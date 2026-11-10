// Page controller for the isolated Space 3D prototype: chooses a renderer, owns the snapshot and selection, and
// keeps the accessible device list, inspector and status line in sync. No scanning, storage or network here.

import { calibrationPolicy, denseSnapshot, sparseSnapshot, tickSnapshot } from './fixtures.js';
import { classificationText, displayName, isStale, validateSnapshot } from './renderer-interface.js';
import { createFallbackRenderer } from './fallback-renderer.js';

const params = new URLSearchParams(location.search);
let forcedRenderer = params.get('renderer'); // 'fallback' | 'fail' | null; cleared by Retry 3D
const initialScene = params.get('scene') === 'dense' ? 'dense' : 'sparse';

const stage = document.getElementById('stage');
const mount = document.getElementById('sceneMount');
const sceneSelect = document.getElementById('sceneSelect');
const tickButton = document.getElementById('tickBtn');
const resetButton = document.getElementById('resetBtn');
const hideButton = document.getElementById('hideBtn');
const retryButton = document.getElementById('retryBtn');
const zoomIn = document.getElementById('zoomIn');
const zoomOut = document.getElementById('zoomOut');
const status = document.getElementById('status');
const deviceList = document.getElementById('deviceList');
const inspector = document.getElementById('inspector');
const summary = document.getElementById('summary');

const state = { snapshot: null, selectedId: null, renderer: null, kind: 'none', failure: '', tick: 0, sceneName: initialScene, hidden: false };
const listItems = new Map();

function buildSnapshot(name) {
  return name === 'dense' ? denseSnapshot(120, 7) : sparseSnapshot();
}

async function mountRenderer() {
  state.renderer?.dispose();
  state.renderer = null;
  state.failure = '';
  if (forcedRenderer !== 'fallback') {
    try {
      const module = await import('./three-renderer.js');
      state.renderer = module.createThreeRenderer({ container: mount, onSelect: select, forceFail: forcedRenderer === 'fail' });
      state.kind = 'three';
    } catch (error) {
      state.failure = error?.message || String(error);
      console.warn('Space 3D: Three.js renderer unavailable, using HTML fallback.', error);
    }
  }
  if (!state.renderer) {
    state.renderer = createFallbackRenderer({ container: mount, onSelect: select, reason: state.failure || (forcedRenderer === 'fallback' ? 'fallback requested' : '') });
    state.kind = 'fallback';
  }
  stage.dataset.renderer = state.kind;
  retryButton.hidden = state.kind !== 'fallback';
  zoomIn.disabled = zoomOut.disabled = resetButton.disabled = state.kind !== 'three';
  state.renderer.setObservation(state.snapshot);
  state.renderer.setSelected(state.selectedId);
  state.renderer.setVisible(!state.hidden);
  renderStatus();
  setTimeout(renderStatus, 400); // first frames land after mount
}

function select(id) {
  state.selectedId = id && state.snapshot.devices.some(device => device.id === id) ? id : null;
  state.renderer?.setSelected(state.selectedId);
  renderList();
  renderInspector();
}

function loadScene(name) {
  state.sceneName = name;
  state.tick = 0;
  state.snapshot = validateSnapshot(buildSnapshot(name));
  if (state.selectedId && !state.snapshot.devices.some(device => device.id === state.selectedId)) state.selectedId = null;
  state.renderer?.setObservation(state.snapshot);
  renderList();
  renderInspector();
  renderStatus();
}

function applyTick() {
  state.tick++;
  state.snapshot = validateSnapshot(tickSnapshot(state.snapshot, state.tick));
  state.renderer?.setObservation(state.snapshot);
  renderList();
  renderInspector();
  renderStatus();
}

function renderList() {
  const keep = new Set();
  for (const device of state.snapshot.devices) {
    keep.add(device.id);
    let item = listItems.get(device.id);
    if (!item) {
      item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.id = device.id;
      button.addEventListener('click', () => select(device.id));
      const number = document.createElement('span'); number.className = 'num';
      const name = document.createElement('span'); name.className = 'name';
      const meta = document.createElement('span'); meta.className = 'meta';
      button.append(number, name, meta);
      item.append(button);
      listItems.set(device.id, item);
      deviceList.append(item);
    }
    const button = item.firstElementChild;
    const selected = device.id === state.selectedId;
    button.children[0].textContent = `#${device.number}`;
    button.children[1].textContent = displayName(device);
    button.children[2].textContent = `${classificationText(device)} · ${device.signal.rssi} dBm · position unknown`;
    button.setAttribute('aria-pressed', String(selected));
    button.classList.toggle('selected', selected);
    button.classList.toggle('stale', isStale(device, Date.parse(state.snapshot.capturedAt)));
  }
  for (const [id, item] of listItems) {
    if (!keep.has(id)) { item.remove(); listItems.delete(id); }
  }
  summary.textContent = `${state.snapshot.devices.length} devices · ${state.snapshot.source} · arrangement by arrival order; positions unknown`;
}

function row(term, value, className = '') {
  const dt = document.createElement('dt'); dt.textContent = term;
  const dd = document.createElement('dd'); dd.textContent = value; if (className) dd.className = className;
  return [dt, dd];
}

