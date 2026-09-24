// Shared between server.js (socket handling) and routes/devices.js (pushing
// live settings changes to a specific agent the moment an admin changes them).
const onlineAgents = new Map(); // deviceId -> socket.id

module.exports = { onlineAgents };
