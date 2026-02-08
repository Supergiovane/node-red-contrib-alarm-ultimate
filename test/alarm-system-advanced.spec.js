'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

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

function waitForEvent(node, eventName, timeoutMs) {
  const ms = Number(timeoutMs) || 800;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timeout waiting for event: ${eventName}`));
    }, ms);
    function cleanup() {
      clearTimeout(timer);
      try {
        node.removeListener('input', onInput);
      } catch (_err) {
        // ignore
      }
    }
    function onInput(msg) {
      if (!msg || msg.topic !== 'alarm/event') return;
      if (msg.event !== eventName) return;
      cleanup();
      resolve(msg);
    }
    node.on('input', onInput);
  });
}

describe('AlarmSystemUltimate node (advanced)', function () {
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

  it('blocks arming when any non-bypassed zone is open', function (done) {
    const flowId = 'alarm-open-block1';
    const flow = [
      { id: flowId, type: 'tab', label: flowId },
      {
        id: 'alarm',
        type: 'AlarmSystemUltimate',
        z: flowId,
        controlTopic: 'alarm',
        exitDelaySeconds: 0,
        requireCodeForDisarm: false,
        persistState: false,
        zones: JSON.stringify([{ topic: 'sensor/frontdoor', type: 'perimeter' }]),
        wires: [['events'], [], [], [], [], [], [], [], []],
      },
      { id: 'events', type: 'helper', z: flowId },
    ];

    loadAlarm(flow)
      .then(() => {
        const alarm = helper.getNode('alarm');
        const events = helper.getNode('events');

        alarm.receive({ topic: 'sensor/frontdoor', payload: true });
        setTimeout(() => alarm.receive({ topic: 'alarm', command: 'arm' }), 20);

        waitForEvent(events, 'arm_blocked', 800)
          .then((msg) => {
            try {
              expect(msg).to.have.nested.property('payload.violations').that.is.an('array');
              expect(msg.payload.violations[0]).to.include({ topic: 'sensor/frontdoor' });
              expect(Boolean(msg.payload.violations[0].open)).to.equal(true);
              done();
            } catch (err) {
              done(err);
            }
          })
          .catch(done);
      })
      .catch(done);
  });

  it('matches zones by prefix when topic ends with *', function (done) {
    const flowId = 'alarm-topic-prefix1';
    const flow = [
      { id: flowId, type: 'tab', label: flowId },
      {
        id: 'alarm',
        type: 'AlarmSystemUltimate',
        z: flowId,
        controlTopic: 'alarm',
        exitDelaySeconds: 0,
        requireCodeForDisarm: false,
        persistState: false,
        zones: JSON.stringify([{ topic: 'sensor/door*', type: 'perimeter' }]),
        wires: [['events'], [], [], [], [], [], [], [], []],
      },
      { id: 'events', type: 'helper', z: flowId },
    ];

    loadAlarm(flow)
      .then(() => {
        const alarm = helper.getNode('alarm');
        const events = helper.getNode('events');

        alarm.receive({ topic: 'alarm', command: 'arm' });

        setTimeout(() => {
          alarm.receive({ topic: 'sensor/door/front', payload: true });
        }, 20);

        waitForEvent(events, 'zone_open', 800)
          .then((msg) => {
            try {
              expect(msg).to.have.nested.property('payload.zone.topic');
              expect(msg.payload.zone.topic).to.equal('sensor/door*');
              done();
            } catch (err) {
              done(err);
            }
          })
          .catch(done);
      })
      .catch(done);
  });

  it('denies arm/disarm when code is required and missing/invalid', function (done) {
    const flowId = 'alarm-codes1';
    const flow = [
      { id: flowId, type: 'tab', label: flowId },
      {
        id: 'alarm',
        type: 'AlarmSystemUltimate',
        z: flowId,
        controlTopic: 'alarm',
        exitDelaySeconds: 0,
        requireCodeForArm: true,
        requireCodeForDisarm: true,
        armCode: '1234',
        persistState: false,
        zones: JSON.stringify([{ topic: 'sensor/frontdoor', type: 'perimeter' }]),
        wires: [['events'], [], [], [], [], [], [], [], []],
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

        alarm.receive({ topic: 'alarm', command: 'arm' });
        setTimeout(() => alarm.receive({ topic: 'alarm', command: 'arm', code: '0000' }), 40);
        setTimeout(() => alarm.receive({ topic: 'alarm', command: 'arm', code: '1234' }), 80);

        setTimeout(() => alarm.receive({ topic: 'alarm', command: 'disarm' }), 130);
        setTimeout(() => alarm.receive({ topic: 'alarm', command: 'disarm', code: '1234' }), 170);

        setTimeout(() => {
          try {
            const deniedArm = seen.find((m) => m && m.event === 'denied' && m.payload && m.payload.action === 'arm');
            expect(deniedArm, 'denied (arm) not received').to.exist;
            const deniedDisarm = seen.find((m) => m && m.event === 'denied' && m.payload && m.payload.action === 'disarm');
            expect(deniedDisarm, 'denied (disarm) not received').to.exist;
            const armed = seen.find((m) => m && m.event === 'armed');
            expect(armed, 'armed not received').to.exist;
            const disarmed = seen.find((m) => m && m.event === 'disarmed');
            expect(disarmed, 'disarmed not received').to.exist;
            done();
          } catch (err) {
            done(err);
          }
        }, 420);
      })
      .catch(done);
  });

  it('persists armed state, bypass list and log across reload (file cache fallback)', function (done) {
    const prevSettings = helper.settings();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alarm-ultimate-test-'));
    helper.settings({ ...prevSettings, userDir: tempDir });

    const flowId = 'alarm-persist1';
    const zoneTopic = 'sensor/frontdoor';
    const flow = [
      { id: flowId, type: 'tab', label: flowId },
      {
        id: 'alarm',
        type: 'AlarmSystemUltimate',
        z: flowId,
        name: 'PersistAlarm',
        controlTopic: 'alarm',
        exitDelaySeconds: 0,
        requireCodeForDisarm: false,
        persistState: true,
        zones: JSON.stringify([{ topic: zoneTopic, type: 'perimeter' }]),
        wires: [['events'], [], [], [], [], [], [], [], []],
      },
      { id: 'events', type: 'helper', z: flowId },
    ];

    loadAlarm(flow)
      .then(() => {
        const alarm = helper.getNode('alarm');
        const events = helper.getNode('events');

        alarm.receive({ topic: zoneTopic, payload: false });
        setTimeout(() => alarm.receive({ topic: 'alarm', command: 'bypass', zoneTopic }), 20);
        setTimeout(() => alarm.receive({ topic: 'alarm', command: 'arm' }), 60);

        return waitForEvent(events, 'armed', 1200);
      })
      .then(() => helper.unload())
      .then(() => {
        const cachePath = path.join(tempDir, 'booleanlogicultimatepersist', 'alarm.AlarmSystemUltimate.json');
        expect(fs.existsSync(cachePath), 'file cache not found').to.equal(true);
        return loadAlarm(flow);
      })
      .then(() => {
        const alarm = helper.getNode('alarm');
        const events = helper.getNode('events');

        alarm.receive({ topic: 'alarm', command: 'status' });
        return waitForEvent(events, 'status', 1200);
      })
      .then((msg) => {
        try {
          expect(msg).to.have.nested.property('payload.state.mode', 'armed');
          expect(msg).to.have.nested.property('payload.state.bypassedZones').that.is.an('array');
          expect(msg.payload.state.bypassedZones).to.include(zoneTopic);
          expect(msg).to.have.nested.property('payload.state.log').that.is.an('array');
          const loggedEvents = msg.payload.state.log.map((e) => e && e.event).filter(Boolean);
          expect(loggedEvents).to.include('armed');
          expect(loggedEvents).to.include('bypassed');
          done();
        } catch (err) {
          done(err);
        }
      })
      .catch(done)
      .finally(() => {
        try {
          helper.settings(prevSettings);
        } catch (_err) {
          // ignore
        }
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (_err) {
          // ignore
        }
      });
  });
});
