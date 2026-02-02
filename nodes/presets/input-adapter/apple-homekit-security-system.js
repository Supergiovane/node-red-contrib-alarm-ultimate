module.exports = {
  id: "apple_homekit_security_system",
  name: "Apple HomeKit Security System",
  description:
    "Maps HomeKit SecuritySystemTargetState/CurrentState (0..4) to AlarmSystemUltimate control commands (arm_home/arm_away/arm_night/disarm).",
  code: `
if (!msg || typeof msg !== "object") return;

const resolvedTopic =
  (typeof msg.topic === "string" && msg.topic.trim()) ||
  (typeof msg.controlTopic === "string" && msg.controlTopic.trim()) ||
  (msg.payload && typeof msg.payload.controlTopic === "string" && msg.payload.controlTopic.trim()) ||
  "";

function pickState(payload) {
  if (typeof payload === "number" || typeof payload === "string") return payload;
  if (!payload || typeof payload !== "object") return undefined;

  const direct =
    payload.SecuritySystemTargetState ??
    payload.securitySystemTargetState ??
    payload.TargetState ??
    payload.targetState ??
    payload["Security System Target State"] ??
    payload.SecuritySystemCurrentState ??
    payload.securitySystemCurrentState ??
    payload.CurrentState ??
    payload.currentState ??
    payload["Security System Current State"];
  if (direct !== undefined && direct !== null) return direct;

  const characteristic =
    (typeof payload.Characteristic === "string" && payload.Characteristic) ||
    (typeof payload.characteristic === "string" && payload.characteristic) ||
    "";
  if (characteristic && payload.value !== undefined) {
    const c = characteristic.toLowerCase();
    if (c.includes("security") && (c.includes("target") || c.includes("current"))) {
      return payload.value;
    }
  }

  const type = typeof payload.type === "string" ? payload.type : "";
  if (type && payload.value !== undefined) {
    const t = type.toLowerCase();
    if (t.includes("securitysystemtargetstate") || t.includes("securitysystemcurrentstate")) {
      return payload.value;
    }
  }

  return undefined;
}

function normalizeState(value) {
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value !== "string") return undefined;

  const s = value.trim().toLowerCase();
  if (!s) return undefined;

  if (s === "0" || s === "stay" || s === "stayarm" || s === "arm_stay" || s === "armed_stay" || s === "home" || s === "arm_home" || s === "armed_home") return 0;
  if (s === "1" || s === "away" || s === "awayarm" || s === "arm_away" || s === "armed_away") return 1;
  if (s === "2" || s === "night" || s === "nightarm" || s === "arm_night" || s === "armed_night") return 2;
  if (s === "3" || s === "disarm" || s === "disarmed" || s === "off") return 3;
  if (s === "4" || s === "alarm" || s === "triggered" || s === "alarm_triggered") return 4;

  const n = Number(s);
  if (!Number.isNaN(n)) return n;
  return undefined;
}

const raw = pickState(msg.payload);
const state = normalizeState(raw);
if (state === undefined) return;

// HomeKit Security System values:
// 0 = stay arm, 1 = away arm, 2 = night arm, 3 = disarmed, 4 = alarm triggered
//
// AlarmSystemUltimate has a single armed/disarmed mode, but it accepts legacy
// arming commands. Emitting the specific command keeps semantics available
// for downstream flows while still working with the Alarm node.
let command = "";
if (state === 3) command = "disarm";
else if (state === 0) command = "arm_home";
else if (state === 1) command = "arm_away";
else if (state === 2) command = "arm_night";
else return; // ignore "triggered" and unknown values

const out = { ...(msg || {}) };
if (resolvedTopic) out.topic = resolvedTopic;
out.command = command;
out.homekit = { ...(out.homekit || {}), securitySystemState: state };
return out;
`.trim(),
};
