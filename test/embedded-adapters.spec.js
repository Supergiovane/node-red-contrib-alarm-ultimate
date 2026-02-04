'use strict';

const { expect } = require('chai');
const { helper } = require('./helpers');

const alarmNode = require('../nodes/AlarmSystemUltimate.js');
const alarmStateNode = require('../nodes/AlarmUltimateState.js');
const alarmZoneNode = require('../nodes/AlarmUltimateZone.js');

function loadFlow(nodeDefs, flow, credentials) {
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
  return helper.load(nodeDefs, normalizedFlow, credentials || {});
}

describe('Embedded adapters (Alarm State / Alarm Zone)', function () {
  this.timeout(8000);

  before(function (done) {
    helper.startServer(done);
  });

  after(function (done) {
    helper.stopServer(done);
  });

  afterEach(function () {
    return helper.unload();
  });

  it('AlarmUltimateState (Output + Homekit) maps alarm events to HomeKit payload', function (done) {
    const flowId = 'embedded-homekit-out';
    const flow = [
      { id: flowId, type: 'tab', label: flowId },
      {
        id: 'alarm',
        type: 'AlarmSystemUltimate',
        z: flowId,
        controlTopic: 'alarm',
        exitDelaySeconds: 0.05,
        entryDelaySeconds: 0,
        sirenDurationSeconds: 0,
        requireCodeForDisarm: false,
        zones: '[{"topic":"sensor/frontdoor","type":"perimeter","entry":false}]',
        wires: [[], [], [], [], [], [], [], [], [], []],
      },
      {
        id: 'stateNode',
        type: 'AlarmUltimateState',
        z: flowId,
        alarmId: 'alarm',
        io: 'out',
        adapter: 'homekit',
        outputInitialState: true,
        wires: [['out']],
      },
      { id: 'out', type: 'helper', z: flowId },
    ];

    loadFlow([alarmNode, alarmStateNode], flow, {})
      .then(() => {
        const alarm = helper.getNode('alarm');
        const out = helper.getNode('out');

        const seen = { arming: false, armed: false };
        let finished = false;

        function maybeDone() {
          if (seen.arming && seen.armed) {
            finished = true;
            done();
          }
        }

        out.on('input', (msg) => {
          if (finished) return;
          try {
            if (!msg || !msg.payload) return;
            const t = msg.payload.SecuritySystemTargetState;
            const c = msg.payload.SecuritySystemCurrentState;
            if (t === 2 && c === 3) {
              seen.arming = true;
              maybeDone();
              return;
            }
            if (t === 2 && c === 2) {
              seen.armed = true;
              maybeDone();
            }
          } catch (err) {
            finished = true;
            done(err);
          }
        });

        setTimeout(() => {
          alarm.receive({ topic: 'alarm', command: 'arm', homekitTargetState: 2 });
        }, 50);
      })
      .catch(done);
  });

  it('AlarmUltimateState (Input + Homekit) injects arm/disarm commands into the selected alarm', function (done) {
    const flowId = 'embedded-homekit-in';
    const flow = [
      { id: flowId, type: 'tab', label: flowId },
      {
        id: 'alarm',
        type: 'AlarmSystemUltimate',
        z: flowId,
        controlTopic: 'alarm',
        exitDelaySeconds: 0,
        entryDelaySeconds: 0,
        sirenDurationSeconds: 0,
        requireCodeForDisarm: false,
        zones: '[{"topic":"sensor/frontdoor","type":"perimeter","entry":false}]',
        wires: [['alarmOut'], [], [], [], [], [], [], [], [], []],
      },
      { id: 'alarmOut', type: 'helper', z: flowId },
      {
        id: 'stateIn',
        type: 'AlarmUltimateState',
        z: flowId,
        alarmId: 'alarm',
        io: 'in',
        adapter: 'homekit',
        outputInitialState: false,
        wires: [[]],
      },
    ];

    loadFlow([alarmNode, alarmStateNode], flow, {})
      .then(() => {
        const stateIn = helper.getNode('stateIn');
        const alarmOut = helper.getNode('alarmOut');

        let finished = false;
        alarmOut.on('input', (msg) => {
          if (finished) return;
          try {
            if (!msg || msg.event !== 'armed') return;
            expect(msg.alarmUltimate).to.be.an('object');
            expect(msg.alarmUltimate.homekitTargetState).to.equal(1);
            finished = true;
            done();
          } catch (err) {
            finished = true;
            done(err);
          }
        });

        stateIn.receive({ payload: { SecuritySystemTargetState: 1 } });
      })
      .catch(done);
  });

  it('AlarmUltimateState (Input + AX Pro) injects arm/disarm commands into the selected alarm', function (done) {
    const flowId = 'embedded-axpro-in';
    const flow = [
      { id: flowId, type: 'tab', label: flowId },
      {
        id: 'alarm',
        type: 'AlarmSystemUltimate',
        z: flowId,
        controlTopic: 'alarm',
        exitDelaySeconds: 0,
        entryDelaySeconds: 0,
        sirenDurationSeconds: 0,
        requireCodeForDisarm: false,
        zones: '[{"topic":"sensor/frontdoor","type":"perimeter","entry":false}]',
        wires: [['alarmOut'], [], [], [], [], [], [], [], [], []],
      },
      { id: 'alarmOut', type: 'helper', z: flowId },
      {
        id: 'stateIn',
        type: 'AlarmUltimateState',
        z: flowId,
        alarmId: 'alarm',
        io: 'in',
        adapter: 'axpro',
        outputInitialState: false,
        wires: [[]],
      },
    ];

    loadFlow([alarmNode, alarmStateNode], flow, {})
      .then(() => {
        const stateIn = helper.getNode('stateIn');
        const alarmOut = helper.getNode('alarmOut');

        const seen = [];
        let finished = false;
        alarmOut.on('input', (msg) => {
          if (finished) return;
          if (msg && typeof msg.event === 'string') {
            seen.push(msg.event);
          }
        });

        stateIn.receive({ payload: { CIDEvent: { code: 3401 } } });
        setTimeout(() => {
          stateIn.receive({ payload: { CIDEvent: { code: 1401 } } });
        }, 60);

        setTimeout(() => {
          if (finished) return;
          finished = true;
          try {
            expect(seen).to.include('armed');
            expect(seen).to.include('disarmed');
            done();
          } catch (err) {
            done(err);
          }
        }, 250);
      })
      .catch(done);
  });

  it('AlarmUltimateZone (Input + KNX, All zones) injects zone sensor updates into the selected alarm', function (done) {
    const flowId = 'embedded-zone-knx-in';
    const flow = [
      { id: flowId, type: 'tab', label: flowId },
      {
        id: 'alarm',
        type: 'AlarmSystemUltimate',
        z: flowId,
        controlTopic: 'alarm',
        exitDelaySeconds: 0,
        entryDelaySeconds: 0,
        sirenDurationSeconds: 0,
        requireCodeForDisarm: false,
        zones: '[{"topic":"0/1/2","type":"perimeter","entry":false}]',
        wires: [['alarmOut'], [], [], [], [], [], [], [], [], []],
      },
      { id: 'alarmOut', type: 'helper', z: flowId },
      {
        id: 'zoneIn',
        type: 'AlarmUltimateZone',
        z: flowId,
        alarmId: 'alarm',
        zoneTopic: '__all__',
        io: 'in',
        adapter: 'knx',
        outputInitialState: false,
        wires: [[]],
      },
    ];

    loadFlow([alarmNode, alarmZoneNode], flow, {})
      .then(() => {
        const zoneIn = helper.getNode('zoneIn');
        const alarmOut = helper.getNode('alarmOut');

        let finished = false;
        alarmOut.on('input', (msg) => {
          if (finished) return;
          try {
            if (!msg || msg.event !== 'zone_open') return;
            expect(msg.payload).to.be.an('object');
            expect(msg.payload.open).to.equal(true);
            expect(msg.payload.zone).to.be.an('object');
            expect(msg.payload.zone.topic).to.equal('0/1/2');
            finished = true;
            done();
          } catch (err) {
            finished = true;
            done(err);
          }
        });

        zoneIn.receive({ knx: { destination: '0/1/2' }, payload: '1' });
      })
      .catch(done);
  });

  it('AlarmUltimateZone (Input + AX Pro) matches zoneUpdate.name to the configured topic', function (done) {
    const flowId = 'embedded-zone-axpro-in';
    const flow = [
      { id: flowId, type: 'tab', label: flowId },
      {
        id: 'alarm',
        type: 'AlarmSystemUltimate',
        z: flowId,
        controlTopic: 'alarm',
        exitDelaySeconds: 0,
        entryDelaySeconds: 0,
        sirenDurationSeconds: 0,
        requireCodeForDisarm: false,
        zones: JSON.stringify([{ name: 'Front door', topic: 'Front door', type: 'perimeter', entry: false }]),
        wires: [['alarmOut'], [], [], [], [], [], [], [], [], []],
      },
      { id: 'alarmOut', type: 'helper', z: flowId },
      {
        id: 'zoneIn',
        type: 'AlarmUltimateZone',
        z: flowId,
        alarmId: 'alarm',
        zoneTopic: 'Front door',
        io: 'in',
        adapter: 'axpro',
        axProZoneNameMatch: 'contains',
        outputInitialState: false,
        wires: [[]],
      },
    ];

    loadFlow([alarmNode, alarmZoneNode], flow, {})
      .then(() => {
        const zoneIn = helper.getNode('zoneIn');
        const alarmOut = helper.getNode('alarmOut');

        let finished = false;
        alarmOut.on('input', (msg) => {
          if (finished) return;
          try {
            if (!msg || msg.event !== 'zone_open') return;
            expect(msg.payload).to.be.an('object');
            expect(msg.payload.open).to.equal(true);
            expect(msg.payload.zone).to.be.an('object');
            expect(msg.payload.zone.topic).to.equal('Front door');
            finished = true;
            done();
          } catch (err) {
            finished = true;
            done(err);
          }
        });

        zoneIn.receive({
          payload: {
            zoneUpdate: {
              name: 'My Front door Sensor',
              status: 'trigger',
            },
          },
        });
      })
      .catch(done);
  });

  it('AlarmUltimateZone (Output + AX Pro, All zones) formats zone events to payload.zoneUpdate', function (done) {
    const flowId = 'embedded-zone-axpro-out';
    const flow = [
      { id: flowId, type: 'tab', label: flowId },
      {
        id: 'alarm',
        type: 'AlarmSystemUltimate',
        z: flowId,
        controlTopic: 'alarm',
        exitDelaySeconds: 0,
        entryDelaySeconds: 0,
        sirenDurationSeconds: 0,
        requireCodeForDisarm: false,
        zones: JSON.stringify([
          { name: 'Front door', topic: 'sensor/frontdoor', type: 'perimeter', entry: false },
          { name: 'Living motion', topic: 'sensor/living_pir', type: 'motion', entry: false },
        ]),
        wires: [[], [], [], [], [], [], [], [], [], []],
      },
      {
        id: 'zoneOut',
        type: 'AlarmUltimateZone',
        z: flowId,
        alarmId: 'alarm',
        zoneTopic: '__all__',
        io: 'out',
        adapter: 'axpro',
        outputInitialState: false,
        wires: [['out']],
      },
      { id: 'out', type: 'helper', z: flowId },
    ];

    loadFlow([alarmNode, alarmZoneNode], flow, {})
      .then(() => {
        const alarm = helper.getNode('alarm');
        const out = helper.getNode('out');

        let finished = false;
        out.on('input', (msg) => {
          if (finished) return;
          try {
            if (!msg || !msg.payload || !msg.payload.zoneUpdate) return;
            expect(msg.payload.zoneUpdate).to.be.an('object');
            expect(msg.payload.zoneUpdate.name).to.equal('Front door');
            expect(msg.payload.zoneUpdate.magnetOpenStatus).to.equal(true);
            finished = true;
            done();
          } catch (err) {
            finished = true;
            done(err);
          }
        });

        alarm.receive({ topic: 'sensor/frontdoor', payload: true });
      })
      .catch(done);
  });
});
