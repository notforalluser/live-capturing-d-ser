const cron = require('node-cron');
const { Screenshot } = require('../db');

async function deleteOldScreenshots() {
  const days = Number(process.env.RETENTION_DAYS || 4);
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const result = await Screenshot.deleteMany({ capturedAt: { $lt: cutoff } });

  if (result.deletedCount > 0) {
    console.log(`[cleanup] Deleted ${result.deletedCount} screenshot(s) older than ${days} day(s).`);
  } else {
    console.log(`[cleanup] Nothing older than ${days} day(s) to delete.`);
  }
}

function scheduleCleanup() {
  cron.schedule('0 3 * * *', () => {
    deleteOldScreenshots().catch((err) => console.error('[cleanup] Job failed:', err));
  });

  deleteOldScreenshots().catch((err) => console.error('[cleanup] Startup run failed:', err));

  console.log('[cleanup] Daily auto-delete job scheduled (03:00).');
}

module.exports = { scheduleCleanup, deleteOldScreenshots };