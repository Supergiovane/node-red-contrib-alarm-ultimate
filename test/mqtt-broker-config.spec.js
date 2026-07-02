'use strict';

const net = require('net');
const { expect } = require('chai');
const mqttPacket = require('mqtt-packet');
const { helper, loadNode } = require('./helpers');

const alarmNode = require('../nodes/AlarmSystemUltimate.js');
const brokerConfigNode = require('../nodes/AlarmUltimateMqtt-config.js');

// Minimal in-process MQTT broker: accepts connections, acks CONNECT/SUBSCRIBE/PING and records
// every PUBLISH. Enough to verify the shared-connection behaviour without a real broker.
function createMiniBroker() {
  const state = {
    server: null,
    port: 0,
    connections: 0,
    activeSockets: new Set(),
    published: [], // { topic, payload, retain }
    subscriptions: [], // topic strings
  };

  state.server = net.createServer((socket) => {
    state.connections += 1;
    state.activeSockets.add(socket);
    const parser = mqttPacket.parser({ protocolVersion: 4 });
    socket.on('data', (chunk) => parser.parse(chunk));
    socket.on('error', () => {});
    socket.on('close', () => state.activeSockets.delete(socket));
    parser.on('error', () => {});
    parser.on('packet', (packet) => {
      if (packet.cmd === 'connect') {
        socket.write(mqttPacket.generate({ cmd: 'connack', returnCode: 0, sessionPresent: false }));
      } else if (packet.cmd === 'subscribe') {
        packet.subscriptions.forEach((s) => state.subscriptions.push(s.topic));
        socket.write(
          mqttPacket.generate({
            cmd: 'suback',
            messageId: packet.messageId,
            granted: packet.subscriptions.map(() => 0),
          })
        );
      } else if (packet.cmd === 'publish') {
        state.published.push({
          topic: packet.topic,
          payload: packet.payload.toString(),
          retain: packet.retain === true,
        });
      } else if (packet.cmd === 'pingreq') {
        socket.write(mqttPacket.generate({ cmd: 'pingresp' }));
      }
    });
    // Deliver a message to this client as if another client had published it.
    socket.deliver = (topic, payload) => {
      socket.write(
        mqttPacket.generate({
          cmd: 'publish',
          topic,
          payload: Buffer.from(payload),
          qos: 0,
          dup: false,
          retain: false,
          messageId: 0,
        })
      );
    };
  });

  return new Promise((resolve) => {
    state.server.listen(0, '127.0.0.1', () => {
      state.port = state.server.address().port;
      resolve(state);
    });
  });
}

function waitFor(check, timeoutMs = 3000, intervalMs = 20) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    (function poll() {
      let result;
      try {
        result = check();
      } catch (err) {
        return reject(err);
      }
      if (result) return resolve(result);
      if (Date.now() - started > timeoutMs) return reject(new Error('waitFor timed out'));
      setTimeout(poll, intervalMs);
    })();
  });
}

function lastPayload(broker, topic) {
  for (let i = broker.published.length - 1; i >= 0; i -= 1) {
    if (broker.published[i].topic === topic) return broker.published[i].payload;
  }
  return undefined;
}

