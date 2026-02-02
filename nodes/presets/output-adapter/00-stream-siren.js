module.exports = {
  id: "siren",
  name: "Siren",
  description:
    'Former Alarm output: "Siren". Emits only siren messages (msg.topic = Siren topic).',
  code: `
if (!msg || typeof msg !== "object") return;
const t = typeof msg.topic === "string" ? msg.topic : "";
if (!t || !t.endsWith("/siren")) return;
return msg;
`.trim(),
};
