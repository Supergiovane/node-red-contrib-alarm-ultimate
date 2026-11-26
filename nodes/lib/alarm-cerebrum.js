'use strict';

// Publishes an Alarm System Ultimate panel to Cerebrum Ultimate, read-only:
// panel state, siren and zones for chat, history, JavaScript routines and MCP.
// Arming, disarming, bypass and codes are never exposed.

const { registerCerebrumIntegration } = require('./cerebrumIntegration.js');

function panelState(snapshot) {
  const state = snapshot || {};
  if (state.alarmActive) return 'triggered';
  if (state.entry && state.entry.active) return 'pending';
  if (state.arming && state.arming.active) return 'arming';
  return state.mode === 'armed' ? 'armed' : 'disarmed';
}

function zoneEntityId(alarmId, zone) {
  return `${alarmId}/zone/${zone.topic || zone.name}`;
}

// uiState: result of the panel's getUiState().
function buildAlarmCerebrumEntities(uiState) {
  const ui = uiState || {};
  const alarmId = ui.id;
  const panelName = ui.name || 'Alarm';
  const snapshot = ui.state || {};
  const entities = [
    {
      id: `${alarmId}/panel`,
      name: panelName,
      kind: 'alarm_panel',
      capability: 'alarm_state',
      state: panelState(snapshot),
      alarmZone: snapshot.alarmZone || null,
      silentAlarm: snapshot.silentAlarmActive === true,
      bypassedZones: Array.isArray(snapshot.bypassedZones) ? snapshot.bypassedZones.length : 0,
    },
    {
      id: `${alarmId}/siren`,
      name: `${panelName} siren`,
      kind: 'siren',
      capability: 'on_off',
      state: snapshot.sirenActive ? 'on' : 'off',
    },
  ];
  (Array.isArray(ui.zones) ? ui.zones : []).forEach((zone) => {
    entities.push({
      id: zoneEntityId(alarmId, zone),
      name: zone.name || zone.topic,
      kind: 'alarm_zone',
      capability: 'open_close',
      state: zone.open ? 'open' : 'closed',
      zoneType: zone.type || '',
      bypassed: zone.bypassed === true,
      supervisionLost: !!(zone.supervision && zone.supervision.lost),
    });
  });
  return entities;
}

function createAlarmCerebrumIntegration({ alarmId, getUiState, packageName = 'node-red-contrib-alarm-ultimate' }) {
  const entities = () => {
    try {
      return buildAlarmCerebrumEntities(getUiState());
    } catch (_err) {
      return [];
    }
  };
  const first = getUiState() || {};
  const integration = registerCerebrumIntegration({
    adapter: {
      id: 'alarm-ultimate',
      title: 'Alarm System Ultimate',
      packageName,
      kind: 'security',
      capabilities: ['alarm-panel', 'zones', 'siren'],
      access: 'observe',
      operations: [
        { id: 'list-entities', description: 'Alarm panels with their state (disarmed, arming, armed, pending entry delay, triggered), siren (on/off) and every zone (open/closed, bypassed, supervision lost). Read-only: the alarm cannot be armed or disarmed from here.' },
        { id: 'read-entity', description: 'Current state of one alarm panel, siren or zone by its exact id.' },
      ],
    },
    provider: {
      id: `alarm-ultimate:${alarmId}`,
      title: `Alarm ${first.name || alarmId}`,
      ownerNodeId: alarmId,
      ready: true,
      listEntities: async () => entities(),
      getEntity: async (id) => entities().find((entity) => entity.id === String(id || '')) || null,
    },
  });

  // Called after every panel event: publishes the entities whose state changed
  // (the helper drops unchanged values).
  function refresh() {
    if (!integration.hasSubscribers()) return;
    entities().forEach((entity) => {
      const details = { ...entity };
      ['id', 'name', 'area', 'kind', 'capability', 'state'].forEach((key) => delete details[key]);
      integration.emit({
        entityId: entity.id,
        state: entity.state,
        resourceName: entity.name,
        resourceType: entity.kind,
        area: entity.area,
        kind: entity.kind,
        capability: entity.capability,
        details,
      });
    });
  }

  return { refresh, entities, provider: integration.provider, dispose: integration.dispose };
}

module.exports = { buildAlarmCerebrumEntities, createAlarmCerebrumIntegration };