describe('Alarm MQTT broker config node (shared connection)', function () {
  this.timeout(8000);

  let broker;

  before(function (done) {
    helper.startServer(done);
  });

  after(function (done) {
    helper.stopServer(done);
  });

  beforeEach(async function () {
    broker = await createMiniBroker();
  });

  afterEach(async function () {
    await helper.unload();
    await new Promise((resolve) => broker.server.close(() => resolve()));
  });

  function alarmFlowNode(id, name, extra) {
    return Object.assign(
      {
        id,
        type: 'AlarmSystemUltimate',
        z: 'flow1',
        name,
        controlTopic: 'alarm',
        exitDelaySeconds: 0.05,
        entryDelaySeconds: 0.05,
        requireCodeForArm: false,
        requireCodeForDisarm: false,
        persistState: false,
        mqttEnabled: true,
        wires: [[], [], [], [], [], [], [], [], []],
      },
      extra
    );
  }

  it('shares a single MQTT connection between two alarm nodes and announces both panels', async function () {
    const flow = [
      { id: 'flow1', type: 'tab', label: 'flow' },
      {
        id: 'broker1',
        type: 'AlarmUltimateMqtt-config',
        url: `mqtt://127.0.0.1:${broker.port}`,
        baseTopic: 'alarm-ultimate',
        discoveryPrefix: 'homeassistant',
      },
      alarmFlowNode('alarmA', 'Panel One', {
        mqttBroker: 'broker1',
        zones: '[{"name":"Front","topic":"sensor/frontdoor","type":"perimeter"}]',
      }),
      alarmFlowNode('alarmB', 'Panel Two', { mqttBroker: 'broker1', zones: '[]' }),
    ];

    await loadNode([brokerConfigNode, alarmNode], flow);

    await waitFor(
      () =>
        lastPayload(broker, 'alarm-ultimate/panel_one/state') === 'disarmed' &&
        lastPayload(broker, 'alarm-ultimate/panel_two/state') === 'disarmed'
    );

    // One TCP connection for both panels.
    expect(broker.connections).to.equal(1);

    // Connection-level availability (Last Will topic) plus per-panel availability.
    expect(lastPayload(broker, 'alarm-ultimate/_bridge/availability')).to.equal('online');
    expect(lastPayload(broker, 'alarm-ultimate/panel_one/availability')).to.equal('online');
    expect(lastPayload(broker, 'alarm-ultimate/panel_two/availability')).to.equal('online');

    // Both panels announced Home Assistant discovery, referencing both availability topics.
    const discovery = JSON.parse(lastPayload(broker, 'homeassistant/alarm_control_panel/panel_one/config'));
    expect(discovery.state_topic).to.equal('alarm-ultimate/panel_one/state');
    expect(discovery.availability_mode).to.equal('all');
    expect(discovery.availability.map((a) => a.topic)).to.have.members([
      'alarm-ultimate/_bridge/availability',
      'alarm-ultimate/panel_one/availability',
    ]);
    expect(lastPayload(broker, 'homeassistant/alarm_control_panel/panel_two/config')).to.be.a('string');

    // Zone binary_sensor discovery for panel one.
    const zoneDiscovery = JSON.parse(
      lastPayload(broker, 'homeassistant/binary_sensor/panel_one_sensor_frontdoor/config')
    );
    expect(zoneDiscovery.state_topic).to.equal('alarm-ultimate/panel_one/zone/sensor_frontdoor/state');

    // Both command topics are subscribed on the shared connection.
    expect(broker.subscriptions).to.include('alarm-ultimate/panel_one/command');
    expect(broker.subscriptions).to.include('alarm-ultimate/panel_two/command');
  });

  it('routes HA commands to the right panel over the shared connection', async function () {
    const flow = [
      { id: 'flow1', type: 'tab', label: 'flow' },
      {
        id: 'broker1',
        type: 'AlarmUltimateMqtt-config',
        url: `mqtt://127.0.0.1:${broker.port}`,
        baseTopic: 'alarm-ultimate',
        discoveryPrefix: 'homeassistant',
      },
      alarmFlowNode('alarmA', 'Panel One', { mqttBroker: 'broker1', zones: '[]' }),
      alarmFlowNode('alarmB', 'Panel Two', { mqttBroker: 'broker1', zones: '[]' }),
    ];

    await loadNode([brokerConfigNode, alarmNode], flow);
    await waitFor(
      () =>
        lastPayload(broker, 'alarm-ultimate/panel_one/state') === 'disarmed' &&
        lastPayload(broker, 'alarm-ultimate/panel_two/state') === 'disarmed'
    );

    const socket = Array.from(broker.activeSockets)[0];
    socket.deliver('alarm-ultimate/panel_one/command', 'ARM_AWAY');

    await waitFor(() => lastPayload(broker, 'alarm-ultimate/panel_one/state') === 'armed_away');
    // The other panel sharing the connection must be untouched.
    expect(lastPayload(broker, 'alarm-ultimate/panel_two/state')).to.equal('disarmed');
  });

  it('legacy fallback: broker settings on the alarm node still work with a private connection', async function () {
    const flow = [
      { id: 'flow1', type: 'tab', label: 'flow' },
      alarmFlowNode('alarmA', 'Legacy Panel', {
        mqttUrl: `mqtt://127.0.0.1:${broker.port}`,
        mqttBaseTopic: 'alarm-ultimate',
        mqttDiscoveryPrefix: 'homeassistant',
        zones: '[]',
      }),
    ];

    await loadNode([brokerConfigNode, alarmNode], flow);
    await waitFor(() => lastPayload(broker, 'alarm-ultimate/legacy_panel/state') === 'disarmed');

    expect(broker.connections).to.equal(1);
    expect(lastPayload(broker, 'alarm-ultimate/legacy_panel/availability')).to.equal('online');

    // Single availability topic (the panel's own), exactly as before the config node existed.
    const discovery = JSON.parse(lastPayload(broker, 'homeassistant/alarm_control_panel/legacy_panel/config'));
    expect(discovery.availability_topic).to.equal('alarm-ultimate/legacy_panel/availability');
    expect(discovery.availability).to.equal(undefined);
  });

  it('marks a supervised zone unavailable in HA when supervision is lost, available again on restore', async function () {
    const flow = [
      { id: 'flow1', type: 'tab', label: 'flow' },
      {
        id: 'broker1',
        type: 'AlarmUltimateMqtt-config',
        url: `mqtt://127.0.0.1:${broker.port}`,
        baseTopic: 'alarm-ultimate',
        discoveryPrefix: 'homeassistant',
      },
      alarmFlowNode('alarmA', 'Panel One', {
        mqttBroker: 'broker1',
        zones:
          '[{"name":"Front","topic":"sensor/frontdoor","type":"perimeter","supervision":{"enabled":true,"timeoutSeconds":0.15,"blockArm":false}},' +
          '{"name":"Back","topic":"sensor/backdoor","type":"perimeter"}]',
      }),
    ];

    await loadNode([brokerConfigNode, alarmNode], flow);
    await waitFor(() => lastPayload(broker, 'alarm-ultimate/panel_one/state') === 'disarmed');

    const zoneAvailabilityTopic = 'alarm-ultimate/panel_one/zone/sensor_frontdoor/availability';

    // Supervised zone discovery references its own availability topic too (mode "all").
    const supervised = JSON.parse(
      lastPayload(broker, 'homeassistant/binary_sensor/panel_one_sensor_frontdoor/config')
    );
    expect(supervised.availability_mode).to.equal('all');
    expect(supervised.availability.map((a) => a.topic)).to.have.members([
      'alarm-ultimate/_bridge/availability',
      'alarm-ultimate/panel_one/availability',
      zoneAvailabilityTopic,
    ]);
    // Unsupervised zones keep the panel-level availability only.
    const unsupervised = JSON.parse(
      lastPayload(broker, 'homeassistant/binary_sensor/panel_one_sensor_backdoor/config')
    );
    expect(unsupervised.availability.map((a) => a.topic)).to.have.members([
      'alarm-ultimate/_bridge/availability',
      'alarm-ultimate/panel_one/availability',
    ]);

    // Announced as available, then unavailable once the supervision timeout expires.
    expect(lastPayload(broker, zoneAvailabilityTopic)).to.equal('online');
    await waitFor(() => lastPayload(broker, zoneAvailabilityTopic) === 'offline');

    // A valid sensor update restores supervision and availability.
    helper.getNode('alarmA').receive({ topic: 'sensor/frontdoor', payload: true });
    await waitFor(() => lastPayload(broker, zoneAvailabilityTopic) === 'online');
  });

  it('exposes legacy MQTT credentials to the editor migration hint', async function () {
    const flow = [
      { id: 'flow1', type: 'tab', label: 'flow' },
      alarmFlowNode('alarmA', 'Legacy Panel', {
        mqttUrl: `mqtt://127.0.0.1:${broker.port}`,
        mqttBaseTopic: 'alarm-ultimate',
        zones: '[]',
      }),
    ];

    await loadNode([brokerConfigNode, alarmNode], flow, {
      alarmA: { mqttUsername: 'legacy-user', mqttPassword: 'legacy-secret' },
    });
    await waitFor(() => lastPayload(broker, 'alarm-ultimate/legacy_panel/state') === 'disarmed');

    const res = await helper.request().get('/alarm-ultimate/alarm/alarmA/mqtt-legacy-credentials').expect(200);
    expect(res.body).to.deep.equal({ username: 'legacy-user', password: 'legacy-secret' });

    await helper.request().get('/alarm-ultimate/alarm/missing/mqtt-legacy-credentials').expect(404);
  });
});
