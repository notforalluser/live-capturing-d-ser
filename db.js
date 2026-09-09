const mongoose = require('mongoose');

// One document per employee laptop. Auto-created the first time that
// device's agent talks to the server.
const deviceSchema = new mongoose.Schema({
  deviceId: { type: String, required: true, unique: true },
  employeeName: { type: String, default: null },
  machineName: { type: String, default: null },
  lastSeen: { type: Date, default: null },
}, { timestamps: true });

// One document per stored screenshot. The cron job in cron/cleanup.js
// deletes documents (and their files) older than RETENTION_DAYS.
const screenshotSchema = new mongoose.Schema({
  deviceId: { type: String, required: true, index: true },
  filePath: { type: String, required: true },
  capturedAt: { type: Date, required: true, index: true },
});

const Device = mongoose.model('Device', deviceSchema);
const Screenshot = mongoose.model('Screenshot', screenshotSchema);

async function initDb() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('MongoDB connected:', process.env.MONGODB_URI);
  return { Device, Screenshot };
}

module.exports = { initDb, Device, Screenshot };