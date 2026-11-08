const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
const script = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
const syntax = require('node:child_process').spawnSync(process.execPath, ['--input-type=module', '--check'], { input: script, encoding: 'utf8' });
assert.equal(syntax.status, 0, syntax.stderr);
function fn(name) {
  const start = script.indexOf(`    async function ${name}(`) >= 0
    ? script.indexOf(`    async function ${name}(`)
    : script.indexOf(`    function ${name}(`);
  assert(start >= 0, name);
  const open = script.indexOf('{', script.indexOf(')', start));
  let depth = 1, end = open + 1;
  for (; depth; end++) { if (script[end] === '{') depth++; if (script[end] === '}') depth--; }
  return script.slice(start, end);
}
class Element {
  constructor(name, value = null) { this.nodeName = name; this.nodeType = name === '#text' ? 3 : 1; this.nodeValue = value; this.childNodes = []; this.hidden = false; this.scrollTop = 0; this.className = ''; this.dataset = {}; this.style = { setProperty(k, v) { this[k] = v; } }; this.classList = { add() { }, remove() { }, toggle() { } }; }
  append(...nodes) { for (const n of nodes) { n.parent = this; this.childNodes.push(n); } }
  insertBefore(node) { this.append(node); return node; }
  replaceChildren(...nodes) { this.childNodes = []; this.append(...nodes); }
  get children() { return this.childNodes.filter(n => n.nodeType === 1); }
  get lastChild() { return this.childNodes.at(-1); }
  set textContent(v) { this.replaceChildren(new Element('#text', String(v))); }
  get textContent() { return this.nodeType === 3 ? this.nodeValue : this.childNodes.map(n => n.textContent).join(' '); }
  remove() { this.parent.childNodes.splice(this.parent.childNodes.indexOf(this), 1); }
  replaceWith(n) { const p = this.parent, i = p.childNodes.indexOf(this); n.parent = p; p.childNodes[i] = n; }
  setAttribute(k, v) { this[k] = v; }
  querySelector(sel) {
    for (const c of this.children) {
      if (sel.startsWith('.') && c.className.split(/\s+/).includes(sel.slice(1))) return c;
      const found = c.querySelector(sel);
      if (found) return found;
    }
    return null;
  }
  addEventListener() { }
}
const mapSources = {};
const mapLayout = {};
const mapPaint = {};
const pathButton = new Element('button');
const tripwiresButton = new Element('button');
const opticalButton = new Element('button');
const viewButton = new Element('button');
const squelchButton = new Element('button');
const toolsToggle = new Element('button');
const toolsMenu = new Element('div');
toolsMenu.hidden = true;
const roomIntelBanner = new Element('button');
const opticalDrawer = new Element('div');
const opticalStatus = new Element('p');
const opticalDetections = new Element('div');
const opticalVideo = new Element('video');
const cardsList = new Element('div');
const empty = new Element('p');
let mapJumpCount = 0;
let scriptLoadShouldFail = true;
const headEl = new Element('head');
headEl.append = (...nodes) => {
  for (const n of nodes) {
    if (n.nodeName === 'script') {
      if (scriptLoadShouldFail) setImmediate(() => n.onerror?.());
      else setImmediate(() => n.onload?.());
    }
  }
};
const mapMock = {
  _zoom: 18,
  getZoom() { return this._zoom; },
  jumpTo(opts) { mapJumpCount++; this._center = opts.center; if (opts.zoom) this._zoom = opts.zoom; },
  easeTo(opts) { this._pitch = opts.pitch; this._bearing = opts.bearing; },
  getSource(id) { return (mapSources[id] ||= { setData(d) { this.data = d; } }); },
  setLayoutProperty(id, prop, val) { (mapLayout[id] ||= {})[prop] = val; },
  getLayoutProperty(id, prop) { return mapLayout[id]?.[prop]; },
  setPaintProperty(id, prop, val) { (mapPaint[id] ||= {})[prop] = val; },
  getPaintProperty(id, prop) { return mapPaint[id]?.[prop]; }
};
const context = vm.createContext({
  assert, Date, Math, Number, Array, Object, String, Boolean, Set, Map, Promise, Error, parseInt,
  window: { clearInterval() { }, setInterval() { return 1; } },
  navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() { } }] }) } },
  document: { head: headEl, createElement: n => new Element(n) },
  detailPanel: new Element('div'), pathButton, tripwiresButton, opticalButton, viewButton, squelchButton, toolsToggle, toolsMenu, roomIntelBanner,
  opticalDrawer, opticalStatus, opticalDetections, opticalVideo,
  cardsList, empty, cards: [], bleCards: new Map(), verifiedAssets: new Map(), anonymousIds: new WeakMap(),
  live: { checked: true }, status: new Element('span'),
  showPath: true, showTripwires: true, view3d: false, activeView: 'nearby', proximityOnly: false, toolsMenuOpen: false, roomIntelTarget: null, scannerStationary: true,
  opticalActive: false, opticalStream: null, opticalTimer: null, opticalModel: null, opticalLoading: null,
  assetNumber: 0, sessionNumber: 0, anonymousCount: 0, userPoint: null, lastFixAt: 0, gpsError: null, userDot: null, lastAccuracy: 0,
  compassHeading: 90, lastHeadingUpdateAt: 0, followGps: true, trailPoints: [],
  VISION_SCRIPTS: ['https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.20.0/dist/tf.min.js'],
  OPTICAL_TARGETS: new Set(['tv', 'laptop', 'cell phone', 'chair', 'refrigerator']),
  requestCompassPermission() { }, updateCards() { }, updateFollowUi() { },
  Element, map: mapMock, mapReady: true, entities: new Map(), lastSignalMapSignature: '',
  maplibregl: { Marker: class { constructor({ element }) { this.el = element; } getElement() { return this.el; } setLngLat(c) { this.lngLat = c; return this; } addTo() { return this; } remove() { return this; } } }
});
vm.runInContext(script.slice(script.indexOf('    const COMPANY_NAMES'), script.indexOf('    function bytesHex')) + '\n' +
  ['setToolsMenu', 'setSquelchMode', 'classifySignal', 'signalMetrics', 'pathLossMeters', 'multilaterateFixes', 'updateGhostState', 'aggregateRoomIntelligence', 'updateRoomIntelBanner', 'styleSignalRay', 'renderSignalRays', 'renderGhostRadarWidget', 'computeRfPerturbation', 'distanceMeters', 'hashId', 'offsetPoint', 'circleFeature', 'collection', 'putGeoJson', 'reserveSignalAngle', 'makeCardInteractive', 'renderEntityNode', 'refreshSignalMap', 'mergeSignal', 'renderSignalRecord', 'setPathVisibility', 'setTripwiresVisibility', 'setViewMode', 'currentGpsPoint', 'updateGpsStatus', 'updateUserShapes', 'updateHeading', 'onPosition', 'loadExternalScript', 'ensureOpticalModel', 'projectOpticalCoordinate', 'pinVerifiedAsset', 'setOpticalMode', 'updateInspectorContent', 'openEntityPopup', 'dismissPopup', 'selectEntity'].map(fn).join('\n') + `
let selectedEntity = null;
const NEARBY_MS = 30000;
const isFresh = e => Date.now() - Date.parse(e.lastSeen) <= NEARBY_MS;
const validRssi = Number.isFinite, validTxPower = Number.isFinite;
`, context);
vm.runInContext(`
const info = (name, uuids, mfgIds = [], mfgPayloads = {}, svcPayloads = {}) => ({name, advertisedName:name, serviceUuids:new Set(uuids), manufacturerIds:new Set(mfgIds), manufacturerPayloads:mfgPayloads, servicePayloads:svcPayloads, iBeacon:false});
assert.equal(identifySignal(info('Hue bulb',['fe0f'])).basis, 'name-and-service');
assert.equal(identifySignal(info('Hue bulb',['fe0f'])).family, 'Philips Hue');
assert.equal(classifySignal(info('Hue bulb',['fe0f'])).category, 'iot');
assert.equal(classifySignal(info('Hue bulb',['fe0f'])).badge, '💡');
assert.equal(identifySignal(info('Hue bulb',[])).family, null);
assert.equal(identifySignal(info('', ['fe0f'])).family, null);
assert.equal(classifySignal(info('', [])).category, 'unresolved');
assert.equal(signalLabel(info('', [])), 'Unresolved Beacon');
assert.equal(identifySignal(info('Hue bulb',['fe0f'])).exactModel, null);
assert.match(identifySignal(info('', ['180a'])).nextStep, /authorized read/);

const airpods = info('', [], [0x004c], {'0x004c': '0719010e20'});
assert.equal(identifySignal(airpods).basis, 'apple-continuity-type-0x07');
assert.equal(identifySignal(airpods).family, 'Apple AirPods');
assert.equal(identifySignal(airpods).categoryLabel, 'Wearables & Tags');
assert.equal(classifySignal(airpods).category, 'wearable');
assert.equal(classifySignal(airpods).badge, '🎧');
assert.equal(identifySignal(airpods).exactModel, null);

const continuity = info('', [], [0x004c], {'0x004c': '12020001'});
assert.equal(identifySignal(continuity).basis, 'apple-continuity-type-0x10-0x12');
assert.equal(identifySignal(continuity).family, 'Apple Continuity');
assert.equal(identifySignal(continuity).categoryLabel, 'Personal Device');
assert.equal(classifySignal(continuity).category, 'personal');
assert.equal(classifySignal(continuity).badge, '📱');

const nearby10 = info('', [], [0x004c], {'0x004c': '10050b1c'});
assert.equal(identifySignal(nearby10).basis, 'apple-continuity-type-0x10-0x12');
assert.equal(classifySignal(nearby10).badge, '📱');

const findmy = info('', [], [0x004c], {'0x004c': '160400'});
assert.equal(identifySignal(findmy).basis, 'apple-findmy-type-0x16');
assert.equal(identifySignal(findmy).family, 'Apple Find My / Offline Beacon');
assert.equal(classifySignal(findmy).category, 'wearable');
assert.equal(classifySignal(findmy).badge, '🏷️');

const airplay = info('', [], [0x004c], {'0x004c': '090600'});
assert.equal(identifySignal(airplay).basis, 'apple-airplay-type-0x09');
assert.equal(identifySignal(airplay).family, 'Apple AirPlay Target');
assert.equal(classifySignal(airplay).category, 'media');
assert.equal(classifySignal(airplay).badge, '📺');

const swiftPair = info('', [], [0x0006], {'0x0006': '030080'});
assert.equal(identifySignal(swiftPair).basis, 'microsoft-company-id-0x0006');
assert.equal(identifySignal(swiftPair).family, 'Windows PC');
assert.equal(identifySignal(swiftPair).categoryLabel, 'Personal Device');
assert.equal(classifySignal(swiftPair).category, 'personal');
assert.equal(classifySignal(swiftPair).badge, '💻');

const fastPair = info('', ['fe2c'], [], {}, {'fe2c': '006050e0459cae4c2175f1141f'});
assert.equal(identifySignal(fastPair).basis, 'google-fast-pair-service-0xfe2c');
assert.equal(identifySignal(fastPair).family, 'Google Fast Pair Accessory');
assert.equal(identifySignal(fastPair).categoryLabel, 'Wearables & Tags');
assert.equal(identifySignal(fastPair).modelId, '0x006050');
assert(identifySignal(fastPair).evidence.some(e => e.includes('0x006050')));
assert.equal(classifySignal(fastPair).category, 'wearable');
assert.equal(classifySignal(fastPair).role, 'Google Fast Pair Accessory');
assert.equal(classifySignal(fastPair).badge, '🎧');
assert.match(classifySignal(fastPair).explainer, /0x006050/);

setPathVisibility(false);
assert.equal(showPath, false);
assert.equal(pathButton.textContent, 'Path: OFF');
assert.equal(pathButton['aria-pressed'], 'false');
assert.equal(map.getLayoutProperty('walking-trail', 'visibility'), 'none');
assert.equal(map.getPaintProperty('walking-trail', 'line-opacity'), 0);
setPathVisibility(true);
assert.equal(showPath, true);
assert.equal(pathButton.textContent, 'Path: ON');
assert.equal(pathButton['aria-pressed'], 'true');
assert.equal(map.getLayoutProperty('walking-trail', 'visibility'), 'visible');
assert.equal(map.getPaintProperty('walking-trail', 'line-opacity'), .9);

const node = { id: 'ble-1', number: 27, name: 'Unknown BLE broadcaster', color: '#64748b', icon: 'RF', badge: 'RF', layoutAngle: 90, location: { lat: 52.37, lng: 4.89 } };
renderEntityNode(node);
const markerEl = node.marker.getElement();
assert.equal(markerEl.querySelector('.ble-label').textContent, '27');
assert.equal(markerEl.querySelector('.ble-badge').textContent, 'RF');
Object.assign(node, classifySignal(airpods), { name: signalLabel(airpods) });
renderEntityNode(node);
assert.equal(node.marker.getElement(), markerEl);
assert.equal(markerEl.querySelector('.ble-badge').textContent, '🎧');
assert.equal(node.layoutAngle, 90);

const trueBeacon = { lat: 52.3702, lng: 4.8952 };
const fixNorth = offsetPoint(trueBeacon, 8, 0);
const fixSouthEast = offsetPoint(trueBeacon, 9, 120);
const fixSouthWest = offsetPoint(trueBeacon, 8, 240);
assert(distanceMeters(fixNorth, fixSouthEast) >= 4);
assert(distanceMeters(fixSouthEast, fixSouthWest) >= 4);
assert(distanceMeters(fixNorth, fixSouthWest) >= 4);
assert.equal(multilaterateFixes([{ ...fixNorth, rssi: -62 }, { ...fixSouthEast, rssi: -63 }], -55), null);
const est = multilaterateFixes([
  { ...fixNorth, rssi: -61, accuracyMeters: 5 },
  { ...fixSouthEast, rssi: -62, accuracyMeters: 5 },
  { ...fixSouthWest, rssi: -61, accuracyMeters: 5 }
], -55);
assert(est, 'Multilateration converges with >= 3 distinct fixes');
assert(distanceMeters(trueBeacon, est) < 3, 'Converged coordinate is within 3m of stationary beacon');
assert(est.radiusMeters >= 3 && est.radiusMeters <= 35, 'Error circle radius is bounded');
Object.assign(node, { pinned: true, origin: fixSouthWest, estimatedLocation: { lat: est.lat, lng: est.lng }, location: { lat: est.lat, lng: est.lng }, errorRadius: est.radiusMeters });
entities.set(node.id, node);
renderEntityNode(node);
refreshSignalMap([node]);
assert.equal(markerEl.dataset.pinned, 'true');
assert.deepEqual(node.marker.lngLat, [est.lng, est.lat]);
assert.equal(map.getSource('beacon-error-circles').data.features.length, 1);
assert.equal(map.getSource('beacon-error-circles').data.features[0].geometry.type, 'Polygon');
function entity(id) { return {number:id, name:'Device '+id, card:new Element('article'), manufacturerIds:[], serviceUuids:[], lastSeen:new Date().toISOString(), firstSeen:new Date().toISOString(), packets:1}; }
const a = entity(1), b = entity(2);
selectEntity(a);
assert(a.popup.isOpen());
selectEntity(b);
assert(!a.popup.isOpen());
assert(b.popup.isOpen());
b.lastSeen = new Date(Date.now()-60000).toISOString();
b.card.hidden = true;
detailPanel.scrollTop = 250;
const content = detailPanel.children[1];
const advanced = content.children.at(-1);
advanced.open = true;
b.packets = 42;
openEntityPopup(b, true);
assert(b.popup.isOpen());
assert.equal(detailPanel.children[1], content);
assert.equal(content.children.at(-1), advanced);
assert.equal(advanced.open, true);
assert.equal(detailPanel.scrollTop, 250);
assert.match(content.textContent, /Packets: 42/);
assert.match(content.textContent, /inspector pinned/);
selectEntity(b);
assert(b.popup.isOpen());
dismissPopup();
assert(detailPanel.hidden);

// Stationary GPS deadband & low-confidence squelch tests
const t0 = Date.now();
onPosition({ coords: { latitude: 52.3702, longitude: 4.8952, accuracy: 8 }, timestamp: t0 });
assert(userDot, 'First GPS fix creates userDot');
assert.deepEqual(userDot.lngLat, [4.8952, 52.3702]);
assert.equal(trailPoints.length, 1);

// <5m drift (~2.2m north) must NOT move userDot, pan map, or append trailPoints
const drift2m = offsetPoint({ lat: 52.3702, lng: 4.8952 }, 2.2, 0);
onPosition({ coords: { latitude: drift2m.lat, longitude: drift2m.lng, accuracy: 8 }, timestamp: t0 + 1000 });
assert.deepEqual(userDot.lngLat, [4.8952, 52.3702], 'Stationary drift <5m suppressed');
assert.equal(trailPoints.length, 1, 'Stationary drift does not append to trailPoints');

// Degraded GPS rejection (>35m accuracy) must reject position update completely and show paused pill
const noisyJump = offsetPoint({ lat: 52.3702, lng: 4.8952 }, 25, 90);
onPosition({ coords: { latitude: noisyJump.lat, longitude: noisyJump.lng, accuracy: 38 }, timestamp: t0 + 2000 });
assert.deepEqual(userDot.lngLat, [4.8952, 52.3702], 'Degraded (>35m) fix rejected');
assert.equal(trailPoints.length, 1);
assert.equal(status.textContent, '⚠️ Coarse GPS (±38m) - Display Paused');
const coarseTestRec = mergeSignal({ id: 'coarse-gps-test', name: '' }, {
  name: '', advertisedName: '', serviceUuids: new Set(), manufacturerIds: new Set(),
  manufacturerPayloads: {}, servicePayloads: {}, iBeacon: false, rssi: -64, txPower: null
}, new Date(t0 + 2100).toISOString(), { lat: noisyJump.lat, lng: noisyJump.lng, accuracyMeters: 38 });
assert.equal(coarseTestRec.info.gpsFixes.length, 0, 'Coarse GPS fix (>35m) is not appended to multilateration fixes');
bleCards.delete('coarse-gps-test');

// Genuine displacement (>= 5m, e.g. 9m east with good accuracy <= 35m) updates userDot, trailPoints, and resumes status
const walk9m = offsetPoint({ lat: 52.3702, lng: 4.8952 }, 9, 90);
onPosition({ coords: { latitude: walk9m.lat, longitude: walk9m.lng, accuracy: 6 }, timestamp: t0 + 3000 });
assert.deepEqual(userDot.lngLat, [walk9m.lng, walk9m.lat], 'Genuine >=5m walk updates userDot');
assert.equal(trailPoints.length, 2, 'Genuine >=5m walk appends to trailPoints');
assert(status.textContent.startsWith('GPS ±6m'), 'Good GPS fix (<=35m) resumes normal GPS status display');

// Compass heading updates smoothly without being reset by suppressed GPS jitter
updateHeading({ webkitCompassHeading: 135 });
assert.equal(compassHeading, 135);
const jitter1m = offsetPoint(walk9m, 1.5, 180);
onPosition({ coords: { latitude: jitter1m.lat, longitude: jitter1m.lng, accuracy: 6 }, timestamp: t0 + 4000 });
assert.equal(compassHeading, 135, 'Suppressed GPS jitter preserves compass heading');
assert.deepEqual(map.getSource('heading-beam').data.features[0].geometry.coordinates[0][0], [walk9m.lng, walk9m.lat]);

// Optical ground-truth pass: pinned asset structure & separation from raw RF nodes
const asset = pinVerifiedAsset({ class: 'tv', score: 0.88, headingDegrees: 90, projectionMeters: 3 });
assert.equal(asset.category, 'physical-asset');
assert.equal(asset.icon, '📷');
assert.equal(asset.badge, '📷');
assert.equal(asset.verifiedAsset, true);
assert.equal(asset.verificationMethod, 'optical-camera-operator');
assert(asset.verifiedAt);
assert.equal(bleCards.size, 0, 'Verified optical asset is kept separate from BLE advertisement records');
assert.equal(verifiedAssets.size, 1, 'Verified optical asset stored in dedicated verifiedAssets collection');
selectEntity(asset);
assert.match(detailPanel.children[1].textContent, /verifiedAsset: true/);
assert.match(detailPanel.children[1].textContent, /verificationMethod: optical-camera-operator/);
dismissPopup();

// Top-right Layers & Tools dropdown menu collapse/expand and auto-collapse on option selection
assert.equal(toolsMenu.hidden, true);
setToolsMenu(true);
assert.equal(toolsMenuOpen, true);
assert.equal(toolsMenu.hidden, false);
assert.equal(toolsToggle['aria-expanded'], 'true');
setPathVisibility(false);
assert.equal(toolsMenuOpen, false, 'Selecting Path toggle auto-collapses dropdown');
assert.equal(toolsMenu.hidden, true);
assert.equal(toolsToggle['aria-expanded'], 'false');
setPathVisibility(true);

setToolsMenu(true);
assert.equal(toolsMenu.hidden, false);
setViewMode(true);
assert.equal(view3d, true);
assert.equal(toolsMenu.hidden, true, 'Selecting 3D View toggle auto-collapses dropdown');
setViewMode(false);

setToolsMenu(true);
setSquelchMode(true);
assert.equal(proximityOnly, true);
assert.equal(squelchButton.textContent, '≥ -75 dBm only');
assert.equal(toolsMenu.hidden, true, 'Selecting Squelch toggle auto-collapses dropdown');
setSquelchMode(false);

setToolsMenu(true);
setTripwiresVisibility(false);
assert.equal(showTripwires, false);
assert.equal(tripwiresButton.textContent, 'RF Radar Tripwires: OFF');
assert.equal(tripwiresButton['aria-pressed'], 'false');
assert.equal(toolsMenu.hidden, true, 'Selecting Tripwires toggle auto-collapses dropdown');
assert.equal(map.getLayoutProperty('signal-rays', 'visibility'), 'none');
assert.equal(map.getLayoutProperty('signal-rays-perturbed', 'visibility'), 'none');
assert.equal(map.getLayoutProperty('signal-rays-occluded', 'visibility'), 'none');
assert.equal(map.getLayoutProperty('beacon-error-circles', 'visibility'), 'none');
assert.equal(map.getLayoutProperty('beacon-error-outline', 'visibility'), 'none');
assert.equal(map.getLayoutProperty('beacon-surprise-outline', 'visibility'), 'none');
setTripwiresVisibility(true);
assert.equal(showTripwires, true);
assert.equal(tripwiresButton.textContent, 'RF Radar Tripwires: ON');
assert.equal(tripwiresButton['aria-pressed'], 'true');
assert.equal(map.getLayoutProperty('signal-rays', 'visibility'), 'visible');
assert.equal(map.getLayoutProperty('signal-rays-perturbed', 'visibility'), 'visible');
assert.equal(map.getLayoutProperty('signal-rays-occluded', 'visibility'), 'visible');
assert.equal(map.getLayoutProperty('beacon-error-circles', 'visibility'), 'visible');
assert.equal(map.getLayoutProperty('beacon-error-outline', 'visibility'), 'visible');
assert.equal(map.getLayoutProperty('beacon-surprise-outline', 'visibility'), 'visible');

// Experimental RF Multipath Perturbation (Living Presence / Disturbance Metric)
const steadyWindow = Array.from({ length: 15 }, (_, i) => -64 + (i % 2 === 0 ? 1 : -1));
const steadyPerturbation = computeRfPerturbation(steadyWindow, true, true);
assert(steadyPerturbation.sigma <= 4.5, 'Steady window has sigma <= 4.5 dBm');
assert.equal(steadyPerturbation.rfDisturbance, null, 'Low variance does not flag RF disturbance');

const disturbedWindow = [-55, -72, -58, -74, -56, -71, -59, -73, -57, -70, -56, -72, -58, -71, -57];
const activePerturbation = computeRfPerturbation(disturbedWindow, true, true);
assert(activePerturbation.sigma > 4.5, 'Multipath variance window has sigma > 4.5 dBm');
assert.equal(activePerturbation.sampleCount, 15, 'Maintains rolling 15-packet RSSI window');
assert.equal(activePerturbation.rfDisturbance, 'Active Multipath Variance (Potential living obstacle / motion)');
assert.equal(
  activePerturbation.disclaimer,
  'High RSSI standard deviation (sigma > 4.5 dBm) observed on a stationary emitter. Indicates physical line-of-sight obstruction or room movement.'
);
const movingPhonePerturbation = computeRfPerturbation(disturbedWindow, true, false);
assert.equal(movingPhonePerturbation.rfDisturbance, null, 'Does not flag disturbance when phone is moving');

// Feed 16 packets into a stationary BLE beacon and verify rolling 15-packet window + inspector disclaimer
scannerStationary = true;
const devStationary = { id: 'stationary-emitter-1', name: 'Lobby Sensor' };
const feedSeries = [-60, ...disturbedWindow];
let stationaryRec = null;
for (let i = 0; i < feedSeries.length; i++) {
  stationaryRec = mergeSignal(devStationary, {
    name: 'Lobby Sensor', advertisedName: 'Lobby Sensor',
    serviceUuids: new Set(['fe0f']), manufacturerIds: new Set(),
    manufacturerPayloads: {}, servicePayloads: {}, iBeacon: false,
    rssi: feedSeries[i], txPower: -59
  }, new Date(t0 + 5000 + i * 500).toISOString(), { lat: walk9m.lat, lng: walk9m.lng, accuracyMeters: 6 });
}
renderSignalRecord(stationaryRec);
assert.equal(stationaryRec.info.rssiWindow.length, 15, 'Rolling RSSI window capped at 15 packets');
assert.equal(stationaryRec.entity.interpretation.rfDisturbance, 'Active Multipath Variance (Potential living obstacle / motion)');
selectEntity(stationaryRec.entity);
assert(detailPanel.children[1].textContent.includes('Active Multipath Variance (Potential living obstacle / motion)'));
assert(detailPanel.children[1].textContent.includes('High RSSI standard deviation (sigma > 4.5 dBm) observed on a stationary emitter. Indicates physical line-of-sight obstruction or room movement.'));
dismissPopup();

// RF Ghost Real-Time Spatial Disturbance Engine tests:
// 1. Ghost mean/variance convergence using alpha = 0.015 and Quiescent state classification (surprise < 1.0)
let gState = null;
for (let i = 0; i < 60; i++) {
  gState = updateGhostState(gState, -60, true);
}
assert.equal(gState.alpha, 0.015);
assert(Math.abs(gState.ghostMean - (-60)) < 0.01, 'ghostMean converges to -60 dBm');
assert.equal(gState.ghostSigma, 0.5, 'ghostSigma clamped to floor 0.5 dBm');
assert(gState.surprise < 1.0, 'Surprise < 1.0 on steady signal');
assert.equal(gState.fieldActivityScore, 0, 'Zero sub-threshold activity on static signal');
assert.equal(gState.physicalState, 'Field Quiescent');
assert.equal(gState.level, 'calm');

// Verify exact single-step alpha = 0.015 recurrence relation
const prevMean = gState.ghostMean;
const prevVar = gState.ghostVar;
const stepTest = updateGhostState(gState, -62, true);
const expectedDelta = -62 - prevMean;
const expectedMean = prevMean + 0.015 * expectedDelta;
const expectedVar = (1 - 0.015) * (prevVar + 0.015 * expectedDelta * expectedDelta);
const expectedSigma = Math.max(0.5, Math.sqrt(expectedVar));
const expectedSurprise = Math.abs(-62 - expectedMean) / expectedSigma;
assert(Math.abs(stepTest.ghostMean - expectedMean) < 1e-12, 'Exact alpha=0.015 mean update');
assert(Math.abs(stepTest.ghostVar - expectedVar) < 1e-12, 'Exact alpha=0.015 variance update');
assert(Math.abs(stepTest.surprise - expectedSurprise) < 1e-12, 'Exact surprise calculation');

// 2. Threshold Inverter (Sub-Threshold Energy Accumulator): micro-jitter (0.5 to 3.0 dBm deltas)
let microState = gState;
const microRssi = [-60.8, -59.6, -60.7, -59.5, -60.6, -59.6];
for (const r of microRssi) {
  microState = updateGhostState(microState, r, true);
}
assert(microState.fieldActivityScore > 0.4 && microState.fieldActivityScore <= 1.0, 'Sub-threshold micro-jitter accumulates fieldActivityScore > 0.4');
assert(microState.surprise <= 2.5, 'Micro-jitter stays within surprise <= 2.5');
assert.equal(microState.physicalState, 'Micro-Movement / Ambient Perturbation');
assert.equal(microState.stateDetail, 'Living presence shifting in room');
assert.equal(microState.level, 'perturbed');

// 3. Body Shadowing / Physical Occlusion triage (surprise > 2.5 and delta < -3 dBm)
const occludedState = updateGhostState(gState, -68, true);
assert(occludedState.delta < -3, 'Occlusion delta < -3 dBm');
assert(occludedState.surprise > 2.5, 'Occlusion surprise > 2.5');
assert.equal(occludedState.physicalState, 'Physical Occlusion / Line-of-Sight Crossing');
assert.equal(occludedState.stateDetail, 'Body Shadowing');
assert.equal(occludedState.level, 'occluded');
assert.equal(occludedState.highSurprise, true);

// 4. Live Visual Telemetry Gauge ("Spatial RF Radar" widget in inspector + minimal pin without .ble-mini-hud)
stationaryRec.entity.pinned = true;
stationaryRec.entity.estimatedLocation = { lat: est.lat, lng: est.lng };
stationaryRec.entity.location = { lat: est.lat, lng: est.lng };
stationaryRec.entity.errorRadius = est.radiusMeters;
stationaryRec.entity.ghost = occludedState;
renderEntityNode(stationaryRec.entity);
refreshSignalMap([stationaryRec.entity]);
assert.equal(stationaryRec.entity.marker.getElement().dataset.highSurprise, 'true');
assert.equal(stationaryRec.entity.marker.getElement().dataset.state, 'occluded');
assert.equal(stationaryRec.entity.marker.getElement().querySelector('.ble-mini-hud'), null, 'No rectangular .ble-mini-hud card on map pin');
assert.equal(stationaryRec.entity.marker.getElement().querySelector('.ble-full-label'), null, 'No text label paragraph on map pin');
assert.equal(map.getSource('beacon-surprise-ripples').data.features.length, 1, 'Pinned beacon with surprise > 2.5 emits ripple circle on MapLibre canvas');
selectEntity(stationaryRec.entity);
const radarEl = detailPanel.children[1].querySelector('.ghost-radar');
assert(radarEl, 'Spatial RF Radar widget is rendered directly in inspector panel');
assert.equal(radarEl.dataset.level, 'occluded');
assert(radarEl.textContent.includes('Spatial RF Radar'));
assert(radarEl.textContent.includes('Baseline μ:'));
assert(radarEl.textContent.includes('Surprise index:'));
assert(radarEl.textContent.includes('Presence score:'));
assert(radarEl.textContent.includes('Physical Occlusion / Line-of-Sight Crossing'));
dismissPopup();

// 5. Two-speed Ghost Baseline (longTermMean alpha = 0.005, shortTermMean alpha = 0.2) & presenceScore
let twoSpeed = null;
for (let i = 0; i < 40; i++) {
  twoSpeed = updateGhostState(twoSpeed, -60, true);
}
assert.equal(twoSpeed.longTermAlpha, 0.005);
assert.equal(twoSpeed.shortTermAlpha, 0.2);
assert(Math.abs(twoSpeed.longTermMean - (-60)) < 0.01);
assert(Math.abs(twoSpeed.shortTermMean - (-60)) < 0.01);
assert.equal(twoSpeed.longTermSigma, 1.0, 'longTermSigma floor at 1.0 dBm');
assert.equal(twoSpeed.presenceScore, 0);

// Sustained human body presence at -68 dBm for 12 packets:
// shortTermMean adapts quickly while longTermMean & longTermSigma resist inflation, keeping presenceScore > 2.0
for (let i = 0; i < 12; i++) {
  twoSpeed = updateGhostState(twoSpeed, -68, true);
}
const expectedPresence = Math.abs(twoSpeed.shortTermMean - twoSpeed.longTermMean) / Math.max(1.0, twoSpeed.longTermSigma);
assert(Math.abs(twoSpeed.presenceScore - expectedPresence) < 1e-12, 'Exact presenceScore formula');
assert(twoSpeed.shortTermMean < -66.5, 'shortTermMean tracks immediate -68 dBm shift');
assert(twoSpeed.longTermMean > -61.0, 'longTermMean preserves empty-room baseline');
assert(twoSpeed.presenceScore > 2.0, 'Sustained presence keeps presenceScore > 2.0 without variance silencing');
assert.equal(twoSpeed.level, 'occluded');
assert.equal(twoSpeed.physicalState, 'Physical Occlusion / Line-of-Sight Crossing');

// 6. Global "Room Spatial Intelligence" HUD Banner aggregator logic
const calmNodeA = { id: 'node-calm-a', number: 101, name: 'Hallway Beacon', card: new Element('article'), manufacturerIds: [], serviceUuids: [], ghost: gState };
const calmNodeB = { id: 'node-calm-b', number: 102, name: 'Desk Sensor', card: new Element('article'), manufacturerIds: [], serviceUuids: [], ghost: gState };
const calmSummary = updateRoomIntelBanner([calmNodeA, calmNodeB], true);
assert.equal(calmSummary.level, 'calm');
assert.equal(roomIntelBanner.textContent, '🟢 Space Quiescent');
assert.equal(roomIntelBanner.dataset.level, 'calm');

const pertNodeA = { id: 'node-pert-a', number: 103, name: 'Shelf Tag', card: new Element('article'), manufacturerIds: [], serviceUuids: [], ghost: microState };
const pertNodeB = { id: 'node-pert-b', number: 104, name: 'Window Lamp', card: new Element('article'), manufacturerIds: [], serviceUuids: [], ghost: microState };
const pertSummary = updateRoomIntelBanner([pertNodeA, pertNodeB], true);
assert.equal(pertSummary.level, 'perturbed');
assert(roomIntelBanner.textContent.startsWith('🟡 Spatial Disturbance ('));
assert.equal(roomIntelBanner.dataset.level, 'perturbed');

const occNode = { id: 'node-occ-1', number: 105, name: 'Doorway Hue Bulb', card: new Element('article'), manufacturerIds: [], serviceUuids: [], ghost: twoSpeed };
const occSummary = updateRoomIntelBanner([calmNodeA, pertNodeA, occNode], true);
assert.equal(occSummary.level, 'occluded');
assert.equal(roomIntelBanner.textContent, '🔴 Tripwire: Doorway Hue Bulb Blocked');
assert.equal(roomIntelBanner.dataset.level, 'occluded');
assert.equal(occSummary.targetEntity, occNode, 'Aggregator targets most perturbed device');
selectEntity(roomIntelTarget, true);
assert.equal(selectedEntity, occNode, 'Tapping Room Intelligence banner opens inspector for most perturbed device');
dismissPopup();

// 7. Reactive 3D Link Rays (Spatial RF Tripwires) styling assignments
const rayCalm = styleSignalRay(calmNodeA);
assert.equal(rayCalm.state, 'calm');
assert.equal(rayCalm.opacity, 0.3);

const rayPerturbed = styleSignalRay(pertNodeA);
assert.equal(rayPerturbed.state, 'perturbed');
assert.equal(rayPerturbed.color, '#f59e0b');
assert.equal(rayPerturbed.opacity, 0.85);

const rayOccluded = styleSignalRay(occNode);
assert.equal(rayOccluded.state, 'occluded');
assert.equal(rayOccluded.color, '#ff2a4d');
assert(rayOccluded.width > rayPerturbed.width, 'Occluded link ray has wider pulsing stroke');

calmNodeA.origin = { lat: 52.37, lng: 4.89 };
calmNodeA.location = { lat: 52.3701, lng: 4.8901 };
pertNodeA.origin = { lat: 52.37, lng: 4.89 };
pertNodeA.location = { lat: 52.3702, lng: 4.8902 };
occNode.origin = { lat: 52.37, lng: 4.89 };
occNode.location = { lat: 52.3703, lng: 4.8903 };
const rayCollection = renderSignalRays([calmNodeA, pertNodeA, occNode]);
assert.equal(rayCollection.features.length, 3);
assert.deepEqual(rayCollection.features.map(f => f.properties.state), ['calm', 'perturbed', 'occluded']);
assert.equal(map.getSource('signal-rays').data.features[2].properties.color, '#ff2a4d');
`, context);
(async () => {
  // Verify BLE entity retention across Optical camera state transitions + async loader graceful fallback
  const bleCountBefore = context.bleCards.size;
  const entityCountBefore = context.entities.size;
  assert(bleCountBefore >= 1, 'BLE entities exist before enabling Optical mode');
  vm.runInContext(`setToolsMenu(true)`, context);
  const ok = await vm.runInContext(`setOpticalMode(true)`, context);
  assert.equal(toolsMenu.hidden, true, 'Enabling Optical mode auto-collapses tools menu');
  assert.equal(ok, false, 'Falls back gracefully when CDN script load fails offline');
  assert.equal(opticalButton.textContent, '📷 Optical: ON');
  assert.equal(opticalDrawer.hidden, false);
  assert.match(opticalStatus.textContent, /Optical pass unavailable/);
  assert.equal(context.bleCards.size, bleCountBefore, 'BLE entities retained when camera mode is enabled');
  assert.equal(context.entities.size, entityCountBefore, 'All tracked entities persist while camera mode is active');
  await vm.runInContext(`setOpticalMode(false)`, context);
  assert.equal(opticalButton.textContent, '📷 Optical: OFF');
  assert.equal(opticalDrawer.hidden, true);
  assert.equal(context.bleCards.size, bleCountBefore, 'BLE entities retained after closing camera mode');
  assert(context.entities.has('ble-stationary-emitter-1'), 'Discovered BLE entity persists across camera state transitions');
  assert(!fn('updateCards').includes('dismissPopup'));
  assert(!fn('setView').includes('dismissPopup'));
  assert(!fn('recenterToGps').includes('dismissPopup'));
  console.log('PASS: syntax, evidence positive/negative cases, selection ownership, aging/filter persistence, live text update, scroll/details preservation, explicit close. DOM stub; not a browser or hardware test.');
})().catch(err => { console.error(err); process.exit(1); });
