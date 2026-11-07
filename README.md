# spatial-canvas-web

Single-file MapLibre walking test. Serve `index.html` over HTTPS or localhost. Android Chrome with experimental Web Bluetooth scanning enabled is the target; the browser may offer only a one-device picker. Bluetooth and GPS permissions are separate.

Start BLE Scan requests browser-delivered BLE advertisements. If broad scanning is unavailable, tap again to use the device picker. Stop and page hiding stop active scans and device watches. After an interruption, resume explicitly. The map displays up to five strongest eligible observations; all device cards remain in the scrollable list. Filters affect presentation only.

Each received advertisement is timestamped immediately and written to browser-local IndexedDB with exposed payload bytes, RSSI, Tx power, UUIDs, and fresh scanner GPS/accuracy. Export downloads this session's full retained observations and device summaries as JSON. The capture banner reports packet count and write losses. Keep the exported file private: it can contain browser IDs and GPS. No field data is sent to this repository.

Browser IDs are not MAC addresses or permanent identities. Role labels based on names are tentative. Apple company data alone does not identify a wearable, phone or tracker. Marker positions and rings are illustrative spacing around the scanner, not measured emitter locations or BLE distance estimates. The blue dot, accuracy circle and heading beam represent the scanner. RSSI bands describe signal strength only. GPS fixes older than 15 seconds are omitted from packet records.

The map supports pinch, wheel, double-click, and visible + / - zoom. GPS updates retain the user's zoom. Tapping the blue dot recenters and resumes following.
