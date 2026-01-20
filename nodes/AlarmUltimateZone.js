'use strict';

const helpers = require('./lib/node-helpers.js');
const { alarmInstances, alarmEmitter } = require('./lib/alarm-registry.js');

module.exports = function (RED) {
  function AlarmUltimateZone(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    const timerBag = helpers.createTimerBag(node);
    const setNodeStatus = helpers.createStatus(node);

    const alarmId = String(config.alarmId || '').trim();
    const zoneId = String(config.zoneId || '').trim();
    const configuredTopic = typeof config.topic === 'string' ? config.topic.trim() : '';
    const outputInitialState = config.outputInitialState !== false;

    let lastOpen = null;

    function buildTopic(controlTopic) {
      if (configuredTopic) return configuredTopic;
      const base = typeof controlTopic === 'string' && controlTopic.trim().length > 0 ? controlTopic.trim() : 'alarm';
      const z = zoneId || 'zone';
      return `${base}/zone/${z}`;
    }

    function emitZone(open, evt, reason) {
      if (typeof open !== 'boolean') return;
      if (lastOpen === open && reason !== 'init') return;
      lastOpen = open;

      const msg = {
        topic: buildTopic(evt && evt.controlTopic),
        payload: open,
        alarmId: evt ? evt.alarmId : alarmId,
        zone: evt && evt.zone ? evt.zone : { id: zoneId || null },
        bypassed: Boolean(evt && evt.bypassed),
        ts: evt && evt.ts ? evt.ts : Date.now(),
        reason,
      };
      node.send(msg);
    }

    function emitCurrent(reason) {
      if (!alarmId || !zoneId) {
        setNodeStatus({ fill: 'red', shape: 'ring', text: 'Missing alarmId/zoneId' });
        return;
      }
      const api = alarmInstances.get(alarmId);
      if (!api) {
        setNodeStatus({ fill: 'yellow', shape: 'ring', text: 'Waiting for alarm node' });
        return;
      }
      const ui = api.getState && typeof api.getState === 'function' ? api.getState() : null;
      const zones = ui && Array.isArray(ui.zones) ? ui.zones : [];
      const selected = zones.find((z) => z && z.id === zoneId);
      if (!selected) {
        setNodeStatus({ fill: 'red', shape: 'ring', text: `Unknown zone (${zoneId})` });
        return;
      }
      setNodeStatus({ fill: 'green', shape: 'dot', text: `Connected (${zoneId}: ${selected.open ? 'open' : 'closed'})` });
      emitZone(Boolean(selected.open), { alarmId, controlTopic: ui.controlTopic, zone: { id: selected.id, name: selected.name, type: selected.type } }, reason);
    }

    function onZoneState(evt) {
      if (!evt || evt.alarmId !== alarmId) return;
      if (!evt.zone || evt.zone.id !== zoneId) return;
      emitZone(Boolean(evt.open), evt, 'zone_state');
    }

    alarmEmitter.on('zone_state', onZoneState);
    node.on('close', () => {
      alarmEmitter.off('zone_state', onZoneState);
    });

    if (outputInitialState) {
      timerBag.setTimeout(() => emitCurrent('init'), 0);
      timerBag.setInterval(() => {
        if (lastOpen === null) {
          emitCurrent('init_retry');
        }
      }, 1000);
    } else {
      setNodeStatus({ fill: 'grey', shape: 'ring', text: 'Ready' });
    }
  }

  RED.nodes.registerType('AlarmUltimateZone', AlarmUltimateZone);
};

