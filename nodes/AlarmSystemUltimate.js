'use strict';

const fs = require('fs');
const path = require('path');

const { alarmInstances, alarmEmitter } = require('./lib/alarm-registry.js');

function readJsonFileSync(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    const trimmed = String(raw || '').trim();
    if (!trimmed) {
      return null;
    }
    return JSON.parse(trimmed);
  } catch (err) {
    return null;
  }
}

function writeJsonFileAtomicSync(filePath, data) {
  const dir = path.dirname(filePath);
  const tempPath = `${filePath}.tmp`;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tempPath, filePath);
}

module.exports = function (RED) {
  const helpers = require('./lib/node-helpers.js');

  if (RED && RED.httpAdmin && typeof RED.httpAdmin.get === 'function') {
    const needsRead =
      RED.auth && typeof RED.auth.needsPermission === 'function'
        ? RED.auth.needsPermission('AlarmSystemUltimate.read')
        : (req, res, next) => next();
    const needsWrite =
      RED.auth && typeof RED.auth.needsPermission === 'function'
        ? RED.auth.needsPermission('AlarmSystemUltimate.write')
        : (req, res, next) => next();

    function sendToolFile(res, filename) {
      const filePath = path.join(__dirname, '..', 'tools', filename);
      res.set('Cache-Control', 'no-store, max-age=0');
      res.set('Pragma', 'no-cache');
      res.sendFile(filePath, (err) => {
        if (err) {
          res.status(err.statusCode || 500).end();
        }
      });
    }

    RED.httpAdmin.get('/alarm-ultimate/alarm-json-mapper', needsRead, (req, res) => {
      sendToolFile(res, 'alarm-json-mapper.html');
    });

    RED.httpAdmin.get('/alarm-ultimate/alarm-panel', needsRead, (req, res) => {
      sendToolFile(res, 'alarm-panel.html');
    });

    RED.httpAdmin.get('/alarm-ultimate/alarm/nodes', needsRead, (req, res) => {
      const nodes = Array.from(alarmInstances.values()).map((api) => ({
        id: api.id,
        name: api.name || '',
        controlTopic: api.controlTopic || 'alarm',
      }));
      res.json({ nodes });
    });

    RED.httpAdmin.get('/alarm-ultimate/alarm/:id/state', needsRead, (req, res) => {
      const api = alarmInstances.get(req.params.id);
      if (!api) {
        res.sendStatus(404);
        return;
      }
      res.json(api.getState());
    });

    RED.httpAdmin.post('/alarm-ultimate/alarm/:id/command', needsWrite, (req, res) => {
      const api = alarmInstances.get(req.params.id);
      if (!api) {
        res.sendStatus(404);
        return;
      }
      try {
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        api.command(body);
        const snapshot = api.getState && typeof api.getState === 'function' ? api.getState() : null;
        res.json({ ok: true, result: snapshot });
      } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
      }
    });
  }

  function AlarmSystemUltimate(config) {
    RED.nodes.createNode(this, config);
    const node = this;
    const REDUtil = RED.util;

    const setNodeStatus = helpers.createStatus(node);
    const timerBag = helpers.createTimerBag(node);

    const controlTopic = config.controlTopic || 'alarm';
    const payloadPropName = config.payloadPropName || 'payload';

    const requireCodeForArm = config.requireCodeForArm === true;
    const requireCodeForDisarm = config.requireCodeForDisarm !== false;
    const armCode = typeof config.armCode === 'string' ? config.armCode : '';
    const duressCode = typeof config.duressCode === 'string' ? config.duressCode : '';
    const duressEnabled = duressCode.trim().length > 0;

    const blockArmOnViolations = config.blockArmOnViolations !== false;
    const emitRestoreEvents = config.emitRestoreEvents === true;

    const exitDelayMs = toMilliseconds(config.exitDelaySeconds, 30);
    const entryDelayMs = toMilliseconds(config.entryDelaySeconds, 30);
    const sirenDurationMs = toMilliseconds(config.sirenDurationSeconds, 180);
    const sirenLatchUntilDisarm = config.sirenLatchUntilDisarm === true || Number(config.sirenDurationSeconds) === 0;

    const maxLogEntries = clampInt(config.maxLogEntries, 50, 0, 500);
    const persistState = config.persistState !== false;

    const fileCacheDir =
      RED &&
      RED.settings &&
      typeof RED.settings.userDir === 'string' &&
      RED.settings.userDir.trim().length > 0
        ? path.join(RED.settings.userDir, 'booleanlogicultimatepersist')
        : null;
    const fileCachePath = fileCacheDir ? path.join(fileCacheDir, `${node.id}.AlarmSystemUltimate.json`) : null;
    let fileCacheWriteTimer = null;
    let fileCacheDirty = false;

    const zoneConfigText = typeof config.zones === 'string' ? config.zones : '';
    let zones = parseZones(zoneConfigText);

    const emitOpenZonesDuringArming = config.emitOpenZonesDuringArming === true;
    const openZonesArmingIntervalMs = toMilliseconds(config.openZonesArmingIntervalSeconds, 1);

    const openZonesRequestTopic =
      typeof config.openZonesRequestTopic === 'string' && config.openZonesRequestTopic.trim().length > 0
        ? config.openZonesRequestTopic.trim()
        : `${controlTopic}/listOpenZones`;
    const openZonesRequestIntervalMs = toMilliseconds(config.openZonesRequestIntervalSeconds, 0);

    const stateKey = 'AlarmSystemUltimateState';
    let state = restoreState();

    function buildFileCachePayload() {
      const zoneState = {};
      for (const zone of zones) {
        if (!zone || !zone.id) continue;
        const meta = state.zoneState[zone.id] || { active: false, lastChangeAt: 0, lastTriggerAt: 0 };
        zoneState[zone.id] = {
          active: meta.active === true,
          lastChangeAt: Number(meta.lastChangeAt) || 0,
          lastTriggerAt: Number(meta.lastTriggerAt) || 0,
        };
      }
      return {
        nodeType: 'AlarmSystemUltimate',
        nodeId: node.id,
        savedAt: Date.now(),
        mode: state.mode,
        bypass: state.bypass,
        zoneState,
      };
    }

    function flushFileCache() {
      if (!fileCachePath) return;
      if (!fileCacheDirty) return;
      fileCacheDirty = false;
      try {
        writeJsonFileAtomicSync(fileCachePath, buildFileCachePayload());
      } catch (err) {
        // Best-effort. Avoid crashing the runtime if filesystem is not writable.
      }
    }

    function scheduleFileCacheWrite() {
      if (!fileCachePath) return;
      fileCacheDirty = true;
      if (fileCacheWriteTimer) return;
      fileCacheWriteTimer = timerBag.setTimeout(() => {
        fileCacheWriteTimer = null;
        flushFileCache();
      }, 250);
    }

    function loadFileCache() {
      if (!fileCachePath) return;
      const cached = readJsonFileSync(fileCachePath);
      if (!cached || typeof cached !== 'object') return;

      if (cached.zoneState && typeof cached.zoneState === 'object') {
        const nextZoneState = { ...(state.zoneState || {}) };
        for (const zone of zones) {
          if (!zone || !zone.id) continue;
          const meta = cached.zoneState[zone.id];
          if (!meta || typeof meta !== 'object') continue;
          nextZoneState[zone.id] = {
            active: meta.active === true,
            lastChangeAt: Number(meta.lastChangeAt) || 0,
            lastTriggerAt: Number(meta.lastTriggerAt) || 0,
          };
        }
        state.zoneState = nextZoneState;
      }

      if (!persistState) {
        if (typeof cached.mode === 'string') {
          state.mode = normalizeMode(cached.mode) || state.mode;
        }
        if (cached.bypass && typeof cached.bypass === 'object') {
          state.bypass = { ...cached.bypass };
        }
      }
    }

    loadFileCache();

    let exitTimer = null;
    let entryTimer = null;
    let sirenTimer = null;
    let statusInterval = null;

    const OUTPUT_ALL_EVENTS = 0;
    const OUTPUT_SIREN = 1;
    const OUTPUT_ALARM_EVENTS = 2;
    const OUTPUT_ARMING_EVENTS = 3;
    const OUTPUT_ZONE_EVENTS = 4;
    const OUTPUT_ERROR_EVENTS = 5;
    const OUTPUT_ANY_ZONE_OPEN = 6;
    const OUTPUT_OPEN_ZONES_ARMING = 7;
    const OUTPUT_OPEN_ZONES_ON_REQUEST = 8;

    const alarmEvents = new Set(['alarm']);
    const armingEvents = new Set([
      'arming',
      'armed',
      'disarmed',
      'entry_delay',
      'arm_blocked',
      'already_armed',
      'status',
      'reset',
      'siren_on',
      'siren_off',
    ]);
    const zoneEvents = new Set([
      'bypassed',
      'unbypassed',
      'chime',
      'zone_open',
      'zone_close',
      'zone_ignored_exit',
      'zone_bypassed_trigger',
      'zone_restore',
    ]);
    const errorEvents = new Set(['error', 'denied']);

    let lastAnyZoneOpen = null;
    let lastOpenZonesCount = null;

    let openZonesArmingInterval = null;
    let openZonesRequestInterval = null;
    let openZonesArmingIndex = 0;

    function getOutputCount() {
      if (Array.isArray(node.wires)) {
        return Math.max(2, node.wires.length);
      }
      return 2;
    }

    function createOutputsArray() {
      return new Array(getOutputCount()).fill(null);
    }

    function safeSend(outputs) {
      node.send(outputs);
    }

    function outputForEvent(eventName) {
      if (alarmEvents.has(eventName)) return OUTPUT_ALARM_EVENTS;
      if (errorEvents.has(eventName)) return OUTPUT_ERROR_EVENTS;
      if (zoneEvents.has(eventName)) return OUTPUT_ZONE_EVENTS;
      if (armingEvents.has(eventName)) return OUTPUT_ARMING_EVENTS;
      return null;
    }

    function safeSetOutput(outputs, index, msg) {
      if (!msg) return;
      if (!Number.isInteger(index)) return;
      if (index < 0 || index >= outputs.length) return;
      outputs[index] = msg;
    }

    function sendEventMessage(eventMsg, sirenMsg) {
      const outputs = createOutputsArray();
      safeSetOutput(outputs, OUTPUT_ALL_EVENTS, eventMsg);
      safeSetOutput(outputs, OUTPUT_SIREN, sirenMsg);

      if (eventMsg && typeof eventMsg.event === 'string') {
        const groupOutput = outputForEvent(eventMsg.event);
        if (groupOutput !== null && groupOutput !== OUTPUT_ALL_EVENTS && groupOutput < outputs.length) {
          outputs[groupOutput] = REDUtil.cloneMessage(eventMsg);
        }
      }
      safeSend(outputs);
    }

    function sendSingleOutput(outputIndex, msg) {
      const outputs = createOutputsArray();
      safeSetOutput(outputs, outputIndex, msg);
      safeSend(outputs);
    }

    function clampInt(value, defaultValue, min, max) {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) {
        return defaultValue;
      }
      return Math.max(min, Math.min(max, Math.trunc(parsed)));
    }

    function toMilliseconds(value, defaultSeconds) {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds >= 0) {
        return seconds * 1000;
      }
      return defaultSeconds * 1000;
    }

    function now() {
      return Date.now();
    }

    function createInitialState() {
      return {
        mode: 'disarmed',
        arming: null,
        entry: null,
        alarmActive: false,
        silentAlarmActive: false,
        sirenActive: false,
        alarmZone: null,
        bypass: {},
        zoneState: {},
        log: [],
      };
    }

    function restoreState() {
      if (!persistState) {
        return createInitialState();
      }
      const saved = node.context().get(stateKey);
      if (!saved || typeof saved !== 'object') {
        return createInitialState();
      }
      const next = createInitialState();
      if (typeof saved.mode === 'string') {
        next.mode = normalizeMode(saved.mode) || 'disarmed';
      }
      if (saved && typeof saved.bypass === 'object') {
        next.bypass = { ...saved.bypass };
      }
      if (Array.isArray(saved.log)) {
        next.log = saved.log.slice(-maxLogEntries);
      }
      return next;
    }

    function persist() {
      if (persistState) {
        node.context().set(stateKey, {
          mode: state.mode,
          bypass: state.bypass,
          log: state.log,
        });
      }
      scheduleFileCacheWrite();
    }

    function normalizeMode(value) {
      if (typeof value !== 'string') {
        return null;
      }
      const v = value.toLowerCase().trim();
      if (v === 'disarmed') return 'disarmed';
      if (v === 'armed') return 'armed';

      // Backward compatibility: previously supported multi-mode arming.
      // These legacy values now map to a single "armed" state.
      if (['home', 'away', 'night', 'h24', '24h', '24'].includes(v)) {
        return 'armed';
      }

      return null;
    }


    function parseZones(text) {
      const results = [];
      const rawText = String(text || '').trim();
      if (!rawText) {
        return results;
      }

      function pushZone(raw, index) {
        if (!raw || typeof raw !== 'object') {
          return;
        }
        const zone = normalizeZone(raw, index);
        if (zone) {
          results.push(zone);
        }
      }

      try {
        const parsed = JSON.parse(rawText);
        if (Array.isArray(parsed)) {
          parsed.forEach((item, index) => {
            pushZone(item, index);
          });
          return results;
        }
        if (parsed && typeof parsed === 'object') {
          pushZone(parsed, 0);
          return results;
        }
      } catch (err) {
        // fallback to JSON-per-line parsing
      }

      const lines = rawText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        try {
          pushZone(JSON.parse(line), index);
        } catch (err) {
          node.log(`AlarmSystemUltimate: unable to parse zone line: ${line}`);
        }
      }
      return results;
    }

    function normalizeZone(raw, index) {
      const zone = { ...raw };
      zone.id = String(zone.id || zone.name || zone.topic || `zone${index + 1}`).trim();
      if (!zone.id) {
        return null;
      }
      zone.name = String(zone.name || zone.id).trim();

      if (typeof zone.topic === 'string') {
        zone.topic = zone.topic.trim();
      }
      if (typeof zone.topicPattern === 'string') {
        zone.topicPattern = zone.topicPattern.trim();
      }
      if (!zone.topic && !zone.topicPattern) {
        return null;
      }

      zone.topicPrefix = null;
      if (zone.topic && zone.topic.endsWith('*')) {
        zone.topicPrefix = zone.topic.slice(0, -1);
      }

      zone.topicRegex = null;
      if (zone.topicPattern) {
        try {
          zone.topicRegex = new RegExp(zone.topicPattern);
        } catch (err) {
          node.log(`AlarmSystemUltimate: invalid topicPattern for zone ${zone.id}`);
          return null;
        }
      }

      const type = typeof zone.type === 'string' ? zone.type.toLowerCase().trim() : 'perimeter';
      zone.type = type || 'perimeter';

      zone.entry = zone.entry === true;
      zone.bypassable = zone.bypassable !== false;
      zone.chime = zone.chime === true;
      zone.instantDuringExit = zone.instantDuringExit === true;

      zone.entryDelayMs = toMilliseconds(zone.entryDelaySeconds, entryDelayMs / 1000);
      zone.cooldownMs = toMilliseconds(zone.cooldownSeconds, 0);
      zone.alwaysActive = zone.type === 'fire' || zone.type === 'tamper' || zone.type === '24h';
      if (Object.prototype.hasOwnProperty.call(zone, 'modes')) {
        delete zone.modes;
      }

      return zone;
    }

    function findZone(topic) {
      if (!topic) {
        return null;
      }
      for (const zone of zones) {
        if (zone.topic && zone.topic === topic) {
          return zone;
        }
        if (zone.topicPrefix && topic.startsWith(zone.topicPrefix)) {
          return zone;
        }
        if (zone.topicRegex && zone.topicRegex.test(topic)) {
          return zone;
        }
      }
      return null;
    }


    function startStatusInterval() {
      if (statusInterval) {
        return;
      }
      statusInterval = timerBag.setInterval(() => {
        updateStatus();
      }, 1000);
    }

    function stopStatusIntervalIfIdle() {
      if (!statusInterval) {
        return;
      }
      if (state.arming || state.entry || state.alarmActive || state.sirenActive) {
        return;
      }
      timerBag.clearInterval(statusInterval);
      statusInterval = null;
    }

    function remainingSeconds(until) {
      return Math.max(0, Math.ceil((until - now()) / 1000));
    }

    function updateStatus() {
      let fill = 'grey';
      let shape = 'ring';
      let text = 'DISARMED';

      // When idle/disarmed, show recent arming errors to make the reason visible in the editor status.
      if (!state.alarmActive && !state.entry && !state.arming && state.mode === 'disarmed') {
        const last = Array.isArray(state.log) && state.log.length ? state.log[state.log.length - 1] : null;
        const evt = last && typeof last.event === 'string' ? last.event : '';
        if (evt === 'arm_blocked') {
          const violations = Array.isArray(last.violations) ? last.violations.length : 0;
          fill = 'yellow';
          shape = 'ring';
          text = `ARM BLOCKED${violations ? ` (${violations})` : ''}`;
        } else if (evt === 'denied' && last && String(last.action || '') === 'arm') {
          fill = 'red';
          shape = 'ring';
          text = 'ARM DENIED';
        }
      }

      if (state.alarmActive) {
        fill = 'red';
        shape = 'dot';
        text = `ALARM${state.silentAlarmActive ? ' (silent)' : ''}`;
      } else if (state.entry) {
        fill = 'yellow';
        shape = 'dot';
        text = `ENTRY ${remainingSeconds(state.entry.until)}s`;
      } else if (state.arming) {
        fill = 'yellow';
        shape = 'dot';
        text = `ARMING ${remainingSeconds(state.arming.until)}s`;
      } else if (state.mode === 'armed') {
        fill = 'green';
        shape = 'dot';
        text = 'ARMED';
      }

      setNodeStatus({ fill, shape, text });
      stopStatusIntervalIfIdle();
    }

    function pushLog(event) {
      if (!maxLogEntries) {
        return;
      }
      state.log.push({ ...event, ts: now() });
      if (state.log.length > maxLogEntries) {
        state.log.splice(0, state.log.length - maxLogEntries);
      }
      persist();
    }

    function buildOutputMessage(type, value, baseMsg) {
      const msg = baseMsg ? REDUtil.cloneMessage(baseMsg) : {};
      try {
        msg.payload = REDUtil.evaluateNodeProperty(value, type, node, baseMsg);
      } catch (err) {
        msg.payload = value;
      }
      return msg;
    }

    function emitEvent(event, details, baseMsg) {
      const msg = baseMsg ? REDUtil.cloneMessage(baseMsg) : {};
      msg.topic = `${controlTopic}/event`;
      msg.event = event;
      msg.payload = {
        event,
        mode: state.mode,
        ...(details || {}),
      };
      sendEventMessage(msg, null);
      pushLog({ event, ...(details || {}) });
      try {
        alarmEmitter.emit('event', {
          alarmId: node.id,
          name: node.name || '',
          controlTopic,
          event,
          details: details || {},
          state: snapshotState(),
          ts: now(),
        });
      } catch (_err) {
        // Best-effort. Never crash runtime on listeners failures.
      }
      updateStatus();
    }

    function emitStatus(baseMsg) {
      emitEvent(
        'status',
        {
          state: snapshotState(),
        },
        baseMsg
      );
    }

    function snapshotState() {
      const bypassed = Object.keys(state.bypass || {}).filter((k) => state.bypass[k] === true);
      return {
        mode: state.mode,
        arming: state.arming
          ? { active: true, target: 'armed', remaining: remainingSeconds(state.arming.until) }
          : { active: false },
        entry: state.entry
          ? { active: true, zone: state.entry.zoneId, remaining: remainingSeconds(state.entry.until) }
          : { active: false },
        alarmActive: state.alarmActive,
        silentAlarmActive: state.silentAlarmActive,
        sirenActive: state.sirenActive,
        alarmZone: state.alarmZone,
        bypassedZones: bypassed,
        log: state.log.slice(-10),
      };
    }

    function buildZoneStateSnapshot() {
      return zones.map((zone) => {
        const meta = state.zoneState[zone.id] || { active: false, lastChangeAt: 0, lastTriggerAt: 0 };
        return {
          id: zone.id,
          name: zone.name,
          type: zone.type,
          topic: zone.topic || null,
          topicPattern: zone.topicPattern || null,
          entry: Boolean(zone.entry),
          bypassable: zone.bypassable !== false,
          bypassed: state.bypass[zone.id] === true,
          open: meta.active === true,
          lastChangeAt: meta.lastChangeAt || 0,
          lastTriggerAt: meta.lastTriggerAt || 0,
        };
      });
    }

    function getUiState() {
      return {
        id: node.id,
        name: node.name || '',
        controlTopic,
        state: snapshotState(),
        zones: buildZoneStateSnapshot(),
      };
    }

    function buildZoneSummary(zone) {
      return {
        id: zone ? zone.id : null,
        name: zone ? zone.name : null,
        type: zone ? zone.type : null,
        topic: zone ? zone.topic || zone.topicPattern || null : null,
      };
    }

    function getOpenZonesSnapshot() {
      const openZoneIds = Object.keys(state.zoneState || {}).filter((id) => {
        const meta = state.zoneState[id];
        return meta && meta.active === true;
      });

      const openZones = openZoneIds.map((id) => {
        const zone = zones.find((z) => z && z.id === id);
        return {
          id,
          name: zone ? zone.name : id,
          type: zone ? zone.type : null,
          topic: zone ? zone.topic || zone.topicPattern || null : null,
          bypassed: state.bypass[id] === true,
        };
      });

      return {
        anyOpen: openZones.length > 0,
        openZonesCount: openZones.length,
        openZones,
      };
    }

    function emitAnyZoneOpenIfChanged(baseMsg) {
      const snapshot = getOpenZonesSnapshot();
      if (snapshot.anyOpen === lastAnyZoneOpen && snapshot.openZonesCount === lastOpenZonesCount) {
        return;
      }
      lastAnyZoneOpen = snapshot.anyOpen;
      lastOpenZonesCount = snapshot.openZonesCount;

      const msg = baseMsg ? REDUtil.cloneMessage(baseMsg) : {};
      msg.topic = `${controlTopic}/anyZoneOpen`;
      msg.payload = snapshot.anyOpen;
      msg.openZonesCount = snapshot.openZonesCount;
      msg.openZones = snapshot.openZones;
      sendSingleOutput(OUTPUT_ANY_ZONE_OPEN, msg);
    }

    function buildOpenZoneMessage(context, zoneSummary, position, total, baseMsg) {
      const msg = baseMsg ? REDUtil.cloneMessage(baseMsg) : {};
      msg.topic = `${controlTopic}/openZone`;
      msg.event = 'open_zone';
      msg.payload = {
        context,
        position,
        total,
        zone: zoneSummary,
      };
      return msg;
    }

    function stopOpenZonesDuringArming() {
      if (openZonesArmingInterval) {
        timerBag.clearInterval(openZonesArmingInterval);
        openZonesArmingInterval = null;
      }
    }

    function stopOpenZonesRequestListing() {
      if (openZonesRequestInterval) {
        timerBag.clearInterval(openZonesRequestInterval);
        openZonesRequestInterval = null;
      }
    }

    function emitNextOpenZoneDuringArming(baseMsg) {
      const snapshot = getOpenZonesSnapshot();
      const openZones = snapshot.openZones || [];
      if (openZones.length === 0) {
        return;
      }
      openZonesArmingIndex += 1;
      const selected = openZones[(openZonesArmingIndex - 1) % openZones.length];
      const msg = buildOpenZoneMessage(
        'arming',
        selected,
        ((openZonesArmingIndex - 1) % openZones.length) + 1,
        openZones.length,
        baseMsg
      );
      sendSingleOutput(OUTPUT_OPEN_ZONES_ARMING, msg);
    }

    function startOpenZonesDuringArming(baseMsg) {
      stopOpenZonesDuringArming();

      if (!emitOpenZonesDuringArming || openZonesArmingIntervalMs <= 0) {
        return;
      }

      openZonesArmingIndex = 0;
      emitNextOpenZoneDuringArming(baseMsg);
      openZonesArmingInterval = timerBag.setInterval(() => {
        if (!state.arming) {
          stopOpenZonesDuringArming();
          return;
        }
        emitNextOpenZoneDuringArming(null);
      }, openZonesArmingIntervalMs);
    }

    function emitOpenZonesOnRequest(baseMsg) {
      stopOpenZonesRequestListing();

      const snapshot = getOpenZonesSnapshot();
      if (snapshot.openZones.length === 0) {
        const msg = baseMsg ? REDUtil.cloneMessage(baseMsg) : {};
        msg.topic = `${controlTopic}/openZones`;
        msg.event = 'open_zones';
        msg.payload = { total: 0, zones: [] };
        sendSingleOutput(OUTPUT_OPEN_ZONES_ON_REQUEST, msg);
        return;
      }

      let index = 0;
      const total = snapshot.openZones.length;

      function sendOne(nextBaseMsg) {
        if (index >= total) {
          stopOpenZonesRequestListing();
          return;
        }
        const zone = snapshot.openZones[index];
        index += 1;
        const msg = buildOpenZoneMessage('request', zone, index, total, nextBaseMsg);
        sendSingleOutput(OUTPUT_OPEN_ZONES_ON_REQUEST, msg);
      }

      if (openZonesRequestIntervalMs > 0) {
        sendOne(baseMsg);
        openZonesRequestInterval = timerBag.setInterval(() => {
          sendOne(null);
        }, openZonesRequestIntervalMs);
        return;
      }

      for (let i = 0; i < total; i += 1) {
        sendOne(i === 0 ? baseMsg : null);
      }
    }

    function sendSiren(active, baseMsg, reason) {
      const topic = config.sirenTopic || `${controlTopic}/siren`;
      const type = active ? config.sirenOnPayloadType || 'bool' : config.sirenOffPayloadType || 'bool';
      const value = active ? config.sirenOnPayload : config.sirenOffPayload;
      const msg = buildOutputMessage(type, value, baseMsg);
      msg.topic = topic;
      msg.event = active ? 'siren_on' : 'siren_off';
      msg.reason = reason;
      sendEventMessage(null, msg);
    }

    function clearExitTimer() {
      if (exitTimer) {
        timerBag.clearTimeout(exitTimer);
        exitTimer = null;
      }
    }

    function clearEntryTimer() {
      if (entryTimer) {
        timerBag.clearTimeout(entryTimer);
        entryTimer = null;
      }
    }

    function clearSirenTimer() {
      if (sirenTimer) {
        timerBag.clearTimeout(sirenTimer);
        sirenTimer = null;
      }
    }

    function stopSiren(baseMsg, reason) {
      if (!state.sirenActive) {
        return;
      }
      clearSirenTimer();
      state.sirenActive = false;
      try {
        alarmEmitter.emit('siren_state', {
          alarmId: node.id,
          name: node.name || '',
          controlTopic,
          active: false,
          reason,
          ts: now(),
        });
      } catch (_err) {
        // ignore
      }
      sendSiren(false, baseMsg, reason);
      emitEvent('siren_off', { reason }, baseMsg);
    }

    function startSiren(baseMsg, reason) {
      if (state.sirenActive) {
        return;
      }
      state.sirenActive = true;
      try {
        alarmEmitter.emit('siren_state', {
          alarmId: node.id,
          name: node.name || '',
          controlTopic,
          active: true,
          reason,
          ts: now(),
        });
      } catch (_err) {
        // ignore
      }
      sendEventMessage(
        buildEventMessage('siren_on', { reason }, baseMsg),
        buildSirenMessage(true, baseMsg, reason)
      );
      pushLog({ event: 'siren_on', reason });
      updateStatus();

      if (sirenLatchUntilDisarm) {
        return;
      }
      if (sirenDurationMs <= 0) {
        return;
      }
      clearSirenTimer();
      sirenTimer = timerBag.setTimeout(() => {
        stopSiren(baseMsg, 'timeout');
      }, sirenDurationMs);
    }

    function buildEventMessage(event, details, baseMsg) {
      const msg = baseMsg ? REDUtil.cloneMessage(baseMsg) : {};
      msg.topic = `${controlTopic}/event`;
      msg.event = event;
      msg.payload = {
        event,
        mode: state.mode,
        ...(details || {}),
      };
      return msg;
    }

    function buildSirenMessage(active, baseMsg, reason) {
      const topic = config.sirenTopic || `${controlTopic}/siren`;
      const type = active ? config.sirenOnPayloadType || 'bool' : config.sirenOffPayloadType || 'bool';
      const value = active ? config.sirenOnPayload : config.sirenOffPayload;
      const msg = buildOutputMessage(type, value, baseMsg);
      msg.topic = topic;
      msg.event = active ? 'siren_on' : 'siren_off';
      msg.reason = reason;
      return msg;
    }

    function triggerAlarm(kind, zone, baseMsg, silent) {
      if (state.alarmActive) {
        return;
      }
      stopOpenZonesDuringArming();
      stopOpenZonesRequestListing();
      state.alarmActive = true;
      state.alarmZone = zone ? zone.id : null;
      state.silentAlarmActive = Boolean(silent);
      clearExitTimer();
      clearEntryTimer();
      state.arming = null;
      state.entry = null;
      startStatusInterval();

      const eventMsg = buildEventMessage('alarm', {
        kind,
        zone: zone ? { id: zone.id, name: zone.name, type: zone.type, topic: zone.topic || zone.topicPattern } : null,
        silent: Boolean(silent),
      }, baseMsg);

      let sirenMsg = null;
      if (!silent || (zone && zone.type === 'fire')) {
        if (!state.sirenActive) {
          state.sirenActive = true;
          try {
            alarmEmitter.emit('siren_state', {
              alarmId: node.id,
              name: node.name || '',
              controlTopic,
              active: true,
              reason: kind,
              ts: now(),
            });
          } catch (_err) {
            // ignore
          }
          sirenMsg = buildSirenMessage(true, baseMsg, kind);
          if (!sirenLatchUntilDisarm && sirenDurationMs > 0) {
            clearSirenTimer();
            sirenTimer = timerBag.setTimeout(() => {
              stopSiren(baseMsg, 'timeout');
            }, sirenDurationMs);
          }
        }
      }

      sendEventMessage(eventMsg, sirenMsg);
      pushLog({
        event: 'alarm',
        kind,
        silent: Boolean(silent),
        zone: zone ? { id: zone.id, name: zone.name, type: zone.type } : null,
      });
      updateStatus();
    }

    function disarm(baseMsg, reason, duress) {
      stopOpenZonesDuringArming();
      stopOpenZonesRequestListing();
      clearExitTimer();
      clearEntryTimer();
      state.arming = null;
      state.entry = null;
      state.alarmActive = false;
      state.silentAlarmActive = false;
      state.alarmZone = null;
      if (state.sirenActive) {
        stopSiren(baseMsg, 'disarm');
      }
      state.mode = 'disarmed';
      persist();
      emitEvent('disarmed', { reason, duress: Boolean(duress) }, baseMsg);
    }

    function violatedZonesForArm() {
      const violations = [];
      for (const zone of zones) {
        if (!zone || zone.alwaysActive) {
          continue;
        }
        if (state.bypass[zone.id] === true) {
          continue;
        }
        const zoneState = state.zoneState[zone.id];
        if (zoneState && zoneState.active === true) {
          violations.push({ id: zone.id, name: zone.name, type: zone.type });
        }
      }
      return violations;
    }

    function arm(baseMsg, reason) {
      if (state.mode === 'armed' && !state.arming) {
        emitEvent('already_armed', { target: 'armed' }, baseMsg);
        return;
      }

      const violations = blockArmOnViolations ? violatedZonesForArm() : [];
      if (blockArmOnViolations && violations.length > 0) {
        emitEvent('arm_blocked', { target: 'armed', violations }, baseMsg);
        return;
      }

      stopOpenZonesDuringArming();
      stopOpenZonesRequestListing();
      clearExitTimer();
      clearEntryTimer();
      state.entry = null;
      state.alarmActive = false;
      state.silentAlarmActive = false;
      state.alarmZone = null;
      if (state.sirenActive) {
        stopSiren(baseMsg, 'arm');
      }

      if (exitDelayMs <= 0) {
        state.mode = 'armed';
        state.arming = null;
        stopOpenZonesDuringArming();
        persist();
        emitEvent('armed', { reason }, baseMsg);
        return;
      }

      const until = now() + exitDelayMs;
      state.arming = { until };
      persist();
      emitEvent('arming', { target: 'armed', seconds: remainingSeconds(until), reason }, baseMsg);
      startStatusInterval();
      startOpenZonesDuringArming(baseMsg);

      exitTimer = timerBag.setTimeout(() => {
        const stillArming = state.arming && typeof state.arming.until === 'number';
        if (!stillArming) {
          return;
        }
        const followUpViolations = blockArmOnViolations ? violatedZonesForArm() : [];
        if (blockArmOnViolations && followUpViolations.length > 0) {
          state.arming = null;
          stopOpenZonesDuringArming();
          persist();
          emitEvent('arm_blocked', { target: 'armed', violations: followUpViolations }, baseMsg);
          return;
        }
        state.mode = 'armed';
        state.arming = null;
        stopOpenZonesDuringArming();
        persist();
        emitEvent('armed', { reason }, baseMsg);
      }, exitDelayMs);
    }

    function startEntryDelay(zone, baseMsg) {
      if (state.entry) {
        return;
      }
      const delay = zone && Number.isFinite(zone.entryDelayMs) ? zone.entryDelayMs : entryDelayMs;
      if (delay <= 0) {
        triggerAlarm('instant', zone, baseMsg, false);
        return;
      }
      const until = now() + delay;
      state.entry = { zoneId: zone.id, until };
      emitEvent('entry_delay', { zone: buildZoneSummary(zone), seconds: remainingSeconds(until) }, baseMsg);
      startStatusInterval();
      clearEntryTimer();
      entryTimer = timerBag.setTimeout(() => {
        if (!state.entry || state.entry.zoneId !== zone.id) {
          return;
        }
        state.entry = null;
        triggerAlarm('entry_timeout', zone, baseMsg, false);
      }, delay);
    }

    function shouldConsumeControlMessage(msg) {
      if (!msg || typeof msg !== 'object') {
        return false;
      }
      if (msg.topic !== controlTopic) {
        return false;
      }
      return true;
    }

    function resolveCode(msg) {
      if (!msg || typeof msg !== 'object') {
        return '';
      }
      if (typeof msg.code === 'string') {
        return msg.code;
      }
      if (typeof msg.pin === 'string') {
        return msg.pin;
      }
      return '';
    }

    function validateCode(msg, action) {
      const provided = resolveCode(msg).trim();
      const expects = action === 'arm' ? requireCodeForArm : requireCodeForDisarm;
      if (!expects) {
        return { ok: true, duress: false };
      }
      if (!armCode.trim()) {
        return { ok: true, duress: false };
      }
      if (provided && duressEnabled && provided === duressCode) {
        return { ok: true, duress: true };
      }
      if (provided && provided === armCode) {
        return { ok: true, duress: false };
      }
      return { ok: false, duress: false };
    }

    function setBypass(zoneId, enabled, baseMsg) {
      const id = String(zoneId || '').trim();
      if (!id) {
        emitEvent('error', { error: 'missing_zone' }, baseMsg);
        return;
      }
      const zone = zones.find((z) => z && z.id === id);
      if (!zone) {
        emitEvent('error', { error: 'unknown_zone', zone: id }, baseMsg);
        return;
      }
      if (enabled && zone.bypassable === false) {
        emitEvent('error', { error: 'zone_not_bypassable', zone: id }, baseMsg);
        return;
      }
      state.bypass[id] = Boolean(enabled);
      persist();
      emitEvent(enabled ? 'bypassed' : 'unbypassed', { zone: buildZoneSummary(zone) }, baseMsg);
    }

    function handleControlMessage(msg) {
      const command = typeof msg.command === 'string' ? msg.command.toLowerCase().trim() : '';
      if (msg.reset === true || command === 'reset') {
        stopOpenZonesDuringArming();
        stopOpenZonesRequestListing();
        clearExitTimer();
        clearEntryTimer();
        clearSirenTimer();
        state = createInitialState();
        persist();
        emitAnyZoneOpenIfChanged(msg);
        emitEvent('reset', {}, msg);
        return true;
      }

      if (msg.status === true || command === 'status') {
        emitStatus(msg);
        return true;
      }

      if (command === 'list_open_zones' || command === 'listopenzones' || msg.listOpenZones === true) {
        emitOpenZonesOnRequest(msg);
        return true;
      }

      if (command === 'bypass' || msg.bypass === true) {
        setBypass(msg.zone || msg.zoneId || msg.zoneName, true, msg);
        return true;
      }
      if (command === 'unbypass' || msg.unbypass === true) {
        setBypass(msg.zone || msg.zoneId || msg.zoneName, false, msg);
        return true;
      }

      if (command === 'siren_on') {
        startSiren(msg, 'manual');
        return true;
      }
      if (command === 'siren_off') {
        stopSiren(msg, 'manual');
        return true;
      }

      if (command === 'panic' || msg.panic === true) {
        triggerAlarm('panic', null, msg, false);
        return true;
      }
      if (command === 'panic_silent' || command === 'silent_panic') {
        triggerAlarm('panic', null, msg, true);
        return true;
      }

      if (command === 'disarm' || msg.disarm === true) {
        const validation = validateCode(msg, 'disarm');
        if (!validation.ok) {
          emitEvent('denied', { action: 'disarm' }, msg);
          return true;
        }
        if (validation.duress) {
          triggerAlarm('duress', null, msg, true);
          disarm(msg, 'duress', true);
          return true;
        }
        disarm(msg, 'manual', false);
        return true;
      }

      const requestedMode =
        normalizeMode(msg.arm) ||
        normalizeMode(msg.mode) ||
        (command === 'arm' ? 'armed' : null) ||
        (command === 'arm_away' ? 'armed' : null) ||
        (command === 'arm_home' ? 'armed' : null) ||
        (command === 'arm_night' ? 'armed' : null) ||
        (command === 'arm_h24' ? 'armed' : null) ||
        (command === 'arm_24h' ? 'armed' : null);

      if (requestedMode && requestedMode !== 'disarmed') {
        const validation = validateCode(msg, 'arm');
        if (!validation.ok) {
          emitEvent('denied', { action: 'arm', target: 'armed' }, msg);
          return true;
        }
        if (validation.duress) {
          triggerAlarm('duress', null, msg, true);
        }
        arm(msg, 'manual');
        return true;
      }

      return false;
    }

    function handleSensorMessage(msg) {
      const zone = findZone(msg.topic);
      if (!zone) {
        return;
      }
      const resolved = helpers.resolveInput(msg, payloadPropName, null, RED);
      const value = resolved.boolean;
      if (value === undefined) {
        return;
      }

      const zoneMeta = state.zoneState[zone.id] || { active: false, lastChangeAt: 0, lastTriggerAt: 0 };
      const changed = zoneMeta.active !== value;
      zoneMeta.active = value;
      zoneMeta.lastChangeAt = now();
      state.zoneState[zone.id] = zoneMeta;

      if (changed) {
        emitEvent(
          value === true ? 'zone_open' : 'zone_close',
          {
            zone: buildZoneSummary(zone),
            open: value === true,
            bypassed: state.bypass[zone.id] === true,
          },
          msg
        );
      }

      if (changed && emitRestoreEvents && value === false) {
        emitEvent('zone_restore', { zone: buildZoneSummary(zone) }, msg);
      }

      if (changed) {
        emitAnyZoneOpenIfChanged(msg);
        scheduleFileCacheWrite();
        try {
          alarmEmitter.emit('zone_state', {
            alarmId: node.id,
            name: node.name || '',
            controlTopic,
            zone: buildZoneSummary(zone),
            open: value === true,
            bypassed: state.bypass[zone.id] === true,
            ts: zoneMeta.lastChangeAt,
          });
        } catch (_err) {
          // ignore
        }
      }

      if (value !== true) {
        return;
      }

      if (state.bypass[zone.id] === true && zone.bypassable !== false) {
        emitEvent('zone_bypassed_trigger', { zone: buildZoneSummary(zone) }, msg);
        return;
      }

      const cooldownMs = Number(zone.cooldownMs) || 0;
      if (cooldownMs > 0 && zoneMeta.lastTriggerAt && now() - zoneMeta.lastTriggerAt < cooldownMs) {
        return;
      }
      zoneMeta.lastTriggerAt = now();
      state.zoneState[zone.id] = zoneMeta;
      scheduleFileCacheWrite();

      if (zone.alwaysActive) {
        triggerAlarm(zone.type, zone, msg, false);
        return;
      }

      if (state.arming && !zone.instantDuringExit) {
        emitEvent('zone_ignored_exit', { zone: buildZoneSummary(zone) }, msg);
        return;
      }

      if (state.mode === 'disarmed') {
        if (zone.chime) {
          emitEvent('chime', { zone: buildZoneSummary(zone) }, msg);
        }
        return;
      }

      if (zone.entry) {
        startEntryDelay(zone, msg);
        return;
      }
      triggerAlarm('instant', zone, msg, false);
    }

    node.on('input', (msg) => {
      if (msg && typeof msg.topic === 'string' && msg.topic === openZonesRequestTopic) {
        emitOpenZonesOnRequest(msg);
        return;
      }
      if (shouldConsumeControlMessage(msg)) {
        if (handleControlMessage(msg)) {
          return;
        }
      }
      handleSensorMessage(msg);
    });

    updateStatus();
    emitAnyZoneOpenIfChanged();

    const api = {
      id: node.id,
      name: node.name || '',
      controlTopic,
      getState: getUiState,
      command(body) {
        const payload = body && typeof body === 'object' ? body : {};
        const msg = { topic: controlTopic };

        if (typeof payload.command === 'string' && payload.command.trim().length > 0) {
          msg.command = payload.command;
        } else if (typeof payload.action === 'string' && payload.action.trim().length > 0) {
          msg.command = payload.action;
        }

        if (typeof payload.arm === 'string') {
          msg.arm = payload.arm;
        }
        if (typeof payload.mode === 'string') {
          msg.mode = payload.mode;
        }
        if (payload.disarm === true) {
          msg.disarm = true;
        }
        if (typeof payload.code === 'string') {
          msg.code = payload.code;
        }
        if (typeof payload.pin === 'string') {
          msg.pin = payload.pin;
        }
        if (typeof payload.zone === 'string') {
          msg.zone = payload.zone;
        }

        node.receive(msg);
      },
    };

    alarmInstances.set(node.id, api);
    node.on('close', () => {
      flushFileCache();
      alarmInstances.delete(node.id);
    });
  }

  RED.nodes.registerType('AlarmSystemUltimate', AlarmSystemUltimate);
};
