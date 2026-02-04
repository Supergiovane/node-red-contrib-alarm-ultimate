'use strict';

const { expect } = require('chai');
const { helper } = require('./helpers');

const alarmNode = require('../nodes/AlarmSystemUltimate.js');

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
      return { ...node, x: 100 + index * 10, y: 100 + index * 10 };
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
        zones: '{"name":"Front","topic":"sensor/frontdoor","type":"perimeter","entry":true}',
        wires: [['out'], [], [], [], [], [], [], [], [], []],
      },
      { id: 'out', type: 'helper', z: flowId },
    ];

    loadAlarm(flow).then(() => {
      const alarm = helper.getNode('alarm');
      const out = helper.getNode('out');

      const received = { entry: false, alarm: false, sirenOn: false };

      function maybeDone() {
        if (received.entry && received.alarm && received.sirenOn) {
          done();
        }
      }

      out.on('input', (msg) => {
        try {
          if (msg && msg.topic === 'alarm/event' && msg.event === 'entry_delay') received.entry = true;
          if (msg && msg.topic === 'alarm/event' && msg.event === 'alarm') received.alarm = true;
          if (msg && msg.topic === 'alarm/siren' && msg.event === 'siren_on') received.sirenOn = true;
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
        zones: '{"topic":"sensor/frontdoor","type":"perimeter","entry":true}',
        wires: [['out'], [], [], [], [], [], [], [], [], []],
      },
      { id: 'out', type: 'helper', z: flowId },
    ];

    loadAlarm(flow).then(() => {
      const alarm = helper.getNode('alarm');
      const out = helper.getNode('out');

      const seenEvents = [];
      const sirenOn = [];

      out.on('input', (msg) => {
        if (msg && msg.topic === 'alarm/event' && msg.event) {
          seenEvents.push(msg.event);
        }
        if (msg && msg.topic === 'alarm/event' && msg.event === 'entry_delay') {
          setTimeout(() => {
            alarm.receive({ topic: 'alarm', command: 'disarm' });
          }, 20);
        }
      });

      out.on('input', (msg) => {
        if (msg && msg.topic === 'alarm/siren' && msg.event === 'siren_on') {
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
        zones: '{"topic":"sensor/frontdoor","type":"perimeter","entry":false,"bypassable":true}',
        wires: [['out'], [], [], [], [], [], [], [], [], []],
      },
      { id: 'out', type: 'helper', z: flowId },
    ];

    loadAlarm(flow).then(() => {
      const alarm = helper.getNode('alarm');
      const out = helper.getNode('out');

      const seenEvents = [];
      let sirenOn = false;

      out.on('input', (msg) => {
        if (msg && msg.topic === 'alarm/event' && msg.event) {
          seenEvents.push(msg.event);
        }
        if (msg && msg.topic === 'alarm/siren' && msg.event === 'siren_on') {
          sirenOn = true;
        }
      });

      alarm.receive({ topic: 'alarm', command: 'bypass', zone: 'sensor/frontdoor' });
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
              name: 'Front',
              topic: 'sensor/frontdoor',
              type: 'perimeter',
              entry: true,
            },
          ],
          null,
          2
        ),
        wires: [['out'], [], [], [], [], [], [], [], [], []],
      },
      { id: 'out', type: 'helper', z: flowId },
    ];

    loadAlarm(flow).then(() => {
      const alarm = helper.getNode('alarm');
      const out = helper.getNode('out');

      const received = { entry: false, alarm: false, sirenOn: false };

      function maybeDone() {
        if (received.entry && received.alarm && received.sirenOn) {
          done();
        }
      }

      out.on('input', (msg) => {
        try {
          if (msg && msg.topic === 'alarm/event' && msg.event === 'entry_delay') received.entry = true;
          if (msg && msg.topic === 'alarm/event' && msg.event === 'alarm') received.alarm = true;
          if (msg && msg.topic === 'alarm/siren' && msg.event === 'siren_on') received.sirenOn = true;
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

  it('emits the "alarm" event on the output', function (done) {
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
        zones: '{"topic":"sensor/frontdoor","type":"perimeter","entry":false}',
        wires: [['out'], [], [], [], [], [], [], [], [], []],
      },
      { id: 'out', type: 'helper', z: flowId },
    ];

    loadAlarm(flow)
      .then(() => {
        const alarm = helper.getNode('alarm');
        const out = helper.getNode('out');

        out.on('input', (msg) => {
          try {
            if (msg && msg.topic === 'alarm/event' && msg.event === 'alarm') {
              done();
            }
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
        zones: '{"topic":"sensor/frontdoor","type":"perimeter","entry":false}',
        wires: [['out'], [], [], [], [], [], [], [], [], []],
      },
      { id: 'out', type: 'helper', z: flowId },
    ];

    loadAlarm(flow)
      .then(() => {
        const alarm = helper.getNode('alarm');
        const out = helper.getNode('out');

        let hasSeenTrue = false;

        out.on('input', (msg) => {
          try {
            if (!msg || msg.topic !== 'alarm/anyZoneOpen') return;
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
            { name: 'Front', topic: 'sensor/frontdoor', type: 'perimeter', entry: false },
            { name: 'Back', topic: 'sensor/backdoor', type: 'perimeter', entry: false },
          ],
          null,
          2
        ),
        wires: [['out'], [], [], [], [], [], [], [], [], []],
      },
      { id: 'out', type: 'helper', z: flowId },
    ];

    loadAlarm(flow)
      .then(() => {
        const alarm = helper.getNode('alarm');
        const out = helper.getNode('out');

        const receivedTopics = new Set();

        out.on('input', (msg) => {
          try {
            if (!msg || msg.topic !== 'alarm/openZone') return;
            expect(msg.event).to.equal('open_zone');
            expect(msg).to.have.nested.property('payload.zone.topic');
            receivedTopics.add(msg.payload.zone.topic);
            if (receivedTopics.has('sensor/frontdoor') && receivedTopics.has('sensor/backdoor')) {
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

  it('cycles open zones at a fixed interval (any state)', function (done) {
    const flowId = 'alarm-open-zones-cycle';
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
        emitOpenZonesCycle: true,
        openZonesCycleIntervalSeconds: 0.03,
        zones: JSON.stringify(
          [
            { name: 'Front', topic: 'sensor/frontdoor', type: 'perimeter', entry: false },
            { name: 'Back', topic: 'sensor/backdoor', type: 'perimeter', entry: false },
          ],
          null,
          2
        ),
        wires: [['out'], [], [], [], [], [], [], [], [], []],
      },
      { id: 'out', type: 'helper', z: flowId },
    ];

    loadAlarm(flow)
      .then(() => {
        const alarm = helper.getNode('alarm');
        const out = helper.getNode('out');

        const receivedTopics = new Set();

        out.on('input', (msg) => {
          try {
            if (!msg || msg.topic !== 'alarm/openZone') return;
            if (msg.event !== 'open_zone') return;
            if (!msg.payload || msg.payload.context !== 'cycle') return;
            if (!msg.payload.zone || !msg.payload.zone.topic) return;
            receivedTopics.add(msg.payload.zone.topic);
            if (receivedTopics.has('sensor/frontdoor') && receivedTopics.has('sensor/backdoor')) {
              done();
            }
          } catch (err) {
            done(err);
          }
        });

        alarm.receive({ topic: 'sensor/frontdoor', payload: true });
        alarm.receive({ topic: 'sensor/backdoor', payload: true });
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
        zones: '{"name":"Front","topic":"sensor/frontdoor","type":"perimeter","entry":false}',
        wires: [['out'], [], [], [], [], [], [], [], [], []],
      },
      { id: 'out', type: 'helper', z: flowId },
    ];

    loadAlarm(flow)
      .then(() => {
        const alarm = helper.getNode('alarm');
        const out = helper.getNode('out');

        const seen = [];
        out.on('input', (msg) => {
          if (msg && msg.topic === 'alarm/event') {
            seen.push(msg);
          }
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

  it('emits siren messages on the same output', function (done) {
    const flowId = 'alarmSingle1';
    const flow = [
      { id: flowId, type: 'tab', label: 'alarmSingle1' },
      {
        id: 'alarm',
        type: 'AlarmSystemUltimate',
        z: flowId,
        controlTopic: 'alarm',
        sirenDurationSeconds: 0.05,
        sirenLatchUntilDisarm: false,
        requireCodeForDisarm: false,
        zones: '{"name":"Front","topic":"sensor/frontdoor","type":"perimeter","entry":false}',
        wires: [['out'], [], [], [], [], [], [], [], [], []],
      },
      { id: 'out', type: 'helper', z: flowId },
    ];

    loadAlarm(flow)
      .then(() => {
        const alarm = helper.getNode('alarm');
        const out = helper.getNode('out');

        const got = { event: false, siren: false };

        function maybeDone() {
          if (got.event && got.siren) done();
        }

        out.on('input', (msg) => {
          try {
            if (msg && msg.topic === 'alarm/event' && msg.event === 'siren_on') {
              got.event = true;
            }
            if (msg && msg.topic === 'alarm/siren' && msg.event === 'siren_on') {
              got.siren = true;
            }
            maybeDone();
          } catch (err) {
            done(err);
          }
        });

        alarm.receive({ topic: 'alarm', command: 'siren_on' });
      })
      .catch(done);
  });

  it('syncs arm/disarm to other Alarm nodes', function (done) {
    const flowId = 'alarm-sync';
    const flow = [
      { id: flowId, type: 'tab', label: 'alarm-sync' },
      {
        id: 'alarmA',
        type: 'AlarmSystemUltimate',
        z: flowId,
        name: 'Alarm A',
        controlTopic: 'alarmA',
        exitDelaySeconds: 0,
        requireCodeForDisarm: false,
        syncTargets: JSON.stringify({
          alarmB: { onArm: 'arm', onDisarm: 'disarm' },
        }),
        wires: [['aEvents'], [], [], [], [], [], [], [], [], []],
      },
      { id: 'aEvents', type: 'helper', z: flowId },
      {
        id: 'alarmB',
        type: 'AlarmSystemUltimate',
        z: flowId,
        name: 'Alarm B',
        controlTopic: 'alarmB',
        exitDelaySeconds: 0,
        requireCodeForDisarm: false,
        wires: [['bEvents'], [], [], [], [], [], [], [], [], []],
      },
      { id: 'bEvents', type: 'helper', z: flowId },
    ];

    loadAlarm(flow)
      .then(() => {
        const alarmA = helper.getNode('alarmA');
        const bEvents = helper.getNode('bEvents');

        const seenB = [];
        bEvents.on('input', (msg) => {
          if (msg && typeof msg.event === 'string') {
            seenB.push(msg.event);
          }
        });

        alarmA.receive({ topic: 'alarmA', command: 'arm' });
        setTimeout(() => {
          alarmA.receive({ topic: 'alarmA', command: 'disarm' });
        }, 60);

        setTimeout(() => {
          try {
            expect(seenB).to.include('armed');
            expect(seenB).to.include('disarmed');
            done();
          } catch (err) {
            done(err);
          }
        }, 250);
      })
      .catch(done);
  });

  it('emits supervision_lost and supervision_restored for supervised zones', function (done) {
    const flowId = 'alarm-supervision1';
    const flow = [
      { id: flowId, type: 'tab', label: 'alarm-supervision1' },
      {
        id: 'alarm',
        type: 'AlarmSystemUltimate',
        z: flowId,
        controlTopic: 'alarm',
        requireCodeForDisarm: false,
        zones: JSON.stringify({
          topic: 'sensor/frontdoor',
          type: 'perimeter',
          supervision: { enabled: true, timeoutSeconds: 0.05 },
        }),
        wires: [['events'], [], [], [], [], [], [], [], [], []],
      },
      { id: 'events', type: 'helper', z: flowId },
    ];

    loadAlarm(flow)
      .then(() => {
        const alarm = helper.getNode('alarm');
        const events = helper.getNode('events');

        const received = { lost: false, restored: false };
        let finished = false;

        function maybeDone() {
          if (finished) return;
          if (received.lost && received.restored) {
            finished = true;
            done();
          }
        }

        events.on('input', (msg) => {
          try {
            if (msg && msg.event === 'supervision_lost') received.lost = true;
            if (msg && msg.event === 'supervision_restored') received.restored = true;
            maybeDone();
          } catch (err) {
            if (!finished) {
              finished = true;
              done(err);
            }
          }
        });

        alarm.receive({ topic: 'sensor/frontdoor', payload: true });
        setTimeout(() => {
          alarm.receive({ topic: 'sensor/frontdoor', payload: true });
        }, 120);

        setTimeout(() => {
          if (finished) return;
          finished = true;
          done(new Error('Timeout waiting for supervision events'));
        }, 700);
      })
      .catch(done);
  });

  it('starts supervision immediately (no initial sensor message)', function (done) {
    const flowId = 'alarm-supervision3';
    const flow = [
      { id: flowId, type: 'tab', label: 'alarm-supervision3' },
      {
        id: 'alarm',
        type: 'AlarmSystemUltimate',
        z: flowId,
        controlTopic: 'alarm',
        requireCodeForDisarm: false,
        zones: JSON.stringify({
          topic: 'sensor/frontdoor',
          type: 'perimeter',
          supervision: { enabled: true, timeoutSeconds: 0.05 },
        }),
        wires: [['events'], [], [], [], [], [], [], [], [], []],
      },
      { id: 'events', type: 'helper', z: flowId },
    ];

    loadAlarm(flow)
      .then(() => {
        const alarm = helper.getNode('alarm');
        const events = helper.getNode('events');

        const received = { lost: false, restored: false };
        let finished = false;

        function maybeDone() {
          if (finished) return;
          if (received.lost && received.restored) {
            finished = true;
            done();
          }
        }

        events.on('input', (msg) => {
          try {
            if (msg && msg.event === 'supervision_lost') {
              received.lost = true;
              // Restore by sending a valid sensor update.
              setTimeout(() => {
                alarm.receive({ topic: 'sensor/frontdoor', payload: false });
              }, 10);
            }
            if (msg && msg.event === 'supervision_restored') received.restored = true;
            maybeDone();
          } catch (err) {
            if (!finished) {
              finished = true;
              done(err);
            }
          }
        });

        setTimeout(() => {
          if (finished) return;
          finished = true;
          done(new Error('Timeout waiting for immediate supervision events'));
        }, 700);
      })
      .catch(done);
  });

  it('blocks arming when supervision is lost (blockArmOnViolations)', function (done) {
    const flowId = 'alarm-supervision2';
    const flow = [
      { id: flowId, type: 'tab', label: 'alarm-supervision2' },
      {
        id: 'alarm',
        type: 'AlarmSystemUltimate',
        z: flowId,
        controlTopic: 'alarm',
        exitDelaySeconds: 0,
        requireCodeForDisarm: false,
        blockArmOnViolations: true,
        zones: JSON.stringify({
          topic: 'sensor/frontdoor',
          type: 'perimeter',
          supervision: { enabled: true, timeoutSeconds: 0.05, blockArm: true },
        }),
        wires: [['events'], [], [], [], [], [], [], [], [], []],
      },
      { id: 'events', type: 'helper', z: flowId },
    ];

    loadAlarm(flow)
      .then(() => {
        const alarm = helper.getNode('alarm');
        const events = helper.getNode('events');

        const seen = [];
        events.on('input', (msg) => {
          if (msg && typeof msg.event === 'string') {
            seen.push(msg);
          }
        });

        // Start supervision timer without opening the zone.
        alarm.receive({ topic: 'sensor/frontdoor', payload: false });

        setTimeout(() => {
          alarm.receive({ topic: 'alarm', command: 'arm' });
        }, 120);

        setTimeout(() => {
          try {
            const blocked = seen.find((m) => m && m.event === 'arm_blocked');
            expect(blocked, 'arm_blocked not received').to.exist;
            const violations = blocked && blocked.payload ? blocked.payload.violations : null;
            expect(violations).to.be.an('array');
            expect(violations[0]).to.include({ topic: 'sensor/frontdoor' });
            expect(Boolean(violations[0].supervisionLost)).to.equal(true);
            done();
          } catch (err) {
            done(err);
          }
        }, 450);
      })
      .catch(done);
  });
});
