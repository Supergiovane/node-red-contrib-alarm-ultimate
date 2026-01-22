module.exports = {
  id: "home_assistant_on_off",
  name: "Home Assistant on/off",
  description: 'Converts msg.payload "on"/"off" (or boolean) to boolean payload.',
  code: `
if (!msg || typeof msg !== "object") return;
const topic = msg.topic;
const value = msg.payload;
let b;
if (typeof value === "boolean") b = value;
else if (typeof value === "string") {
  const v = value.trim().toLowerCase();
  if (v === "on" || v === "open" || v === "true" || v === "1") b = true;
  else if (v === "off" || v === "closed" || v === "false" || v === "0") b = false;
  else return;
} else if (typeof value === "number") {
  b = value !== 0;
} else {
  return;
}
return { topic, payload: b };
`.trim(),
};

