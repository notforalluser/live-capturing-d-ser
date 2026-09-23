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
    camera_enabled: d.cameraEnabled,
    mic_enabled: d.micEnabled,
    camera_mic_consent: d.cameraMicConsent,
  };
}

function settingsPayload(d) {
  return {
    liveEnabled: d.liveEnabled,
    screenshotEnabled: d.screenshotEnabled,
    screenshotIntervalSeconds: d.screenshotIntervalSeconds,
    cameraEnabled: d.cameraEnabled,
    micEnabled: d.micEnabled,
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
router.get('/:deviceId/settings', async (req, res) => {
  try {
    let device = await Device.findOne({ deviceId: req.params.deviceId });
    if (!device) {
      device = await Device.create({ deviceId: req.params.deviceId });
    }
    res.json(settingsPayload(device));
  } catch (err) {
    console.error('Settings fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// PUT /api/devices/:deviceId/settings
// { liveEnabled?, screenshotEnabled?, screenshotIntervalSeconds?, cameraEnabled?, micEnabled? }
// Pushes the change to that laptop's agent immediately via Socket.io if
// it's currently online, so toggles take effect right away.
router.put('/:deviceId/settings', async (req, res) => {
  try {
    const { liveEnabled, screenshotEnabled, screenshotIntervalSeconds, cameraEnabled, micEnabled } = req.body;
    const update = {};
    if (typeof liveEnabled === 'boolean') update.liveEnabled = liveEnabled;
    if (typeof screenshotEnabled === 'boolean') update.screenshotEnabled = screenshotEnabled;
    if (typeof screenshotIntervalSeconds === 'number' && screenshotIntervalSeconds >= 5) {
      update.screenshotIntervalSeconds = screenshotIntervalSeconds;
    }
    if (typeof cameraEnabled === 'boolean') update.cameraEnabled = cameraEnabled;
    if (typeof micEnabled === 'boolean') update.micEnabled = micEnabled;

    const device = await Device.findOneAndUpdate(
      { deviceId: req.params.deviceId },
      { $set: update },
      { new: true, upsert: true }
    );

    const io = req.app.locals.io;
    const socketId = onlineAgents.get(req.params.deviceId);
    if (io && socketId) {
      io.to(socketId).emit('settings:update', settingsPayload(device));
    }

    res.json({ ok: true, settings: shapeDevice(device) });
  } catch (err) {
    console.error('Settings update error:', err);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

module.exports = router;