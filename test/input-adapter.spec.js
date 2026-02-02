'use strict';

const { expect } = require('chai');
const { helper } = require('./helpers');

const adapterNode = require('../nodes/AlarmUltimateInputAdapter.js');
const alarmNode = require('../nodes/AlarmSystemUltimate.js');

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
  return helper.load(adapterNode, normalizedFlow, credentials || {});
}

describe('AlarmUltimateInputAdapter node', function () {
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

  it('applies built-in preset (Home Assistant on/off)', function (done) {
    const flowId = 'adapter1';
    const flow = [
      { id: flowId, type: 'tab', label: 'adapter1' },
      {
        id: 'adapter',
        type: 'AlarmUltimateInputAdapter',
        z: flowId,
        presetSource: 'builtin',
        presetId: 'home_assistant_on_off',
        wires: [['out']],
      },
      { id: 'out', type: 'helper', z: flowId },
    ];

    loadAdapter(flow)
      .then(() => {
        const adapter = helper.getNode('adapter');
        const out = helper.getNode('out');

        out.on('input', (msg) => {
          try {
            expect(msg).to.be.an('object');
            expect(msg.topic).to.equal('sensor/frontdoor');
            expect(msg.payload).to.equal(true);
            done();
          } catch (err) {
            done(err);
          }
        });

        adapter.receive({ topic: 'sensor/frontdoor', payload: 'on' });
      })
      .catch(done);
  });

  it('applies built-in preset (KNX Ultimate)', function (done) {
    const flowId = 'adapter3';
    const flow = [
      { id: flowId, type: 'tab', label: 'adapter3' },
      {
        id: 'adapter',
        type: 'AlarmUltimateInputAdapter',
        z: flowId,
        presetSource: 'builtin',
        presetId: 'knx_ultimate',
        wires: [['out']],
      },
      { id: 'out', type: 'helper', z: flowId },
    ];

    loadAdapter(flow)
      .then(() => {
        const adapter = helper.getNode('adapter');
        const out = helper.getNode('out');

        out.on('input', (msg) => {
          try {
            expect(msg).to.be.an('object');
            expect(msg.topic).to.equal('0/1/2');
            expect(msg.payload).to.equal(false);
            done();
          } catch (err) {
            done(err);
          }
        });

        adapter.receive({
          topic: '0/1/2',
          payload: false,
          previouspayload: true,
          payloadmeasureunit: '%',
          payloadsubtypevalue: 'Start',
          devicename: 'Dinning table lamp',
          gainfo: {
            maingroupname: 'Light actuators',
            middlegroupname: 'First flow lights',
            ganame: 'Table Light',
            maingroupnumber: '1',
            middlegroupnumber: '1',
            ganumber: '0',
          },
          knx: {
            event: 'GroupValue_Write',
            dpt: '1.001',
            dptdesc: 'Humidity',
            source: '15.15.22',
            destination: '0/1/2',
            rawValue: { 0: '0x0' },
          },
        });
      })
      .catch(done);
  });

  it('applies built-in preset (AX Pro from Hikvision-Ultimate)', function (done) {
    const flowId = 'adapter4';
    const flow = [
      { id: flowId, type: 'tab', label: 'adapter4' },
      {
        id: 'adapter',
        type: 'AlarmUltimateInputAdapter',
        z: flowId,
        presetSource: 'builtin',
        presetId: 'axpro_hikvision_ultimate',
        wires: [['out']],
      },
      { id: 'out', type: 'helper', z: flowId },
    ];

    loadAdapter(flow)
      .then(() => {
        const adapter = helper.getNode('adapter');
        const out = helper.getNode('out');

        out.on('input', (msg) => {
          try {
            expect(msg).to.be.an('object');
            expect(msg.topic).to.equal('Cancello#2/7/12');
            expect(msg.payload).to.equal(false);
            expect(msg.zoneUpdate).to.be.an('object');
            expect(msg.zoneUpdate.id).to.equal(9);
            done();
          } catch (err) {
            done(err);
          }
        });

        adapter.receive({
          payload: {
            zoneUpdate: {
              id: 9,
              name: 'Cancello#2/7/12',
              status: 'online',
              sensorStatus: 'normal',
              magnetOpenStatus: false,
              tamperEvident: false,
              shielded: false,
              bypassed: false,
              armed: false,
              isArming: false,
              alarm: false,
              subSystemNo: 5,
              linkageSubSystem: [5],
              detectorType: 'magneticContact',
              stayAway: false,
              zoneType: 'Instant',
              accessModuleType: 'localTransmitter',
              moduleChannel: 9,
              zoneAttrib: 'wired',
              deviceNo: 21,
              abnormalOrNot: false,
            },
          },
          _msgid: '5f34ea7333772aeb',
        });
      })
      .catch(done);
  });

  it('applies built-in preset (Apple HomeKit Security System)', function (done) {
    const flowId = 'adapter5';
    const flow = [
      { id: flowId, type: 'tab', label: 'adapter5' },
      {
        id: 'adapter',
        type: 'AlarmUltimateInputAdapter',
        z: flowId,
        presetSource: 'builtin',
        presetId: 'apple_homekit_security_system',
        wires: [['out']],
      },
      { id: 'out', type: 'helper', z: flowId },
    ];

    loadAdapter(flow)
      .then(() => {
        const adapter = helper.getNode('adapter');
        const out = helper.getNode('out');

        out.on('input', (msg) => {
          try {
            expect(msg).to.be.an('object');
            expect(msg.topic).to.equal('alarm/control');
            expect(msg.command).to.equal('arm_away');
            expect(msg.homekit).to.be.an('object');
            expect(msg.homekit.securitySystemState).to.equal(1);
            done();
          } catch (err) {
            done(err);
          }
        });

        adapter.receive({
          controlTopic: 'alarm/control',
          payload: { SecuritySystemTargetState: 1 },
        });
      })
      .catch(done);
  });

  it('injects Alarm controlTopic when Alarm node is selected (HomeKit)', function (done) {
    const flowId = 'adapter-homekit-controltopic';
    const flow = [
      { id: flowId, type: 'tab', label: flowId },
      {
        id: 'alarm',
        type: 'AlarmSystemUltimate',
        z: flowId,
        controlTopic: 'alarm/control',
        requireCodeForDisarm: false,
        sirenDurationSeconds: 0,
        zones: '{"id":"front","topic":"sensor/frontdoor","type":"perimeter","entry":false}',
        wires: [[]],
      },
      {
        id: 'adapter',
        type: 'AlarmUltimateInputAdapter',
        z: flowId,
        alarmId: 'alarm',
        presetSource: 'builtin',
        presetId: 'apple_homekit_security_system',
        wires: [['out']],
      },
      { id: 'out', type: 'helper', z: flowId },
    ];

    helper
      .load([alarmNode, adapterNode], flow, {})
      .then(() => {
        const adapter = helper.getNode('adapter');
        const out = helper.getNode('out');

        out.on('input', (msg) => {
          try {
            expect(msg).to.be.an('object');
            expect(msg.topic).to.equal('alarm/control');
            expect(msg.command).to.equal('arm_away');
            done();
          } catch (err) {
            done(err);
          }
        });

        // No topic/controlTopic in the incoming msg -> must come from selected Alarm node.
        adapter.receive({ payload: { SecuritySystemTargetState: 1 } });
      })
      .catch(done);
  });

  it('applies user preset stored in node config', function (done) {
    const flowId = 'adapter2';
    const userCode = [
      'if (!msg || typeof msg !== "object") return;',
      'const topic = msg.payload && msg.payload.topic ? msg.payload.topic : msg.topic;',
      'const open = msg.payload && msg.payload.state === "open";',
      'return { topic, payload: open };',
    ].join('\n');

    const flow = [
      { id: flowId, type: 'tab', label: 'adapter2' },
      {
        id: 'adapter',
        type: 'AlarmUltimateInputAdapter',
        z: flowId,
        presetSource: 'user',
        presetId: 'custom',
        userCode,
        wires: [['out']],
      },
      { id: 'out', type: 'helper', z: flowId },
    ];

    loadAdapter(flow)
      .then(() => {
        const adapter = helper.getNode('adapter');
        const out = helper.getNode('out');

        out.on('input', (msg) => {
          try {
            expect(msg.topic).to.equal('sensor/door');
            expect(msg.payload).to.equal(true);
            done();
          } catch (err) {
            done(err);
          }
        });

        adapter.receive({ payload: { topic: 'sensor/door', state: 'open' } });
      })
      .catch(done);
  });
});
