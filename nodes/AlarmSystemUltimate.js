'use strict';

const fs = require('fs');
const path = require('path');

const { alarmInstances, alarmEmitter } = require('./lib/alarm-registry.js');
const { attachAlarmUltimateEnvelope } = require('./lib/alarm-ultimate-envelope.js');

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

  function parseJsonObject(value) {
    const raw = String(value || '').trim();
    if (!raw) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch (_err) {
      return null;
    }
  }

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

    RED.httpAdmin.get('/alarm-ultimate/alarm/:id/log', needsRead, (req, res) => {
      const api = alarmInstances.get(req.params.id);
      if (!api) {
        res.sendStatus(404);
        return;
      }
      const getLog = api.getLog && typeof api.getLog === 'function' ? api.getLog : null;
      if (!getLog) {
        res.status(501).json({ ok: false, error: 'log_not_supported' });
        return;
      }
      const since = Number(req.query && req.query.since);
      const limit = Number(req.query && req.query.limit);
      res.json(
        getLog({
          since: Number.isFinite(since) ? since : null,
          limit: Number.isFinite(limit) ? limit : null,
        })
      );
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
    const syncTargetsConfig = parseJsonObject(config.syncTargets) || {};

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

	    const emitOpenZonesCycle = config.emitOpenZonesCycle === true;
	    const openZonesCycleIntervalMs = toMilliseconds(config.openZonesCycleIntervalSeconds, 5);

    const stateKey = 'AlarmSystemUltimateState';
    let state = restoreState();

    function buildFileCachePayload() {
      const zoneState = {};
      for (const zone of zones) {
        if (!zone || !zone.key) continue;
        const meta = state.zoneState[zone.key] || {
          active: false,
          lastChangeAt: 0,
          lastTriggerAt: 0,
          lastSeenAt: 0,
          supervisionLost: false,
          supervisionLostAt: 0,
        };
        zoneState[zone.key] = {
          active: meta.active === true,
          lastChangeAt: Number(meta.lastChangeAt) || 0,
          lastTriggerAt: Number(meta.lastTriggerAt) || 0,
          lastSeenAt: Number(meta.lastSeenAt) || 0,
          supervisionLost: meta.supervisionLost === true,
          supervisionLostAt: Number(meta.supervisionLostAt) || 0,
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
          if (!zone || !zone.key) continue;
          const meta = pickCachedZoneMeta(cached.zoneState, zone);
          if (!meta || typeof meta !== 'object') continue;
          nextZoneState[zone.key] = {
            active: meta.active === true,
            lastChangeAt: Number(meta.lastChangeAt) || 0,
            lastTriggerAt: Number(meta.lastTriggerAt) || 0,
            lastSeenAt: Number(meta.lastSeenAt) || 0,
            supervisionLost: meta.supervisionLost === true,
            supervisionLostAt: Number(meta.supervisionLostAt) || 0,
          };
        }
        state.zoneState = nextZoneState;
      }

      if (!persistState) {
        if (typeof cached.mode === 'string') {
          state.mode = normalizeMode(cached.mode) || state.mode;
        }
        if (cached.bypass && typeof cached.bypass === 'object') {
          state.bypass = migrateZoneRefMap(cached.bypass);
        }
      }
    }

    loadFileCache();

    let exitTimer = null;
    let entryTimer = null;
    let sirenTimer = null;
    let statusInterval = null;
    const supervisionTimers = new Map();

    const OUTPUT_ALL_EVENTS = 0;
    const OUTPUT_SIREN = 1;
    const OUTPUT_ALARM_EVENTS = 2;
    const OUTPUT_ARMING_EVENTS = 3;
    const OUTPUT_ZONE_EVENTS = 4;
    const OUTPUT_ERROR_EVENTS = 5;
	    const OUTPUT_ANY_ZONE_OPEN = 6;
	    const OUTPUT_OPEN_ZONES_ARMING = 7;
	    const OUTPUT_OPEN_ZONES_ON_REQUEST = 8;
	    const OUTPUT_OPEN_ZONES_CYCLE = 9;

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
      'supervision_lost',
      'supervision_restored',
    ]);
    const errorEvents = new Set(['error', 'denied']);

    let lastAnyZoneOpen = null;
    let lastOpenZonesCount = null;

	    let openZonesArmingInterval = null;
	    let openZonesRequestInterval = null;
	    let openZonesCycleInterval = null;
	    let openZonesArmingIndex = 0;
	    let openZonesCycleIndex = 0;

    function getOutputCount() {
      // Outputs (index):
      // 0: All messages (superset)
      // 1: Siren
      // 2: Alarm triggered
      // 3: Arm/Disarm updates
      // 4: Zone activity
      // 5: Errors/Denied
      // 6: Any zone open
      // 7: Open zones (arming)
      // 8: Open zones (on request)
      // 9: Open zones (cycle)
      return 10;
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

    function safeEmitBus(kind, msg) {
      if (!msg) return;
      try {
        alarmEmitter.emit('message', {
          alarmId: node.id,
          name: node.name || '',
          controlTopic,
          kind,
          msg: REDUtil.cloneMessage(msg),
          ts: now(),
        });
      } catch (_err) {
        // Best-effort. Never crash runtime on listeners failures.
      }
    }

    function pushToAllOutputs(outputs, msg, clone) {
      if (!msg) return;
      if (!outputs || outputs.length === 0) return;
      if (outputs.length === 1) {
        safeSetOutput(outputs, OUTPUT_ALL_EVENTS, msg);
        return;
      }
      const m = clone ? REDUtil.cloneMessage(msg) : msg;
      if (!outputs[OUTPUT_ALL_EVENTS]) {
        outputs[OUTPUT_ALL_EVENTS] = m;
        return;
      }
      if (Array.isArray(outputs[OUTPUT_ALL_EVENTS])) {
        outputs[OUTPUT_ALL_EVENTS].push(m);
        return;
      }
      outputs[OUTPUT_ALL_EVENTS] = [outputs[OUTPUT_ALL_EVENTS], m];
    }

    function sendEventMessage(eventMsg, sirenMsg) {
      const outputs = createOutputsArray();

      if (outputs.length === 1) {
        if (eventMsg) safeEmitBus('event', eventMsg);
        if (sirenMsg) safeEmitBus('siren', sirenMsg);

        const merged = [];
        if (eventMsg) merged.push(eventMsg);
        if (sirenMsg) merged.push(sirenMsg);
        if (merged.length === 1) {
          outputs[0] = merged[0];
        } else if (merged.length > 1) {
          outputs[0] = merged;
        }
        safeSend(outputs);
        return;
      }

      if (eventMsg) {
        safeSetOutput(outputs, OUTPUT_ALL_EVENTS, eventMsg);
        safeEmitBus('event', eventMsg);
      }
      if (sirenMsg) {
        safeSetOutput(outputs, OUTPUT_SIREN, sirenMsg);
        safeEmitBus('siren', sirenMsg);
        pushToAllOutputs(outputs, sirenMsg, true);
      }

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
	      const kind =
	        outputIndex === OUTPUT_ANY_ZONE_OPEN
	          ? 'any_zone_open'
	          : outputIndex === OUTPUT_OPEN_ZONES_ARMING
	            ? 'open_zones_arming'
	            : outputIndex === OUTPUT_OPEN_ZONES_ON_REQUEST
	              ? 'open_zones_request'
	              : outputIndex === OUTPUT_OPEN_ZONES_CYCLE
	                ? 'open_zones_cycle'
	                : 'message';
	      safeEmitBus(kind, msg);
	      if (outputs.length === 1) {
	        safeSetOutput(outputs, OUTPUT_ALL_EVENTS, msg);
	      } else {
	        safeSetOutput(outputs, outputIndex, msg);
	        pushToAllOutputs(outputs, msg, outputIndex !== OUTPUT_ALL_EVENTS);
	      }
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
        next.bypass = migrateZoneRefMap(saved.bypass);
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
          if (results.some((z) => z && z.key === zone.key)) {
            node.log(`AlarmSystemUltimate: duplicate zone topic/pattern skipped: ${zone.key}`);
            return;
          }
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
      if (typeof zone.topic === 'string') {
        zone.topic = zone.topic.trim();
      }
      if (typeof zone.topicPattern === 'string') {
        zone.topicPattern = zone.topicPattern.trim();
      }
      if (zone.topicPattern) {
        if (!zone.topic) {
          node.log('AlarmSystemUltimate: zone.topicPattern is no longer supported; treating it as topic.');
          zone.topic = zone.topicPattern;
        } else {
          node.log('AlarmSystemUltimate: zone.topicPattern is no longer supported; ignoring it (topic is set).');
        }
        delete zone.topicPattern;
      }
      if (!zone.topic) {
        return null;
      }

      zone.key = String(zone.topic || '').trim();
      if (!zone.key) {
        return null;
      }
      zone.name = String(zone.name || zone.key).trim();

      // Remove legacy id if present.
      if (Object.prototype.hasOwnProperty.call(zone, 'id')) {
        delete zone['id'];
      }

      zone.topicPrefix = null;
      if (zone.topic && zone.topic.endsWith('*')) {
        zone.topicPrefix = zone.topic.slice(0, -1);
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

      // Optional sensor supervision (per-zone).
      // Starts after the first valid sensor message is received for that zone.
      const supervisionConfig = zone.supervision && typeof zone.supervision === 'object' ? zone.supervision : null;
      const enabledRaw =
        supervisionConfig && Object.prototype.hasOwnProperty.call(supervisionConfig, 'enabled')
          ? supervisionConfig.enabled
          : Object.prototype.hasOwnProperty.call(zone, 'supervisionEnabled')
            ? zone.supervisionEnabled
            : zone.supervision === true;
      zone.supervisionEnabled = enabledRaw === true;

      const timeoutSecondsRaw =
        supervisionConfig && Object.prototype.hasOwnProperty.call(supervisionConfig, 'timeoutSeconds')
          ? supervisionConfig.timeoutSeconds
          : Object.prototype.hasOwnProperty.call(zone, 'supervisionTimeoutSeconds')
            ? zone.supervisionTimeoutSeconds
            : Object.prototype.hasOwnProperty.call(zone, 'supervisionSeconds')
              ? zone.supervisionSeconds
              : null;
      const timeoutSeconds = Number(timeoutSecondsRaw);
      zone.supervisionTimeoutMs =
        zone.supervisionEnabled === true && Number.isFinite(timeoutSeconds) && timeoutSeconds > 0 ? timeoutSeconds * 1000 : 0;

      const blockArmRaw =
        supervisionConfig && Object.prototype.hasOwnProperty.call(supervisionConfig, 'blockArm')
          ? supervisionConfig.blockArm
          : Object.prototype.hasOwnProperty.call(zone, 'supervisionBlockArm')
            ? zone.supervisionBlockArm
            : true;
      zone.supervisionBlockArm = blockArmRaw !== false;

      return zone;
    }

    function normalizeZoneRef(value) {
      const ref = String(value || '').trim();
      if (!ref) return '';
      const direct = zones.find((z) => z && z.key === ref);
      if (direct) return direct.key;
      const byName = zones.find((z) => z && z.name === ref);
      if (byName) return byName.key;
      return '';
    }

    function migrateZoneRefMap(obj) {
      const source = obj && typeof obj === 'object' ? obj : {};
      const out = {};
      for (const [k, v] of Object.entries(source)) {
        const resolved = normalizeZoneRef(k);
        if (!resolved) continue;
        out[resolved] = v;
      }
      return out;
    }

    function pickCachedZoneMeta(cachedZoneState, zone) {
      const bag = cachedZoneState && typeof cachedZoneState === 'object' ? cachedZoneState : {};
      if (!zone || !zone.key) return null;
      return (
        bag[zone.key] ||
        (zone.topic ? bag[zone.topic] : null) ||
        (zone.name ? bag[zone.name] : null) ||
        null
      );
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
        } else {
          const troubleCount = zones.filter((z) => {
            if (!z || z.supervisionEnabled !== true) return false;
            const meta = state.zoneState && state.zoneState[z.key];
            return meta && meta.supervisionLost === true;
          }).length;
          if (troubleCount > 0) {
            fill = 'yellow';
            shape = 'ring';
            text = `TROUBLE${troubleCount ? ` (${troubleCount})` : ''}`;
          }
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
      const auUpdate = {
        kind: 'event',
        event,
        mode: state.mode,
        details: details || {},
      };
      if (details && typeof details.reason === 'string' && details.reason) auUpdate.reason = details.reason;
      if (details && details.zone) auUpdate.zone = details.zone;
      if (details && typeof details.open === 'boolean') auUpdate.open = details.open;
      if (details && typeof details.bypassed === 'boolean') auUpdate.bypassed = details.bypassed;
      if (details && details.state) auUpdate.state = details.state;
      if (typeof msg.homekitTargetState === 'number' && Number.isFinite(msg.homekitTargetState)) {
        auUpdate.homekitTargetState = msg.homekitTargetState;
      }
      attachAU(msg, auUpdate);
      sendEventMessage(msg, null);
      pushLog({ event, ...(details || {}) });
      try {
        const homekitTargetState =
          typeof msg.homekitTargetState === 'number' && Number.isFinite(msg.homekitTargetState)
            ? msg.homekitTargetState
            : undefined;
        alarmEmitter.emit('event', {
          alarmId: node.id,
          name: node.name || '',
          controlTopic,
          event,
          details: details || {},
          state: snapshotState(),
          homekitTargetState,
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
          ? { active: true, zoneTopic: state.entry.zoneTopic, remaining: remainingSeconds(state.entry.until) }
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
        const meta = state.zoneState[zone.key] || {
          active: false,
          lastChangeAt: 0,
          lastTriggerAt: 0,
          lastSeenAt: 0,
          supervisionLost: false,
          supervisionLostAt: 0,
        };
        return {
          name: zone.name,
          type: zone.type,
          topic: zone.topic || null,
          entry: Boolean(zone.entry),
          bypassable: zone.bypassable !== false,
          bypassed: state.bypass[zone.key] === true,
          open: meta.active === true,
          lastChangeAt: meta.lastChangeAt || 0,
          lastTriggerAt: meta.lastTriggerAt || 0,
          lastSeenAt: meta.lastSeenAt || 0,
          supervision: {
            enabled: zone.supervisionEnabled === true,
            timeoutSeconds: zone.supervisionEnabled === true ? Number(zone.supervisionTimeoutMs || 0) / 1000 : 0,
            blockArm: zone.supervisionEnabled === true ? zone.supervisionBlockArm !== false : false,
            lost: meta.supervisionLost === true,
            lostAt: meta.supervisionLostAt || 0,
          },
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

    function getLogSnapshot(opts) {
      const options = opts && typeof opts === 'object' ? opts : {};
      const since = Number.isFinite(Number(options.since)) ? Number(options.since) : null;
      const limit = Number.isFinite(Number(options.limit)) ? clampInt(options.limit, 200, 0, 500) : null;

      const all = Array.isArray(state.log) ? state.log : [];
      const filtered = since ? all.filter((e) => (e && Number(e.ts)) > since) : all;
      const out = limit === null ? filtered : limit === 0 ? [] : filtered.slice(-limit);

      return {
        id: node.id,
        name: node.name || '',
        now: now(),
        total: all.length,
        returned: out.length,
        since,
        limit,
        log: out.map((e) => ({ ...(e || {}) })),
      };
    }

    function buildZoneSummary(zone) {
      return {
        name: zone ? zone.name : null,
        type: zone ? zone.type : null,
        topic: zone ? zone.topic || null : null,
      };
    }

    function attachAU(msg, update) {
      const baseUpdate = update && typeof update === 'object' ? update : {};
      const alarmUpdate =
        baseUpdate.alarm && typeof baseUpdate.alarm === 'object' ? baseUpdate.alarm : {};
      attachAlarmUltimateEnvelope(msg, {
        ...baseUpdate,
        ts: now(),
        alarm: {
          id: node.id,
          name: node.name || '',
          controlTopic,
          ...alarmUpdate,
        },
      });
      return msg;
    }

    function getOpenZonesSnapshot() {
      const openZoneKeys = Object.keys(state.zoneState || {}).filter((key) => {
        const meta = state.zoneState[key];
        return meta && meta.active === true;
      });

      const openZones = openZoneKeys.map((key) => {
        const zone = zones.find((z) => z && z.key === key);
        return {
          name: zone ? zone.name : key,
          type: zone ? zone.type : null,
          topic: zone ? zone.topic || null : null,
          bypassed: state.bypass[key] === true,
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
      msg.event = 'any_zone_open';
      msg.payload = snapshot.anyOpen;
      msg.openZonesCount = snapshot.openZonesCount;
      msg.openZones = snapshot.openZones;
      attachAU(msg, {
        kind: 'any_zone_open',
        event: 'any_zone_open',
        anyOpen: snapshot.anyOpen,
        openZonesCount: snapshot.openZonesCount,
        openZones: snapshot.openZones,
      });
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
      attachAU(msg, {
        kind: 'open_zones',
        event: 'open_zone',
        openZone: {
          context,
          position,
          total,
          zone: zoneSummary,
        },
      });
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

	    function stopOpenZonesCycle() {
	      if (openZonesCycleInterval) {
	        timerBag.clearInterval(openZonesCycleInterval);
	        openZonesCycleInterval = null;
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

	    function emitNextOpenZoneCycle(baseMsg) {
	      const snapshot = getOpenZonesSnapshot();
	      const openZones = snapshot.openZones || [];
	      if (openZones.length === 0) {
	        return;
	      }
	      openZonesCycleIndex += 1;
	      const selected = openZones[(openZonesCycleIndex - 1) % openZones.length];
	      const msg = buildOpenZoneMessage(
	        'cycle',
	        selected,
	        ((openZonesCycleIndex - 1) % openZones.length) + 1,
	        openZones.length,
	        baseMsg
	      );
	      sendSingleOutput(OUTPUT_OPEN_ZONES_CYCLE, msg);
	    }

	    function startOpenZonesCycle(baseMsg) {
	      stopOpenZonesCycle();
	      if (!emitOpenZonesCycle || openZonesCycleIntervalMs <= 0) {
	        return;
	      }
	      openZonesCycleIndex = 0;
	      emitNextOpenZoneCycle(baseMsg);
	      openZonesCycleInterval = timerBag.setInterval(() => {
	        emitNextOpenZoneCycle(null);
	      }, openZonesCycleIntervalMs);
	    }

	    function emitOpenZonesOnRequest(baseMsg) {
	      stopOpenZonesRequestListing();

      const snapshot = getOpenZonesSnapshot();
      if (snapshot.openZones.length === 0) {
        const msg = baseMsg ? REDUtil.cloneMessage(baseMsg) : {};
        msg.topic = `${controlTopic}/openZones`;
        msg.event = 'open_zones';
        msg.payload = { total: 0, zones: [] };
        attachAU(msg, {
          kind: 'open_zones',
          event: 'open_zones',
          total: 0,
          zones: [],
        });
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
      attachAU(msg, {
        kind: 'siren',
        event: msg.event,
        reason,
        siren: { active: Boolean(active) },
      });
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
      const auUpdate = {
        kind: 'event',
        event,
        mode: state.mode,
        details: details || {},
      };
      if (details && typeof details.reason === 'string' && details.reason) auUpdate.reason = details.reason;
      if (details && details.zone) auUpdate.zone = details.zone;
      if (details && typeof details.open === 'boolean') auUpdate.open = details.open;
      if (details && typeof details.bypassed === 'boolean') auUpdate.bypassed = details.bypassed;
      if (details && details.state) auUpdate.state = details.state;
      if (typeof msg.homekitTargetState === 'number' && Number.isFinite(msg.homekitTargetState)) {
        auUpdate.homekitTargetState = msg.homekitTargetState;
      }
      attachAU(msg, auUpdate);
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
      attachAU(msg, {
        kind: 'siren',
        event: msg.event,
        reason,
        siren: { active: Boolean(active) },
      });
      return msg;
    }

    function triggerAlarm(kind, zone, baseMsg, silent) {
      if (state.alarmActive) {
        return;
      }
      stopOpenZonesDuringArming();
      stopOpenZonesRequestListing();
      state.alarmActive = true;
      state.alarmZone = zone ? zone.key : null;
      state.silentAlarmActive = Boolean(silent);
      clearExitTimer();
      clearEntryTimer();
      state.arming = null;
      state.entry = null;
      startStatusInterval();

      const eventMsg = buildEventMessage(
        'alarm',
        {
          kind,
          zone: zone ? buildZoneSummary(zone) : null,
          silent: Boolean(silent),
        },
        baseMsg,
      );

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
        zone: zone ? buildZoneSummary(zone) : null,
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
      return true;
    }

    function violatedZonesForArm() {
      const violations = [];
      for (const zone of zones) {
        if (!zone || zone.alwaysActive) {
          continue;
        }
        if (state.bypass[zone.key] === true) {
          continue;
        }
        const zoneState = state.zoneState[zone.key];
        if (
          (zoneState && zoneState.active === true) ||
          (zone.supervisionEnabled === true && zone.supervisionBlockArm !== false && zoneState && zoneState.supervisionLost === true)
        ) {
          violations.push({
            name: zone.name,
            type: zone.type,
            topic: zone.topic || null,
            open: zoneState && zoneState.active === true,
            supervisionLost: zoneState && zoneState.supervisionLost === true,
          });
        }
      }
      return violations;
    }

    function clearSupervisionTimer(zoneKey) {
      const existing = supervisionTimers.get(zoneKey);
      if (existing) {
        timerBag.clearTimeout(existing);
      }
      supervisionTimers.delete(zoneKey);
    }

    function scheduleSupervisionTimer(zone) {
      if (!zone || zone.supervisionEnabled !== true) {
        return;
      }
      const timeoutMs = Number(zone.supervisionTimeoutMs) || 0;
      if (timeoutMs <= 0) {
        return;
      }

      const zoneKey = zone.key;
      clearSupervisionTimer(zoneKey);

      const handle = timerBag.setTimeout(() => {
        supervisionTimers.delete(zoneKey);
        const meta = state.zoneState && state.zoneState[zoneKey];
        if (!meta) return;
        const lastSeenAt = Number(meta.lastSeenAt) || 0;
        if (!lastSeenAt) return;
        if (meta.supervisionLost === true) return;

        const elapsed = now() - lastSeenAt;
        if (elapsed < timeoutMs) {
          scheduleSupervisionTimer(zone);
          return;
        }

        meta.supervisionLost = true;
        meta.supervisionLostAt = now();
        state.zoneState[zoneKey] = meta;
        scheduleFileCacheWrite();
        emitEvent(
          'supervision_lost',
          {
            zone: buildZoneSummary(zone),
            timeoutSeconds: timeoutMs / 1000,
            lastSeenAt,
          },
          { topic: controlTopic, _alarmUltimateSupervision: { zoneTopic: zoneKey } }
        );
      }, timeoutMs);

      supervisionTimers.set(zoneKey, handle);
    }

    function bootstrapSupervision() {
      const ts = now();
      for (const zone of zones) {
        if (!zone || zone.supervisionEnabled !== true) continue;
        const timeoutMs = Number(zone.supervisionTimeoutMs) || 0;
        if (timeoutMs <= 0) continue;
        const zoneKey = zone.key;
        if (!zoneKey) continue;
        const meta = state.zoneState && state.zoneState[zoneKey] ? state.zoneState[zoneKey] : null;
        const next =
          meta && typeof meta === 'object'
            ? { ...meta }
            : {
                active: false,
                lastChangeAt: 0,
                lastTriggerAt: 0,
                lastSeenAt: 0,
                supervisionLost: false,
                supervisionLostAt: 0,
              };

        // Start supervision immediately: if no valid sensor updates arrive, it will go missing after timeout.
        if (!Number(next.lastSeenAt)) {
          next.lastSeenAt = ts;
        }
        state.zoneState[zoneKey] = next;
        if (next.supervisionLost !== true) {
          scheduleSupervisionTimer(zone);
        }
      }
    }

    function arm(baseMsg, reason) {
      if (state.mode === 'armed' && !state.arming) {
        emitEvent('already_armed', { target: 'armed' }, baseMsg);
        return true;
      }

      const violations = blockArmOnViolations ? violatedZonesForArm() : [];
      if (blockArmOnViolations && violations.length > 0) {
        emitEvent('arm_blocked', { target: 'armed', violations }, baseMsg);
        return false;
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
        return true;
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
      return true;
    }

    function isSyncedControlMessage(msg) {
      return Boolean(msg && typeof msg === 'object' && msg._alarmUltimateSync);
    }

    function normalizeSyncAction(value) {
      const v = String(value || '').toLowerCase().trim();
      if (v === 'arm') return 'arm';
      if (v === 'disarm') return 'disarm';
      return 'leave';
    }

    function syncOtherAlarms(trigger, baseMsg) {
      if (!syncTargetsConfig || typeof syncTargetsConfig !== 'object') {
        return;
      }
      if (isSyncedControlMessage(baseMsg)) {
        return;
      }
      const when = trigger === 'disarm' ? 'onDisarm' : 'onArm';
      const entries = Object.entries(syncTargetsConfig);
      if (!entries.length) {
        return;
      }
      for (const [targetId, rule] of entries) {
        if (!targetId || targetId === node.id) continue;
        const action = normalizeSyncAction(rule && typeof rule === 'object' ? rule[when] : '');
        if (action === 'leave') continue;
        const api = alarmInstances.get(targetId);
        if (!api || typeof api.command !== 'function') continue;

        const payload = {
          command: action,
          _alarmUltimateSync: {
            origin: node.id,
            trigger,
          },
        };
        if (typeof baseMsg.code === 'string') payload.code = baseMsg.code;
        if (typeof baseMsg.pin === 'string') payload.pin = baseMsg.pin;

        try {
          api.command(payload);
        } catch (_err) {
          // ignore
        }
      }
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
      state.entry = { zoneTopic: zone.key, until };
      emitEvent('entry_delay', { zone: buildZoneSummary(zone), seconds: remainingSeconds(until) }, baseMsg);
      startStatusInterval();
      clearEntryTimer();
      entryTimer = timerBag.setTimeout(() => {
        if (!state.entry || state.entry.zoneTopic !== zone.key) {
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

    function setBypass(zoneRef, enabled, baseMsg) {
      const ref = String(zoneRef || '').trim();
      if (!ref) {
        emitEvent('error', { error: 'missing_zone' }, baseMsg);
        return;
      }
      const zone = zones.find((z) => z && z.key === ref) || null;
      if (!zone) {
        emitEvent('error', { error: 'unknown_zone', zone: ref }, baseMsg);
        return;
      }
      if (enabled && zone.bypassable === false) {
        emitEvent('error', { error: 'zone_not_bypassable', zone: ref }, baseMsg);
        return;
      }
      state.bypass[zone.key] = Boolean(enabled);
      persist();
      emitEvent(enabled ? 'bypassed' : 'unbypassed', { zone: buildZoneSummary(zone) }, baseMsg);
    }

	    function handleControlMessage(msg) {
	      const command = typeof msg.command === 'string' ? msg.command.toLowerCase().trim() : '';
	      if (msg.reset === true || command === 'reset') {
	        stopOpenZonesDuringArming();
	        stopOpenZonesRequestListing();
	        openZonesCycleIndex = 0;
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
        setBypass(msg.zoneTopic || msg.zone, true, msg);
        return true;
      }
      if (command === 'unbypass' || msg.unbypass === true) {
        setBypass(msg.zoneTopic || msg.zone, false, msg);
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
          syncOtherAlarms('disarm', msg);
          return true;
        }
        disarm(msg, 'manual', false);
        syncOtherAlarms('disarm', msg);
        return true;
      }

      const requestedMode =
        normalizeMode(msg.arm) ||
        normalizeMode(msg.mode) ||
        (command === 'arm' ? 'armed' : null);

      if (requestedMode && requestedMode !== 'disarmed') {
        const validation = validateCode(msg, 'arm');
        if (!validation.ok) {
          emitEvent('denied', { action: 'arm', target: 'armed' }, msg);
          return true;
        }
        if (validation.duress) {
          triggerAlarm('duress', null, msg, true);
        }
        const accepted = arm(msg, 'manual');
        if (accepted) {
          syncOtherAlarms('arm', msg);
        }
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

      const ts = now();
      const zoneMeta = state.zoneState[zone.key] || {
        active: false,
        lastChangeAt: 0,
        lastTriggerAt: 0,
        lastSeenAt: 0,
        supervisionLost: false,
        supervisionLostAt: 0,
      };
      const changed = zoneMeta.active !== value;
      zoneMeta.active = value;
      zoneMeta.lastChangeAt = ts;
      zoneMeta.lastSeenAt = ts;
      state.zoneState[zone.key] = zoneMeta;

      if (zone.supervisionEnabled === true && (Number(zone.supervisionTimeoutMs) || 0) > 0) {
        if (zoneMeta.supervisionLost === true) {
          zoneMeta.supervisionLost = false;
          zoneMeta.supervisionLostAt = 0;
          state.zoneState[zone.key] = zoneMeta;
          scheduleFileCacheWrite();
          emitEvent(
            'supervision_restored',
            {
              zone: buildZoneSummary(zone),
              timeoutSeconds: Number(zone.supervisionTimeoutMs || 0) / 1000,
              lastSeenAt: zoneMeta.lastSeenAt || 0,
            },
            msg
          );
        }
        scheduleSupervisionTimer(zone);
      }

      if (changed) {
        emitEvent(
          value === true ? 'zone_open' : 'zone_close',
          {
            zone: buildZoneSummary(zone),
            open: value === true,
            bypassed: state.bypass[zone.key] === true,
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
            bypassed: state.bypass[zone.key] === true,
            ts: zoneMeta.lastChangeAt,
          });
        } catch (_err) {
          // ignore
        }
      }

      if (value !== true) {
        return;
      }

      if (state.bypass[zone.key] === true && zone.bypassable !== false) {
        emitEvent('zone_bypassed_trigger', { zone: buildZoneSummary(zone) }, msg);
        return;
      }

      const cooldownMs = Number(zone.cooldownMs) || 0;
      if (cooldownMs > 0 && zoneMeta.lastTriggerAt && now() - zoneMeta.lastTriggerAt < cooldownMs) {
        return;
      }
      zoneMeta.lastTriggerAt = now();
      state.zoneState[zone.key] = zoneMeta;
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
	    startOpenZonesCycle();
	    bootstrapSupervision();

    const api = {
      id: node.id,
      name: node.name || '',
      controlTopic,
      getState: getUiState,
      getLog: getLogSnapshot,
      receive(msg) {
        node.receive(msg);
      },
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
        if (payload._alarmUltimateSync && typeof payload._alarmUltimateSync === 'object') {
          msg._alarmUltimateSync = payload._alarmUltimateSync;
        }

        node.receive(msg);
      },
    };

	    alarmInstances.set(node.id, api);
	    node.on('close', () => {
	      stopOpenZonesCycle();
	      flushFileCache();
	      alarmInstances.delete(node.id);
	    });
	  }

  RED.nodes.registerType('AlarmSystemUltimate', AlarmSystemUltimate);
};
