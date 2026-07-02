'use strict';

// Shared MQTT connection with reference counting.
//
// One instance is owned by an "Alarm MQTT broker" config node and shared by every Alarm System
// node that references it, so multiple alarm panels reuse a single broker connection. The same
// factory is also used by the legacy fallback, where an Alarm node still carries its own broker
// settings and gets a private (single-user) connection.
//
// - register(user): adds a user; the first one triggers the actual broker connection.
// - deregister(user, done): removes a user; when the last one leaves the connection is closed
//   gracefully (retained "offline" on the availability topic, then socket end).
// - subscribe(topic, handler): many handlers per topic; the broker subscription is made once per
//   topic and re-established on every reconnect.
// - The availability topic doubles as the Last Will topic: retained "online" is published on
//   every (re)connect, retained "offline" on graceful close, and the Will covers crashes.
//
// A connection can be re-registered after it fully closed (e.g. a partial redeploy recreates the
// alarm nodes while the config node instance survives): a fresh client is created on demand.
//
// Best-effort: a broker that is down or misconfigured must never crash the runtime.

const mqtt = require('mqtt');

function createMqttConnection(options) {
  const opts = options || {};
  const url = typeof opts.url === 'string' ? opts.url.trim() : '';
  const username = typeof opts.username === 'string' && opts.username ? opts.username : undefined;
  const password = typeof opts.password === 'string' && opts.password ? opts.password : undefined;
  const availabilityTopic = typeof opts.availabilityTopic === 'string' ? opts.availabilityTopic : '';
  const log = typeof opts.log === 'function' ? opts.log : () => {};
  const warn = typeof opts.warn === 'function' ? opts.warn : () => {};

  let client = null;
  const users = new Set();
  const handlersByTopic = new Map(); // topic -> Set<handler(topic, buffer)>
  const connectListeners = new Set();
  const statusListeners = new Set();

  function emitStatus(status) {
    for (const fn of Array.from(statusListeners)) {
      try {
        fn(status);
      } catch (_err) {
        // best-effort
      }
    }
  }

  function publish(topic, payload, retain) {
    if (!client) return;
    try {
      client.publish(topic, payload, { retain: retain === true, qos: 0 });
    } catch (_err) {
      // best-effort
    }
  }

  function subscribe(topic, handler) {
    if (!topic || typeof handler !== 'function') return;
    let set = handlersByTopic.get(topic);
    const isNewTopic = !set;
    if (!set) {
      set = new Set();
      handlersByTopic.set(topic, set);
    }
    set.add(handler);
    if (isNewTopic && client && client.connected) {
      try {
        client.subscribe(topic, { qos: 0 });
      } catch (_err) {
        // best-effort
      }
    }
  }

  function unsubscribe(topic, handler) {
    const set = handlersByTopic.get(topic);
    if (!set) return;
    if (handler) set.delete(handler);
    else set.clear();
    if (set.size > 0) return;
    handlersByTopic.delete(topic);
    if (client && client.connected) {
      try {
        client.unsubscribe(topic);
      } catch (_err) {
        // best-effort
      }
    }
  }

  function handleMessage(topic, buf) {
    const set = handlersByTopic.get(topic);
    if (!set) return;
    for (const fn of Array.from(set)) {
      try {
        fn(topic, buf);
      } catch (_err) {
        // best-effort
      }
    }
  }

  function connect() {
    if (client) return;
    if (!url) {
      emitStatus({ state: 'error', detail: 'missing broker url' });
      return;
    }
    const connectOpts = {
      reconnectPeriod: 5000,
      connectTimeout: 15000,
    };
    if (availabilityTopic) {
      connectOpts.will = { topic: availabilityTopic, payload: 'offline', retain: true, qos: 0 };
    }
    if (username) connectOpts.username = username;
    if (password) connectOpts.password = password;

    try {
      client = mqtt.connect(url, connectOpts);
    } catch (err) {
      client = null;
      emitStatus({ state: 'error', detail: err && err.message });
      return;
    }

    client.on('connect', () => {
      log(`connected to ${url}`);
      if (availabilityTopic) publish(availabilityTopic, 'online', true);
      for (const topic of handlersByTopic.keys()) {
        try {
          client.subscribe(topic, { qos: 0 });
        } catch (_err) {
          // best-effort
        }
      }
      emitStatus({ state: 'connected' });
      // Fire connect listeners after subscriptions so re-announced discovery can be answered.
      for (const fn of Array.from(connectListeners)) {
        try {
          fn();
        } catch (_err) {
          // best-effort
        }
      }
    });
    client.on('message', handleMessage);
    client.on('reconnect', () => emitStatus({ state: 'reconnect' }));
    client.on('offline', () => emitStatus({ state: 'offline' }));
    client.on('error', (err) => {
      warn(`MQTT error: ${err && err.message}`);
      emitStatus({ state: 'error', detail: err && err.message });
    });
  }

  function close(done) {
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

    if (c.connected && availabilityTopic) {
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

  function register(user) {
    users.add(user);
    connect();
  }

  function deregister(user, done) {
    users.delete(user);
    if (users.size > 0) {
      if (typeof done === 'function') done();
      return;
    }
    close(done);
  }

  function onConnect(fn) {
    if (typeof fn !== 'function') return;
    connectListeners.add(fn);
    // A shared connection may already be up (opened by another panel): announce right away.
    if (client && client.connected) {
      try {
        fn();
      } catch (_err) {
        // best-effort
      }
    }
  }

  function offConnect(fn) {
    connectListeners.delete(fn);
  }

  function onStatus(fn) {
    if (typeof fn === 'function') statusListeners.add(fn);
  }

  function offStatus(fn) {
    statusListeners.delete(fn);
  }

  return {
    get connected() {
      return !!(client && client.connected);
    },
    availabilityTopic,
    register,
    deregister,
    subscribe,
    unsubscribe,
    publish,
    onConnect,
    offConnect,
    onStatus,
    offStatus,
    close,
  };
}

module.exports = { createMqttConnection };
