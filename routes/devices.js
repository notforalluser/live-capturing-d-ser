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
    remote_control_enabled: d.remoteControlEnabled,
    manager_visibility: {
      live: d.managerVisibility?.live !== false,
      screenshot: d.managerVisibility?.screenshot !== false,
      camera: d.managerVisibility?.camera === true,
      mic: d.managerVisibility?.mic === true,
      remoteControl: d.managerVisibility?.remoteControl === true,
    },
  };
}

function settingsPayload(d) {
  return {
    liveEnabled: d.liveEnabled,
    screenshotEnabled: d.screenshotEnabled,
    screenshotIntervalSeconds: d.screenshotIntervalSeconds,
    cameraEnabled: d.cameraEnabled,
    micEnabled: d.micEnabled,
    remoteControlEnabled: d.remoteControlEnabled,
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
// { liveEnabled?, screenshotEnabled?, screenshotIntervalSeconds?, cameraEnabled?, micEnabled?, remoteControlEnabled? }
// Functional toggles - what the agent actually does. Callable from either
// dashboard; the manager dashboard's UI only exposes the ones a manager
// is allowed to touch (see manager_visibility), enforced client-side same
// as the rest of this app's access model.
router.put('/:deviceId/settings', async (req, res) => {
  try {
    const {
      liveEnabled, screenshotEnabled, screenshotIntervalSeconds,
      cameraEnabled, micEnabled, remoteControlEnabled,
    } = req.body;
    const update = {};
    if (typeof liveEnabled === 'boolean') update.liveEnabled = liveEnabled;
    if (typeof screenshotEnabled === 'boolean') update.screenshotEnabled = screenshotEnabled;
    if (typeof screenshotIntervalSeconds === 'number' && screenshotIntervalSeconds >= 5) {
      update.screenshotIntervalSeconds = screenshotIntervalSeconds;
    }
    if (typeof cameraEnabled === 'boolean') update.cameraEnabled = cameraEnabled;
    if (typeof micEnabled === 'boolean') update.micEnabled = micEnabled;
    if (typeof remoteControlEnabled === 'boolean') update.remoteControlEnabled = remoteControlEnabled;

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

// PUT /api/devices/:deviceId/manager-visibility
// { live?, screenshot?, camera?, mic?, remoteControl? }
// Super Admin only (enforced in the Super Admin dashboard UI - only that
// page renders the controls for this). Controls what the Manager
// Dashboard shows for this employee; does NOT affect whether the agent
// itself has that capability turned on.
router.put('/:deviceId/manager-visibility', async (req, res) => {
  try {
    const { live, screenshot, camera, mic, remoteControl } = req.body;
    const update = {};
    if (typeof live === 'boolean') update['managerVisibility.live'] = live;
    if (typeof screenshot === 'boolean') update['managerVisibility.screenshot'] = screenshot;
    if (typeof camera === 'boolean') update['managerVisibility.camera'] = camera;
    if (typeof mic === 'boolean') update['managerVisibility.mic'] = mic;
    if (typeof remoteControl === 'boolean') update['managerVisibility.remoteControl'] = remoteControl;

    const device = await Device.findOneAndUpdate(
      { deviceId: req.params.deviceId },
      { $set: update },
      { new: true, upsert: true }
    );

    res.json({ ok: true, settings: shapeDevice(device) });
  } catch (err) {
    console.error('Manager visibility update error:', err);
    res.status(500).json({ error: 'Failed to update manager visibility' });
  }
});

module.exports = router;
