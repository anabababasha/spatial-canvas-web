// Small renderer interface for the isolated Space 3D prototype.
//
// A renderer receives observation snapshots and a selection and draws them. It never scans, stores or
// infers positions. Arrangement coordinates are layout slots derived from session arrival order and are
// kept apart from measured data, which this prototype does not have (every `measured` block says so).
//
// Contract (duck-typed; see three-renderer.js and fallback-renderer.js):
//   setObservation(snapshot)  -> update the scene in place; never rebuild it for an update
//   setSelected(id | null)    -> highlight one device
//   setVisible(boolean)       -> pause all rendering when false
//   resize()                  -> re-measure the container
//   stats()                   -> { kind, frames, ... } for the status line and tests
//   dispose()                 -> release everything
// Optional: benchmark(ms), projectLocal(x, z) for verification scripts.

export const SNAPSHOT_SCHEMA = 'space3d-snapshot/1';

// Ring 1 starts this far from the centre so the "You" marker stays clear. Units are arrangement slots, not metres.
export const RING_OFFSET = 1.6;

export const BRAND_TINTS = Object.freeze({
  apple: '#e2e8f0', microsoft: '#7dd3fc', google: '#fbbf24', samsung: '#60a5fa', lg: '#f472b6', hue: '#a3e635', none: '#94a3b8'
});

/** Session arrival order -> ring/angle slot. Same rule as the main app: ring k holds 6k slots, rings are offset by 30 degrees. */
export function arrangementFor(order) {
  let ring = 1;
  while (order > 3 * ring * (ring + 1)) ring++;
  const slotIndex = order - 3 * ring * (ring - 1) - 1;
  const angle = (slotIndex * 360 / (6 * ring) + (ring - 1) * 30) % 360;
  return Object.freeze({ order, ring, angle, basis: 'session-arrival-order', units: 'arrangement slots (not metres)' });
}

/** Arrangement slot -> local scene coordinates on the ground plane. Still layout units; still not a position. */
export function arrangementToLocal(arrangement) {
  const radius = arrangement.ring + RING_OFFSET;
  const rad = arrangement.angle * Math.PI / 180;
  return { x: radius * Math.cos(rad), z: radius * Math.sin(rad) };
}

export function arrangementRadius(snapshot) {
  let maxRing = 1;
  for (const device of snapshot.devices) maxRing = Math.max(maxRing, device.arrangement.ring);
  return maxRing + RING_OFFSET + 1;
}

export function validateSnapshot(snapshot) {
  if (!snapshot || snapshot.schema !== SNAPSHOT_SCHEMA) throw new Error(`Unsupported snapshot schema: ${snapshot?.schema}`);
  if (!Array.isArray(snapshot.devices)) throw new Error('Snapshot has no devices array');
  const ids = new Set();
  for (const device of snapshot.devices) {
    if (!device.id || ids.has(device.id)) throw new Error(`Duplicate or missing device id: ${device.id}`);
    ids.add(device.id);
    if (!device.arrangement || !Number.isFinite(device.arrangement.ring)) throw new Error(`Device ${device.id} lacks an arrangement slot`);
    if (!device.classification || typeof device.classification.type !== 'string') throw new Error(`Device ${device.id} lacks a classification`);
    if (device.measured?.position != null) throw new Error(`Device ${device.id} carries a measured position; this prototype has none`);
  }
  return snapshot;
}

/** Glyph shape vocabulary. Only a verified classification earns a dimensional shape; everything else is the generic glyph. */
export function glyphShapeFor(device) {
  if (device.classification?.confidence !== 'verified') return 'generic';
  switch (device.classification.type) {
    case 'printer': case 'access-point': case 'display': return 'box';
    default: return 'generic';
  }
}

export function brandTint(device) {
  return BRAND_TINTS[device.evidence?.brand || 'none'] || BRAND_TINTS.none;
}

export function isStale(device, now = Date.now()) {
  const seen = Date.parse(device.signal?.lastSeen || '');
  return !Number.isFinite(seen) || now - seen > 60000;
}

export function displayName(device) {
  if (device.verification?.label) return device.verification.label;
  if (device.name) return device.name;
  return 'BLE observation';
}

export function classificationText(device) {
  const c = device.classification || {};
  if (c.confidence === 'verified' && c.synthetic) return `${c.type} · synthetic fixture (stands in for a verified type; no real asset verified)`;
  if (c.confidence === 'verified') return `${c.type} · verified (${c.basis || 'operator'})`;
  if (c.confidence === 'tentative') return `${c.type} · tentative (${c.basis || 'evidence'})`;
  return 'unknown';
}
