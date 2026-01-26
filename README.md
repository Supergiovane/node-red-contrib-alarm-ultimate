<p align="center">
  <img src="docs/images/banner.png" alt="Alarm Ultimate for Node-RED" width="600">
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

- `AlarmSystemUltimate` (BETA): full alarm control panel node (zones, entry/exit delays, bypass, chime, 24h/fire/tamper, siren, event log).
- `AlarmUltimateInputAdapter`: translates incoming messages into zone messages for `AlarmSystemUltimate` using built-in or user-defined presets.
- Output-only helper nodes: `AlarmUltimateState`, `AlarmUltimateZone`, `AlarmUltimateSiren`.
- Web tools: Zones JSON mapper + web Alarm Panel (embeddable in Node-RED Dashboard).

Note: `AlarmSystemUltimate` is currently **BETA**.

## Table of contents

- [Install](#install)
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

It emits events and state updates on multiple outputs (see the node help in the editor for full details).

### Output-only helper nodes

These nodes have no input and emit the current Alarm state (and changes) for one configured `AlarmSystemUltimate`:

- `Alarm State` (`AlarmUltimateState`): `msg.payload = "armed"|"disarmed"`
- `Alarm Zone` (`AlarmUltimateZone`): `msg.payload = true|false` for a selected zone
- `Alarm Siren` (`AlarmUltimateSiren`): `msg.payload = true|false` when the siren is on/off

### Input Adapter

`AlarmUltimateInputAdapter` translates incoming messages (from arbitrary sources) into the format expected by the Alarm zones.

- Built-in presets are shipped with the package.
- A single user preset (custom JavaScript) can be created/edited inside the node and is stored in the node configuration.

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
- `examples/alarm-ultimate-home-assistant-alarm-panel.json`: Home Assistant Add-on example (no MQTT) using the HA Alarm Panel card + `AlarmUltimateInputAdapter`.

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
- `AlarmUltimateInputAdapter.read`

HTTP admin endpoints:

- `GET /alarm-ultimate/alarm/nodes`
- `GET /alarm-ultimate/alarm/:id/state`
- `GET /alarm-ultimate/alarm/:id/log`
- `GET /alarm-ultimate/input-adapter/presets`
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
