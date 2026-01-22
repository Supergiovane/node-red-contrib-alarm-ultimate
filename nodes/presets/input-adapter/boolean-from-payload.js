module.exports = {
  id: "boolean_from_payload",
  name: "Boolean from payload",
  description: "Copies msg.topic and converts msg.payload to boolean.",
  code: `
if (typeof msg !== "object" || msg === null) return;
return { topic: msg.topic, payload: !!msg.payload };
`.trim(),
};

