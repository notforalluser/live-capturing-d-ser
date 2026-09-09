const express = require('express');
const { Device } = require('../db');

const router = express.Router();

// GET /api/devices -> all known laptops + when they were last seen
router.get('/', async (req, res) => {
  try {
    const rows = await Device.find({}).sort({ lastSeen: -1 }).lean();
    const shaped = rows.map((d) => ({
      device_id: d.deviceId,
      employee_name: d.employeeName,
      machine_name: d.machineName,
      last_seen: d.lastSeen,
    }));
    res.json(shaped);
  } catch (err) {
    console.error('Devices fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch devices' });
  }
});

// PUT /api/devices/:deviceId  { employeeName } -> label a device with a real name
router.put('/:deviceId', async (req, res) => {
  try {
    const { employeeName } = req.body;
    await Device.findOneAndUpdate({ deviceId: req.params.deviceId }, { employeeName });
    res.json({ ok: true });
  } catch (err) {
    console.error('Device update error:', err);
    res.status(500).json({ error: 'Failed to update device' });
  }
});

module.exports = router;