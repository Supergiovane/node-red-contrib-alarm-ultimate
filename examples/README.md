## Examples

Import the flow from `examples/alarm-ultimate-basic.json` into Node-RED:

1. Menu → **Import**
2. Paste the JSON file content
3. Deploy

This flow includes:

- 1 `AlarmSystemUltimate` node with 2 example zones
- Inject nodes for arm/disarm, bypass, sensor open/close
- Output-only nodes (`Alarm State`, `Alarm Zone`, `Alarm Siren`) connected to debug

Notes:

- The old Alarm “Translator” option has been removed. If you need to translate incoming device messages, use the `AlarmUltimateInputAdapter` node.
- Zones can be edited from the Alarm node editor via the “Manage zones” button (opens the `alarm-json-mapper` tool).

## Dashboard (node-red-dashboard)

Import `examples/alarm-ultimate-dashboard.json`.

- Requires `node-red-dashboard` installed (`ui_*` nodes).
- The widget uses an iframe pointing to `"/alarm-ultimate/alarm-panel?embed=1&id=<alarmNodeId>"`.
- If you changed `httpAdminRoot`, update the iframe URL accordingly (e.g. `"/red/alarm-ultimate/alarm-panel?...`).

### Dashboard + commands (panel + controls)

Import `examples/alarm-ultimate-dashboard-controls.json`.

- Includes the panel (iframe) + Dashboard buttons for `arm`, `disarm`, `status`, `list_open_zones`, `siren_on/off`, `panic`.
- Also includes a small “sensor simulator” (buttons that send `true/false` on `sensor/frontdoor` and `sensor/living_pir`).
- The iframe uses a *relative* URL (`alarm-ultimate/...`) so it works even when Node-RED is served under a path prefix (e.g. Home Assistant Ingress).

## Dashboard V2 (FlowFuse / @flowfuse/node-red-dashboard)

Import `examples/alarm-ultimate-dashboard-v2.json`.

- Requires `@flowfuse/node-red-dashboard` installed (`ui-*` nodes).
- Embeds the Alarm Panel via a Dashboard 2.0 `ui-template` (Vue SFC) iframe.
- Includes basic command buttons (`arm`, `disarm`, `status`), a small sensor simulator, and two status widgets (`AlarmUltimateState`, `AlarmUltimateSiren` → `ui-text`).
