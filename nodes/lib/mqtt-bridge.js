'use strict';

// Per-panel MQTT/Home Assistant bridge for the Alarm System node.
//
// It runs on top of a shared MQTT connection (see mqtt-connection.js) — normally owned by an
// "Alarm MQTT broker" config node and shared by every alarm panel that references it; in legacy
// mode the panel creates a private connection with the broker settings stored on the node.
//
// For its own panel it:
// - publishes the current alarm state (Home Assistant alarm_control_panel states) to a retained state topic,
// - subscribes to a command topic and converts HA commands (ARM_AWAY/ARM_HOME/DISARM/TRIGGER...) into alarm commands,
// - optionally publishes a Home Assistant MQTT Discovery config so the alarm appears automatically in HA,
// - tracks availability (online/offline). The Last Will lives on the shared connection's
//   availability topic; when that topic differs from the panel's own, discovery uses both
//   (availability_mode "all") so entities go unavailable when either the connection drops
//   ungracefully or this panel is closed.
//
// The bridge is best-effort: a broker that is down or misconfigured must never crash the runtime.

const ha = require('./home-assistant.js');

function sanitizeBaseTopic(value) {
  const s = typeof value === 'string' ? value.trim() : '';
  // Strip wildcards and surrounding slashes; MQTT base topics must be concrete.
  return (s || 'alarm-ultimate').replace(/[#+]/g, '').replace(/^\/+|\/+$/g, '') || 'alarm-ultimate';
}

// Topics and Home Assistant ids are derived from the node NAME (clearer than the internal node
// id), slugified to a topic-safe form. Falls back to the sanitized node id when the node has no
// name. Leading/trailing "_" are stripped, so a panel can never collide with the connection's
// reserved "_bridge" availability subtree.
function panelId(node) {
  const slug = String((node && node.name) || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return slug || String((node && node.id) || 'alarm').replace(/[^A-Za-z0-9_-]/g, '');
}

function panelAvailabilityTopic(baseTopic, node) {
  return `${sanitizeBaseTopic(baseTopic)}/${panelId(node)}/availability`;
}

function createMqttBridge(options) {
  const opts = options || {};
  const node = opts.node;
  const connection = opts.connection;
  const onCommand = typeof opts.onCommand === 'function' ? opts.onCommand : () => {};
  const onStatus = typeof opts.onStatus === 'function' ? opts.onStatus : () => {};

  const baseTopic = sanitizeBaseTopic(opts.baseTopic);
  const discovery = opts.discovery !== false;
  const discoveryPrefix = (typeof opts.discoveryPrefix === 'string' && opts.discoveryPrefix.trim()) || 'homeassistant';

  // Optional per-zone binary_sensor discovery. `zones` items: { id, name, deviceClass, supervised }.
  const zones = Array.isArray(opts.zones) ? opts.zones : [];
  const publishZones = opts.publishZones === true && zones.length > 0;
  const getZoneStates = typeof opts.getZoneStates === 'function' ? opts.getZoneStates : () => ({});
  // Supervised zones get their own availability topic (see below); { zoneId: boolean available }.
  const getZoneAvailability = typeof opts.getZoneAvailability === 'function' ? opts.getZoneAvailability : () => ({});
  const supervisedZoneIds = new Set(zones.filter((z) => z && z.supervised === true).map((z) => z.id));

  const name = (node && node.name) || 'Alarm Ultimate';
  const id = panelId(node);
  const uniqueId = `alarm_ultimate_${id}`;

  const root = `${baseTopic}/${id}`;
  const stateTopic = `${root}/state`;
  const commandTopic = `${root}/command`;
  const availabilityTopic = `${root}/availability`;
  const discoveryTopic = `${discoveryPrefix}/alarm_control_panel/${id}/config`;
  // Home Assistant birth topic(s): when HA (re)starts or its MQTT integration is re-added it
  // publishes "online" here, and devices must re-announce their discovery. Default is
  // homeassistant/status; also cover the configured discovery prefix in case it differs.
  const birthTopics = Array.from(new Set(['homeassistant/status', `${discoveryPrefix}/status`]));

  // With a shared connection the Last Will belongs to the connection, not to this panel, so
  // discovery must reference both availability topics. In legacy mode the connection's Will is
  // this panel's own availability topic and a single topic suffices (same behaviour as before).
  const connectionAvailability = connection && connection.availabilityTopic;
  const useSharedAvailability = !!(connectionAvailability && connectionAvailability !== availabilityTopic);

  // Registration token for the shared connection's reference counting.
  const bridgeUser = { id: (node && node.id) || uniqueId };

  let active = false;
  let lastArmMode = null;
  let lastState = null;
  const lastZoneStates = {};
  const lastZoneAvailability = {};

  function zoneStateTopic(zoneId) {
    return `${root}/zone/${zoneId}/state`;
  }
  function zoneAvailabilityTopic(zoneId) {
    return `${root}/zone/${zoneId}/availability`;
  }
  function zoneDiscoveryTopic(zoneId) {
    return `${discoveryPrefix}/binary_sensor/${id}_${zoneId}/config`;
  }

  function log(msg) {
    if (node && typeof node.log === 'function') node.log(`[mqtt] ${msg}`);
  }

  function publishRaw(topic, payload, retain) {
    if (!connection || !active) return;
    try {
      connection.publish(topic, payload, retain === true);
    } catch (_err) {
      // best-effort
    }
  }

  // Availability section shared by the panel and zone discovery configs. Supervised zones pass
  // their own availability topic as `extraTopic`, so they also go unavailable in Home Assistant
  // when sensor supervision reports them missing.
  function applyAvailability(config, extraTopic) {
    const topics = [];
    if (useSharedAvailability) topics.push(connectionAvailability);
    topics.push(availabilityTopic);
    if (extraTopic) topics.push(extraTopic);
    if (topics.length === 1) {
      config.availability_topic = topics[0];
      config.payload_available = 'online';
      config.payload_not_available = 'offline';
    } else {
      config.availability = topics.map((topic) => ({
        topic,
        payload_available: 'online',
        payload_not_available: 'offline',
      }));
      config.availability_mode = 'all';
    }
    return config;
  }

  function buildDiscoveryConfig() {
    return applyAvailability({
      name,
      unique_id: uniqueId,
      state_topic: stateTopic,
      command_topic: commandTopic,
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
    });
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
    const config = applyAvailability(
      {
        name: zone.name,
        unique_id: `${uniqueId}_${zone.id}`,
        state_topic: zoneStateTopic(zone.id),
        payload_on: 'open',
        payload_off: 'closed',
        device: {
          identifiers: [uniqueId],
          name,
          manufacturer: 'node-red-contrib-alarm-ultimate',
          model: 'Alarm System Ultimate',
        },
      },
      supervisedZoneIds.has(zone.id) ? zoneAvailabilityTopic(zone.id) : null
    );
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

  // Publish a supervised zone's availability (retained): offline when sensor supervision reports
  // the zone missing, online when it is (or comes back) alive. No-op for unsupervised zones.
  function publishZoneAvailability(zoneId, available) {
    if (!publishZones || !zoneId || !supervisedZoneIds.has(zoneId)) return;
    const payload = available === false ? 'offline' : 'online';
    if (lastZoneAvailability[zoneId] === payload) return;
    lastZoneAvailability[zoneId] = payload;
    publishRaw(zoneAvailabilityTopic(zoneId), payload, true);
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
    const availability = getZoneAvailability() || {};
    Object.keys(availability).forEach((zoneId) => {
      delete lastZoneAvailability[zoneId];
      publishZoneAvailability(zoneId, availability[zoneId] !== false);
    });
  }

  // (Re)publish availability, discovery and current state. Called on connect and whenever Home
  // Assistant comes online, so the alarm reappears after an HA restart or after the MQTT
  // integration is removed and re-added (without restarting the Node-RED node).
  function announce() {
    publishRaw(availabilityTopic, 'online', true);
    if (discovery) publishRaw(discoveryTopic, JSON.stringify(buildDiscoveryConfig()), true);
    publishAllZones();
    if (lastState) publishRaw(stateTopic, lastState, true);
    log(`announced discovery (panel${discovery ? '' : ' OFF'}${publishZones ? `, ${zones.length} zone(s)` : ', zones OFF'})`);
  }

  function handleIncoming(topic, buf) {
    const text = buf == null ? '' : buf.toString();

    // Home Assistant birth message: re-announce everything when HA comes online.
    if (birthTopics.includes(topic)) {
      if (text.trim().toLowerCase() === 'online') announce();
      return;
    }

    if (topic !== commandTopic) return;
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
    if (active || !connection) {
      if (!connection) onStatus({ state: 'error', detail: 'missing connection' });
      return;
    }
    active = true;
    connection.onStatus(onStatus);
    connection.subscribe(commandTopic, handleIncoming);
    birthTopics.forEach((t) => connection.subscribe(t, handleIncoming));
    // Announces now if the shared connection is already up, and again on every (re)connect.
    connection.onConnect(announce);
    connection.register(bridgeUser);
  }

  function close(done) {
    if (!active || !connection) {
      if (typeof done === 'function') done();
      return;
    }
    // Best-effort retained per-panel "offline" while the shared connection is still up (a private
    // legacy connection publishes it itself on close, since its Will topic is this panel's).
    if (useSharedAvailability) publishRaw(availabilityTopic, 'offline', true);
    active = false;
    connection.offConnect(announce);
    connection.offStatus(onStatus);
    connection.unsubscribe(commandTopic, handleIncoming);
    birthTopics.forEach((t) => connection.unsubscribe(t, handleIncoming));
    // Last user out closes the underlying connection (never blocks; bounded internally).
    connection.deregister(bridgeUser, done);
  }

  return {
    connect,
    close,
    publishState,
    publishZoneState,
    publishZoneAvailability,
    topics: { stateTopic, commandTopic, availabilityTopic, discoveryTopic },
  };
}

module.exports = { createMqttBridge, sanitizeBaseTopic, panelAvailabilityTopic };
