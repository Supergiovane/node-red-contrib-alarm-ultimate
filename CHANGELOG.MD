# Changelog

## [0.1.18] - 2026-02-02

### What's new

- **Alarm node editor:** added **Export JSON** / **Import JSON** buttons in the Zones tab to backup/restore zone definitions from a file.

## [0.1.17] - 2026-02-02

### Breaking (BETA)

- **Output Adapter (HomeKit Security System - basic):** on `arming` the preset now keeps `SecuritySystemCurrentState` at the previous value (while updating `SecuritySystemTargetState`). If you relied on both being the same during arming, update your downstream flows.

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

- **Input Adapter:** added built-in preset for Apple HomeKit Security System state messages (arm/disarm mapping).
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
  "id": "frontdoor",
  "topic": "sensor/frontdoor",
  "supervision": { "enabled": true, "timeoutSeconds": 120, "blockArm": true }
}
```

- Supervision starts **immediately** when the node is running.
- If no “valid” updates arrive within `timeoutSeconds`, the zone becomes **MISSING**.
- With `blockArm: true` (and `blockArmOnViolations` enabled) arming is blocked if a zone is **MISSING**.
