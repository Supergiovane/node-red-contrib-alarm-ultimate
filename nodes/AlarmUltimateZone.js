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
  if (v === '1' || v === 'true' || v === 'on' || v === 'open') return true;
  if (v === '0' || v === 'false' || v === 'off' || v === 'closed') return false;
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

function toAxProZoneUpdateOut(msg) {
  if (!msg || typeof msg !== 'object') return msg;
  const au = msg.alarmUltimate && typeof msg.alarmUltimate === 'object' ? msg.alarmUltimate : null;
  const evt = (au && typeof au.event === 'string' ? au.event : '') || (typeof msg.event === 'string' ? msg.event : '');
  if (evt !== 'zone_open' && evt !== 'zone_close') return { ...(msg || {}) };

  const zone = au && au.zone && typeof au.zone === 'object' ? au.zone : null;
  const zoneName =
    (zone && typeof zone.name === 'string' && zone.name.trim()) ||
    (zone && typeof zone.topic === 'string' && zone.topic.trim() ? zone.topic.trim() : '') ||
    '';
  if (!zoneName) return null;

  const out = { ...(msg || {}) };
  out.payload = out.payload && typeof out.payload === 'object' ? { ...(out.payload || {}) } : {};
  out.payload.zoneUpdate = {
    name: zoneName,
    magnetOpenStatus: evt === 'zone_open',
    sensorStatus: evt === 'zone_open' ? 'open' : 'normal',
    status: evt === 'zone_open' ? 'trigger' : 'normal',
  };
  return out;
}

function matchesZoneTopic(zone, topic) {
  if (!zone || !topic) return false;
  const t = String(topic || '').trim();
  if (!t) return false;
  if (typeof zone.topic === 'string' && zone.topic.trim()) {
    const zt = zone.topic.trim();
    if (zt.endsWith('*')) return t.startsWith(zt.slice(0, -1));
    return t === zt;
  }
  return false;
}

function matchesAxProZoneName(zoneName, zoneTopic, matchKind) {
  const name = String(zoneName || '').trim();
  const topic = String(zoneTopic || '').trim();
  if (!name || !topic) return false;

  if (topic.endsWith('*')) {
    const prefix = topic.slice(0, -1);
    return prefix ? name.startsWith(prefix) : false;
  }

  const kind = String(matchKind || 'exact').trim().toLowerCase();
  if (kind === 'starts') return name.startsWith(topic);
  if (kind === 'contains') return name.includes(topic);
  if (kind === 'ends') return name.endsWith(topic);
  return name === topic;
}

