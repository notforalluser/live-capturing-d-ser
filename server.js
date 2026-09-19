require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const { initDb, Device } = require('./db');
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
    socket.on('agent:online', async ({ deviceId }) => {
      onlineAgents.set(deviceId, socket.id);
      socket.data.role = 'agent';
      socket.data.deviceId = deviceId;
      io.emit('devices:update', Array.from(onlineAgents.keys()));

      // Send this laptop's current settings immediately - covers the case
      // where an admin changed them while this agent was offline/restarting.
      try {
        let device = await Device.findOne({ deviceId });
        if (!device) device = await Device.create({ deviceId });
        socket.emit('settings:update', {
          liveEnabled: device.liveEnabled,
          screenshotEnabled: device.screenshotEnabled,
          screenshotIntervalSeconds: device.screenshotIntervalSeconds,
        });
      } catch (err) {
        console.error('Failed to send initial settings to agent:', err);
      }
    });

    socket.on('viewer:watch', ({ deviceId }) => {
      const agentSocketId = onlineAgents.get(deviceId);
      if (agentSocketId) {
        io.to(agentSocketId).emit('viewer:request', { viewerId: socket.id });
      }
    });

    socket.on('signal', ({ to, data, deviceId }) => {
      io.to(to).emit('signal', { from: socket.id, data, deviceId });
    });

    socket.on('disconnect', () => {
      if (socket.data.role === 'agent' && socket.data.deviceId) {
        onlineAgents.delete(socket.data.deviceId);
        io.emit('devices:update', Array.from(onlineAgents.keys()));
      }
    });

    socket.emit('devices:update', Array.from(onlineAgents.keys()));
  });

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