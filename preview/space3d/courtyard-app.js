// Controller for the synthetic courtyard page. Owns the snapshot, the selection and the HUD; the renderer owns the
// scene. No scanning, geolocation, storage or network use: every input here is an authored fixture.

import { COURTYARD_VIEW, courtyardSnapshot, createCourtyardCloud } from './courtyard.js';
import { validateSnapshot } from './renderer-interface.js';
import { createFallbackRenderer } from './fallback-renderer.js';

const params = new URLSearchParams(location.search);
const forced = params.get('renderer'); // 'fallback' | 'fail' | null
const initialLayout = params.get('view') === 'abstract' ? 'arrangement' : 'environment';
const initialDetail = params.get('detail') === 'low' ? 'low' : 'high';

const $ = id => document.getElementById(id);
const mount = $('sceneMount');
const card = $('card');
const chips = $('chips');
const hint = $('hint');
const statsLine = $('stats');
const infoBtn = $('infoBtn'), infoPanel = $('infoPanel');
const viewCloud = $('viewCloud'), viewAbstract = $('viewAbstract');
const detailBtn = $('detailBtn'), returnBtn = $('returnBtn'), zoomIn = $('zoomIn'), zoomOut = $('zoomOut');

const state = { snapshot: validateSnapshot(courtyardSnapshot()), selectedId: null, renderer: null, kind: 'none', failure: '', layout: initialLayout, detail: initialDetail };
const environment = { build: createCourtyardCloud, view: COURTYARD_VIEW };

async function mountRenderer() {
  state.renderer?.dispose();
  state.renderer = null;
  state.failure = '';
  if (forced !== 'fallback') {
    try {
      const module = await import('./three-renderer.js');
      state.renderer = module.createThreeRenderer({
        container: mount, onSelect: id => select(id, { fromScene: true }), forceFail: forced === 'fail',
        environment, layout: state.layout, detail: state.detail
      });
      state.kind = 'three';
      state.renderer.onInteraction(() => hideHint());
    } catch (error) {
      state.failure = error?.message || String(error);
      console.warn('Courtyard: Three.js renderer unavailable, using HTML fallback.', error);
    }
  }
  if (!state.renderer) {
    state.renderer = createFallbackRenderer({ container: mount, onSelect: id => select(id), reason: state.failure || 'fallback requested' });
    state.kind = 'fallback';
    hideHint(true);
  }
  for (const control of [viewCloud, viewAbstract, detailBtn, returnBtn, zoomIn, zoomOut]) control.disabled = state.kind !== 'three';
  state.renderer.setObservation(state.snapshot);
  state.renderer.setSelected(state.selectedId);
  renderSwitch();
  renderStats();
}

function select(id, { fromScene = false } = {}) {
  const valid = id && state.snapshot.devices.some(device => device.id === id) ? id : null;
  if (!valid && fromScene) {
    // A tap on empty space clears the selection but leaves the camera where the explorer put it.
    state.selectedId = null;
  } else {
    state.selectedId = valid;
  }
  state.renderer?.setSelected(state.selectedId);
  if (state.selectedId) { state.renderer?.focusOn?.(state.selectedId); hideHint(); }
  renderChips();
  renderCard();
}

function renderChips() {
  if (!chips.children.length) {
    for (const device of state.snapshot.devices) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.id = device.id;
      button.textContent = device.letter;
      button.setAttribute('aria-label', `${device.name}, ${device.placement.spot}, authored placement`);
      button.addEventListener('click', () => select(state.selectedId === device.id ? null : device.id));
      chips.append(button);
    }
  }
  for (const button of chips.children) button.setAttribute('aria-pressed', String(button.dataset.id === state.selectedId));
}

