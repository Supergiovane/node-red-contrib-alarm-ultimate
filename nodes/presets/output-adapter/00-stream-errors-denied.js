module.exports = {
  id: "errors_denied",
  name: "Errors/Denied",
  description:
    'Former Alarm output: "Errors/Denied". Emits only msg.event === "error" or "denied" (msg.topic = controlTopic + "/event").',
  code: `
if (!msg || typeof msg !== "object") return;
if (msg.event !== "error" && msg.event !== "denied") return;
return msg;
`.trim(),
};
