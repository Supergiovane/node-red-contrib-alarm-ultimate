module.exports = {
  id: "homekit_security_system",
  name: "HomeKit Security System (basic)",
  description:
    "Maps AlarmSystemUltimate events to HomeKit SecuritySystem states. TargetState follows requested state; CurrentState follows actual state (during arming, CurrentState remains previous).",
  code: `
if (!msg || typeof msg !== "object") return;

const evt = typeof msg.event === "string" ? msg.event : "";

// Allow override upstream (e.g. Change node).
let target = msg.homekitTargetState;
if (typeof target !== "number") target = undefined;

function stateForEvent(e) {
  if (e === "disarmed" || e === "reset") return 3;
  if (e === "alarm") return 4;
  if (e === "armed" || e === "arming") return 1; // AWAY
  return undefined;
}

const desiredTarget = target !== undefined ? target : stateForEvent(evt);
if (desiredTarget === undefined) return;

const nodeCtx = context && context.node && typeof context.node.get === "function" ? context.node : null;
const lastTarget = nodeCtx ? nodeCtx.get("homekitTargetState") : undefined;
const lastCurrent = nodeCtx ? nodeCtx.get("homekitCurrentState") : undefined;

// HomeKit: TargetState valid values are typically 0..3. CurrentState can be 0..4 (ALARM_TRIGGERED = 4).
// On "arming" we update only TargetState, keeping CurrentState at the previous state.
let outTarget = desiredTarget;
let outCurrent = desiredTarget;

if (evt === "arming") {
  outCurrent = typeof lastCurrent === "number" ? lastCurrent : 3;
}

if (evt === "alarm") {
  outCurrent = 4;
  // Keep target to last requested state if available; fallback to AWAY (1).
  outTarget = typeof lastTarget === "number" ? lastTarget : 1;
}

// Keep state memory.
if (nodeCtx) {
  nodeCtx.set("homekitTargetState", outTarget);
  nodeCtx.set("homekitCurrentState", outCurrent);
}

const out = { ...(msg || {}) };
out.payload = {
  SecuritySystemTargetState: outTarget,
  SecuritySystemCurrentState: outCurrent,
};
return out;
`.trim(),
};
