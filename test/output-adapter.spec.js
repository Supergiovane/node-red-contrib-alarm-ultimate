'use strict';

const { expect } = require('chai');
const { helper } = require('./helpers');

const alarmNode = require('../nodes/AlarmSystemUltimate.js');
const adapterNode = require('../nodes/AlarmUltimateOutputAdapter.js');

function loadAdapter(flow, credentials) {
  const normalizedFlow = flow.map((node, index) => {
    if (
      node &&
      node.type &&
      node.type !== 'tab' &&
      node.type !== 'subflow' &&
      node.type !== 'group' &&
      node.z &&
      !(Object.prototype.hasOwnProperty.call(node, 'x') && Object.prototype.hasOwnProperty.call(node, 'y'))
    ) {
      return { ...node, x: 100 + index * 10, y: 100 + index * 10 };
    }
    return node;
  });
  return helper.load([alarmNode, adapterNode], normalizedFlow, credentials || {});
}

describe('AlarmUltimateOutputAdapter node', function () {
  this.timeout(5000);

  before(function (done) {
    helper.startServer(done);
  });

  after(function (done) {
    helper.stopServer(done);
  });

  afterEach(function () {
    return helper.unload();
  });

  it('applies built-in preset (HomeKit Security System)', function (done) {
    const flowId = 'outadapter1';
    const flow = [
      { id: flowId, type: 'tab', label: 'outadapter1' },
      {
        id: 'alarm',
        type: 'AlarmSystemUltimate',
        z: flowId,
        controlTopic: 'alarm',
        exitDelaySeconds: 0,
        requireCodeForDisarm: false,
        sirenDurationSeconds: 0,
        zones: '{"id":"front","topic":"sensor/frontdoor","type":"perimeter","entry":false}',
        wires: [[]],
      },
      {
        id: 'adapter',
        type: 'AlarmUltimateOutputAdapter',
        z: flowId,
        alarmId: 'alarm',
        presetSource: 'builtin',
        presetId: 'homekit_security_system',
        wires: [['out']],
      },
      { id: 'out', type: 'helper', z: flowId },
    ];

    loadAdapter(flow)
      .then(() => {
        const alarm = helper.getNode('alarm');
        const out = helper.getNode('out');

        let finished = false;
        out.on('input', (msg) => {
          if (finished) return;
          try {
            expect(msg).to.be.an('object');
            if (
              !msg ||
              !msg.payload ||
              msg.payload.SecuritySystemTargetState !== 1 ||
              msg.payload.SecuritySystemCurrentState !== 1
            ) {
              return;
            }
            expect(msg.payload).to.deep.equal({
              SecuritySystemTargetState: 1,
              SecuritySystemCurrentState: 1,
            });
            finished = true;
            done();
          } catch (err) {
            finished = true;
            done(err);
          }
        });

        alarm.receive({ topic: 'alarm', command: 'arm' });
      })
      .catch(done);
  });

  it('HomeKit preset keeps CurrentState while arming', function (done) {
    const flowId = 'outadapter-homekit-arming';
    const flow = [
      { id: flowId, type: 'tab', label: flowId },
      {
        id: 'alarm',
        type: 'AlarmSystemUltimate',
        z: flowId,
        controlTopic: 'alarm',
        exitDelaySeconds: 0.05,
        requireCodeForDisarm: false,
        sirenDurationSeconds: 0,
        zones: '{"id":"front","topic":"sensor/frontdoor","type":"perimeter","entry":false}',
        wires: [[]],
      },
      {
        id: 'adapter',
        type: 'AlarmUltimateOutputAdapter',
        z: flowId,
        alarmId: 'alarm',
        presetSource: 'builtin',
        presetId: 'homekit_security_system',
        wires: [['out']],
      },
      { id: 'out', type: 'helper', z: flowId },
    ];

    loadAdapter(flow)
      .then(() => {
        const alarm = helper.getNode('alarm');
        const out = helper.getNode('out');

        const seen = { arming: false, armed: false };
        let finished = false;

        out.on('input', (msg) => {
          if (finished) return;
          try {
            if (!msg || !msg.payload) return;
            const t = msg.payload.SecuritySystemTargetState;
            const c = msg.payload.SecuritySystemCurrentState;

            // During arming: target becomes away(1), current remains disarmed(3).
            if (!seen.arming && t === 1 && c === 3) {
              seen.arming = true;
              return;
            }

            // After armed: both become away(1).
            if (seen.arming && t === 1 && c === 1) {
              seen.armed = true;
              finished = true;
              done();
            }
          } catch (err) {
            finished = true;
            done(err);
          }
        });

        alarm.receive({ topic: 'alarm', command: 'arm' });
      })
      .catch(done);
  });

  it('applies built-in preset (Cycle open zones)', function (done) {
    const flowId = 'outadapter2';
    const flow = [
      { id: flowId, type: 'tab', label: 'outadapter2' },
      {
        id: 'alarm',
        type: 'AlarmSystemUltimate',
        z: flowId,
        controlTopic: 'alarm',
        requireCodeForDisarm: false,
        sirenDurationSeconds: 0,
        openZonesRequestTopic: 'alarm/listOpenZones',
        openZonesRequestIntervalSeconds: 0,
        zones: JSON.stringify(
          [
            { id: 'front', name: 'Front door', topic: 'sensor/frontdoor', type: 'perimeter', entry: false },
            { id: 'back', name: 'Back door', topic: 'sensor/backdoor', type: 'perimeter', entry: false },
          ],
          null,
          2
        ),
        wires: [[]],
      },
      {
        id: 'adapter',
        type: 'AlarmUltimateOutputAdapter',
        z: flowId,
        alarmId: 'alarm',
        presetSource: 'builtin',
        presetId: 'cycle_open_zones',
        wires: [['out']],
      },
      { id: 'out', type: 'helper', z: flowId },
    ];

    loadAdapter(flow)
      .then(() => {
        const alarm = helper.getNode('alarm');
        const out = helper.getNode('out');

        let finished = false;

        out.on('input', (msg) => {
          if (finished) return;
          try {
            expect(msg).to.be.an('object');
            if (msg.payload !== 'request: 1/2 Front door') {
              return;
            }
            expect(msg.zone).to.include({ id: 'front', name: 'Front door' });
            finished = true;
            done();
          } catch (err) {
            finished = true;
            done(err);
          }
        });

        alarm.receive({ topic: 'sensor/frontdoor', payload: true });
        alarm.receive({ topic: 'sensor/backdoor', payload: true });
        setTimeout(() => {
          alarm.receive({ topic: 'alarm/listOpenZones' });
        }, 30);
      })
      .catch(done);
  });

  it('applies user preset stored in node config', function (done) {
    const flowId = 'outadapter3';
    const userCode = [
      'if (!msg || typeof msg !== "object") return;',
      'return { topic: "mapped", payload: msg.event || null };',
    ].join('\n');

    const flow = [
      { id: flowId, type: 'tab', label: 'outadapter3' },
      {
        id: 'alarm',
        type: 'AlarmSystemUltimate',
        z: flowId,
        controlTopic: 'alarm',
        requireCodeForDisarm: false,
        sirenDurationSeconds: 0,
        zones: '{"id":"front","topic":"sensor/frontdoor","type":"perimeter","entry":false}',
        wires: [[]],
      },
      {
        id: 'adapter',
        type: 'AlarmUltimateOutputAdapter',
        z: flowId,
        alarmId: 'alarm',
        presetSource: 'user',
        presetId: 'custom',
        userCode,
        wires: [['out']],
      },
      { id: 'out', type: 'helper', z: flowId },
    ];

    loadAdapter(flow)
      .then(() => {
        const alarm = helper.getNode('alarm');
        const out = helper.getNode('out');

        let finished = false;
        out.on('input', (msg) => {
          if (finished) return;
          try {
            expect(msg.topic).to.equal('mapped');
            if (msg.payload !== 'disarmed') return;
            finished = true;
            done();
          } catch (err) {
            finished = true;
            done(err);
          }
        });

        alarm.receive({ topic: 'alarm', command: 'disarm' });
      })
      .catch(done);
  });
});
