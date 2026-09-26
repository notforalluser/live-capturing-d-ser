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
  // Admin permission gate for remote mouse/keyboard control - same pattern
  // as the other toggles, defaults OFF.
  remoteControlEnabled: { type: Boolean, default: false },
  // What the MEMBER dashboard (shared with any trusted person the Super
  // Admin gives the password to) is allowed to show/control for this
  // employee. Separate from the functional toggles above: e.g. camera can
  // be enabled (cameraEnabled: true) but still hidden from members
  // (managerVisibility.camera: false) until explicitly granted. Once
  // granted, members get the same functional control as the Super Admin
  // for that category on that employee (not just viewing).
  managerVisibility: {
    live: { type: Boolean, default: true },
    screenshot: { type: Boolean, default: true },
    camera: { type: Boolean, default: false },
    mic: { type: Boolean, default: false },
    remoteControl: { type: Boolean, default: false },
  },
}, { timestamps: true });

// One document per stored screenshot - the image bytes themselves live
// directly inside imageData (MongoDB handles this fine for JPEGs well
// under 1MB each). The cron job in cron/cleanup.js deletes documents
// older than RETENTION_DAYS, which is what keeps total DB size bounded.
const screenshotSchema = new mongoose.Schema({
  deviceId: { type: String, required: true, index: true },
  imageData: { type: Buffer, required: true },
  capturedAt: { type: Date, required: true, index: true },
  // Per-image override, admin-only - default visible to the team. Hiding
  // one image never affects any other, and never affects the functional
  // screenshot_enabled toggle.
  hiddenFromTeam: { type: Boolean, default: false },
});

// One document per notable action taken from either dashboard - who did
// what, on which employee, and when. Visible only on the Super Admin
// dashboard, useful now that access is shared with multiple trusted people.
const activityLogSchema = new mongoose.Schema({
  viewerRole: { type: String, required: true }, // 'super_admin' | 'member'
  viewerName: { type: String, required: true },
  action: { type: String, required: true }, // e.g. 'viewed_camera', 'started_remote_control'
  deviceId: { type: String, default: null },
  deviceLabel: { type: String, default: null },
  at: { type: Date, default: Date.now },
});

const Device = mongoose.model('Device', deviceSchema);
const Screenshot = mongoose.model('Screenshot', screenshotSchema);
const ActivityLog = mongoose.model('ActivityLog', activityLogSchema);

async function initDb() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('MongoDB connected:', process.env.MONGODB_URI);
  return { Device, Screenshot, ActivityLog };
}

module.exports = { initDb, Device, Screenshot, ActivityLog };
