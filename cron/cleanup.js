const cron = require('node-cron');
const path = require('path');
const fs = require('fs');
const { Screenshot } = require('../db');

const UPLOAD_ROOT = path.join(__dirname, '..', process.env.UPLOAD_DIR || 'uploads');

async function deleteOldScreenshots() {
  const days = Number(process.env.RETENTION_DAYS || 4);
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const oldRows = await Screenshot.find({ capturedAt: { $lt: cutoff } }).lean();

  if (oldRows.length === 0) {
    console.log(`[cleanup] Nothing older than ${days} day(s) to delete.`);
    return;
  }

  for (const row of oldRows) {
    const fullPath = path.join(UPLOAD_ROOT, row.filePath);
    fs.unlink(fullPath, (err) => {
      if (err && err.code !== 'ENOENT') {
        console.error(`[cleanup] Could not delete file ${fullPath}:`, err.message);
      }
    });
  }

  const ids = oldRows.map((r) => r._id);
  await Screenshot.deleteMany({ _id: { $in: ids } });

  console.log(`[cleanup] Deleted ${oldRows.length} screenshot(s) older than ${days} day(s).`);
}

function scheduleCleanup() {
  // Runs once every day at 03:00 server time.
  cron.schedule('0 3 * * *', () => {
    deleteOldScreenshots().catch((err) => console.error('[cleanup] Job failed:', err));
  });

  // Also run once at startup so old files don't wait for the next 3am.
  deleteOldScreenshots().catch((err) => console.error('[cleanup] Startup run failed:', err));

  console.log('[cleanup] Daily auto-delete job scheduled (03:00).');
}

module.exports = { scheduleCleanup, deleteOldScreenshots };