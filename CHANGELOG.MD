# Changelog

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
