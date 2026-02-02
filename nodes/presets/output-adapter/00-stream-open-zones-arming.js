module.exports = {
  id: "open_zones_arming",
  name: "Open Zones (Arming)",
  description:
    'Former Alarm output: "Open Zones (Arming)". Requires Alarm setting "Emit open zones while arming".',
  code: `
if (!msg || typeof msg !== "object") return;
if (msg.event !== "open_zone") return;
const p = msg.payload && typeof msg.payload === "object" ? msg.payload : null;
if (!p) return;
if (p.context !== "arming") return;
return msg;
`.trim(),
};
