# spatial-canvas-web

A responsive street map and tracked-entities bottom sheet. The map uses Leaflet from a CDN and keyless OpenStreetMap tiles with a dark filter.

Serve `index.html` over HTTPS, or localhost for development. GPS and BLE access require device permissions. The map and entity list start empty until a real BLE device is detected or chosen. **Scan Real BLE / RF** uses advertisement scanning when supported, or the browser's BLE device picker. Names, service UUIDs, and exposed manufacturer data drive heuristic classification; RSSI drives signal quality and range tiers when available. Browser device IDs are not broadcast MAC addresses. Map nodes mark the phone's GPS position at detection, not the device's measured location. Browsers cannot scan arbitrary RF or Wi-Fi signals. No build step is required.

The **All RF / Proximity Only** control hides readings below -75 dBm in Proximity Only mode. All captured signals remain available when the control returns to All RF. Unresolved signals appear in the list but are hidden on the map until the Unresolved tab is selected. The map shows only the five strongest eligible signals and labels a device when its node or card is inspected. Signal strength is an estimate of proximity, not a measured distance.
