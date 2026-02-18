'use strict';

const helpers = require('./lib/node-helpers.js');
const { alarmInstances, alarmEmitter } = require('./lib/alarm-registry.js');
const { attachAlarmUltimateEnvelope } = require('./lib/alarm-ultimate-envelope.js');

function normalizeBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value !== 0;
  if (typeof value !== 'string') return undefined;
  const v = value.trim().toLowerCase();
  if (!v) return undefined;
  if (v === '1' || v === 'true' || v === 'on' || v === 'open' || v === 'armed' || v === 'arm') return true;
  if (v === '0' || v === 'false' || v === 'off' || v === 'closed' || v === 'disarmed' || v === 'disarm') return false;
  return undefined;
}

function inferBooleanFromAlarmUltimate(msg) {
  if (!msg || typeof msg !== 'object') return undefined;
  const au = msg.alarmUltimate && typeof msg.alarmUltimate === 'object' ? msg.alarmUltimate : null;
  if (au) {
    if (au.kind === 'siren' && au.siren && typeof au.siren.active === 'boolean') return au.siren.active;
    if (typeof au.open === 'boolean') return au.open;
    if (typeof au.anyOpen === 'boolean') return au.anyOpen;
    if (au.event === 'armed' || au.event === 'arming') return true;
    if (au.event === 'disarmed' || au.event === 'reset') return false;
    if (au.event === 'alarm' || au.event === 'entry_delay') return true;
    if (au.event === 'open_zone' || au.event === 'open_zones') return true;
    if (au.event === 'zone_open') return true;
    if (au.event === 'zone_close') return false;
    if (au.event === 'siren_on') return true;
    if (au.event === 'siren_off') return false;
  }
  return normalizeBoolean(msg.payload);
}

function toKnxUltimateOut(msg) {
  if (!msg || typeof msg !== 'object') return msg;
  const b = inferBooleanFromAlarmUltimate(msg);
  if (typeof b !== 'boolean') return { ...(msg || {}) };

  const au = msg.alarmUltimate && typeof msg.alarmUltimate === 'object' ? msg.alarmUltimate : null;
  const destination =
    (typeof msg.destination === 'string' && msg.destination.trim()) ||
    (msg.knx && typeof msg.knx.destination === 'string' && msg.knx.destination.trim()) ||
    (au && au.zone && typeof au.zone.topic === 'string' && au.zone.topic.trim()) ||
    (typeof msg.topic === 'string' && msg.topic.trim()) ||
    '';
  if (!destination) return { ...(msg || {}) };

  const dpt =
    (typeof msg.dpt === 'string' && msg.dpt.trim()) ||
    (msg.knx && typeof msg.knx.dpt === 'string' && msg.knx.dpt.trim()) ||
    '1.001';

  const out = { ...(msg || {}) };
  out.destination = destination;
  out.dpt = dpt;
  out.payload = b;
  return out;
}

function normalizeHomekitTargetState(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value !== 'string') return undefined;
  const s = value.trim().toLowerCase();
  if (!s) return undefined;
  if (s === '0' || s === 'stay' || s === 'home') return 0;
  if (s === '1' || s === 'away') return 1;
  if (s === '2' || s === 'night') return 2;
  const n = Number(s);
  if (!Number.isNaN(n)) return n;
  return undefined;
}

function toHomekitSecuritySystemOut(msg, node) {
  if (!msg || typeof msg !== 'object') return msg;
  const au = msg.alarmUltimate && typeof msg.alarmUltimate === 'object' ? msg.alarmUltimate : null;
  const evt =
    (au && typeof au.event === 'string' && au.event) || (typeof msg.event === 'string' ? msg.event : '');

  function stateForEvent(e) {
    if (e === 'disarmed' || e === 'reset') return 3;
    if (e === 'alarm') return 4;
    if (e === 'armed' || e === 'arming') return 1;
    if (e === 'entry_delay') return 1;
    return undefined;
  }

  const ctx = node && typeof node.context === 'function' ? node.context() : null;
  const lastTarget = ctx ? ctx.get('homekitTargetState') : undefined;
  const lastCurrent = ctx ? ctx.get('homekitCurrentState') : undefined;
  const lastArmTarget = typeof lastTarget === 'number' && [0, 1, 2].includes(lastTarget) ? lastTarget : undefined;

  let target = normalizeHomekitTargetState(msg.homekitTargetState);
  if (
    target === undefined &&
    au &&
    typeof au.homekitTargetState === 'number' &&
    Number.isFinite(au.homekitTargetState)
  ) {
    target = au.homekitTargetState;
  }

  let desiredTarget = target !== undefined ? target : stateForEvent(evt);
  if (desiredTarget === undefined) {
    const out = { ...(msg || {}) };
    attachAlarmUltimateEnvelope(out, { homekit: { kind: 'passthrough' } });
    return out;
  }

  let outTarget = desiredTarget;
  let outCurrent = desiredTarget;

  if (evt === 'arming') {
    outCurrent = typeof lastCurrent === 'number' ? lastCurrent : 3;
  }

  if (evt === 'alarm') {
    outCurrent = 4;
    outTarget = lastArmTarget !== undefined ? lastArmTarget : 1;
  }

  if (evt === 'entry_delay') {
    outCurrent = 4;
    outTarget = lastArmTarget !== undefined ? lastArmTarget : outTarget;
  }

  if (ctx) {
    ctx.set('homekitTargetState', outTarget);
    ctx.set('homekitCurrentState', outCurrent);
  }

  const out = { ...(msg || {}) };
  const hkPayload = {
    SecuritySystemTargetState: outTarget,
    SecuritySystemCurrentState: outCurrent,
  };
  out.SecuritySystemTargetState = outTarget;
  out.SecuritySystemCurrentState = outCurrent;
  out.payload = outTarget !== 3;
  attachAlarmUltimateEnvelope(out, { homekit: { kind: 'security_system', payload: hkPayload } });
  return out;
}