function renderCard() {
  const device = state.snapshot.devices.find(item => item.id === state.selectedId);
  if (!device) { card.hidden = true; card.replaceChildren(); return; }
  const head = document.createElement('div');
  head.className = 'card-head';
  const title = document.createElement('h2');
  title.textContent = device.name;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'icon-btn';
  close.setAttribute('aria-label', 'Close');
  close.textContent = '×';
  close.addEventListener('click', () => select(null));
  head.append(title, close);
  const list = document.createElement('dl');
  const row = (term, value, className = '') => {
    const dt = document.createElement('dt'); dt.textContent = term;
    const dd = document.createElement('dd'); dd.textContent = value; if (className) dd.className = className;
    list.append(dt, dd);
  };
  row('Type', 'unknown', 'unknown');
  row('Signal', `${device.signal.rssi} dBm · simulated`);
  row('Placement', `${device.placement.spot} · authored, not measured`);
  row('Abstract slot', `ring ${device.arrangement.ring} · arrival order`);
  card.replaceChildren(head, list);
  card.hidden = false;
}

function setLayout(layout) {
  if (state.kind !== 'three') return;
  state.layout = state.renderer.setLayout(layout);
  renderSwitch();
}

function renderSwitch() {
  viewCloud.setAttribute('aria-pressed', String(state.layout === 'environment'));
  viewAbstract.setAttribute('aria-pressed', String(state.layout === 'arrangement'));
  detailBtn.setAttribute('aria-pressed', String(state.detail === 'low'));
  detailBtn.textContent = state.detail === 'low' ? 'Higher detail' : 'Lower detail';
}

function renderStats() {
  const s = state.renderer?.stats?.();
  if (!s) return;
  statsLine.textContent = s.kind === 'three'
    ? `three.js · ${s.layout === 'environment' ? 'point cloud' : 'abstract'} · ${s.environmentPoints.toLocaleString()} points (${s.detail}) · ${s.drawCalls} draw calls · pixel ratio ${s.pixelRatio} · ${s.frames} frames`
    : `HTML fallback · ${state.failure || 'requested'}`;
}

let hintTimer = 0;
function showHint() {
  hint.hidden = false;
  hint.classList.remove('is-hidden');
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => hideHint(), 5000);
}
function hideHint(immediate = false) {
  clearTimeout(hintTimer);
  hint.classList.add('is-hidden');
  if (immediate) hint.hidden = true;
}

viewCloud.addEventListener('click', () => setLayout('environment'));
viewAbstract.addEventListener('click', () => setLayout('arrangement'));
returnBtn.addEventListener('click', () => state.renderer?.returnHome?.());
zoomIn.addEventListener('click', () => state.renderer?.zoomBy?.(1.25));
zoomOut.addEventListener('click', () => state.renderer?.zoomBy?.(1 / 1.25));
detailBtn.addEventListener('click', () => {
  state.detail = state.renderer.setDetail(state.detail === 'low' ? 'high' : 'low');
  renderSwitch();
  renderStats();
});
infoBtn.addEventListener('click', () => {
  const open = infoPanel.hidden;
  infoPanel.hidden = !open;
  infoBtn.setAttribute('aria-expanded', String(open));
  renderStats();
});
$('hintAgainBtn').addEventListener('click', () => { infoPanel.hidden = true; infoBtn.setAttribute('aria-expanded', 'false'); showHint(); });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    if (!infoPanel.hidden) { infoPanel.hidden = true; infoBtn.setAttribute('aria-expanded', 'false'); }
    else if (state.selectedId) select(null);
  }
});
setInterval(() => { if (!infoPanel.hidden) renderStats(); }, 1000);

renderChips();
renderCard();
showHint();
mountRenderer();

// Verification hooks for the browser scripts. Not used by the page itself.
window.__courtyard = {
  state,
  kind: () => state.kind,
  stats: () => state.renderer?.stats?.(),
  benchmark: ms => state.renderer?.benchmark?.(ms),
  projectLocal: (x, z, y) => state.renderer?.projectLocal?.(x, z, y),
  projectDevice: id => state.renderer?.projectDevice?.(id),
  select
};
