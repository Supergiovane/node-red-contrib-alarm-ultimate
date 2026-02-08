'use strict';

const { expect } = require('chai');
const { helper } = require('./helpers');

const alarmNode = require('../nodes/AlarmSystemUltimate.js');
const alarmStateNode = require('../nodes/AlarmUltimateState.js');
const alarmZoneNode = require('../nodes/AlarmUltimateZone.js');
const alarmSirenNode = require('../nodes/AlarmUltimateSiren.js');

describe('Alarm Ultimate output-only nodes', function () {
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

  it('emits alarm state, zone state and siren state', function (done) {
    const flowId = 'flow1';
    const flow = [
      { id: flowId, type: 'tab', label: 'flow1' },
      {
        id: 'alarm',
        type: 'AlarmSystemUltimate',
        z: flowId,
        x: 100,
        y: 80,
        controlTopic: 'alarm',
        exitDelaySeconds: 0,
        entryDelaySeconds: 0,
        sirenDurationSeconds: 0.2,
        requireCodeForDisarm: false,
        zones: JSON.stringify([{ name: 'Front', topic: 'sensor/frontdoor', type: 'perimeter', entry: false }]),
        wires: [['events'], ['siren'], [], [], [], [], [], [], []],
      },
      { id: 'events', type: 'helper', z: flowId, x: 280, y: 60 },
      { id: 'siren', type: 'helper', z: flowId, x: 280, y: 100 },
      {
        id: 'stateNode',
        type: 'AlarmUltimateState',
        z: flowId,
        x: 100,
        y: 160,
        alarmId: 'alarm',
        outputInitialState: true,
        wires: [['stateOut']],
      },
      { id: 'stateOut', type: 'helper', z: flowId, x: 280, y: 160 },
      {
        id: 'zoneNode',
        type: 'AlarmUltimateZone',
        z: flowId,
        x: 100,
        y: 220,
        alarmId: 'alarm',
        zoneTopic: 'sensor/frontdoor',
        outputInitialState: true,
        wires: [['zoneOut']],
      },
      { id: 'zoneOut', type: 'helper', z: flowId, x: 280, y: 220 },
      {
        id: 'sirenNode',
        type: 'AlarmUltimateSiren',
        z: flowId,
        x: 100,
        y: 280,
        alarmId: 'alarm',
        outputInitialState: true,
        wires: [['sirenOut']],
      },
      { id: 'sirenOut', type: 'helper', z: flowId, x: 280, y: 280 },
    ];

    helper
      .load([alarmNode, alarmStateNode, alarmZoneNode, alarmSirenNode], flow, {})
      .then(() => {
        const alarm = helper.getNode('alarm');
        const stateOut = helper.getNode('stateOut');
        const zoneOut = helper.getNode('zoneOut');
        const sirenOut = helper.getNode('sirenOut');

        const seen = {
          initialDisarmed: false,
          initialZoneClosed: false,
          initialSirenOff: false,
          armed: false,
          zoneOpen: false,
          sirenOn: false,
        };

        function maybeDone() {
          if (Object.values(seen).every(Boolean)) {
            done();
          }
        }

        stateOut.on('input', (msg) => {
          try {
            expect(msg).to.be.an('object');
            expect(msg.alarmUltimate).to.be.an('object');
            expect(msg.alarmUltimate.v).to.equal(1);
            expect(msg.alarmUltimate.kind).to.equal('event');
            expect(msg.alarmUltimate.event).to.equal(msg.event);

            const initReason = msg && msg.reason;
            if (String(initReason || '').startsWith('init') && msg.event === 'disarmed' && msg.mode === 'disarmed' && msg.payload === false) {
              seen.initialDisarmed = true;
            }
            if (msg.event === 'armed' && msg.mode === 'armed' && msg.payload === true) {
              seen.armed = true;
            }
            maybeDone();
          } catch (err) {
            done(err);
          }
        });

        zoneOut.on('input', (msg) => {
          try {
            expect(msg).to.be.an('object');
            expect(msg.alarmUltimate).to.be.an('object');
            expect(msg.alarmUltimate.v).to.equal(1);
            expect(msg.alarmUltimate.kind).to.equal('event');
            expect(msg.alarmUltimate.event).to.equal(msg.event);

            const initReason = msg && msg.reason;
            if (String(initReason || '').startsWith('init') && msg.event === 'zone_close' && msg.payload === false && msg.open === false) {
              seen.initialZoneClosed = true;
              expect(msg.topic).to.equal('alarm/event');
            }
            if (msg.event === 'zone_open' && msg.payload === true && msg.open === true && msg.zone && msg.zone.topic === 'sensor/frontdoor') {
              seen.zoneOpen = true;
              expect(msg.topic).to.equal('alarm/event');
            }
            maybeDone();
          } catch (err) {
            done(err);
          }
        });

        sirenOut.on('input', (msg) => {
          try {
            expect(msg).to.be.an('object');
            expect(msg.alarmUltimate).to.be.an('object');
            expect(msg.alarmUltimate.v).to.equal(1);
            expect(msg.alarmUltimate.kind).to.equal('siren');
            expect(msg.alarmUltimate.event).to.equal(msg.event);
            expect(msg.alarmUltimate.siren).to.deep.include({ active: Boolean(msg.payload) });

            if (String(msg.reason || '').startsWith('init') && msg.event === 'siren_off' && msg.payload === false) {
              seen.initialSirenOff = true;
            }
            if (msg.event === 'siren_on' && msg.payload === true) {
              seen.sirenOn = true;
            }
            maybeDone();
          } catch (err) {
            done(err);
          }
        });

        setTimeout(() => {
          alarm.receive({ topic: 'alarm', command: 'arm' });
          setTimeout(() => {
            alarm.receive({ topic: 'sensor/frontdoor', payload: true });
          }, 30);
        }, 50);
      })
      .catch(done);
  });
});
