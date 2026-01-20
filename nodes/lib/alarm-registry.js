'use strict';

const { EventEmitter } = require('events');

const alarmInstances = new Map();
const alarmEmitter = new EventEmitter();

// Allow many listeners (multiple nodes can subscribe).
alarmEmitter.setMaxListeners(0);

module.exports = {
  alarmInstances,
  alarmEmitter,
};

