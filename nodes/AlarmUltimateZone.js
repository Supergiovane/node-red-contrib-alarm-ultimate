'use strict';

const helpers = require('./lib/node-helpers.js');
const { alarmInstances, alarmEmitter } = require('./lib/alarm-registry.js');
const { attachAlarmUltimateEnvelope } = require('./lib/alarm-ultimate-envelope.js');

module.exports = function (RED) {
  function AlarmUltimateZone(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    const timerBag = helpers.createTimerBag(node);
    const setNodeStatus = helpers.createStatus(node);

    const alarmId = String(config.alarmId || '').trim();
    const zoneRef = String(config.zoneTopic || '').trim();
    const configuredTopic = typeof config.topic === 'string' ? config.topic.trim() : '';
    const outputInitialState = config.outputInitialState !== false;
    const allZones = zoneRef === '__all__';

    let lastOpen = null;
    const lastOpenByZoneKey = new Map();
    let lastMode = null;
    let initRetryInterval = null;

    function stopInitRetryInterval() {
      if (!initRetryInterval) return;
      timerBag.clearInterval(initRetryInterval);
      initRetryInterval = null;
    }

    function buildTopic(controlTopic, zoneTopic) {
      if (configuredTopic) return configuredTopic;
      const base = typeof controlTopic === 'string' && controlTopic.trim().length > 0 ? controlTopic.trim() : 'alarm';
      return `${base}/event`;
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
        stopInitRetryInterval();
      } else {
        if (lastOpen === open && reason !== 'init') return;
        lastOpen = open;
        stopInitRetryInterval();
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
      msg.payload = open;
      msg.mode = effectiveMode;
      msg.zone = evt && evt.zone ? evt.zone : { topic: zoneRef || null };
      msg.open = open;
      msg.bypassed = Boolean(evt && evt.bypassed);
      msg.reason = reason;
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
      attachAlarmUltimateEnvelope(msg, auUpdate);
      node.send(msg);
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

    alarmEmitter.on('zone_state', onZoneState);
    alarmEmitter.on('event', onAlarmEvent);
    node.on('close', () => {
      alarmEmitter.off('zone_state', onZoneState);
      alarmEmitter.off('event', onAlarmEvent);
    });

    if (outputInitialState) {
      timerBag.setTimeout(() => emitCurrent('init'), 0);
      initRetryInterval = timerBag.setInterval(() => {
        if (allZones) {
          if (lastOpenByZoneKey.size === 0) emitCurrent('init_retry');
          else stopInitRetryInterval();
          return;
        }
        if (lastOpen === null) {
          emitCurrent('init_retry');
          return;
        }
        stopInitRetryInterval();
      }, 1000);
    } else {
      setNodeStatus({ fill: 'grey', shape: 'ring', text: 'Ready' });
    }
  }

  RED.nodes.registerType('AlarmUltimateZone', AlarmUltimateZone);
};
