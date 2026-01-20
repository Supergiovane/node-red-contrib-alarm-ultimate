'use strict';

const helpers = require('./lib/node-helpers.js');
const { alarmInstances, alarmEmitter } = require('./lib/alarm-registry.js');

module.exports = function (RED) {
  function AlarmUltimateState(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    const timerBag = helpers.createTimerBag(node);
    const setNodeStatus = helpers.createStatus(node);

    const alarmId = String(config.alarmId || '').trim();
    const configuredTopic = typeof config.topic === 'string' ? config.topic.trim() : '';
    const outputInitialState = config.outputInitialState !== false;

    let lastMode = null;

    function buildTopic(controlTopic) {
      if (configuredTopic) return configuredTopic;
      const base = typeof controlTopic === 'string' && controlTopic.trim().length > 0 ? controlTopic.trim() : 'alarm';
      return `${base}/state`;
    }

    function emitMode(mode, api, reason) {
      if (mode !== 'armed' && mode !== 'disarmed') {
        return;
      }
      if (lastMode === mode && reason !== 'init') {
        return;
      }
      lastMode = mode;

      const msg = {
        topic: buildTopic(api && api.controlTopic),
        payload: mode,
        alarmId: api ? api.id : alarmId,
        name: api ? api.name || '' : '',
        reason,
      };
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
      const state = api.getState && typeof api.getState === 'function' ? api.getState() : null;
      const mode = state && state.state ? state.state.mode : null;
      setNodeStatus({ fill: 'green', shape: 'dot', text: `Connected (${mode || 'unknown'})` });
      emitMode(mode, api, reason);
    }

    function onAlarmEvent(evt) {
      if (!evt || evt.alarmId !== alarmId) return;
      if (evt.event === 'armed' || evt.event === 'disarmed' || evt.event === 'reset') {
        emitMode(evt.state && evt.state.mode, evt, evt.event);
      }
    }

    alarmEmitter.on('event', onAlarmEvent);
    node.on('close', () => {
      alarmEmitter.off('event', onAlarmEvent);
    });

    if (outputInitialState) {
      timerBag.setTimeout(() => emitCurrent('init'), 0);
      timerBag.setInterval(() => {
        if (lastMode === null) {
          emitCurrent('init_retry');
        }
      }, 1000);
    } else {
      setNodeStatus({ fill: 'grey', shape: 'ring', text: 'Ready' });
    }
  }

  RED.nodes.registerType('AlarmUltimateState', AlarmUltimateState);
};

