<p align="center">
  <img src="docs/images/banner.png" alt="Alarm Ultimate for Node-RED" width="300">
</p>

[![NPM version][npm-version-image]][npm-url]
[![NPM downloads][npm-downloads-image]][npm-url]
[![Node-RED Flows][flows-image]][flows-url]
[![License][license-image]][license-url]
[![GitHub issues][issues-image]][issues-url]
[![Status: beta][beta-image]][repo-url]

# node-red-contrib-alarm-ultimate

Alarm System Ultimate nodes + web panel for Node-RED.

<p align="center">
  <a href="https://youtu.be/HUPzhVgObBE">
    <img src="https://img.youtube.com/vi/HUPzhVgObBE/hqdefault.jpg" alt="Alarm Ultimate video (YouTube)" width="640">
  </a>
  <br>
  <a href="https://youtu.be/HUPzhVgObBE">Watch the video on YouTube</a>
</p>

Includes:

- `AlarmSystemUltimate` (BETA): full alarm control panel node (zones, entry/exit delays, bypass, chime, 24h/fire/tamper, siren, event log, optional per-zone sensor supervision).
- Helper nodes: `AlarmUltimateState`, `AlarmUltimateZone`, `AlarmUltimateSiren`.
  `AlarmUltimateState` and `AlarmUltimateZone` can be configured as **Input** or **Output** nodes and include embedded adapters (Default/Homekit/Ax Pro/KNX-Ultimate).
- Web tools: Zones JSON mapper + web Alarm Panel (embeddable in Node-RED Dashboard).

Note: `AlarmSystemUltimate` is currently **BETA**.

## Table of contents

