module.exports = {
  id: "any_zone_open",
  name: "Any Zone Open",
  description:
    'Former Alarm output: "Any Zone Open". Emits only messages with msg.topic = controlTopic + "/anyZoneOpen".',
  code: `
if (!msg || typeof msg !== "object") return;
const t = typeof msg.topic === "string" ? msg.topic : "";
if (!t || !t.endsWith("/anyZoneOpen")) return;
return msg;
`.trim(),
};