function pickHomekitState(payload) {
  if (typeof payload === 'number' || typeof payload === 'string') return payload;
  if (!payload || typeof payload !== 'object') return undefined;

  const direct =
    payload.SecuritySystemTargetState ??
    payload.securitySystemTargetState ??
    payload.TargetState ??
    payload.targetState ??
    payload['Security System Target State'] ??
    payload.SecuritySystemCurrentState ??
    payload.securitySystemCurrentState ??
    payload.CurrentState ??
    payload.currentState ??
    payload['Security System Current State'];
  if (direct !== undefined && direct !== null) return direct;

  const characteristic =
    (typeof payload.Characteristic === 'string' && payload.Characteristic) ||
    (typeof payload.characteristic === 'string' && payload.characteristic) ||
    '';
  if (characteristic && payload.value !== undefined) {
    const c = characteristic.toLowerCase();
    if (c.includes('security') && (c.includes('target') || c.includes('current'))) {
      return payload.value;
    }
  }

  const type = typeof payload.type === 'string' ? payload.type : '';
  if (type && payload.value !== undefined) {
    const t = type.toLowerCase();
    if (t.includes('securitysystemtargetstate') || t.includes('securitysystemcurrentstate')) {
      return payload.value;
    }
  }

  return undefined;
}

function normalizeHomekitSecurityState(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value !== 'string') return undefined;

  const s = value.trim().toLowerCase();
  if (!s) return undefined;

  if (
    s === '0' ||
    s === 'stay' ||
    s === 'stayarm' ||
    s === 'arm_stay' ||
    s === 'armed_stay' ||
    s === 'home' ||
    s === 'arm_home' ||
    s === 'armed_home'
  )
    return 0;
  if (s === '1' || s === 'away' || s === 'awayarm' || s === 'arm_away' || s === 'armed_away') return 1;
  if (
    s === '2' ||
    s === 'night' ||
    s === 'nightarm' ||
    s === 'arm_night' ||
    s === 'armed_night'
  )
    return 2;
  if (s === '3' || s === 'disarm' || s === 'disarmed' || s === 'off') return 3;
  if (s === '4' || s === 'alarm' || s === 'triggered' || s === 'alarm_triggered') return 4;

  const n = Number(s);
  if (!Number.isNaN(n)) return n;
  return undefined;
}

function toHomekitAlarmCommandIn(msg) {
  if (!msg || typeof msg !== 'object') return null;
  const raw = pickHomekitState(msg.payload);
  const state = normalizeHomekitSecurityState(raw);
  if (state === undefined) return null;

  let command = '';
  if (state === 3) command = 'disarm';
  else if (state === 0 || state === 1 || state === 2) command = 'arm';
  else return null;

  const out = { ...(msg || {}) };
  out.command = command;
  out.homekit = { ...(out.homekit || {}), securitySystemState: state };
  if (state === 0 || state === 1 || state === 2) out.homekitTargetState = state;
  return out;
}

function toAxProAlarmCommandIn(msg) {
  if (!msg || typeof msg !== 'object') return null;
  const payload = msg.payload && typeof msg.payload === 'object' ? msg.payload : null;
  const cid = payload && payload.CIDEvent && typeof payload.CIDEvent === 'object' ? payload.CIDEvent : null;
  const rawCode = cid && cid.code !== undefined && cid.code !== null ? cid.code : undefined;
  const code = Number(rawCode);
  if (!Number.isFinite(code)) return null;

  // Known CID codes for arming/disarming (as reported by Hikvision AX Pro).
  // - 3401: Away
  // - 3441: Stay
  // - 1401: Disarmed
  let command = '';
  let axProArmKind = '';
  if (code === 3401) {
    command = 'arm';
    axProArmKind = 'away';
  } else if (code === 3441) {
    command = 'arm';
    axProArmKind = 'stay';
  } else if (code === 1401) {
    command = 'disarm';
    axProArmKind = 'disarmed';
  } else {
    return null;
  }

  const out = { ...(msg || {}) };
  out.command = command;
  out.axpro = { ...(out.axpro || {}), cid: { ...(cid || {}), code }, armKind: axProArmKind };
  return out;
}

