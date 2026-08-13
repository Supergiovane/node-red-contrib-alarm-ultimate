# Changelog

> Stable release track from `0.3.0`.
> Previous pre-release history is preserved below.

## [2.1.5] - 2026-08-13

### Changed

- Removed the **WEB PAGE / Panel** button from the Alarm Siren editor.

## [2.1.4] - 2026-08-13

### Fixed

- **Alarm State disappeared when dropped on the flow:** the editor definition now exposes numeric
  input/output counts and updates them safely when switching between Input and Output mode.
- **Alarm Zone did not list Alarm System nodes:** Alarm Zone, Alarm State and Alarm Siren now read
  Alarm System nodes directly from the editor model, including nodes that have not been deployed yet.
  Alarm Zone also reads zones from the flow configuration before falling back to the runtime API.

### Changed

- Removed the **WEB PAGE / Panel** button from the Alarm Zone and Alarm State editors.

## [2.1.3] - 2026-08-11

### Fixed

- **Home Assistant Ingress web tools returned 404:** Alarm Panel, zone manager, editor API requests
  and Dashboard 2 examples now preserve the session-specific Ingress path instead of using
  Node-RED's internal `httpAdminRoot` as a browser URL.

## [2.1.2] - 2026-07-10

### Changed

- **Docs:** redesigned the logo and added the new Max Supervibe README banner.

## [2.1.1] - 2026-07-02

### Added

- **Supervised zones report "Unavailable" in Home Assistant:** zones with sensor supervision enabled get a per-zone availability topic (`<base>/<name>/zone/<zone>/availability`, retained). When supervision reports the sensor missing the zone entity becomes Unavailable in HA, and turns available again on the next valid sensor update. Discovery references connection, panel and zone availability with `availability_mode: all`.

## [2.1.0] - 2026-07-02

### Added

- **Shared MQTT broker configuration node (`AlarmUltimateMqtt-config`):** broker URL, credentials, base topic and discovery prefix now live in a config node selected in the Alarm System node's **MQTT / HA** tab. All Alarm System nodes referencing the same broker configuration share a **single MQTT connection** (reference-counted: opened by the first panel, closed by the last), instead of each node opening its own.

### Changed

- **Availability topics:** the shared connection tracks its own availability on `<base>/_bridge/availability` (retained, Last Will); each panel keeps its `<base>/<name>/availability` topic. Home Assistant discovery now references both (`availability_mode: all`), so entities go unavailable when either the whole connection drops or a single panel is removed.
- **Migration / backward compatibility:** flows saved with broker settings on the Alarm node itself keep working unchanged (private connection per node, as before) and log a deprecation warning; the **MQTT / HA** tab shows a migration hint listing the stored legacy values (URL, base topic, discovery prefix, username and password) ready to be copied into the broker configuration. Selecting a broker configuration takes precedence over the legacy per-node settings.

## [2.0.0] - 2026-06-30

### Changed

- **MQTT topics & Home Assistant ids now use the node name** (slugified) instead of the internal node id, e.g. `alarm-ultimate/casa/state` and `homeassistant/alarm_control_panel/casa/config`. Falls back to the node id when the node has no name. Give each Alarm node a unique name.
- **Zones page redesigned (beginner-first):** the zone list is now the main focus with a primary **Add zone** button; the bulk importer is a clearly-labelled secondary section with its advanced ETS/Home Assistant filters tucked under a collapsible **Advanced filters**. Added an **Import zones wizard** shortcut button and removed the redundant sort bar (sorting is available by clicking column headers).
- **Editor defaults:** **HA discovery** and **Publish zones** show as enabled by default, including for alarm nodes saved before these options existed.

### Fixed

- **Alarm did not reappear in Home Assistant after an HA restart / MQTT integration re-add:** the bridge now listens for the Home Assistant birth message (`homeassistant/status` = `online`) and re-announces the panel, all zones and the current state.

### Docs

- **Simplified, end-user-focused README** (removed developer-only reference sections); added a compatibility section with the MQTT and Home Assistant logos (bundled in `resources/`). Node help updated accordingly.

## [1.2.0] - 2026-06-30

### Added

- **Expose zones to Home Assistant:** new **Publish zones** option in the **MQTT / HA** tab (on by default). With MQTT + discovery enabled, each alarm zone is auto-registered as a Home Assistant `binary_sensor` (`<prefix>/binary_sensor/<nodeId>_<zone>/config`), grouped under the same device as the alarm panel. Zone state is published (retained) to `<base>/<nodeId>/zone/<zone>/state` as `open`/`closed`, with a `device_class` mapped from the zone type (perimeter→opening, motion→motion, fire→smoke, tamper→tamper, 24h→safety).

