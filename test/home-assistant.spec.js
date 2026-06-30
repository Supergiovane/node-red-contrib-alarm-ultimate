'use strict';

const { expect } = require('chai');
const ha = require('../nodes/lib/home-assistant.js');

describe('Home Assistant mapping helpers', function () {
  describe('eventToHaState', function () {
    it('maps transition events to HA states', function () {
      expect(ha.eventToHaState('disarmed', 'disarmed')).to.equal('disarmed');
      expect(ha.eventToHaState('reset', 'disarmed')).to.equal('disarmed');
      expect(ha.eventToHaState('arming', 'disarmed')).to.equal('arming');
      expect(ha.eventToHaState('entry_delay', 'armed')).to.equal('pending');
      expect(ha.eventToHaState('alarm', 'armed')).to.equal('triggered');
      expect(ha.eventToHaState('armed', 'armed')).to.equal('armed_away');
    });

    it('honors the arm-mode hint for the armed state', function () {
      expect(ha.eventToHaState('armed', 'armed', 'armed_home')).to.equal('armed_home');
      expect(ha.eventToHaState('armed', 'armed', 'night')).to.equal('armed_night');
    });

    it('returns null for non-transition events', function () {
      expect(ha.eventToHaState('zone_open', 'armed')).to.equal(null);
      expect(ha.eventToHaState('chime', 'disarmed')).to.equal(null);
    });

    it('derives state from mode on status events', function () {
      expect(ha.eventToHaState('status', 'armed', 'armed_home')).to.equal('armed_home');
      expect(ha.eventToHaState('status', 'disarmed')).to.equal('disarmed');
    });
  });

  describe('parseHaCommand', function () {
    it('parses plain command strings', function () {
      expect(ha.parseHaCommand('ARM_AWAY')).to.deep.equal({ command: 'arm', armMode: 'armed_away' });
      expect(ha.parseHaCommand('arm_home')).to.deep.equal({ command: 'arm', armMode: 'armed_home' });
      expect(ha.parseHaCommand('ARM_NIGHT')).to.deep.equal({ command: 'arm', armMode: 'armed_night' });
      expect(ha.parseHaCommand('DISARM')).to.deep.equal({ command: 'disarm' });
      expect(ha.parseHaCommand('TRIGGER')).to.deep.equal({ command: 'panic' });
    });

    it('parses object payloads and forwards the code', function () {
      expect(ha.parseHaCommand({ action: 'DISARM', code: '1234' })).to.deep.equal({
        command: 'disarm',
        code: '1234',
      });
      expect(ha.parseHaCommand({ command: 'ARM_AWAY' })).to.deep.equal({
        command: 'arm',
        armMode: 'armed_away',
      });
    });

    it('returns null for unrecognized payloads', function () {
      expect(ha.parseHaCommand('nonsense')).to.equal(null);
      expect(ha.parseHaCommand(null)).to.equal(null);
      expect(ha.parseHaCommand({})).to.equal(null);
    });
  });

  describe('armedLabel', function () {
    it('defaults to armed_away', function () {
      expect(ha.armedLabel()).to.equal('armed_away');
      expect(ha.armedLabel('whatever')).to.equal('armed_away');
      expect(ha.armedLabel('home')).to.equal('armed_home');
    });
  });
});
