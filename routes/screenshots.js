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

// GET /api/screenshots/:deviceId?limit=50&forTeam=true
// forTeam=true (used only by member-app.js) filters out anything the admin
// has hidden from the team. Omitted (admin-app.js) returns everything,
// hidden or not, along with the hidden_from_team flag so the admin UI can
// show its indicator.
router.get('/:deviceId', async (req, res) => {
  try {
    // limit=all (used by the gallery view, which groups everything by date)
    // fetches everything up to a generous safety ceiling. A plain number
    // still works as before for anything that wants a small page.
    const HARD_CEILING = 5000;
    const limit = req.query.limit === 'all'
      ? HARD_CEILING
      : Math.min(Number(req.query.limit) || 50, HARD_CEILING);
    const query = { deviceId: req.params.deviceId };
    if (req.query.forTeam === 'true') {
      query.hiddenFromTeam = { $ne: true };
    }

    const rows = await Screenshot.find(query)
      .select('_id capturedAt hiddenFromTeam')
      .sort({ capturedAt: -1 })
      .limit(limit)
      .lean();

    const shaped = rows.map((r) => ({
      id: r._id,
      captured_at: r.capturedAt,
      hidden_from_team: !!r.hiddenFromTeam,
    }));
    res.json(shaped);
  } catch (err) {
    console.error('History fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

// PUT /api/screenshots/:id/visibility  { hidden: true|false }
// Admin-only usage (only admin-app.js has UI for this) - toggles whether
// one specific image is visible on the team dashboard.
router.put('/:id/visibility', async (req, res) => {
  try {
    const { hidden } = req.body;
    if (typeof hidden !== 'boolean') {
      return res.status(400).json({ error: 'hidden (boolean) is required' });
    }
    const updated = await Screenshot.findByIdAndUpdate(
      req.params.id,
      { hiddenFromTeam: hidden },
      { new: true }
    );
    if (!updated) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true, hidden_from_team: updated.hiddenFromTeam });
  } catch (err) {
    console.error('Visibility update error:', err);
    res.status(500).json({ error: 'Failed to update visibility' });
  }
});

// POST /api/screenshots/hide-many  { ids: [...], hidden: true|false }
// Bulk version for the admin dashboard's multi-select actions.
router.post('/hide-many', async (req, res) => {
  try {
    const { ids, hidden } = req.body;
    if (!Array.isArray(ids) || ids.length === 0 || typeof hidden !== 'boolean') {
      return res.status(400).json({ error: 'ids array and hidden (boolean) are required' });
    }
    const result = await Screenshot.updateMany({ _id: { $in: ids } }, { hiddenFromTeam: hidden });
    res.json({ ok: true, modifiedCount: result.modifiedCount });
  } catch (err) {
    console.error('Bulk visibility update error:', err);
    res.status(500).json({ error: 'Failed to update visibility' });
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