## [1.1.4] - 2026-06-30

### Fixed

- **Slow stop/deploy when MQTT is enabled:** closing the MQTT bridge waited on the broker. The retained "offline" publish (QoS 0) stayed queued and `client.end()` waited to flush it, so stopping Node-RED or deploying hung for several seconds (until the runtime close timeout) whenever the broker was slow or unreachable. The bridge now force-closes the connection, only attempts the graceful "offline" notice while connected, and caps the whole shutdown at ~700 ms (typically a few ms).

## [1.1.3] - 2026-06-30

### Fixed

- **MQTT username/password were not saved:** the credentials were declared only in the editor HTML, not in the runtime `registerType`, so Node-RED never stored them and they appeared empty when reopening the node. The runtime now registers the `mqttUsername`/`mqttPassword` credentials, so they persist across edits and restarts.

## [1.1.2] - 2026-06-30

### Added

- **Home Assistant zone input adapter:** new `Home Assistant` option in **Zones → Zone input adapter**. It matches zones by Home Assistant `entity_id` and accepts either a pre-mapped message (`msg.topic` + state payload) or a raw `state_changed` event (reads `entity_id` and `new_state.state` from the payload/`data`). States like `on`/`off`, `open`/`closed`, `home`/`not_home` are converted to boolean; `unavailable`/`unknown` are ignored.

## [1.1.1] - 2026-06-30

### Fixed

- **Zones with a stray `id` field were silently dropped:** the Alarm System node logged `invalid zone config (id field is not supported)` and discarded the whole zone whenever a zone object carried an `id` (very common in imported/exported configs). It now ignores the extra `id` and keeps the zone (`topic` remains the identifier). `topicPattern` is likewise ignored when a usable `topic` is present. The zone JSON mapper tool now strips `id`/`topicPattern` from its exports.

## [1.1.0] - 2026-06-30

### Added

- **Native MQTT bridge (Alarm System):** new optional **MQTT / HA** tab. When enabled, the Alarm connects directly to an MQTT broker (URL + credentials), publishes its state to a retained `…/state` topic, accepts arm/disarm/trigger commands on `…/command`, and tracks availability (`…/availability`, via Last Will). No extra flow nodes required.
- **Home Assistant MQTT Discovery:** when enabled, the Alarm auto-registers as a Home Assistant `alarm_control_panel` (retained config under `<prefix>/alarm_control_panel/<nodeId>/config`), so it appears in HA with no YAML or template panel. States: `disarmed`, `arming`, `pending`, `triggered`, `armed_away`, `armed_home`.
- **Home Assistant adapter (Alarm State):** new `Home Assistant` option in the **Adapter** dropdown. In **Input** mode it converts HA commands (`ARM_AWAY`/`ARM_HOME`/`ARM_NIGHT`/`DISARM`/`TRIGGER`, optional `code`) into alarm commands; in **Output** mode it emits the matching HA `alarm_control_panel` state string.

### Changed

- **Node status:** the Alarm System node status now appends a compact open/bypass summary (e.g. `ARMED • 2 open • 1 bypass`) for at-a-glance zone activity.

## [1.0.4] - 2026-06-30

### Added

- **MQTT example flow:** new `examples/alarm-ultimate-mqtt.json` showing how to wire `AlarmSystemUltimate` to an MQTT broker using Node-RED's standard `mqtt in` / `mqtt out` nodes (zone sensors, control commands, and state/event/siren outputs). Documented in `examples/README.md`.

## [1.0.3] - 2026-05-31

### Added

- **Log retention (days):** new Alarm System option to automatically drop log entries older than the configured number of days. Defaults to `365` (also for nodes saved before this option existed); `0` keeps the log forever. Pruning runs when new events are logged and on restart.
- **Clear log:** new **Clear log** button in the Control Panel web page (next to **Download JSON**) and matching `clearlog` control command (`msg.command = "clearlog"` / `msg.clearLog = true`) to empty the event log without touching state, bypass list or timers.

### Changed

- **Settings:** renamed the **Event log size** option to **Max log entries** (internal property `maxLogEntries` unchanged).

## [1.0.2] - 2026-04-08

### Fixed

- **Tools + adminAuth (OAuth):** fixed `401/Unauthorized` when opening tools pages from the editor with protected Node-RED admin access.
- **OAuth token handling:** tools now support `access_token` propagation from editor links and keep the token while navigating between tool pages.
- **Bearer parsing conflict:** fixed `400 Bad Request` when both query `access_token` and `Authorization` header were present by normalizing auth before permission checks.
- **Control Panel auth fallback:** improved token lookup to support Node-RED token storage keys with `httpAdminRoot` suffix.

