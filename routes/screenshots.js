const express = require('express');
const multer = require('multer');
const { Device, Screenshot } = require('../db');

const router = express.Router();

// Nothing touches local disk - the buffer goes straight into MongoDB.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

// POST /api/screenshots  (multipart/form-data: deviceId, machineName, image)
router.post('/', upload.single('image'), async (req, res) => {
  try {
    const { deviceId, machineName } = req.body;
    if (!deviceId || !req.file) {
      return res.status(400).json({ error: 'deviceId and image are required' });
    }

    await Device.findOneAndUpdate(
      { deviceId },
      { deviceId, machineName: machineName || null, lastSeen: new Date() },
      { upsert: true, new: true }
    );

    await Screenshot.create({
      deviceId,
      imageData: req.file.buffer,
      capturedAt: new Date(),
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// GET /api/screenshots/:deviceId?limit=50 -> metadata only (no image bytes -
// keeps this response small and fast; the dashboard fetches each image
// separately via /api/screenshot-image/:id)
router.get('/:deviceId', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const rows = await Screenshot.find({ deviceId: req.params.deviceId })
      .select('_id capturedAt')
      .sort({ capturedAt: -1 })
      .limit(limit)
      .lean();

    const shaped = rows.map((r) => ({ id: r._id, captured_at: r.capturedAt }));
    res.json(shaped);
  } catch (err) {
    console.error('History fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

module.exports = router;