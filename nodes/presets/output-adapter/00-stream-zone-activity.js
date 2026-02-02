module.exports = {
  id: "zone_activity",
  name: "Zone Activity",
  description:
    'Former Alarm output: "Zone Activity". Emits zone-related events (msg.topic = controlTopic + "/event").',
  code: `
if (!msg || typeof msg !== "object") return;
const evt = typeof msg.event === "string" ? msg.event : "";
if (!evt) return;
const allowed = new Set([
  "bypassed",
  "unbypassed",
  "chime",
  "zone_open",
  "zone_close",
  "zone_ignored_exit",
  "zone_bypassed_trigger",
  "zone_restore",
  "supervision_lost",
  "supervision_restored",
]);
if (!allowed.has(evt)) return;
return msg;
`.trim(),
};
