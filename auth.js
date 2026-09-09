// Simple shared-secret auth. Since this is a single-admin internal tool,
// one API key for both the agents (uploading) and the dashboard (viewing)
// is enough - no need for a full user/role system.

function requireApiKey(req, res, next) {
  const key = req.header('x-api-key') || req.query.apiKey;
  if (!key || key !== process.env.API_KEY) {
    return res.status(401).json({ error: 'Invalid or missing API key' });
  }
  next();
}

module.exports = { requireApiKey };