## [1.0.1] - 2026-04-07

### Changed

- **Tools UI (Vue shell):** aligned all pages in `tools/` to the KNX AI visual style (layout, colors, typography, shared CSS shell).
- **Navigation:** renamed sections to **Control Panel**, **Zones**, and **Settings** with SVG icons and improved selected-menu highlighting.
- **Zones page:** reorganized import flow by moving the full **Import Wizard** into its own dedicated box (now positioned above the zones list).
- **Settings page:** moved JSON import/export actions from Zones to Settings and renamed actions to **Export Zones** / **Import Zones**.
- **Control Panel page:** removed redundant helper texts in the Node box and improved node-selection button readability.
- **Zones supervision timeout:** default timeout is now `120` seconds and empty timeout fields no longer trigger validation errors.
- **Packaging:** added `prepublishOnly` hook to automatically run `build:vue-tools` before publishing.

## [0.3.0] - 2026-02-18

### Release

- First stable release of `node-red-contrib-alarm-ultimate` (from `0.3.0-pre-release.7`).

### Fixed

- **Security (Zones JSON Mapper):** fixed XSS risk in the target-alarm context rendering by removing unsafe `innerHTML` usage for the node name.
- **Output-only nodes:** initial retry intervals now stop automatically once the first valid state is received (`AlarmUltimateState`, `AlarmUltimateZone`, `AlarmUltimateSiren`).

### Changed

- **Packaging:** added explicit npm publish allowlist (`package.json` `files`) to avoid accidental inclusion of unwanted files.

## [0.3.0-pre-release.7] - 2026-02-08

### Breaking (pre-release)

- **Alarm outputs (Open zones):** removed **Open zones (on request)** output + `list_open_zones` / request-topic behavior. Open zones listing while arming and cyclic listing are now always-on outputs (configurable intervals). Total outputs: **9**.
- **Alarm Zone / Alarm State (outputs):** `msg.payload` is now always a boolean (`true|false`). All extra fields are emitted as root properties on `msg`.

### Fixed

- **Editor (Alarm Zone):** Zone field no longer stays red after selecting **All zones** (async validation refresh).

### Changed

- **Alarm System:** output label renamed to **Any zone open (bool)** and help now documents each output pin.
- **Examples/Docs/Tests:** updated for new pins and helper node payload shape.

## [0.3.0-pre-release.6] - 2026-02-07

### Breaking (pre-release)

- **Alarm Zone:** `AlarmUltimateZone` is now output-only (removed Input mode and all adapters).
- **Alarm System:** moved zone input adapters into the Alarm node (**Zones → Zone input adapter** + **AX Pro match**).

### Fixed

- **Editor (Alarm System):** Siren / Open zones / Advanced tabs were empty due to invalid HTML nesting in the edit dialog.

### Changed

- **Tests:** expanded unit test coverage for core Alarm behaviors (arming violations, topic prefix matching, code denial, persistence fallback).

## [0.3.0-pre-release.5] - 2026-02-07

### Breaking (pre-release)

- **Alarm System:** removed `blockArmOnViolations`. Arming is now always blocked by violations (open zones, or supervised zones that are **MISSING** when `supervision.blockArm: true`).

### Added

- **Alarm System:** new option `Wait zones closed before exit delay`. When you arm with one or more open zones, the node enters **Arming** but waits for all zones to close before starting the exit delay countdown.

### Changed

- **Persistence:** armed/disarmed state, bypass list, event log, and zone state now persist across Node-RED restart/deploy even when the context store is not persistent (file cache fallback; requires **Persist state**).
- **Tools:** moved **Export JSON** / **Import JSON** from the node edit dialog to `/alarm-ultimate/alarm-json-mapper`.
- **Tools / Runtime:** `supervision.blockArm` now treats false-like values (e.g. `"false"`, `0`) as `false`.

## [0.3.0-pre-release.4] - 2026-02-06

### Changed

- **Tools (Zones JSON Mapper):** improved table readability (bigger header font, colored header background, zebra rows).
- **UI:** `AlarmUltimateZone` now allows selecting the **Ax Pro** adapter also in **Output** mode.
- **Docs:** refreshed node help and README for coherence (HomeKit input notes, Ax Pro mapping notes, "click Done" reminder).

## [0.3.0-pre-release.3] - 2026-02-06

### Changed

