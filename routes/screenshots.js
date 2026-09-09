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

// DELETE /api/screenshots/:id -> delete one screenshot by its document ID
router.delete('/:id', async (req, res) => {
  try {
    const deleted = await Screenshot.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ error: 'Failed to delete' });
  }
});

// POST /api/screenshots/delete-many  { ids: [...] } -> bulk delete for the
// dashboard's "Delete Selected" button
router.post('/delete-many', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids array is required' });
    }
    const result = await Screenshot.deleteMany({ _id: { $in: ids } });
    res.json({ ok: true, deletedCount: result.deletedCount });
  } catch (err) {
    console.error('Bulk delete error:', err);
    res.status(500).json({ error: 'Failed to delete' });
  }
});

module.exports = router;