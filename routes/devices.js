const express = require('express');
const { Device } = require('../db');
const { onlineAgents } = require('../agentRegistry');

const router = express.Router();

function shapeDevice(d) {
  return {
    device_id: d.deviceId,
    employee_name: d.employeeName,
    machine_name: d.machineName,
    last_seen: d.lastSeen,
    live_enabled: d.liveEnabled,
    screenshot_enabled: d.screenshotEnabled,
    screenshot_interval_seconds: d.screenshotIntervalSeconds,
  };
}

// GET /api/devices -> all known laptops, including their current settings
router.get('/', async (req, res) => {
  try {
    const rows = await Device.find({}).sort({ lastSeen: -1 }).lean();
    res.json(rows.map(shapeDevice));
  } catch (err) {
    console.error('Devices fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch devices' });
  }
});

// PUT /api/devices/:deviceId  { employeeName } -> label a device with a real name
router.put('/:deviceId', async (req, res) => {
  try {
    const { employeeName } = req.body;
    await Device.findOneAndUpdate(
      { deviceId: req.params.deviceId },
      { employeeName },
      { upsert: true }
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Device update error:', err);
    res.status(500).json({ error: 'Failed to update device' });
  }
});

// GET /api/devices/:deviceId/settings -> called by the agent on startup/reconnect
// to learn its current liveEnabled/screenshotEnabled/interval (creates the
// device with defaults if this is the very first time it's been seen).
router.get('/:deviceId/settings', async (req, res) => {
  try {
    let device = await Device.findOne({ deviceId: req.params.deviceId });
    if (!device) {
      device = await Device.create({ deviceId: req.params.deviceId });
    }
    res.json({
      liveEnabled: device.liveEnabled,
      screenshotEnabled: device.screenshotEnabled,
      screenshotIntervalSeconds: device.screenshotIntervalSeconds,
    });
  } catch (err) {
    console.error('Settings fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// PUT /api/devices/:deviceId/settings  { liveEnabled?, screenshotEnabled?, screenshotIntervalSeconds? }
// Called from the admin dashboard. Pushes the change to that laptop's agent
// immediately via Socket.io if it's currently online, so toggles/interval
// changes take effect right away rather than waiting for a poll.
router.put('/:deviceId/settings', async (req, res) => {
  try {
    const { liveEnabled, screenshotEnabled, screenshotIntervalSeconds } = req.body;
    const update = {};
    if (typeof liveEnabled === 'boolean') update.liveEnabled = liveEnabled;
    if (typeof screenshotEnabled === 'boolean') update.screenshotEnabled = screenshotEnabled;
    if (typeof screenshotIntervalSeconds === 'number' && screenshotIntervalSeconds >= 5) {
      update.screenshotIntervalSeconds = screenshotIntervalSeconds;
    }

    const device = await Device.findOneAndUpdate(
      { deviceId: req.params.deviceId },
      { $set: update },
      { new: true, upsert: true }
    );

    const io = req.app.locals.io;
    const socketId = onlineAgents.get(req.params.deviceId);
    if (io && socketId) {
      io.to(socketId).emit('settings:update', {
        liveEnabled: device.liveEnabled,
        screenshotEnabled: device.screenshotEnabled,
        screenshotIntervalSeconds: device.screenshotIntervalSeconds,
      });
    }

    res.json({ ok: true, settings: shapeDevice(device) });
  } catch (err) {
    console.error('Settings update error:', err);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

module.exports = router;