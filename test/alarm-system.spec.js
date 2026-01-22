'use strict';

const { expect } = require('chai');
const { helper } = require('./helpers');

const alarmNode = require('../nodes/AlarmSystemUltimate.js');

const ALARM_OUTPUT_COUNT = 9;

function loadAlarm(flow, credentials) {
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
      const adjusted = { ...node, x: 100 + index * 10, y: 100 + index * 10 };
      if (adjusted.type === 'AlarmSystemUltimate' && Array.isArray(adjusted.wires)) {
        const nextWires = adjusted.wires.map((wire) => (Array.isArray(wire) ? wire : []));
        while (nextWires.length < ALARM_OUTPUT_COUNT) {
          nextWires.push([]);
        }
        adjusted.wires = nextWires;
      }
      return adjusted;
    }
    return node;
  });
  return helper.load(alarmNode, normalizedFlow, credentials || {});
}

describe('AlarmSystemUltimate node', function () {
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

  it('triggers alarm after entry delay', function (done) {
    const flowId = 'alarm1';
    const flow = [
      { id: flowId, type: 'tab', label: 'alarm1' },
      {
        id: 'alarm',
        type: 'AlarmSystemUltimate',
        z: flowId,
        controlTopic: 'alarm',
        exitDelaySeconds: 0.05,
        entryDelaySeconds: 0.05,
        sirenDurationSeconds: 0.05,
        sirenLatchUntilDisarm: false,
        requireCodeForDisarm: false,
        blockArmOnViolations: true,
        zones: '{"id":"front","name":"Front","topic":"sensor/frontdoor","type":"perimeter","entry":true}',
        wires: [['events'], ['siren']],
      },
      { id: 'events', type: 'helper', z: flowId },
      { id: 'siren', type: 'helper', z: flowId },
    ];

    loadAlarm(flow).then(() => {
      const alarm = helper.getNode('alarm');
      const events = helper.getNode('events');
      const siren = helper.getNode('siren');

      const received = { entry: false, alarm: false, sirenOn: false };

      function maybeDone() {
        if (received.entry && received.alarm && received.sirenOn) {
          done();
        }
      }

      events.on('input', (msg) => {
        try {
          if (msg.event === 'entry_delay') {
            received.entry = true;
          }
          if (msg.event === 'alarm') {
            received.alarm = true;
          }
          maybeDone();
        } catch (err) {
          done(err);
        }
      });

      siren.on('input', (msg) => {
        try {
          if (msg.event === 'siren_on') {
            received.sirenOn = true;
          }
          maybeDone();
        } catch (err) {
          done(err);
        }
      });

      alarm.receive({ topic: 'alarm', command: 'arm' });
      setTimeout(() => {
        alarm.receive({ topic: 'sensor/frontdoor', payload: 'open' });
      }, 80);
    }).catch(done);
  });

  it('disarms during entry delay and prevents alarm', function (done) {
    const flowId = 'alarm2';
    const flow = [
      { id: flowId, type: 'tab', label: 'alarm2' },
      {
        id: 'alarm',
        type: 'AlarmSystemUltimate',
        z: flowId,
        controlTopic: 'alarm',
        exitDelaySeconds: 0.05,
        entryDelaySeconds: 0.1,
        sirenDurationSeconds: 0.2,
        requireCodeForDisarm: false,
        zones: '{"id":"front","topic":"sensor/frontdoor","type":"perimeter","entry":true}',
        wires: [['events'], ['siren']],
      },
      { id: 'events', type: 'helper', z: flowId },
      { id: 'siren', type: 'helper', z: flowId },
    ];

    loadAlarm(flow).then(() => {
      const alarm = helper.getNode('alarm');
      const events = helper.getNode('events');
      const siren = helper.getNode('siren');

      const seenEvents = [];
      const sirenOn = [];

      events.on('input', (msg) => {
        seenEvents.push(msg.event);
        if (msg.event === 'entry_delay') {
          setTimeout(() => {
            alarm.receive({ topic: 'alarm', command: 'disarm' });
          }, 20);
        }
      });

      siren.on('input', (msg) => {
        if (msg.event === 'siren_on') {
          sirenOn.push(msg);
        }
      });

      alarm.receive({ topic: 'alarm', command: 'arm' });
      setTimeout(() => {
        alarm.receive({ topic: 'sensor/frontdoor', payload: 'open' });
      }, 80);

      setTimeout(() => {
        try {
          expect(seenEvents).to.include('entry_delay');
          expect(seenEvents).to.include('disarmed');
          expect(seenEvents).to.not.include('alarm');
          expect(sirenOn.length).to.equal(0);
          done();
        } catch (err) {
          done(err);
        }
      }, 300);
    }).catch(done);
  });

  it('bypasses a zone and ignores its trigger', function (done) {
    const flowId = 'alarm3';
    const flow = [
      { id: flowId, type: 'tab', label: 'alarm3' },
      {
        id: 'alarm',
        type: 'AlarmSystemUltimate',
        z: flowId,
        controlTopic: 'alarm',
        exitDelaySeconds: 0.05,
        entryDelaySeconds: 0.05,
        sirenDurationSeconds: 0.2,
        requireCodeForDisarm: false,
        zones: '{"id":"front","topic":"sensor/frontdoor","type":"perimeter","entry":false,"bypassable":true}',
        wires: [['events'], ['siren']],
      },
      { id: 'events', type: 'helper', z: flowId },
      { id: 'siren', type: 'helper', z: flowId },
    ];

    loadAlarm(flow).then(() => {
      const alarm = helper.getNode('alarm');
      const events = helper.getNode('events');
      const siren = helper.getNode('siren');

      const seenEvents = [];
      let sirenOn = false;

      events.on('input', (msg) => {
        seenEvents.push(msg.event);
      });

      siren.on('input', (msg) => {
        if (msg.event === 'siren_on') {
          sirenOn = true;
        }
      });

      alarm.receive({ topic: 'alarm', command: 'bypass', zone: 'front' });
      alarm.receive({ topic: 'alarm', command: 'arm' });
      setTimeout(() => {
        alarm.receive({ topic: 'sensor/frontdoor', payload: 'open' });
      }, 80);

      setTimeout(() => {
        try {
          expect(seenEvents).to.include('bypassed');
          expect(seenEvents).to.not.include('alarm');
          expect(sirenOn).to.equal(false);
          done();
        } catch (err) {
          done(err);
        }
      }, 250);
    }).catch(done);
  });

  it('accepts zones as a JSON array (formatted)', function (done) {
    const flowId = 'alarm4';
    const flow = [
      { id: flowId, type: 'tab', label: 'alarm4' },
      {
        id: 'alarm',
        type: 'AlarmSystemUltimate',
        z: flowId,
        controlTopic: 'alarm',
        exitDelaySeconds: 0.05,
        entryDelaySeconds: 0.05,
        sirenDurationSeconds: 0.05,
        sirenLatchUntilDisarm: false,
        requireCodeForDisarm: false,
        blockArmOnViolations: true,
        zones: JSON.stringify(
          [
            {
              id: 'front',
              name: 'Front',
              topic: 'sensor/frontdoor',
              type: 'perimeter',
              entry: true,
            },
          ],
          null,
          2
        ),
        wires: [['events'], ['siren']],
      },
      { id: 'events', type: 'helper', z: flowId },
      { id: 'siren', type: 'helper', z: flowId },
    ];

    loadAlarm(flow).then(() => {
      const alarm = helper.getNode('alarm');
      const events = helper.getNode('events');
      const siren = helper.getNode('siren');

      const received = { entry: false, alarm: false, sirenOn: false };

      function maybeDone() {
        if (received.entry && received.alarm && received.sirenOn) {
          done();
        }
      }

      events.on('input', (msg) => {
        try {
          if (msg.event === 'entry_delay') {
            received.entry = true;
          }
          if (msg.event === 'alarm') {
            received.alarm = true;
          }
          maybeDone();
        } catch (err) {
          done(err);
        }
      });

      siren.on('input', (msg) => {
        try {
          if (msg.event === 'siren_on') {
            received.sirenOn = true;
          }
          maybeDone();
        } catch (err) {
          done(err);
        }
      });

      alarm.receive({ topic: 'alarm', command: 'arm' });
      setTimeout(() => {
        alarm.receive({ topic: 'sensor/frontdoor', payload: 'open' });
      }, 80);
    }).catch(done);
  });

  it('routes alarm events to the "Alarm Triggered" output', function (done) {
    const flowId = 'alarm5';
    const flow = [
      { id: flowId, type: 'tab', label: 'alarm5' },
      {
        id: 'alarm',
        type: 'AlarmSystemUltimate',
        z: flowId,
        controlTopic: 'alarm',
        exitDelaySeconds: 0,
        entryDelaySeconds: 0,
        sirenDurationSeconds: 0,
        requireCodeForDisarm: false,
        zones: '{"id":"front","topic":"sensor/frontdoor","type":"perimeter","entry":false}',
        wires: [['events'], ['siren'], ['alarmTriggered']],
      },
      { id: 'events', type: 'helper', z: flowId },
      { id: 'siren', type: 'helper', z: flowId },
      { id: 'alarmTriggered', type: 'helper', z: flowId },
    ];

    loadAlarm(flow)
      .then(() => {
        const alarm = helper.getNode('alarm');
        const alarmTriggered = helper.getNode('alarmTriggered');

        alarmTriggered.on('input', (msg) => {
          try {
            expect(msg.event).to.equal('alarm');
            done();
          } catch (err) {
            done(err);
          }
        });

        alarm.receive({ topic: 'alarm', command: 'arm' });
        setTimeout(() => {
          alarm.receive({ topic: 'sensor/frontdoor', payload: true });
        }, 20);
      })
      .catch(done);
  });

  it('emits "Any Zone Open" boolean output', function (done) {
    const flowId = 'alarm6';
    const flow = [
      { id: flowId, type: 'tab', label: 'alarm6' },
      {
        id: 'alarm',
        type: 'AlarmSystemUltimate',
        z: flowId,
        controlTopic: 'alarm',
        exitDelaySeconds: 0,
        entryDelaySeconds: 0,
        sirenDurationSeconds: 0,
        requireCodeForDisarm: false,
        zones: '{"id":"front","topic":"sensor/frontdoor","type":"perimeter","entry":false}',
        wires: [['events'], ['siren'], [], [], [], [], ['anyZoneOpen']],
      },
      { id: 'events', type: 'helper', z: flowId },
      { id: 'siren', type: 'helper', z: flowId },
      { id: 'anyZoneOpen', type: 'helper', z: flowId },
    ];

    loadAlarm(flow)
      .then(() => {
        const alarm = helper.getNode('alarm');
        const anyZoneOpen = helper.getNode('anyZoneOpen');

        let hasSeenTrue = false;

        anyZoneOpen.on('input', (msg) => {
          try {
            if (msg.payload === true) {
              hasSeenTrue = true;
              return;
            }
            if (hasSeenTrue && msg.payload === false) {
              done();
            }
          } catch (err) {
            done(err);
          }
        });

        setTimeout(() => {
          alarm.receive({ topic: 'sensor/frontdoor', payload: true });
        }, 30);
        setTimeout(() => {
          alarm.receive({ topic: 'sensor/frontdoor', payload: false });
        }, 80);
      })
      .catch(done);
  });

  it('lists open zones on request topic', function (done) {
    const flowId = 'alarm7';
    const flow = [
      { id: flowId, type: 'tab', label: 'alarm7' },
      {
        id: 'alarm',
        type: 'AlarmSystemUltimate',
        z: flowId,
        controlTopic: 'alarm',
        exitDelaySeconds: 0,
        entryDelaySeconds: 0,
        sirenDurationSeconds: 0,
        requireCodeForDisarm: false,
        openZonesRequestTopic: 'alarm/listOpenZones',
        openZonesRequestIntervalSeconds: 0,
        zones: JSON.stringify(
          [
            { id: 'front', topic: 'sensor/frontdoor', type: 'perimeter', entry: false },
            { id: 'back', topic: 'sensor/backdoor', type: 'perimeter', entry: false },
          ],
          null,
          2
        ),
        wires: [['events'], ['siren'], [], [], [], [], [], [], ['openZones']],
      },
      { id: 'events', type: 'helper', z: flowId },
      { id: 'siren', type: 'helper', z: flowId },
      { id: 'openZones', type: 'helper', z: flowId },
    ];

    loadAlarm(flow)
      .then(() => {
        const alarm = helper.getNode('alarm');
        const openZones = helper.getNode('openZones');

        const receivedIds = new Set();

        openZones.on('input', (msg) => {
          try {
            expect(msg.event).to.equal('open_zone');
            expect(msg).to.have.nested.property('payload.zone.id');
            receivedIds.add(msg.payload.zone.id);
            if (receivedIds.has('front') && receivedIds.has('back')) {
              done();
            }
          } catch (err) {
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

  it('emits zone open/close events while disarmed', function (done) {
    const flowId = 'alarm-zone-events';
    const flow = [
      { id: flowId, type: 'tab', label: 'alarm-zone-events' },
      {
        id: 'alarm',
        type: 'AlarmSystemUltimate',
        z: flowId,
        controlTopic: 'alarm',
        requireCodeForDisarm: false,
        zones: '{"id":"front","name":"Front","topic":"sensor/frontdoor","type":"perimeter","entry":false}',
        wires: [[], [], [], [], ['zoneEvents']],
      },
      { id: 'zoneEvents', type: 'helper', z: flowId },
    ];

    loadAlarm(flow)
      .then(() => {
        const alarm = helper.getNode('alarm');
        const zoneEvents = helper.getNode('zoneEvents');

        const seen = [];
        zoneEvents.on('input', (msg) => {
          seen.push(msg);
        });

        // Default mode is disarmed. We should still see zone_open/zone_close.
        alarm.receive({ topic: 'sensor/frontdoor', payload: true });
        setTimeout(() => {
          alarm.receive({ topic: 'sensor/frontdoor', payload: false });
        }, 30);

        setTimeout(() => {
          try {
            const events = seen.map((m) => m.event).filter(Boolean);
            expect(events).to.include('zone_open');
            expect(events).to.include('zone_close');
            const openEvt = seen.find((m) => m && m.event === 'zone_open');
            expect(openEvt).to.be.an('object');
            expect(openEvt.payload).to.be.an('object');
            expect(openEvt.payload.zone).to.be.an('object');
            expect(openEvt.payload.zone.topic).to.equal('sensor/frontdoor');
            done();
          } catch (err) {
            done(err);
          }
        }, 120);
      })
      .catch(done);
  });
});
