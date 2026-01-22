module.exports = {
  id: "knx_ultimate",
  name: "KNX Ultimate",
  description: "Uses knx.destination (fallback msg.topic) and converts payload to boolean.",
  code: `
if (!msg || typeof msg !== "object") return;
const topic =
  msg.knx && typeof msg.knx.destination === "string" && msg.knx.destination.trim()
    ? msg.knx.destination.trim()
    : msg.topic;
if (typeof topic !== "string" || !topic.trim()) return;

const value = msg.payload;
let b;
if (typeof value === "boolean") b = value;
else if (typeof value === "number") b = value !== 0;
else if (typeof value === "string") {
  const v = value.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "on" || v === "open") b = true;
  else if (v === "0" || v === "false" || v === "off" || v === "closed") b = false;
  else return;
} else {
  return;
}

return { topic, payload: b };
`.trim(),
};