module.exports = function (RED) {
  function AlarmUltimateZone(config) {
    RED.nodes.createNode(this, config);
    const node = this;
    const REDUtil = RED.util;

    const timerBag = helpers.createTimerBag(node);
    const setNodeStatus = helpers.createStatus(node);

    const alarmId = String(config.alarmId || '').trim();
    const zoneRef = String(config.zoneTopic || '').trim();
    const configuredTopic = typeof config.topic === 'string' ? config.topic.trim() : '';
    const outputInitialState = config.outputInitialState !== false;
    const io = typeof config.io === 'string' && config.io.trim() ? config.io.trim() : 'out';
    const adapter = typeof config.adapter === 'string' && config.adapter.trim() ? config.adapter.trim() : 'default';
    const axProZoneNameMatch =
      typeof config.axProZoneNameMatch === 'string' && config.axProZoneNameMatch.trim()
        ? config.axProZoneNameMatch.trim()
        : 'exact';
    const allZones = zoneRef === '__all__';

    let lastOpen = null;
    const lastOpenByZoneKey = new Map();
    let lastMode = null;

    function buildTopic(controlTopic, zoneTopic) {
      if (configuredTopic) return configuredTopic;
      const base = typeof controlTopic === 'string' && controlTopic.trim().length > 0 ? controlTopic.trim() : 'alarm';
      return `${base}/event`;
    }

    function applyOutputAdapter(baseMsg) {
      const msg = baseMsg && typeof baseMsg === 'object' ? baseMsg : {};
      if (adapter === 'knx') return toKnxUltimateOut(msg);
      if (adapter === 'axpro') return toAxProZoneUpdateOut(msg);
      // default: pass-through
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

    function emitZoneEvent(open, evt, reason) {
      if (typeof open !== 'boolean') return;
      const zoneKey =
        evt && evt.zone
          ? String(evt.zone.topic || '').trim()
          : '';
      const key = zoneKey || zoneRef || '';
      if (allZones) {
        if (!key) return;
        const prev = lastOpenByZoneKey.has(key) ? lastOpenByZoneKey.get(key) : null;
        if (prev === open && reason !== 'init') return;
        lastOpenByZoneKey.set(key, open);
      } else {
        if (lastOpen === open && reason !== 'init') return;
        lastOpen = open;
      }

      const zoneTopic =
        evt && evt.zone ? evt.zone.topic || null : null;
      const statusLabel = zoneTopic || zoneRef || 'zone';

      setNodeStatus({
        fill: open ? 'red' : 'green',
        shape: 'dot',
        text: `${statusLabel}: ${open ? 'open' : 'closed'}`,
      });

      const controlTopic = evt && typeof evt.controlTopic === 'string' ? evt.controlTopic : null;
      const effectiveMode =
        evt && evt.state && typeof evt.state.mode === 'string'
          ? evt.state.mode
          : lastMode || 'disarmed';

      const event = open ? 'zone_open' : 'zone_close';
      const msg = {};
      msg.topic = buildTopic(controlTopic, zoneTopic);
      msg.event = event;
      msg.payload = {
        event,
        mode: effectiveMode,
        zone: evt && evt.zone ? evt.zone : { topic: zoneRef || null },
        open,
        bypassed: Boolean(evt && evt.bypassed),
        reason,
      };
      const zoneObj = evt && evt.zone ? evt.zone : { topic: zoneRef || null };
      const auUpdate = {
        ts: Date.now(),
        kind: 'event',
        event,
        mode: effectiveMode,
        reason,
        alarm: { id: alarmId, controlTopic: controlTopic || null },
        zone: zoneObj,
        open,
        bypassed: Boolean(evt && evt.bypassed),
      };
      auUpdate.adapter = { direction: 'out', id: adapter || 'default' };
      attachAlarmUltimateEnvelope(msg, auUpdate);
      sendToFlowWithAdapter(msg);
    }

    function emitCurrent(reason) {
      if (!alarmId || (!zoneRef && !allZones)) {
        setNodeStatus({ fill: 'red', shape: 'ring', text: 'Missing alarmId/zoneTopic' });
        return;
      }
      const api = alarmInstances.get(alarmId);
      if (!api) {
        setNodeStatus({ fill: 'yellow', shape: 'ring', text: 'Waiting for alarm node' });
        return;
      }
      const ui = api.getState && typeof api.getState === 'function' ? api.getState() : null;
      const zones = ui && Array.isArray(ui.zones) ? ui.zones : [];
      lastMode = ui && ui.state && typeof ui.state.mode === 'string' ? ui.state.mode : lastMode;
      if (allZones) {
        zones.forEach((selected) => {
          if (!selected) return;
          const key = String(selected.topic || '').trim();
          if (!key) return;
          emitZoneEvent(
            Boolean(selected.open),
            {
              alarmId,
              controlTopic: ui.controlTopic,
              state: ui.state ? { mode: ui.state.mode } : null,
              zone: {
                name: selected.name,
                type: selected.type,
                topic: selected.topic || null,
              },
              bypassed: Boolean(selected.bypassed),
            },
            reason,
          );
        });
        return;
      }

      const selected = zones.find((z) => z && String(z.topic || '').trim() === zoneRef);
      if (!selected) {
        setNodeStatus({ fill: 'red', shape: 'ring', text: `Unknown zone (${zoneRef})` });
        return;
      }
      emitZoneEvent(
        Boolean(selected.open),
        {
          alarmId,
          controlTopic: ui.controlTopic,
          state: ui.state ? { mode: ui.state.mode } : null,
          zone: {
            name: selected.name,
            type: selected.type,
            topic: selected.topic || null,
          },
          bypassed: Boolean(selected.bypassed),
        },
        reason,
      );
    }

    function onZoneState(evt) {
      if (!evt || evt.alarmId !== alarmId) return;
      if (!evt.zone) return;
      const key = String(evt.zone.topic || '').trim();
      if (!allZones && key !== zoneRef) return;
      emitZoneEvent(Boolean(evt.open), evt, 'zone_state');
    }

    function onAlarmEvent(evt) {
      if (!evt || evt.alarmId !== alarmId) return;
      const mode = evt.state && typeof evt.state.mode === 'string' ? evt.state.mode : null;
      if (mode === 'armed' || mode === 'disarmed') {
        lastMode = mode;
      }
    }

    function injectSensorToAlarm(inMsg, done) {
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

      const ui = api.getState && typeof api.getState === 'function' ? api.getState() : null;
      const zones = ui && Array.isArray(ui.zones) ? ui.zones : [];
      const selected = !allZones ? zones.find((z) => z && String(z.topic || '').trim() === zoneRef) : null;
      if (!allZones && !selected) {
        setNodeStatus({ fill: 'red', shape: 'ring', text: `Unknown zone (${zoneRef})` });
        if (done) done();
        return;
      }

      let topic =
        inMsg && typeof inMsg === 'object' && typeof inMsg.topic === 'string' ? inMsg.topic : '';
      let payload = inMsg && typeof inMsg === 'object' ? inMsg.payload : undefined;
      let matchedZoneForEnvelope = null;

      if (adapter === 'knx') {
        const t =
          inMsg &&
          inMsg.knx &&
          typeof inMsg.knx.destination === 'string' &&
          inMsg.knx.destination.trim()
            ? inMsg.knx.destination.trim()
            : typeof inMsg.topic === 'string'
              ? inMsg.topic
              : '';
        topic = t;
        const b = normalizeBoolean(payload);
        if (typeof b === 'boolean') payload = b;
      } else if (adapter === 'axpro') {
        const zoneUpdate =
          inMsg && inMsg.payload && typeof inMsg.payload === 'object' ? inMsg.payload.zoneUpdate || null : null;
        if (!zoneUpdate || typeof zoneUpdate !== 'object') {
          if (done) done();
          return;
        }

        const rawTopic =
          typeof zoneUpdate.name === 'string' && zoneUpdate.name.trim()
            ? zoneUpdate.name.trim()
            : zoneUpdate.id !== undefined && zoneUpdate.id !== null
              ? String(zoneUpdate.id)
              : '';
        if (!rawTopic) {
          if (done) done();
          return;
        }
        const zoneName = rawTopic;

        if (allZones) {
          const candidate = zones.find((z) => z && matchesAxProZoneName(zoneName, z.topic, axProZoneNameMatch));
          if (!candidate) {
            if (done) done();
            return;
          }
          matchedZoneForEnvelope = candidate;
          topic = String(candidate.topic || '').trim();
        } else {
          if (!matchesAxProZoneName(zoneName, zoneRef, axProZoneNameMatch)) {
            if (done) done();
            return;
          }
          topic = zoneRef;
        }

        let open;
        if (typeof zoneUpdate.magnetOpenStatus === 'boolean') open = zoneUpdate.magnetOpenStatus;
        else if (typeof zoneUpdate.alarm === 'boolean') open = zoneUpdate.alarm;
        else if (typeof zoneUpdate.sensorStatus === 'string') {
          const v = zoneUpdate.sensorStatus.trim().toLowerCase();
          open = v !== 'normal' && v !== 'closed' && v !== 'ok';
        } else if (typeof zoneUpdate.status === 'string') {
          const v = zoneUpdate.status.trim().toLowerCase();
          open = v !== 'normal' && v !== 'closed' && v !== 'ok' && v !== 'restore';
        } else {
          if (done) done();
          return;
        }
        payload = open;
      } else {
        const b = normalizeBoolean(payload);
        if (typeof b === 'boolean') payload = b;
      }

      if (typeof topic !== 'string' || !topic.trim()) {
        if (done) done();
        return;
      }
      topic = topic.trim();

      if (!allZones) {
        const matches = matchesZoneTopic(selected, topic);
        if (!matches) {
          if (done) done();
          return;
        }
      }

      const forwarded = inMsg && typeof inMsg === 'object' ? REDUtil.cloneMessage(inMsg) : { payload: inMsg };
      forwarded.topic = topic;
      if (payload !== undefined) forwarded.payload = payload;

      const auUpdate = {
        adapter: { direction: 'in', id: adapter || 'default' },
        alarm: { id: alarmId, controlTopic: ui && ui.controlTopic ? ui.controlTopic : null },
      };
      const zoneForEnvelope = selected || matchedZoneForEnvelope;
      if (zoneForEnvelope) {
        auUpdate.zone = {
          name: zoneForEnvelope.name,
          type: zoneForEnvelope.type,
          topic: zoneForEnvelope.topic || null,
        };
      }
      attachAlarmUltimateEnvelope(forwarded, auUpdate);

      try {
        api.receive(forwarded);
        const statusLabel = allZones ? 'Injected' : `Injected (${zoneRef})`;
        setNodeStatus({ fill: 'blue', shape: 'dot', text: statusLabel });
        if (done) done();
      } catch (err) {
        setNodeStatus({ fill: 'red', shape: 'dot', text: 'inject error' });
        node.error(err, inMsg);
        if (done) done(err);
      }
    }

    if (io === 'in') {
      setNodeStatus({ fill: 'grey', shape: 'ring', text: `Input (${adapter || 'default'})` });
      node.on('input', (msg, _send, done) => injectSensorToAlarm(msg, done));
      return;
    }

    alarmEmitter.on('zone_state', onZoneState);
    alarmEmitter.on('event', onAlarmEvent);
    node.on('close', () => {
      alarmEmitter.off('zone_state', onZoneState);
      alarmEmitter.off('event', onAlarmEvent);
    });

    if (outputInitialState) {
      timerBag.setTimeout(() => emitCurrent('init'), 0);
      timerBag.setInterval(() => {
        if (allZones) {
          if (lastOpenByZoneKey.size === 0) emitCurrent('init_retry');
          return;
        }
        if (lastOpen === null) {
          emitCurrent('init_retry');
        }
      }, 1000);
    } else {
      setNodeStatus({ fill: 'grey', shape: 'ring', text: `Ready (${adapter || 'default'})` });
    }
  }

  RED.nodes.registerType('AlarmUltimateZone', AlarmUltimateZone);
};
