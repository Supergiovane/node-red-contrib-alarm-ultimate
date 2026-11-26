'use strict';

const { expect } = require('chai');
const { helper } = require('./helpers');
const { CEREBRUM_REGISTRY_KEY, getCerebrumRegistry } = require('../nodes/lib/cerebrumIntegration.js');

const alarmNode = require('../nodes/AlarmSystemUltimate.js');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('AlarmSystemUltimate → Cerebrum integration', function () {
  this.timeout(5000);

  before(function (done) {
    delete globalThis[CEREBRUM_REGISTRY_KEY];
    helper.startServer(done);
  });

  after(function (done) {
    helper.stopServer(done);
  });

  afterEach(function () {
    return helper.unload();
  });

  const flow = [
    { id: 'tabC', type: 'tab', label: 'cerebrum' },
    {
      id: 'alarmC',
      type: 'AlarmSystemUltimate',
      z: 'tabC',
      name: 'Casa',
      controlTopic: 'alarm',
      exitDelaySeconds: 0.05,
      entryDelaySeconds: 0,
      sirenDurationSeconds: 0.2,
      sirenLatchUntilDisarm: false,
      requireCodeForDisarm: false,
      zones: '[{"name":"Porta ingresso","topic":"sensor/frontdoor","type":"perimeter","entry":false}]',
      x: 100,
      y: 100,
      wires: [[], [], [], [], [], [], [], [], []],
    },
  ];

  it('publishes panel, siren and zones read-only, and follows their changes', async function () {
    await helper.load(alarmNode, flow, {});
    const registry = getCerebrumRegistry();
    const provider = registry.providers.get('alarm-ultimate:alarmC');
    expect(provider).to.include({ adapterId: 'alarm-ultimate', ownerNodeId: 'alarmC' });
    expect(provider).to.not.have.property('callService');
    expect(provider).to.not.have.property('command');

    const entities = await provider.listEntities();
    expect(entities.map((entity) => [entity.id, entity.state])).to.deep.equal([
      ['alarmC/panel', 'disarmed'],
      ['alarmC/siren', 'off'],
      ['alarmC/zone/sensor/frontdoor', 'closed'],
    ]);
    expect(entities[2]).to.include({ name: 'Porta ingresso', kind: 'alarm_zone', bypassed: false });

    const events = [];
    provider.subscribe((event) => events.push(event));
    const alarm = helper.getNode('alarmC');
    alarm.receive({ topic: 'alarm', command: 'arm' });
    await wait(150);
    alarm.receive({ topic: 'sensor/frontdoor', payload: 'open' });
    await wait(50);

    const changes = events.map((event) => [event.entityId, event.state]);
    expect(changes).to.deep.include(['alarmC/panel', 'arming']);
    expect(changes).to.deep.include(['alarmC/panel', 'armed']);
    expect(changes).to.deep.include(['alarmC/zone/sensor/frontdoor', 'open']);
    expect(changes).to.deep.include(['alarmC/panel', 'triggered']);
    expect(changes).to.deep.include(['alarmC/siren', 'on']);
    // Unchanged entities are not repeated.
    expect(changes.filter(([id, state]) => id === 'alarmC/panel' && state === 'armed')).to.have.length(1);
    expect(events[0]).to.include({ adapterId: 'alarm-ultimate', providerId: 'alarm-ultimate:alarmC', eventType: 'state_changed' });
  });

  it('removes the provider when the panel is closed', async function () {
    await helper.load(alarmNode, flow, {});
    expect(getCerebrumRegistry().providers.has('alarm-ultimate:alarmC')).to.equal(true);
    await helper.unload();
    expect(getCerebrumRegistry().providers.has('alarm-ultimate:alarmC')).to.equal(false);
  });
});
