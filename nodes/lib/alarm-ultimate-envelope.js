'use strict';

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function attachAlarmUltimateEnvelope(msg, update) {
  if (!isObject(msg)) return msg;
  const prev = isObject(msg.alarmUltimate) ? msg.alarmUltimate : {};
  const next = { ...prev, ...(isObject(update) ? update : {}) };

  next.v = 1;
  if (typeof next.ts !== 'number' || !Number.isFinite(next.ts)) {
    next.ts = Date.now();
  }

  const prevAlarm = isObject(prev.alarm) ? prev.alarm : {};
  const updateAlarm = isObject(update && update.alarm) ? update.alarm : {};
  if (Object.keys(prevAlarm).length > 0 || Object.keys(updateAlarm).length > 0) {
    next.alarm = { ...prevAlarm, ...updateAlarm };
  }

  msg.alarmUltimate = next;
  return msg;
}

module.exports = {
  attachAlarmUltimateEnvelope,
};

