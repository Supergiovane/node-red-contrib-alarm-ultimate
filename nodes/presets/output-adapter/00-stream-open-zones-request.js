module.exports = {
  id: "open_zones_request",
  name: "Open Zones (On Request)",
  description:
    'Former Alarm output: "Open Zones (On Request)". Triggered by Alarm setting "Open zones request topic".',
  code: `
if (!msg || typeof msg !== "object") return;
if (msg.event === "open_zones") return msg;
if (msg.event !== "open_zone") return;
const p = msg.payload && typeof msg.payload === "object" ? msg.payload : null;
if (!p) return;
if (p.context !== "request") return;
return msg;
`.trim(),
};
