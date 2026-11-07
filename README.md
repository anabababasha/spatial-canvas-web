# spatial-canvas-web

Single-file MapLibre walking test. Serve `index.html` over HTTPS or localhost. Android Chrome with experimental Web Bluetooth scanning enabled is the target; the browser may offer only a one-device picker. Bluetooth and GPS permissions are separate.

Start BLE Scan requests browser-delivered BLE advertisements. If broad scanning is unavailable, tap again to use the device picker. Stop and page hiding stop active scans and device watches. After an interruption, resume explicitly. Nearby now shows packets received in the last 30 seconds, not proof of physical presence. History retains older device summaries; export retains all stored packets. The map shows up to five recent located observations. Filters affect presentation only.

Each received advertisement is timestamped immediately and written to browser-local IndexedDB with exposed payload bytes, RSSI, Tx power, UUIDs, and fresh scanner GPS/accuracy. Export downloads this session's full retained observations and device summaries as JSON. The capture banner reports packet count and write losses. Keep the exported file private: it can contain browser IDs and GPS. No field data is sent to this repository.

Browser IDs are not MAC addresses or permanent identities. Role labels based on names are tentative. Apple company data alone does not identify a wearable, phone or tracker. White spots mark the phone's location when an advertisement was received; numbered markers are offset from those spots for legibility, never measured emitter locations or BLE distance estimates. The blue dot, accuracy circle and heading beam represent the scanner. RSSI bands describe signal strength only. GPS fixes older than 15 seconds are omitted from packet records. Invalid reported RSSI/Tx values remain in raw export but are not used as measurements.

The map supports pinch, wheel, double-click, and visible + / - zoom. GPS updates retain the user's zoom. My location or the blue dot recenters on a fresh phone fix and resumes Follow without changing zoom or 2D/3D mode. Manual dragging stops Follow.
