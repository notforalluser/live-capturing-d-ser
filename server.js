require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const { initDb } = require('./db');
const { requireApiKey } = require('./auth');
const { scheduleCleanup } = require('./cron/cleanup');

const screenshotRoutes = require('./routes/screenshots');
const deviceRoutes = require('./routes/devices');

async function main() {
  await initDb();

  const app = express();
  app.use(cors());
  app.use(express.json());

  // Everything under /api requires the shared API key.
  app.use('/api/screenshots', requireApiKey, screenshotRoutes);
  app.use('/api/devices', requireApiKey, deviceRoutes);

  // Serve stored screenshot images (still gated by the key via query param,
  // since <img> tags can't send custom headers).
  app.use(
    '/uploads',
    (req, res, next) => {
      if (req.query.apiKey !== process.env.API_KEY) {
        return res.status(401).send('Unauthorized');
      }
      next();
    },
    express.static(path.join(__dirname, process.env.UPLOAD_DIR || 'uploads'))
  );

  // Serve the dashboard (plain HTML/JS, no build step) from ../dashboard
  app.use('/', express.static(path.join(__dirname, '..', 'dashboard')));

  app.get('/health', (req, res) => res.json({ ok: true }));

  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: '*' } });

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

  const onlineAgents = new Map(); // deviceId -> socket.id

  io.on('connection', (socket) => {
    socket.on('agent:online', ({ deviceId }) => {
      onlineAgents.set(deviceId, socket.id);
      socket.data.role = 'agent';
      socket.data.deviceId = deviceId;
      io.emit('devices:update', Array.from(onlineAgents.keys()));
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
