module.exports = {
  id: "open_zones_cycle",
  name: "Open Zones (Cycle)",
  description:
    'Cycles open zones at a fixed interval (msg.event "open_zone" with payload.context = "cycle"). Requires Alarm setting "Cycle open zones (always)".',
  code: `
if (!msg || typeof msg !== "object") return;
if (msg.event !== "open_zone") return;
const p = msg.payload && typeof msg.payload === "object" ? msg.payload : null;
if (!p) return;
if (p.context !== "cycle") return;
return msg;
`.trim(),
};

