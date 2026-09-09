const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { Device, Screenshot } = require('../db');

const router = express.Router();

const UPLOAD_ROOT = path.join(__dirname, '..', process.env.UPLOAD_DIR || 'uploads');

// Store files as uploads/<deviceId>/<timestamp>.jpg
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const deviceId = req.body.deviceId || 'unknown';
    const dir = path.join(UPLOAD_ROOT, deviceId);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}.jpg`);
  },
});

const upload = multer({ storage, limits: { fileSize: 8 * 1024 * 1024 } });

// POST /api/screenshots  (multipart/form-data: deviceId, machineName, image)
router.post('/', upload.single('image'), async (req, res) => {
  try {
    const { deviceId, machineName } = req.body;
    if (!deviceId || !req.file) {
      return res.status(400).json({ error: 'deviceId and image are required' });
    }

    const relativePath = path.relative(UPLOAD_ROOT, req.file.path).replace(/\\/g, '/');

    // Upsert the device's "last seen" info
    await Device.findOneAndUpdate(
      { deviceId },
      { deviceId, machineName: machineName || null, lastSeen: new Date() },
      { upsert: true, new: true }
    );

    await Screenshot.create({
      deviceId,
      filePath: relativePath,
      capturedAt: new Date(),
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// GET /api/screenshots/:deviceId?limit=50 -> most recent screenshots for one device
router.get('/:deviceId', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const rows = await Screenshot.find({ deviceId: req.params.deviceId })
      .sort({ capturedAt: -1 })
      .limit(limit)
      .lean();

    // Match the field shape the dashboard expects
    const shaped = rows.map((r) => ({
      id: r._id,
      file_path: r.filePath,
      captured_at: r.capturedAt,
    }));

    res.json(shaped);
  } catch (err) {
    console.error('History fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

module.exports = router;