- **Tools (Zones JSON Mapper):** "Block arm" is now independent from "Supervision" (they are distinct settings).
- **Tools (Zones JSON Mapper):** import wizard now skips zones whose Topic already exists in the current zone list.
- **Tools (Zones JSON Mapper):** added bulk controls to apply **Kind**, **Supervision**, and **Block arm** to all zones.
- **Tools (Zones JSON Mapper):** zone list can now be sorted (Topic/Name/Kind/Supervision + advanced fields).
- **Tools (Zones JSON Mapper):** Step 1 input is now persisted (browser localStorage) so pasted data is kept.
- **Tools (Zones JSON Mapper):** improved visibility of the "click Done in Node-RED editor to apply" reminder.
- **UI:** clarified AX Pro matching help text in `AlarmUltimateZone`.

## [0.3.0-pre-release.2] - 2026-02-04

### Changed

- **Examples:** updated bypass/unbypass injects to use `msg.zoneTopic` (topic-only zones).
- **Examples docs:** removed `id` from zone snippets and aligned zones snippets to JSON array format.
- **Tools:** Zones JSON Mapper now accepts **JSON array only** (aligned with `AlarmSystemUltimate.zones`).
- **UI:** refined AX Pro “match” option labels in `AlarmUltimateZone`.

## [0.3.0-pre-release.1] - 2026-02-04

### Breaking (pre-release)

- **Zones identifier:** removed the `id`/`zoneId` field from zones. Zones are identified only by `topic`.
- **Zones format:** `AlarmSystemUltimate.zones` now accepts **JSON array only** (no single-object, no JSON-per-line).
- **Bypass command:** bypass/unbypass now accepts only `msg.zoneTopic` (no `msg.zone` alias).
- **Codes:** removed `msg.pin` support (use `msg.code` only). Sync forwarding no longer forwards `pin`.
- **Commands API:** `/alarm-ultimate/alarm/:id/command` now accepts only `payload.command` (no `payload.action`) and `payload.zoneTopic` (no `payload.zone`).
- **Topic matching:** removed regex matching (`topicPattern`). Only exact topics or `topic*` prefix matching are supported.
- **Alarm Zone adapters:** removed **Homekit** adapter option from `AlarmUltimateZone` (both Input and Output).

### Added / Changed

- **Alarm Zone (Input + AX Pro):** added `AX Pro match` options (exact/starts/contains/ends) to match `payload.zoneUpdate.name` and inject zone updates correctly.
- **Alarm Zone (AX Pro):** aligned parsing/formatting with `node-red-contrib-hikvision-ultimate` payloads (`zoneUpdate.status` support; output adds `status` field).
- **Alarm State (Input + AX Pro):** added support for AX Pro `CIDEvent.code` to inject arm/disarm (`3401` Away, `3441` Stay, `1401` Disarmed).
- **Tools:** Alarm JSON Mapper and Alarm Panel updated to reflect topic-only zones and the simplified zones format.

## [0.3.0-pre-release.0] - 2026-02-04

### Breaking (pre-release)

- **Removed adapter nodes:** `AlarmUltimateInputAdapter` and `AlarmUltimateOutputAdapter` have been removed.
- **Alarm State / Alarm Zone I/O mode:** `AlarmUltimateState` and `AlarmUltimateZone` can now be configured as **Input** (flow → selected alarm) or **Output** (selected alarm → flow).
- **Embedded adapters:** adapters are now selected directly on each node (no separate nodes).
  - `AlarmUltimateState`: **Default**, **Homekit**, **Ax Pro (Hikvision Ultimate)**, **KNX-Ultimate**
  - `AlarmUltimateZone`: **Default**, **KNX-Ultimate** (AX Pro is Input-only; Homekit removed)
- **Alarm Zone: All zones:** `AlarmUltimateZone` can now emit events for **All zones** (not only one zone).

### Migration notes

- Replace any `AlarmUltimateInputAdapter` nodes with:
  - `AlarmUltimateZone` → **Mode: Input**, **Zone: All zones**, pick an **Adapter**, wire your devices into it.
- Replace any `AlarmUltimateOutputAdapter` nodes with:
  - `AlarmUltimateState` / `AlarmUltimateZone` → **Mode: Output**, pick an **Adapter**, wire their output to your integrations.

## [0.2.0-pre-release.0] - 2026-02-03

### Breaking (pre-release)

- **Canonical envelope:** all nodes now emit `msg.alarmUltimate` (versioned) as the stable, canonical representation of alarm messages.
- **Output-only helper nodes:** `Alarm State`, `Alarm Zone`, `Alarm Siren` now emit the same “default telegrams” as `AlarmSystemUltimate`:
  - events on `.../event` (`msg.event`, `msg.payload = { event, mode, ... }`)
  - siren on `.../siren` (`msg.event = siren_on|siren_off`, `msg.payload = boolean`)
