# spatial-canvas-web

A responsive street map and tracked-entities bottom sheet. The map uses Leaflet from a CDN and keyless OpenStreetMap tiles with a dark filter.

Serve `index.html` over HTTPS, or localhost for development. GPS and BLE access require device permissions. Tap **Scan Real BLE / RF** to scan BLE advertisements where the browser supports it, or choose one BLE device through the browser picker. The displayed device ID is the browser's identifier, and RSSI appears only when an advertisement supplies it. Browsers cannot scan arbitrary RF or Wi-Fi signals. Sample map nodes use fixed offsets from the first GPS fix; BLE nodes are anchored at the user's GPS position with an estimated RSSI coverage radius. No build step is required.
