'use strict';

// Optional native MQTT bridge for the Alarm System node.
//
// When enabled it:
// - publishes the current alarm state (Home Assistant alarm_control_panel states) to a retained state topic,
// - subscribes to a command topic and converts HA commands (ARM_AWAY/ARM_HOME/DISARM/TRIGGER...) into alarm commands,
// - optionally publishes a Home Assistant MQTT Discovery config so the alarm appears automatically in HA,
// - tracks an availability (online/offline) topic via Last Will.
//
// The bridge is best-effort: a broker that is down or misconfigured must never crash the runtime.

const mqtt = require('mqtt');
const ha = require('./home-assistant.js');

function sanitizeBaseTopic(value) {
  const s = typeof value === 'string' ? value.trim() : '';
  // Strip wildcards and surrounding slashes; MQTT base topics must be concrete.
  return (s || 'alarm-ultimate').replace(/[#+]/g, '').replace(/^\/+|\/+$/g, '') || 'alarm-ultimate';
}

function createMqttBridge(options) {
  const opts = options || {};
  const node = opts.node;
  const onCommand = typeof opts.onCommand === 'function' ? opts.onCommand : () => {};
  const onStatus = typeof opts.onStatus === 'function' ? opts.onStatus : () => {};

  const url = typeof opts.url === 'string' ? opts.url.trim() : '';
  const baseTopic = sanitizeBaseTopic(opts.baseTopic);
  const discovery = opts.discovery !== false;
  const discoveryPrefix = (typeof opts.discoveryPrefix === 'string' && opts.discoveryPrefix.trim()) || 'homeassistant';
  const username = typeof opts.username === 'string' && opts.username ? opts.username : undefined;
  const password = typeof opts.password === 'string' && opts.password ? opts.password : undefined;

  // Optional per-zone binary_sensor discovery. `zones` items: { id, name, deviceClass }.
  const zones = Array.isArray(opts.zones) ? opts.zones : [];
  const publishZones = opts.publishZones === true && zones.length > 0;
  const getZoneStates = typeof opts.getZoneStates === 'function' ? opts.getZoneStates : () => ({});

  const id = String((node && node.id) || 'alarm').replace(/[^A-Za-z0-9_-]/g, '');
  const name = (node && node.name) || 'Alarm Ultimate';
  const uniqueId = `alarm_ultimate_${id}`;

  const root = `${baseTopic}/${id}`;
  const stateTopic = `${root}/state`;
  const commandTopic = `${root}/command`;
  const availabilityTopic = `${root}/availability`;
  const discoveryTopic = `${discoveryPrefix}/alarm_control_panel/${id}/config`;

  let client = null;
  let closed = false;
  let lastArmMode = null;
  let lastState = null;
  const lastZoneStates = {};

  function zoneStateTopic(zoneId) {
    return `${root}/zone/${zoneId}/state`;
  }
  function zoneDiscoveryTopic(zoneId) {
    return `${discoveryPrefix}/binary_sensor/${id}_${zoneId}/config`;
  }

  function log(msg) {
    if (node && typeof node.log === 'function') node.log(`[mqtt] ${msg}`);
  }

  function publishRaw(topic, payload, retain) {
    if (!client || closed) return;
    try {
      client.publish(topic, payload, { retain: retain === true, qos: 0 });
    } catch (_err) {
      // best-effort
    }
  }

  function buildDiscoveryConfig() {
    return {
      name,
      unique_id: uniqueId,
      state_topic: stateTopic,
      command_topic: commandTopic,
      availability_topic: availabilityTopic,
      payload_available: 'online',
      payload_not_available: 'offline',
      payload_arm_away: 'ARM_AWAY',
      payload_arm_home: 'ARM_HOME',
      payload_arm_night: 'ARM_NIGHT',
      payload_disarm: 'DISARM',
      payload_trigger: 'TRIGGER',
      // The alarm node enforces codes server-side; don't make HA prompt for one (HA defaults these to true).
      code_arm_required: false,
      code_disarm_required: false,
      supported_features: ['arm_home', 'arm_away', 'arm_night', 'trigger'],
      device: {
        identifiers: [uniqueId],
        name,
        manufacturer: 'node-red-contrib-alarm-ultimate',
        model: 'Alarm System Ultimate',
      },
    };
  }

  // Publish a base alarm state. `baseState` is one of: disarmed | arming | pending | triggered | armed.
  // A generic "armed" is expanded to armed_away/home/night using the last requested arm mode.
  function publishState(baseState) {
    if (!baseState) return;
    const state = baseState === 'armed' ? ha.armedLabel(lastArmMode) : baseState;
    if (state === lastState) return;
    lastState = state;
    publishRaw(stateTopic, state, true);
  }

  function buildZoneDiscovery(zone) {
    const config = {
      name: zone.name,
      unique_id: `${uniqueId}_${zone.id}`,
      state_topic: zoneStateTopic(zone.id),
      payload_on: 'open',
      payload_off: 'closed',
      availability_topic: availabilityTopic,
      payload_available: 'online',
      payload_not_available: 'offline',
      device: {
        identifiers: [uniqueId],
        name,
        manufacturer: 'node-red-contrib-alarm-ultimate',
        model: 'Alarm System Ultimate',
      },
    };
    if (zone.deviceClass) config.device_class = zone.deviceClass;
    return config;
  }

  // Publish a single zone's open/closed state (retained). No-op when zone discovery is disabled.
  function publishZoneState(zoneId, open) {
    if (!publishZones || !zoneId) return;
    const payload = open === true ? 'open' : 'closed';
    if (lastZoneStates[zoneId] === payload) return;
    lastZoneStates[zoneId] = payload;
    publishRaw(zoneStateTopic(zoneId), payload, true);
  }

  function publishAllZones() {
    if (!publishZones) return;
    for (const zone of zones) {
      publishRaw(zoneDiscoveryTopic(zone.id), JSON.stringify(buildZoneDiscovery(zone)), true);
    }
    const states = getZoneStates() || {};
    Object.keys(states).forEach((zoneId) => {
      // Force a publish on (re)connect even if the cached value is unchanged.
      delete lastZoneStates[zoneId];
      publishZoneState(zoneId, states[zoneId] === true);
    });
  }

  function handleIncoming(topic, buf) {
    if (topic !== commandTopic) return;
    const text = buf == null ? '' : buf.toString();
    let parsed = ha.parseHaCommand(text);
    if (!parsed && text && text.trim().startsWith('{')) {
      try {
        parsed = ha.parseHaCommand(JSON.parse(text));
      } catch (_err) {
        parsed = null;
      }
    }
    if (!parsed) return;
    if (parsed.armMode) lastArmMode = parsed.armMode;
    try {
      onCommand(parsed);
    } catch (err) {
      if (node && typeof node.error === 'function') node.error(err);
    }
  }

  function connect() {
    if (!url) {
      onStatus({ state: 'error', detail: 'missing url' });
      return;
    }
    const connectOpts = {
      reconnectPeriod: 5000,
      connectTimeout: 15000,
      will: { topic: availabilityTopic, payload: 'offline', retain: true, qos: 0 },
    };
    if (username) connectOpts.username = username;
    if (password) connectOpts.password = password;

    try {
      client = mqtt.connect(url, connectOpts);
    } catch (err) {
      onStatus({ state: 'error', detail: err && err.message });
      return;
    }

    client.on('connect', () => {
      log(`connected to ${url}`);
      publishRaw(availabilityTopic, 'online', true);
      if (discovery) publishRaw(discoveryTopic, JSON.stringify(buildDiscoveryConfig()), true);
      publishAllZones();
      try {
        client.subscribe(commandTopic, { qos: 0 });
      } catch (_err) {
        // best-effort
      }
      if (lastState) publishRaw(stateTopic, lastState, true);
      onStatus({ state: 'connected' });
    });
    client.on('message', handleIncoming);
    client.on('reconnect', () => onStatus({ state: 'reconnect' }));
    client.on('offline', () => onStatus({ state: 'offline' }));
    client.on('error', (err) => {
      if (node && typeof node.warn === 'function') node.warn(`MQTT error: ${err && err.message}`);
      onStatus({ state: 'error', detail: err && err.message });
    });
  }

  function close(done) {
    closed = true;
    const c = client;
    client = null;

    let finished = false;
    function finish() {
      if (finished) return;
      finished = true;
      clearTimeout(guard);
      // Force-close the socket and stop reconnection attempts; never wait on the broker.
      if (c) {
        try {
          c.end(true);
        } catch (_err) {
          // ignore
        }
      }
      if (typeof done === 'function') done();
    }

    // Hard cap so stopping/redeploying is never blocked when the broker is slow or unreachable.
    const guard = setTimeout(finish, 700);
    if (typeof guard.unref === 'function') guard.unref();

    if (!c) {
      finish();
      return;
    }

    if (c.connected) {
      // Best-effort retained "offline" before a graceful disconnect (the Last Will only fires on
      // an ungraceful drop). The guard above bounds how long we wait for it.
      try {
        c.publish(availabilityTopic, 'offline', { retain: true, qos: 0 }, () => finish());
      } catch (_err) {
        finish();
      }
    } else {
      // Not connected: nothing can be flushed, so close immediately.
      finish();
    }
  }

  return {
    connect,
    close,
    publishState,
    publishZoneState,
    topics: { stateTopic, commandTopic, availabilityTopic, discoveryTopic },
  };
}

module.exports = { createMqttBridge };