- **Output Adapter:** preset-based dropdown (removed the old “mode” selector). Added preset **Homekit Alarm** (replaces the former *Homekit Alarm Status*) which handles both alarm state and siren outputs.
- **Output Adapter presets:** added reverse (Alarm → flow) presets to format outputs for downstream systems (KNX/HA/Boolean/AX Pro). Presets are resilient: unknown inputs are passed through (not dropped).
- **Input Adapter:** now adds `msg.alarmUltimate` (kind `command`) to its output messages.

### Docs

- Updated README and node help to reflect the new canonical envelope and output formats.

## [0.1.18] - 2026-02-02

### What's new

- **Alarm node editor:** added **Export JSON** / **Import JSON** buttons in the Zones tab to backup/restore zone definitions from a file.

## [0.1.17] - 2026-02-02

### Breaking (pre-release)

- **Output Adapter (Homekit Alarm Status):** on `arming` the node keeps `SecuritySystemCurrentState` at the previous value (while updating `SecuritySystemTargetState`). If you relied on both being the same during arming, update your downstream flows.

### Docs

- Updated node editor help + README to be more beginner-friendly (quick-start sections and clearer explanations).

## [0.1.16] - 2026-02-02

### Fix

- **Output Adapter (HomeKit):** during `arming`, `SecuritySystemCurrentState` now remains the previous state while `SecuritySystemTargetState` changes (better HomeKit semantics).

## [0.1.15] - 2026-02-02

### What's new

- **Input Adapter:** added **Alarm node** selector + **Panel** button, and (when selected) auto-injects `msg.controlTopic` for presets like HomeKit.

## [0.1.14] - 2026-02-02

### What's new

- **Alarm node:** added **Cycle open zones (always)** with a configurable interval (emits `open_zone` with `payload.context = "cycle"`).
- **Alarm node editor:** reorganized settings into tabs for improved usability.
- **Output Adapter:** added built-in stream preset **Open Zones (Cycle)**.

## [0.1.13] - 2026-02-02

### Fix

- **Output Adapter:** fixed duplicate messages (Alarm internal bus now emits each message only once).

## [0.1.12] - 2026-02-02

### Fix

- **Output Adapter:** shows received message count in status and can listen to any Alarm node if none is selected (helps debugging).

## [Unreleased]

### Breaking (pre-release)

- TBD.

## [0.1.11] - 2026-02-02

### Maintenance

- **Output Adapter:** removed the separate **Source** field; the former source options are now available as built-in presets (`Stream: ...`).

## [0.1.10] - 2026-02-02

### What's new

- **Output Adapter:** now output-only (no input pin). It subscribes to a selected Alarm node and can filter by former “Alarm outputs” (siren, zone activity, errors, open-zones, ...).

## [0.1.9] - 2026-02-02

### Breaking (pre-release)

- **Alarm node:** removed classic multi-output mode; `AlarmSystemUltimate` now has a single output only.

## [0.1.8] - 2026-02-02

### What's new

- **New node:** `AlarmUltimateOutputAdapter` (preset-based transformer for Alarm outputs, e.g. HomeKit/MQTT).
- **Alarm node:** now has a **single output** (siren/open-zones/anyZoneOpen messages are emitted on the same output).

## [0.1.7] - 2026-02-02

### What's new

- **Input Adapter:** added built-in preset for HomeKit Security System state messages (arm/disarm mapping).
- **Input Adapter:** HomeKit preset outputs `arm_home` / `arm_away` / `arm_night` / `disarm` to preserve arming semantics.

## [0.1.6] - 2026-02-01

### Maintenance

- Version bump / release publish.

## [0.1.5] - 2026-01-31

### What's new

- **Optional per-zone sensor supervision:** a zone can be marked as “missing” if no updates are received within a configured time.
- **New events:** `supervision_lost` (zone not seen anymore) and `supervision_restored` (zone seen again).
- **Alarm Panel:** in the Zones table, the State column now also shows `… • MISSING` when a supervised zone is missing.
- **Zones JSON Mapper:** added per-zone supervision controls in the UI.

### How to use (quick)

In the zone definition, add for example:

```json
{
  "topic": "sensor/frontdoor",
  "supervision": { "enabled": true, "timeoutSeconds": 120, "blockArm": true }
}
```

- Supervision starts **immediately** when the node is running.
- If no “valid” updates arrive within `timeoutSeconds`, the zone becomes **MISSING**.
- With `blockArm: true`, arming is blocked if a zone is **MISSING**.
