## Examples

Import the flow from `examples/alarm-ultimate-basic.json` into Node-RED:

1. Menu → **Import**
2. Paste the JSON file content
3. Deploy

This flow includes:

- 1 `AlarmSystemUltimate` node with 2 example zones
- Inject nodes for arm/disarm, bypass, sensor open/close
- Output-only nodes (`Alarm State`, `Alarm Zone`, `Alarm Siren`) connected to debug

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
