module.exports = {
  id: "axpro_hikvision_ultimate",
  name: "AX Pro (Hikvision Ultimate)",
  description:
    "Maps payload.zoneUpdate from Hikvision-Ultimate AX Pro nodes to {topic,payload} for Alarm zones.",
  code: `
if (!msg || typeof msg !== "object") return;
const zone = msg.payload && msg.payload.zoneUpdate ? msg.payload.zoneUpdate : null;
if (!zone || typeof zone !== "object") return;

const rawTopic =
  typeof zone.name === "string" && zone.name.trim()
    ? zone.name.trim()
    : zone.id !== undefined && zone.id !== null
      ? String(zone.id)
      : "";
if (!rawTopic) return;

let open;
if (typeof zone.magnetOpenStatus === "boolean") {
  open = zone.magnetOpenStatus;
} else if (typeof zone.alarm === "boolean") {
  open = zone.alarm;
} else if (typeof zone.sensorStatus === "string") {
  const v = zone.sensorStatus.trim().toLowerCase();
  open = v !== "normal" && v !== "closed" && v !== "ok";
} else {
  return;
}

return { topic: rawTopic, payload: open, zoneUpdate: zone };
`.trim(),
};

