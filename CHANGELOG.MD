# Changelog

> **BETA (breaking changes):** this package is currently **BETA** and changes can be **breaking** at any release.
> Backward compatibility is not guaranteed.

## [0.3.0-beta.6] - 2026-02-07

### Breaking (BETA)

- **Alarm Zone:** `AlarmUltimateZone` is now output-only (removed Input mode and all adapters).
- **Alarm System:** moved zone input adapters into the Alarm node (**Zones → Zone input adapter** + **AX Pro match**).
- **Alarm System (open zones):** removed **Open zones (on request)** output + `list_open_zones` / request-topic behavior. Open zones listing while arming and cyclic listing are now always-on outputs (configurable intervals).

### Fixed

- **Editor (Alarm System):** Siren / Open zones / Advanced tabs were empty due to invalid HTML nesting in the edit dialog.

### Changed

- **Tests:** expanded unit test coverage for core Alarm behaviors (arming violations, topic prefix matching, code denial, persistence fallback).

## [0.3.0-beta.5] - 2026-02-07

### Breaking (BETA)

- **Alarm System:** removed `blockArmOnViolations`. Arming is now always blocked by violations (open zones, or supervised zones that are **MISSING** when `supervision.blockArm: true`).

### Added

- **Alarm System:** new option `Wait zones closed before exit delay`. When you arm with one or more open zones, the node enters **Arming** but waits for all zones to close before starting the exit delay countdown.

### Changed

- **Persistence:** armed/disarmed state, bypass list, event log, and zone state now persist across Node-RED restart/deploy even when the context store is not persistent (file cache fallback; requires **Persist state**).
- **Tools:** moved **Export JSON** / **Import JSON** from the node edit dialog to `/alarm-ultimate/alarm-json-mapper`.
- **Tools / Runtime:** `supervision.blockArm` now treats false-like values (e.g. `"false"`, `0`) as `false`.

## [0.3.0-beta.4] - 2026-02-06

### Changed

- **Tools (Zones JSON Mapper):** improved table readability (bigger header font, colored header background, zebra rows).
- **UI:** `AlarmUltimateZone` now allows selecting the **Ax Pro** adapter also in **Output** mode.
- **Docs:** refreshed node help and README for coherence (HomeKit input notes, Ax Pro mapping notes, "click Done" reminder).

## [0.3.0-beta.3] - 2026-02-06

### Changed

- **Tools (Zones JSON Mapper):** "Block arm" is now independent from "Supervision" (they are distinct settings).
- **Tools (Zones JSON Mapper):** import wizard now skips zones whose Topic already exists in the current zone list.
- **Tools (Zones JSON Mapper):** added bulk controls to apply **Kind**, **Supervision**, and **Block arm** to all zones.
- **Tools (Zones JSON Mapper):** zone list can now be sorted (Topic/Name/Kind/Supervision + advanced fields).
- **Tools (Zones JSON Mapper):** Step 1 input is now persisted (browser localStorage) so pasted data is kept.
- **Tools (Zones JSON Mapper):** improved visibility of the "click Done in Node-RED editor to apply" reminder.
- **UI:** clarified AX Pro matching help text in `AlarmUltimateZone`.

## [0.3.0-beta.2] - 2026-02-04

### Changed

- **Examples:** updated bypass/unbypass injects to use `msg.zoneTopic` (topic-only zones).
- **Examples docs:** removed `id` from zone snippets and aligned zones snippets to JSON array format.
- **Tools:** Zones JSON Mapper now accepts **JSON array only** (aligned with `AlarmSystemUltimate.zones`).
- **UI:** refined AX Pro “match” option labels in `AlarmUltimateZone`.

## [0.3.0-beta.1] - 2026-02-04

### Breaking (BETA)

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

## [0.3.0-beta.0] - 2026-02-04

### Breaking (BETA)

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

## [0.2.0-beta.0] - 2026-02-03

### Breaking (BETA)

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

### Breaking (BETA)

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

### Breaking (BETA)

- TBD.

## [0.1.11] - 2026-02-02

### Maintenance

- **Output Adapter:** removed the separate **Source** field; the former source options are now available as built-in presets (`Stream: ...`).

## [0.1.10] - 2026-02-02

### What's new

- **Output Adapter:** now output-only (no input pin). It subscribes to a selected Alarm node and can filter by former “Alarm outputs” (siren, zone activity, errors, open-zones, ...).

## [0.1.9] - 2026-02-02

### Breaking (BETA)

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
