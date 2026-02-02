module.exports = {
  id: "cycle_open_zones",
  name: "Cycle open zones (format)",
  description:
    'Formats Alarm open-zones listing messages into a single text payload (works with msg.event "open_zone"/"open_zones").',
  code: `
if (!msg || typeof msg !== "object") return;
const evt = typeof msg.event === "string" ? msg.event : "";

if (evt === "open_zones") {
  const total = msg.payload && typeof msg.payload.total === "number" ? msg.payload.total : 0;
  if (total === 0) return { ...(msg || {}), payload: "No open zones" };
  return { ...(msg || {}), payload: "Open zones: " + total };
}

if (evt !== "open_zone") return;

const p = msg.payload && typeof msg.payload === "object" ? msg.payload : null;
const zone = p && p.zone && typeof p.zone === "object" ? p.zone : null;
if (!zone) return;

const zoneContext = typeof p.context === "string" ? p.context : "";
const position = typeof p.position === "number" ? p.position : null;
const total = typeof p.total === "number" ? p.total : null;
const name = zone.name || zone.id || "zone";
const pos = position && total ? String(position) + "/" + String(total) : "";
const prefix = zoneContext ? zoneContext + ": " : "";

return {
  ...(msg || {}),
  payload: prefix + (pos ? pos + " " : "") + String(name),
  zone,
  context: zoneContext,
  position,
  total,
};
`.trim(),
};