module.exports = function (RED) {
  function AlarmUltimateState(config) {
    RED.nodes.createNode(this, config);
    const node = this;
    const REDUtil = RED.util;

    const timerBag = helpers.createTimerBag(node);
    const setNodeStatus = helpers.createStatus(node);

    const alarmId = String(config.alarmId || '').trim();
    const configuredTopic = typeof config.topic === 'string' ? config.topic.trim() : '';
    const outputInitialState = config.outputInitialState !== false;
    const io = typeof config.io === 'string' && config.io.trim() ? config.io.trim() : 'out';
    const adapter = typeof config.adapter === 'string' && config.adapter.trim() ? config.adapter.trim() : 'default';

    let lastMode = null;
    let initRetryInterval = null;

    function stopInitRetryInterval() {
      if (!initRetryInterval) return;
      timerBag.clearInterval(initRetryInterval);
      initRetryInterval = null;
    }

    function buildTopic(controlTopic) {
      if (configuredTopic) return configuredTopic;
      const base = typeof controlTopic === 'string' && controlTopic.trim().length > 0 ? controlTopic.trim() : 'alarm';
      return `${base}/event`;
    }

    function applyOutputAdapter(baseMsg) {
      const msg = baseMsg && typeof baseMsg === 'object' ? baseMsg : {};
      if (adapter === 'homekit') return toHomekitSecuritySystemOut(msg, node);
      if (adapter === 'knx') return toKnxUltimateOut(msg);
      // axpro/default: pass-through
      return msg;
    }

    function sendToFlowWithAdapter(baseMsg) {
      const out = applyOutputAdapter(baseMsg);
      if (out === undefined || out === null) return;
      if (Array.isArray(out)) {
        out.filter(Boolean).forEach((m, idx) => node.send(idx === 0 ? m : REDUtil.cloneMessage(m)));
        return;
      }
      if (typeof out === 'object') {
        node.send(out);
        return;
      }
      node.send({ ...(baseMsg || {}), payload: out });
    }

    function emitEventMessage(event, mode, details, controlTopic, homekitTargetState) {
      if (typeof event !== 'string' || !event) return;
      const m = typeof mode === 'string' ? mode : null;
      if (m !== 'armed' && m !== 'disarmed') return;

      if (event === 'armed' || event === 'disarmed') {
        if (lastMode === m && details && details.reason !== 'init') {
          return;
        }
        lastMode = m;
        stopInitRetryInterval();
      }

      setNodeStatus({
        fill: m === 'disarmed' ? 'green' : 'red',
        shape: 'dot',
        text: m === 'disarmed' ? 'Disarmed' : 'Armed',
      });

      const msg = {};
      msg.topic = buildTopic(controlTopic);
      msg.event = event;
      if (typeof homekitTargetState === 'number' && Number.isFinite(homekitTargetState)) {
        msg.homekitTargetState = homekitTargetState;
      }
      msg.payload = event === 'disarmed' || event === 'reset' ? false : true;
      msg.mode = m;
      const d = details && typeof details === 'object' ? details : null;
      if (d) {
        for (const [k, v] of Object.entries(d)) {
          if (!k) continue;
          if (k === 'event' || k === 'mode') continue;
          msg[k] = v;
        }
      }
      const auUpdate = {
        ts: Date.now(),
        kind: 'event',
        event,
        mode: m,
        alarm: { id: alarmId, controlTopic: controlTopic || null },
      };
      if (details && typeof details === 'object') auUpdate.details = details;
      if (details && typeof details.reason === 'string' && details.reason) auUpdate.reason = details.reason;
      if (typeof homekitTargetState === 'number' && Number.isFinite(homekitTargetState)) {
        auUpdate.homekitTargetState = homekitTargetState;
      }
      auUpdate.adapter = { direction: 'out', id: adapter || 'default' };
      attachAlarmUltimateEnvelope(msg, auUpdate);
      sendToFlowWithAdapter(msg);
    }

    function emitCurrent(reason) {
      if (!alarmId) {
        setNodeStatus({ fill: 'red', shape: 'ring', text: 'Missing alarmId' });
        return;
      }
      const api = alarmInstances.get(alarmId);
      if (!api) {
        setNodeStatus({ fill: 'yellow', shape: 'ring', text: 'Waiting for alarm node' });
        return;
      }
      const state = api.getState && typeof api.getState === 'function' ? api.getState() : null;
      const mode = state && state.state ? state.state.mode : null;
      if (mode !== 'armed' && mode !== 'disarmed') return;
      emitEventMessage(mode === 'armed' ? 'armed' : 'disarmed', mode, { reason }, api.controlTopic);
    }

    function onAlarmEvent(evt) {
      if (!evt || evt.alarmId !== alarmId) return;
      const event = typeof evt.event === 'string' ? evt.event : '';
      const mode = evt.state && typeof evt.state.mode === 'string' ? evt.state.mode : null;
      if (!event || (event !== 'arming' && event !== 'armed' && event !== 'disarmed' && event !== 'reset' && event !== 'entry_delay' && event !== 'alarm')) {
        return;
      }
      const hk =
        typeof evt.homekitTargetState === 'number' && Number.isFinite(evt.homekitTargetState)
          ? evt.homekitTargetState
          : undefined;
      emitEventMessage(event, mode, evt.details || {}, evt.controlTopic, hk);
    }

    function injectToAlarm(inMsg, done) {
      if (!alarmId) {
        setNodeStatus({ fill: 'red', shape: 'ring', text: 'Missing alarmId' });
        if (done) done();
        return;
      }
      const api = alarmInstances.get(alarmId);
      if (!api || typeof api.receive !== 'function') {
        setNodeStatus({ fill: 'yellow', shape: 'ring', text: 'Waiting for alarm node' });
        if (done) done();
        return;
      }

      const controlTopic = api.controlTopic || 'alarm';
      let transformed = null;

      if (adapter === 'homekit') transformed = toHomekitAlarmCommandIn(inMsg);
      else if (adapter === 'axpro') transformed = toAxProAlarmCommandIn(inMsg);
      else if (adapter === 'knx') {
        const b = normalizeBoolean(inMsg && inMsg.payload);
        if (typeof b === 'boolean') {
          transformed = { ...(inMsg || {}), command: b ? 'arm' : 'disarm' };
        }
      } else {
        transformed = inMsg && typeof inMsg === 'object' ? { ...(inMsg || {}) } : { payload: inMsg };
        if (!transformed.command) {
          const p = transformed.payload;
          const pb = normalizeBoolean(p);
          if (typeof pb === 'boolean') {
            transformed.command = pb ? 'arm' : 'disarm';
          } else if (typeof p === 'string' && p.trim()) {
            const s = p.trim().toLowerCase();
            if (s === 'arm' || s === 'armed') transformed.command = 'arm';
            if (s === 'disarm' || s === 'disarmed') transformed.command = 'disarm';
          }
        }
      }

      if (!transformed || typeof transformed !== 'object') {
        if (done) done();
        return;
      }

      const toSend = REDUtil.cloneMessage(transformed);
      toSend.topic = controlTopic;
      const auUpdate = {
        kind: 'command',
        adapter: { direction: 'in', id: adapter || 'default' },
        alarm: { id: alarmId, controlTopic },
      };
      if (typeof toSend.command === 'string' && toSend.command.trim()) {
        auUpdate.command = toSend.command.trim();
      }
      if (typeof toSend.homekitTargetState === 'number' && Number.isFinite(toSend.homekitTargetState)) {
        auUpdate.homekitTargetState = toSend.homekitTargetState;
      }
      attachAlarmUltimateEnvelope(toSend, auUpdate);

      try {
        api.receive(toSend);
        const label = typeof toSend.command === 'string' && toSend.command ? toSend.command : 'sent';
        setNodeStatus({ fill: 'blue', shape: 'dot', text: `Injected: ${label}` });
        if (done) done();
      } catch (err) {
        setNodeStatus({ fill: 'red', shape: 'dot', text: 'inject error' });
        node.error(err, inMsg);
        if (done) done(err);
      }
    }

    if (io === 'in') {
      setNodeStatus({ fill: 'grey', shape: 'ring', text: `Input (${adapter || 'default'})` });
      node.on('input', (msg, _send, done) => injectToAlarm(msg, done));
      return;
    }

    alarmEmitter.on('event', onAlarmEvent);
    node.on('close', () => {
      alarmEmitter.off('event', onAlarmEvent);
    });

    if (outputInitialState) {
      timerBag.setTimeout(() => emitCurrent('init'), 0);
      initRetryInterval = timerBag.setInterval(() => {
        if (lastMode === null) {
          emitCurrent('init_retry');
          return;
        }
        stopInitRetryInterval();
      }, 1000);
    } else {
      setNodeStatus({ fill: 'grey', shape: 'ring', text: `Ready (${adapter || 'default'})` });
    }
  }

  RED.nodes.registerType('AlarmUltimateState', AlarmUltimateState);
};
