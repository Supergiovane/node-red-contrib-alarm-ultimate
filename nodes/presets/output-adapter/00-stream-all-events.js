module.exports = {
  id: "all_events",
  name: "All Events",
  description:
    'Former Alarm output: "All Events". Emits only event messages (msg.topic = controlTopic + "/event").',
  code: `
if (!msg || typeof msg !== "object") return;
const t = typeof msg.topic === "string" ? msg.topic : "";
if (!t || !t.endsWith("/event")) return;
return msg;
`.trim(),
};