function renderInspector() {
  const device = state.snapshot.devices.find(item => item.id === state.selectedId);
  if (!device) {
    inspector.replaceChildren(Object.assign(document.createElement('p'), { className: 'muted', textContent: 'Tap a glyph or pick a device from the list.' }));
    return;
  }
  const heading = document.createElement('h2');
  heading.textContent = `#${device.number} ${displayName(device)}`;
  const list = document.createElement('dl');
  const evidence = device.evidence || {};
  const evidenceText = [
    evidence.advertisedName ? `advertised name "${evidence.advertisedName}" (untrusted)` : null,
    evidence.manufacturerIds?.length ? `manufacturer id ${evidence.manufacturerIds.join(', ')}` : null,
    evidence.serviceUuids?.length ? `service ${evidence.serviceUuids.join(', ')}` : null
  ].filter(Boolean).join(' · ') || 'none';
  list.append(
    ...row('Classification', classificationText(device), device.classification.confidence === 'verified' ? '' : 'unknown'),
    ...row('Basis', device.classification.note || device.classification.basis || '—'),
    ...row('Brand evidence', evidence.brand ? `${evidence.brand} (${evidence.basis}); tints the glyph only` : 'none'),
    ...row('Evidence', evidenceText),
    ...row('Signal', `${device.signal.rssi} dBm · last seen ${new Date(device.signal.lastSeen).toLocaleTimeString()} · ${isStale(device, Date.parse(state.snapshot.capturedAt)) ? 'stale' : 'recent'}`),
    ...row('Arrangement', `ring ${device.arrangement.ring}, ${device.arrangement.angle.toFixed(0)}° · ${device.arrangement.basis} · ${device.arrangement.units}`),
    ...row('Measured position', device.measured.note, 'unknown')
  );
  if (device.verification) list.append(...row('Verification', `${device.verification.method} · ${new Date(device.verification.verifiedAt).toLocaleString()}`));
  if (device.note) list.append(...row('Note', device.note));
  if (device.calibration?.length) {
    const included = device.calibration.filter(item => !item.excluded).map(item => `${item.id} ("${item.operatorLabel}") · ${item.status}`);
    const excluded = device.calibration.filter(item => item.excluded).map(item => `${item.id} ("${item.operatorLabel}") · ${item.status}: ${item.reason}`);
    list.append(...row('Calibration intervals', included.length ? included.join('; ') : 'none', 'unknown'));
    if (excluded.length) list.append(...row('Calibration excluded', excluded.join('; '), 'warn'));
    list.append(...row('Calibration note', calibrationPolicy.note));
  }
  if (device.verification?.synthetic) list.append(...row('Fixture note', 'This "verified" entry is a synthetic fixture, not a verified real-world asset.', 'warn'));
  inspector.replaceChildren(heading, list);
}

function renderStatus() {
  const stats = state.renderer?.stats?.() || { kind: 'none' };
  const parts = [`renderer: ${stats.kind}`];
  if (stats.kind === 'three') {
    parts.push(`frames ${stats.frames}`, stats.renderingActive ? 'drawing' : 'idle', `${stats.drawCalls} draw calls`);
    if (stats.contextLost) parts.push('WebGL context lost');
  } else if (state.failure) parts.push(`reason: ${state.failure}`);
  if (state.hidden) parts.push('scene hidden: rendering paused');
  parts.push(`tick ${state.tick}`);
  status.textContent = parts.join(' · ');
}

sceneSelect.value = initialScene;
sceneSelect.addEventListener('change', () => loadScene(sceneSelect.value));
tickButton.addEventListener('click', applyTick);
resetButton.addEventListener('click', () => state.renderer?.resetView?.());
zoomIn.addEventListener('click', () => state.renderer?.zoomBy?.(1.25));
zoomOut.addEventListener('click', () => state.renderer?.zoomBy?.(1 / 1.25));
hideButton.addEventListener('click', () => {
  state.hidden = !state.hidden;
  hideButton.setAttribute('aria-pressed', String(state.hidden));
  hideButton.textContent = state.hidden ? 'Show scene' : 'Hide scene';
  mount.classList.toggle('is-hidden', state.hidden);
  state.renderer?.setVisible(!state.hidden);
  renderStatus();
});
retryButton.addEventListener('click', () => { forcedRenderer = null; history.replaceState(null, '', location.pathname + (params.get('scene') ? `?scene=${params.get('scene')}` : '')); mountRenderer(); });
setInterval(renderStatus, 1000);

state.snapshot = validateSnapshot(buildSnapshot(initialScene));
renderList();
renderInspector();
mountRenderer();

// Verification hooks for the browser scripts. Not used by the page itself.
window.__space3d = {
  state,
  calibrationPolicy,
  kind: () => state.kind,
  stats: () => state.renderer?.stats?.(),
  benchmark: ms => state.renderer?.benchmark?.(ms),
  projectLocal: (x, z, y) => state.renderer?.projectLocal?.(x, z, y),
  select,
  tick: applyTick,
  loadScene
};
