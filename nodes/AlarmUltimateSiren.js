'use strict';

const helpers = require('./lib/node-helpers.js');
const { alarmInstances, alarmEmitter } = require('./lib/alarm-registry.js');
const { attachAlarmUltimateEnvelope } = require('./lib/alarm-ultimate-envelope.js');

module.exports = function (RED) {
  function AlarmUltimateSiren(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    const timerBag = helpers.createTimerBag(node);
    const setNodeStatus = helpers.createStatus(node);

    const alarmId = String(config.alarmId || '').trim();
    const configuredTopic = typeof config.topic === 'string' ? config.topic.trim() : '';
    const outputInitialState = config.outputInitialState !== false;

    let lastActive = null;
    let initRetryInterval = null;

    function stopInitRetryInterval() {
      if (!initRetryInterval) return;
      timerBag.clearInterval(initRetryInterval);
      initRetryInterval = null;
    }

    function buildTopic(controlTopic) {
      if (configuredTopic) return configuredTopic;
      const base = typeof controlTopic === 'string' && controlTopic.trim().length > 0 ? controlTopic.trim() : 'alarm';
      return `${base}/siren`;
    }

    function emitSiren(active, evt, reason) {
      if (typeof active !== 'boolean') return;
      if (lastActive === active && reason !== 'init') return;
      lastActive = active;
      stopInitRetryInterval();

      setNodeStatus({
        fill: active ? 'red' : 'green',
        shape: 'dot',
        text: active ? 'Siren on' : 'Siren off',
      });

      const msg = {
        topic: buildTopic(evt && evt.controlTopic),
        payload: active,
      };
      msg.event = active ? 'siren_on' : 'siren_off';
      msg.reason = evt && evt.reason ? evt.reason : reason;
      attachAlarmUltimateEnvelope(msg, {
        ts: evt && typeof evt.ts === 'number' ? evt.ts : Date.now(),
        kind: 'siren',
        event: msg.event,
        reason: msg.reason,
        alarm: { id: alarmId, controlTopic: evt && evt.controlTopic ? evt.controlTopic : null },
        siren: { active },
      });
      node.send(msg);
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
      const ui = api.getState && typeof api.getState === 'function' ? api.getState() : null;
      const state = ui && ui.state ? ui.state : null;
      const active = state ? Boolean(state.sirenActive) : null;
      emitSiren(active, { alarmId, controlTopic: ui.controlTopic, name: ui.name }, reason);
    }

    function onSirenState(evt) {
      if (!evt || evt.alarmId !== alarmId) return;
      emitSiren(Boolean(evt.active), evt, 'siren_state');
    }

    alarmEmitter.on('siren_state', onSirenState);
    node.on('close', () => {
      alarmEmitter.off('siren_state', onSirenState);
    });

    if (outputInitialState) {
      timerBag.setTimeout(() => emitCurrent('init'), 0);
      initRetryInterval = timerBag.setInterval(() => {
        if (lastActive === null) {
          emitCurrent('init_retry');
          return;
        }
        stopInitRetryInterval();
      }, 1000);
    } else {
      setNodeStatus({ fill: 'grey', shape: 'ring', text: 'Ready' });
    }
  }

  RED.nodes.registerType('AlarmUltimateSiren', AlarmUltimateSiren);
};
