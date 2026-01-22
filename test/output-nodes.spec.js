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
        zones: JSON.stringify([{ id: 'front', topic: 'sensor/frontdoor', type: 'perimeter', entry: false }]),
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
        zoneId: 'front',
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
            if (String(msg.reason || '').startsWith('init') && msg.payload === 'disarmed') {
              seen.initialDisarmed = true;
            }
            if (msg.payload === 'armed') {
              seen.armed = true;
            }
            maybeDone();
          } catch (err) {
            done(err);
          }
        });

        zoneOut.on('input', (msg) => {
          try {
            if (String(msg.reason || '').startsWith('init') && msg.payload === false) {
              seen.initialZoneClosed = true;
              expect(msg.topic).to.equal('alarm/zone/sensor/frontdoor');
            }
            if (msg.payload === true && msg.zone && msg.zone.id === 'front') {
              seen.zoneOpen = true;
              expect(msg.topic).to.equal('alarm/zone/sensor/frontdoor');
            }
            maybeDone();
          } catch (err) {
            done(err);
          }
        });

        sirenOut.on('input', (msg) => {
          try {
            if (String(msg.reason || '').startsWith('init') && msg.payload === false) {
              seen.initialSirenOff = true;
            }
            if (msg.payload === true) {
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
