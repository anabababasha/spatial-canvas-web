// Plain HTML fallback renderer. Used when the Three.js renderer cannot be created (module load failure, no WebGL,
// forced failure) or when the viewer opts out. It depends on nothing but the DOM and keeps selection working.

import { classificationText, displayName, isStale } from './renderer-interface.js';

export function createFallbackRenderer({ container, onSelect, reason = '' }) {
  const root = document.createElement('div');
  root.className = 'fallback';
  const message = document.createElement('p');
  message.className = 'fallback-message';
  message.textContent = reason
    ? `3D scene unavailable (${reason}). The list below keeps selection working.`
    : '3D scene disabled. The list below keeps selection working.';
  const note = document.createElement('p');
  note.className = 'fallback-note';
  note.textContent = 'Arrangement view · device positions unknown';
  const list = document.createElement('div');
  list.className = 'fallback-list';
  root.append(message, note, list);
  container.replaceChildren(root);

  const buttons = new Map();
  let selectedId = null;
  let disposed = false;

  function render(snapshot) {
    const keep = new Set();
    for (const device of snapshot.devices) {
      keep.add(device.id);
      let button = buttons.get(device.id);
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.dataset.id = device.id;
        button.addEventListener('click', () => onSelect?.(device.id));
        buttons.set(device.id, button);
        list.append(button);
      }
      button.textContent = `#${device.number} ${displayName(device)} · ${classificationText(device)}`;
      button.classList.toggle('stale', isStale(device));
      button.classList.toggle('selected', device.id === selectedId);
      button.setAttribute('aria-pressed', String(device.id === selectedId));
    }
    for (const [id, button] of buttons) {
      if (!keep.has(id)) { button.remove(); buttons.delete(id); }
    }
  }

  let lastSnapshot = null;
  return {
    kind: 'fallback',
    setObservation(snapshot) { if (disposed) return; lastSnapshot = snapshot; render(snapshot); },
    setSelected(id) { selectedId = id; if (lastSnapshot) render(lastSnapshot); },
    setVisible() { },
    resize() { },
    stats() { return { kind: 'fallback', frames: 0, renderingActive: false, devices: buttons.size, reason }; },
    dispose() { disposed = true; root.remove(); buttons.clear(); }
  };
}
