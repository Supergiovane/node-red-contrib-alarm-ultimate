'use strict';

// Shared Home Assistant mapping helpers.
//
// Used by:
// - the native MQTT bridge (AlarmSystemUltimate) for alarm_control_panel discovery,
// - the "Home Assistant" adapter of the Alarm State node.
//
// HA alarm_control_panel states:
//   disarmed | arming | pending | triggered | armed_away | armed_home | armed_night

const HA_STATES = {
  DISARMED: 'disarmed',
  ARMING: 'arming',
  PENDING: 'pending',
  TRIGGERED: 'triggered',
  ARMED_AWAY: 'armed_away',
  ARMED_HOME: 'armed_home',
  ARMED_NIGHT: 'armed_night',
};

// Normalize an arm-mode hint (away/home/night, in any common spelling) to a HA armed_* state.
// Returns null when the value is not a recognized arm mode.
function normalizeArmMode(value) {
  const s = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!s) return null;
  if (['armed_home', 'home', 'stay', 'arm_home'].includes(s)) return HA_STATES.ARMED_HOME;
  if (['armed_night', 'night', 'arm_night'].includes(s)) return HA_STATES.ARMED_NIGHT;
  if (['armed_away', 'away', 'arm_away', 'armed', 'arm'].includes(s)) return HA_STATES.ARMED_AWAY;
  return null;
}

// The HA armed_* state for a generic "armed" mode, given an optional arm-mode hint.
function armedLabel(armMode) {
  return normalizeArmMode(armMode) || HA_STATES.ARMED_AWAY;
}

// Map an Alarm Ultimate event + global mode to a HA alarm_control_panel state.
// `armMode` is an optional hint used to pick armed_away vs armed_home/night.
// Returns null for events that should not change the published HA state.
function eventToHaState(event, mode, armMode) {
  const e = typeof event === 'string' ? event : '';
  if (e === 'disarmed' || e === 'reset') return HA_STATES.DISARMED;
  if (e === 'arming') return HA_STATES.ARMING;
  if (e === 'entry_delay') return HA_STATES.PENDING;
  if (e === 'alarm') return HA_STATES.TRIGGERED;
  if (e === 'armed') return armedLabel(armMode);
  // For non-transition events fall back on the global mode (used for initial sync / status).
  if (e === 'status') {
    if (mode === 'armed') return armedLabel(armMode);
    if (mode === 'disarmed') return HA_STATES.DISARMED;
  }
  return null;
}

// Parse a HA alarm_control_panel command payload into a control action.
// Accepts a plain string (ARM_AWAY, ARM_HOME, ARM_NIGHT, DISARM, TRIGGER, ...) or an
// object carrying it under action/command/state/payload (plus an optional `code`).
// Returns { command, armMode?, code? } or null when unrecognized.
function parseHaCommand(payload) {
  let raw = payload;
  let code;
  if (raw && typeof raw === 'object') {
    if (typeof raw.code === 'string' && raw.code.trim()) code = raw.code.trim();
    raw = raw.action != null ? raw.action : raw.command != null ? raw.command : raw.state != null ? raw.state : raw.payload;
  }
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;

  let result = null;
  switch (s) {
    case 'disarm':
    case 'disarmed':
    case 'off':
      result = { command: 'disarm' };
      break;
    case 'arm_away':
    case 'armed_away':
    case 'away':
    case 'arm':
    case 'armed':
      result = { command: 'arm', armMode: HA_STATES.ARMED_AWAY };
      break;
    case 'arm_home':
    case 'armed_home':
    case 'home':
    case 'stay':
      result = { command: 'arm', armMode: HA_STATES.ARMED_HOME };
      break;
    case 'arm_night':
    case 'armed_night':
    case 'night':
      result = { command: 'arm', armMode: HA_STATES.ARMED_NIGHT };
      break;
    case 'arm_vacation':
    case 'arm_custom_bypass':
      result = { command: 'arm', armMode: HA_STATES.ARMED_AWAY };
      break;
    case 'trigger':
    case 'triggered':
    case 'panic':
      result = { command: 'panic' };
      break;
    default:
      return null;
  }
  if (code) result.code = code;
  return result;
}

module.exports = {
  HA_STATES,
  normalizeArmMode,
  armedLabel,
  eventToHaState,
  parseHaCommand,
};
