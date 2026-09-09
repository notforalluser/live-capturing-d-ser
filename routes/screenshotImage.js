const express = require('express');
const { Screenshot } = require('../db');

const router = express.Router();

// Separate query-param auth (not the header-based one) since <img src="...">
// can't send custom headers. Mounted at a path that doesn't collide with
// the header-gated /api/screenshots routes - see server.js.
router.get('/:id', async (req, res) => {
  try {
    if (req.query.apiKey !== process.env.API_KEY) {
      return res.status(401).send('Unauthorized');
    }

    const shot = await Screenshot.findById(req.params.id).select('imageData').lean();
    if (!shot) return res.status(404).send('Not found');

    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'private, max-age=3600'); // image never changes once stored
    res.send(shot.imageData.buffer || shot.imageData);
  } catch (err) {
    console.error('Image fetch error:', err);
    res.status(500).send('Failed to load image');
  }
});

module.exports = router;