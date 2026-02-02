module.exports = {
  id: "alarm_triggered",
  name: "Alarm Triggered",
  description:
    'Former Alarm output: "Alarm Triggered". Emits only event messages with msg.event === "alarm".',
  code: `
if (!msg || typeof msg !== "object") return;
if (msg.event !== "alarm") return;
return msg;
`.trim(),
};
