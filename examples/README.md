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
- The widget uses an iframe pointing to `../alarm-ultimate/alarm-panel?embed=1&id=<alarmNodeId>` (escapes the Dashboard path like `/ui`).
- The embedded panel supports `view=keypad`, `view=zones`, and `view=log`.

### Dashboard + commands (panel + controls)

Import `examples/alarm-ultimate-dashboard-controls.json`.

- Includes the panel (iframe) + Dashboard buttons for `arm`, `disarm`, `status`, `list_open_zones`, `siren_on/off`, `panic`.
- Also includes a small “sensor simulator” (buttons that send `true/false` on `sensor/frontdoor` and `sensor/living_pir`).
- The iframe uses a _relative_ URL that escapes the Dashboard path (`../alarm-ultimate/...`) so it works even when Node-RED is served under a path prefix (e.g. Home Assistant Ingress).
- The embedded panel supports `view=keypad`, `view=zones`, and `view=log` (useful to show a user-facing event log).

## Dashboard V2 (FlowFuse / @flowfuse/node-red-dashboard)

Import `examples/alarm-ultimate-dashboard-v2.json`.

- Requires `@flowfuse/node-red-dashboard` installed (`ui-*` nodes).
- Embeds the Alarm Panel via a Dashboard 2.0 `ui-template` (Vue SFC) iframe.
- Includes basic command buttons (`arm`, `disarm`, `status`), a small sensor simulator, and two status widgets (`AlarmUltimateState`, `AlarmUltimateSiren` → `ui-text`).

## Home Assistant (Alarm Panel card, no MQTT)

If you run Node-RED as the Home Assistant Add-on and you want to use the standard Home Assistant Alarm Panel card, import:

- `examples/alarm-ultimate-home-assistant-alarm-panel.json`

This example:

- Maps `binary_sensor.*` state changes (`"on"/"off"`) into Alarm zones using `AlarmUltimateInputAdapter` (built-in preset: **Home Assistant on/off**).
- Receives arm/disarm commands from a Home Assistant Template Alarm Control Panel via the `alarm_ultimate_command` event.
- Mirrors Alarm events back into Home Assistant by updating `input_select.alarm_ultimate_state`.

### Setup steps

1. **Install prerequisites**
   - In Home Assistant, ensure the Node-RED Add-on is installed and running.
   - In Node-RED, ensure `node-red-contrib-home-assistant-websocket` nodes are available.

2. **Create the helper entity in Home Assistant**

   Add this to your `configuration.yaml` (or a `template:`/`input_select:` include), then restart Home Assistant:

   ```yaml
   input_select:
     alarm_ultimate_state:
       name: Alarm Ultimate state
       options:
         - disarmed
         - arming
         - armed_away
         - armed_home
         - pending
         - triggered
   ```

3. **Create the Template Alarm Control Panel**

   This exposes an `alarm_control_panel` entity that the standard Home Assistant “Alarm Panel” dashboard card can use.

   ```yaml
   template:
     - alarm_control_panel:
         - name: "Alarm Ultimate"
           unique_id: alarm_ultimate
           state: "{{ states('input_select.alarm_ultimate_state') }}"
           code_format: no_code
           arm_away:
             - event: alarm_ultimate_command
               event_data:
                 action: arm_away
           arm_home:
             - event: alarm_ultimate_command
               event_data:
                 action: arm_home
           disarm:
             - event: alarm_ultimate_command
               event_data:
                 action: disarm
           trigger:
             - event: alarm_ultimate_command
               event_data:
                 action: trigger
   ```

4. **Import and configure the Node-RED flow**
   - Import `examples/alarm-ultimate-home-assistant-alarm-panel.json`.
   - Open the Home Assistant server config node in the flow and ensure it’s set for the Add-on (default in the example).
   - Edit the `server-state-changed` node to match your real sensors (replace the example `binary_sensor.*` entity ids).
   - In the `AlarmSystemUltimate` node, set each zone `topic` to the matching Home Assistant entity id (same strings as above).

5. **Add the Home Assistant dashboard card**
   - Add the built-in “Alarm panel” card and select the entity `alarm_control_panel.alarm_ultimate`.

Notes:
- This integration uses a single Alarm “armed” state internally. The example maps `arm_home`/`arm_away` to HA states (`armed_home`/`armed_away`) for the UI by remembering the last requested arm mode.
