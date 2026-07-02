'use strict';

// Config node holding the MQTT broker settings (URL, credentials, base topic, discovery prefix)
// shared by every Alarm System node that references it. It owns a single reference-counted MQTT
// connection (see lib/mqtt-connection.js): the first alarm panel that registers opens it, the
// last one that closes releases it — so many panels share one broker connection.

module.exports = function (RED) {
  function AlarmUltimateMqttConfigNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;
    const { sanitizeBaseTopic } = require('./lib/mqtt-bridge.js');

    node.url = typeof config.url === 'string' ? config.url.trim() : '';
    node.baseTopic = sanitizeBaseTopic(config.baseTopic);
    node.discoveryPrefix =
      typeof config.discoveryPrefix === 'string' && config.discoveryPrefix.trim().length > 0
        ? config.discoveryPrefix.trim()
        : 'homeassistant';
    // Connection-level availability (Last Will) topic. Panel slugs never start with "_"
    // (leading underscores are stripped), so "_bridge" cannot collide with a panel root.
    node.availabilityTopic = `${node.baseTopic}/_bridge/availability`;

    let connection = null;

    // Lazily created so the config node still loads when the optional mqtt dependency is
    // missing; the caller (the alarm node) wraps this in a try/catch.
    node.getConnection = function () {
      if (!connection) {
        const { createMqttConnection } = require('./lib/mqtt-connection.js');
        connection = createMqttConnection({
          url: node.url,
          username: node.credentials ? node.credentials.username : undefined,
          password: node.credentials ? node.credentials.password : undefined,
          availabilityTopic: node.availabilityTopic,
          log: (msg) => node.log(`[mqtt] ${msg}`),
          warn: (msg) => node.warn(msg),
        });
      }
      return connection;
    };

    node.on('close', (removed, done) => {
      // Alarm nodes deregister first and normally close the connection themselves; this is a
      // safety net for connections still open (e.g. a panel crashed before deregistering).
      const c = connection;
      connection = null;
      if (c) c.close(done);
      else done();
    });
  }

  RED.nodes.registerType('AlarmUltimateMqtt-config', AlarmUltimateMqttConfigNode, {
    credentials: {
      username: { type: 'text' },
      password: { type: 'password' },
    },
  });
};
