# spatial-canvas-web

A responsive street map and tracked-entities bottom sheet. The map uses Leaflet from a CDN and keyless OpenStreetMap tiles with a dark filter.

Serve `index.html` over HTTPS, or localhost for development. GPS and BLE access require device permissions. The map and entity list start empty until a real BLE device is detected or chosen. **Scan Real BLE / RF** uses advertisement scanning when supported, or the browser's BLE device picker. Names, service UUIDs, and exposed manufacturer data drive heuristic classification; RSSI drives signal quality and range tiers when available. Browser device IDs are not broadcast MAC addresses. Map nodes mark the phone's GPS position at detection, not the device's measured location. Browsers cannot scan arbitrary RF or Wi-Fi signals. No build step is required.