- [Install](#install)
- [Quick start](#quick-start)
- [Screenshots](#screenshots)
- [Nodes](#nodes)
- [Web tools](#web-tools)
- [Examples](#examples)
- [Permissions and endpoints](#permissions-and-endpoints)
- [Development](#development)

## Install

- Palette Manager: Menu → **Manage palette** → **Install** → search `alarm ultimate`
- NPM:

```bash
npm i node-red-contrib-alarm-ultimate
```

## Quick start

Beginner-friendly flow:

1. Add an **AlarmSystemUltimate (BETA)** node.
2. Click **Manage zones** and add at least one zone (example topic: `sensor/frontdoor`). Use **Export JSON** / **Import JSON** in the Zones tab to backup/restore your zones.
3. Send sensor messages to the Alarm node:
   - open: `msg.topic="sensor/frontdoor"`, `msg.payload=true`
   - close: `msg.topic="sensor/frontdoor"`, `msg.payload=false`
4. Arm/disarm by sending a control message to the Alarm node:
   - `msg.topic = controlTopic` (default `alarm`)
   - `msg.command = "arm"` or `msg.command = "disarm"`
5. Connect a **Debug** node to the Alarm output to see events.

Optional (recommended):

- Use `AlarmUltimateZone` in **Input** mode (Zone: **All zones**) to normalize sensor messages and inject them into the selected Alarm node.
- Use `AlarmUltimateState` in **Input** mode to normalize arm/disarm commands (e.g. HomeKit) and inject them into the selected Alarm node.
- Use `AlarmUltimateState` / `AlarmUltimateZone` in **Output** mode with an **Adapter** to format events for external systems (HomeKit / KNX / AX Pro / ...).
- For distributed flows, use Node-RED built-in `link in` / `link out` to fan-in sensors/commands and fan-out Alarm outputs (see `examples/alarm-ultimate-link-bus.json`).

## Screenshots

### Alarm Panel (web)

<p align="center">
  <img src="docs/images/alarm-panel-mock.svg" alt="Alarm Panel mock" width="900">
</p>

### Flow overview

<p align="center">
  <img src="docs/images/flow-overview.svg" alt="Typical flow overview" width="900">
</p>

## Nodes

### Alarm System Ultimate (BETA)

Main node that:

- Receives **control commands** on `msg.topic === controlTopic`
- Receives **sensor messages** on any other topic and matches them to a configured zone

It emits events and state updates on **10 outputs** (see the node help in the editor for full details). Output #1 (**All messages**) is a superset and always emits everything.

Use `AlarmUltimateState` / `AlarmUltimateZone` in **Output** mode with an **Adapter** to fan-out/massage events for your integrations.

Open zones listing features:

- **Open Zones (Arming)**: optional listing during exit delay
- **Open Zones (On Request)**: list open zones when a message arrives on `openZonesRequestTopic`
- **Open Zones (Cycle)**: optional always-on cyclic listing at a fixed interval (any alarm state)

#### Optional per-zone sensor supervision

You can enable **sensor supervision** per zone to detect devices that stop reporting.

- Supervision starts **immediately** when the node runs.
- If a zone does not receive a **valid** sensor update for `timeoutSeconds`, the node emits `supervision_lost` and the Alarm Panel shows `… • MISSING`.
- The next valid sensor update emits `supervision_restored`.
- If `blockArm: true` and **Block arm on violations** is enabled, arming is blocked while the zone is missing.

“Valid” means the message value can be converted to boolean using the Alarm node **With Input** property (default `msg.payload`), e.g. `true/false`, `open/closed`, `on/off`, `1/0`.

Example zone:

```json
{
  "id": "frontdoor",
  "name": "Front door",
  "topic": "sensor/frontdoor",
  "type": "perimeter",
  "supervision": { "enabled": true, "timeoutSeconds": 120, "blockArm": true }
}
```

### Helper nodes (I/O)

`AlarmUltimateState` and `AlarmUltimateZone` can work in two modes:

- **Output**: emit Alarm events to the flow (no wiring from the Alarm node required).
- **Input**: receive messages from the flow, apply an **Adapter**, and inject them into the selected Alarm node.

`AlarmUltimateSiren` remains output-only and emits siren telegrams.

- `Alarm State` (`AlarmUltimateState`): emits `.../event` telegrams (`msg.event`, `msg.payload = { event, mode, ... }`)
- `Alarm Zone` (`AlarmUltimateZone`): emits `zone_open` / `zone_close` as `.../event` telegrams
- `Alarm Siren` (`AlarmUltimateSiren`): emits siren telegrams (`msg.topic = <controlTopic>/siren`, `msg.event = siren_on|siren_off`, `msg.payload = true|false`)

### Canonical envelope (`msg.alarmUltimate`)

All nodes in this package add a stable, versioned object to every output message:

```js
msg.alarmUltimate = {
  v: 1,
  ts: 1700000000000,
  kind: "event|siren|open_zones|any_zone_open|command|...",
  alarm: { id, name, controlTopic },
  event: "armed|disarmed|zone_open|siren_on|...",
  mode: "armed|disarmed",
  reason: "init|timeout|manual|...",
};
```

Embedded adapters use `msg.alarmUltimate` as the canonical source, so they do not depend on user-configurable `msg.topic` / `msg.payload` formats.

## Web tools

These pages are served via the Node-RED admin HTTP endpoint:

- Zones JSON Mapper: `/alarm-ultimate/alarm-json-mapper`
- Alarm Panel: `/alarm-ultimate/alarm-panel`

The Alarm Panel supports:

- Preselect node: `/alarm-ultimate/alarm-panel?id=<alarmNodeId>`
- Embed mode (for Dashboard iframes): `/alarm-ultimate/alarm-panel?embed=1&id=<alarmNodeId>`
- Views: `view=keypad`, `view=zones`, `view=log` (e.g. `/alarm-ultimate/alarm-panel?embed=1&view=log&id=<alarmNodeId>`)

The Zones JSON Mapper supports:

- Sample message mapping (e.g. KNX Ultimate): map `topic`/`payload` fields and generate a zone template.
- ETS Group Addresses export (TSV): paste the exported table and generate zones in batch (boolean datapoints only).

## Examples

- `examples/alarm-ultimate-basic.json`: ready-to-import flow with `AlarmSystemUltimate`, injects and debug nodes.
- `examples/alarm-ultimate-dashboard.json`: Node-RED Dashboard example embedding the Alarm Panel in a `ui_template` iframe.
- `examples/alarm-ultimate-dashboard-controls.json`: Node-RED Dashboard example with the embedded panel plus command buttons (and a small sensor simulator).
- `examples/alarm-ultimate-dashboard-v2.json`: Dashboard 2.0 example for `@flowfuse/node-red-dashboard` (Alarm Panel + basic controls + status).
- `examples/alarm-ultimate-home-assistant-alarm-panel.json`: Home Assistant Add-on example (no MQTT) using the HA Alarm Panel card.

See `examples/README.md`.

## Development

Run tests:

```bash
npm test
```

## Permissions and endpoints

When Node-RED authentication is enabled, the admin endpoints use these permissions (if available):

- `AlarmSystemUltimate.read`
- `AlarmSystemUltimate.write`

HTTP admin endpoints:

- `GET /alarm-ultimate/alarm/nodes`
- `GET /alarm-ultimate/alarm/:id/state`
- `GET /alarm-ultimate/alarm/:id/log`
- `POST /alarm-ultimate/alarm/:id/command`
- `GET /alarm-ultimate/alarm-json-mapper`
- `GET /alarm-ultimate/alarm-panel`

<!-- Badges (reference-style links) -->

[repo-url]: https://github.com/Supergiovane/node-red-contrib-alarm-ultimate
[npm-url]: https://www.npmjs.com/package/node-red-contrib-alarm-ultimate
[flows-url]: https://flows.nodered.org/node/node-red-contrib-alarm-ultimate
[license-url]: LICENSE
[issues-url]: https://github.com/Supergiovane/node-red-contrib-alarm-ultimate/issues
[npm-version-image]: https://img.shields.io/npm/v/node-red-contrib-alarm-ultimate.svg
[npm-downloads-image]: https://img.shields.io/npm/dm/node-red-contrib-alarm-ultimate.svg
[flows-image]: https://img.shields.io/badge/Node--RED%20Flows-library-8f0000?logo=nodered&logoColor=white
[license-image]: https://img.shields.io/npm/l/node-red-contrib-alarm-ultimate.svg
[issues-image]: https://img.shields.io/github/issues/Supergiovane/node-red-contrib-alarm-ultimate.svg
[beta-image]: https://img.shields.io/badge/status-beta-orange.svg
