require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const { initDb, Device, ActivityLog } = require('./db');
const { requireApiKey } = require('./auth');
const { scheduleCleanup } = require('./cron/cleanup');
const { onlineAgents } = require('./agentRegistry');

const screenshotRoutes = require('./routes/screenshots');
const deviceRoutes = require('./routes/devices');
const screenshotImageRoutes = require('./routes/screenshotImage');

async function main() {
  await initDb();

  const app = express();
  app.use(cors());
  app.use(express.json());

  // Everything under /api requires the shared API key.
  app.use('/api/screenshots', requireApiKey, screenshotRoutes);
  app.use('/api/devices', requireApiKey, deviceRoutes);

  // Separate path (not under /api/screenshots) so it isn't caught by the
  // header-based requireApiKey above - this route checks the key itself,
  // via query param, since <img> tags can't send custom headers.
  app.use('/api/screenshot-image', screenshotImageRoutes);

  // Screenshot images now live in R2/S3, not on local disk - the history
  // endpoint returns short-lived signed URLs directly, so no static route
  // is needed here anymore (and nothing here survives a Render restart
  // anyway, which is exactly the problem this change fixes).

  // The dashboard is deployed separately (e.g. on Vercel) and just points
  // at this server's URL - this backend only needs to serve the API,
  // uploaded screenshots, and WebRTC signaling.
  app.get('/', (req, res) => {
    res.json({ ok: true, message: 'Employee monitor backend is running.' });
  });

  app.get('/health', (req, res) => res.json({ ok: true }));

  // Recent activity across both dashboards - only admin-app.js has UI for
  // this, but the endpoint itself just uses the same shared API key as
  // everything else in this app.
  app.get('/api/activity-log', requireApiKey, async (req, res) => {
    try {
      const logs = await ActivityLog.find({}).sort({ at: -1 }).limit(100).lean();
      res.json(logs);
    } catch (err) {
      console.error('Activity log fetch error:', err);
      res.status(500).json({ error: 'Failed to fetch activity log' });
    }
  });

  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: '*' } });
  app.locals.io = io; // lets routes/devices.js push settings changes to a live agent

  // ---- WebRTC signaling (live view only, nothing is stored here) ----
  // Agents join a room named after their deviceId and announce themselves.
  // The dashboard (viewer) asks to watch a deviceId; the server just
  // relays SDP offers/answers and ICE candidates between the two sides -
  // the actual video never passes through this server once WebRTC
  // negotiation succeeds (or through it only as a relay if a direct
  // path isn't possible - see TURN note in README).

  io.use((socket, next) => {
    if (socket.handshake.auth?.apiKey !== process.env.API_KEY) {
      return next(new Error('Invalid API key'));
    }
    next();
  });

  io.on('connection', (socket) => {
    // ---- Dashboard viewer presence ----
    // A dashboard socket calls this right after unlocking with a valid
    // password, identifying its role/name. Members are NEVER told about
    // the admin's presence - broadcastViewers() below filters that out
    // entirely, not just by omitting a label.
    socket.on('viewer:identify', ({ role, clientTag }) => {
      socket.data.role = 'viewer';
      socket.data.viewerRole = role; // 'super_admin' | 'member'

      if (role === 'super_admin') {
        socket.data.viewerName = 'Super Admin';
      } else {
        // No name entry for members - identify automatically by public IP
        // (behind Render's proxy, the real client IP is in x-forwarded-for)
        // plus a short per-browser tag so two people behind the same
        // office NAT still show up as distinct entries.
        const forwarded = socket.handshake.headers['x-forwarded-for'];
        const ip = forwarded ? forwarded.split(',')[0].trim() : socket.handshake.address;
        socket.data.viewerName = clientTag ? `Member-${clientTag} (${ip})` : `Member (${ip})`;
      }

      broadcastViewers();
    });

    // Any dashboard action worth a record - toggles, camera/mic views,
    // remote control sessions. Stored for the admin's Activity Log.
    socket.on('activity:log', async ({ action, deviceId, deviceLabel }) => {
      if (socket.data.role !== 'viewer') return;
      try {
        const entry = await ActivityLog.create({
          viewerRole: socket.data.viewerRole,
          viewerName: socket.data.viewerName,
          action,
          deviceId: deviceId || null,
          deviceLabel: deviceLabel || null,
        });
        // Push live to admin sockets only.
        for (const [, s] of io.of('/').sockets) {
          if (s.data.role === 'viewer' && s.data.viewerRole === 'super_admin') {
            s.emit('activity:new', entry);
          }
        }
      } catch (err) {
        console.error('Activity log write failed:', err);
      }
    });

    socket.on('agent:online', async ({ deviceId, cameraMicConsent }) => {
      onlineAgents.set(deviceId, socket.id);
      socket.data.role = 'agent';
      socket.data.deviceId = deviceId;
      io.emit('devices:update', Array.from(onlineAgents.keys()));

      // Send this laptop's current settings immediately - covers the case
      // where an admin changed them while this agent was offline/restarting.
      try {
        let device = await Device.findOne({ deviceId });
        if (!device) device = await Device.create({ deviceId });
        if (cameraMicConsent && cameraMicConsent !== device.cameraMicConsent) {
          device.cameraMicConsent = cameraMicConsent;
          await device.save();
        }
        socket.emit('settings:update', {
          liveEnabled: device.liveEnabled,
          screenshotEnabled: device.screenshotEnabled,
          screenshotIntervalSeconds: device.screenshotIntervalSeconds,
          cameraEnabled: device.cameraEnabled,
          micEnabled: device.micEnabled,
          remoteControlEnabled: device.remoteControlEnabled,
        });
      } catch (err) {
        console.error('Failed to send initial settings to agent:', err);
      }
    });

    // kind: 'screen' (default) or 'camera' - lets the dashboard request
    // either stream independently, even both at once for the same device.
    socket.on('viewer:watch', ({ deviceId, kind }) => {
      const agentSocketId = onlineAgents.get(deviceId);
      if (agentSocketId) {
        io.to(agentSocketId).emit('viewer:request', { viewerId: socket.id, kind: kind || 'screen' });
      }
    });

    socket.on('signal', ({ to, data, deviceId, kind }) => {
      io.to(to).emit('signal', { from: socket.id, data, deviceId, kind: kind || 'screen' });
    });

    // ---- Remote control relay (mouse/keyboard) ----
    // The agent enforces remoteControlEnabled itself before acting on any
    // of these - this server just passes messages between admin and agent.
    socket.on('remote:start', ({ deviceId }) => {
      const agentSocketId = onlineAgents.get(deviceId);
      if (agentSocketId) io.to(agentSocketId).emit('remote:start', { viewerId: socket.id });
    });

    socket.on('remote:stop', ({ deviceId }) => {
      const agentSocketId = onlineAgents.get(deviceId);
      if (agentSocketId) io.to(agentSocketId).emit('remote:stop', {});
    });

    socket.on('remote:input', ({ deviceId, input }) => {
      const agentSocketId = onlineAgents.get(deviceId);
      if (agentSocketId) io.to(agentSocketId).emit('remote:input', input);
    });

    // Agent reports its real screen size back to the requesting viewer,
    // so the dashboard can translate click coordinates correctly.
    socket.on('remote:screen-info', ({ to, deviceId, width, height }) => {
      io.to(to).emit('remote:screen-info', { deviceId, width, height });
    });

    socket.on('disconnect', () => {
      if (socket.data.role === 'agent' && socket.data.deviceId) {
        onlineAgents.delete(socket.data.deviceId);
        io.emit('devices:update', Array.from(onlineAgents.keys()));
      }
      if (socket.data.role === 'viewer') {
        broadcastViewers();
      }
    });

    socket.emit('devices:update', Array.from(onlineAgents.keys()));
  });

  function broadcastViewers() {
    const memberViewers = [];
    for (const [, s] of io.of('/').sockets) {
      if (s.data.role === 'viewer' && s.data.viewerRole !== 'super_admin') {
        memberViewers.push({ name: s.data.viewerName, role: s.data.viewerRole });
      }
    }
    // Everyone (admin included) only ever sees the member list - the admin's
    // own presence is never broadcast to anyone, including other admins,
    // since there's only ever one admin password anyway.
    for (const [, s] of io.of('/').sockets) {
      if (s.data.role === 'viewer') {
        s.emit('viewers:update', memberViewers);
      }
    }
  }

  scheduleCleanup();

  const PORT = process.env.PORT || 4000;
  server.listen(PORT, () => {
    console.log(`Monitor server running on http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
