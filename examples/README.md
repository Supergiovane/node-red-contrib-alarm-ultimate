## Esempi

Importa il flow da `examples/alarm-ultimate-basic.json` in Node-RED:

1. Menu → **Import**
2. Incolla il contenuto del file JSON
3. Deploy

Il flow include:

- 1 nodo `AlarmSystemUltimate` con 2 zone di esempio
- Inject per arm/disarm, bypass, sensori open/close
- I nodi output-only (`Alarm State`, `Alarm Zone`, `Alarm Siren`) collegati a debug

## Dashboard (node-red-dashboard)

Importa `examples/alarm-ultimate-dashboard.json`.

- Richiede `node-red-dashboard` installato (nodi `ui_*`).
- Il widget usa un iframe verso `"/alarm-ultimate/alarm-panel?embed=1&id=<alarmNodeId>"`.
- Se hai cambiato `httpAdminRoot`, aggiorna l'URL dell'iframe di conseguenza (es: `"/red/alarm-ultimate/alarm-panel?...`).
