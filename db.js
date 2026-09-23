const mongoose = require('mongoose');

// One document per employee laptop.
const deviceSchema = new mongoose.Schema({
  deviceId: { type: String, required: true, unique: true },
  employeeName: { type: String, default: null },
  machineName: { type: String, default: null },
  lastSeen: { type: Date, default: null },
  liveEnabled: { type: Boolean, default: true },
  screenshotEnabled: { type: Boolean, default: true },
  screenshotIntervalSeconds: { type: Number, default: 120 },
  // Camera/mic default to OFF - an admin must explicitly enable each one
  // per employee before "View Camera"/"Listen Mic" will do anything.
  cameraEnabled: { type: Boolean, default: false },
  micEnabled: { type: Boolean, default: false },
  // Set by the agent itself after the one-time consent screen on first
  // launch - not something the admin sets, this reflects what the
  // employee actually agreed to on their own machine.
  cameraMicConsent: { type: String, enum: ['pending', 'granted', 'declined'], default: 'pending' },
}, { timestamps: true });

// One document per stored screenshot - the image bytes themselves live
// directly inside imageData (MongoDB handles this fine for JPEGs well
// under 1MB each). The cron job in cron/cleanup.js deletes documents
// older than RETENTION_DAYS, which is what keeps total DB size bounded.
const screenshotSchema = new mongoose.Schema({
  deviceId: { type: String, required: true, index: true },
  imageData: { type: Buffer, required: true },
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