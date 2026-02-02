module.exports = {
  id: "arm_disarm_updates",
  name: "Arm/Disarm Updates",
  description:
    'Former Alarm output: "Arm/Disarm Updates". Emits arming/state related events (msg.topic = controlTopic + "/event").',
  code: `
if (!msg || typeof msg !== "object") return;
const evt = typeof msg.event === "string" ? msg.event : "";
if (!evt) return;
const allowed = new Set([
  "arming",
  "armed",
  "disarmed",
  "entry_delay",
  "arm_blocked",
  "already_armed",
  "status",
  "reset",
  "siren_on",
  "siren_off",
]);
if (!allowed.has(evt)) return;
return msg;
`.trim(),
};
