// Synthetic courtyard for the Space 3D prototype.
//
// Everything in this file is authored: the façades, passage, trees and the six signal placements are a fixture designed
// for exploring the interaction model. Nothing is reconstructed from BLE, GPS, RSSI or any sensor, and the six signals
// are simulated. Units are scene units chosen to read like metres; they are not measurements.
//
// The geometry is generated procedurally into flat typed arrays (positions and colours) so the renderer can draw the
// whole environment as one batched THREE.Points object. No THREE import here, which keeps this module testable in Node.

import { SNAPSHOT_SCHEMA, arrangementFor } from './renderer-interface.js';

export const COURTYARD_VIEW = Object.freeze({
  home: { x: 0, z: 7 },          // the "You" marker sits at the open south entrance
  center: { x: 0, z: -5 },       // pan is clamped around this point
  panRadius: 17,
  theta: 0, tilt: 30, zoom: 1, targetY: 1.2, targetAheadZ: -9,
  baseDistance: 19,
  tiltMin: 10, tiltMax: 72, zoomMin: 0.55, zoomMax: 3.6, focusZoom: 1.75,
  fogNear: 16, fogFar: 64,
  revealRadius: 36               // radius of the load-time reveal sweep; a visual effect, not scan coverage
});

export const COURTYARD_DETAIL = Object.freeze({
  high: { density: 1, pointSize: 0.055 },
  low: { density: 0.36, pointSize: 0.08 }
});

const MAX_HEIGHT = 9;

// Restrained height ramp: dim cyan at the ground, cyan, teal-green, yellow-green, soft yellow at the roofline.
const RAMP = [
  [0.0, [0.05, 0.30, 0.36]],
  [0.12, [0.07, 0.52, 0.60]],
  [0.42, [0.16, 0.66, 0.56]],
  [0.72, [0.55, 0.78, 0.36]],
  [1.0, [0.90, 0.83, 0.43]]
];

export function heightColor(y) {
  const t = Math.max(0, Math.min(1, y / MAX_HEIGHT));
  for (let i = 1; i < RAMP.length; i++) {
    if (t <= RAMP[i][0]) {
      const [t0, c0] = RAMP[i - 1], [t1, c1] = RAMP[i];
      const k = (t - t0) / (t1 - t0);
      return [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k];
    }
  }
  return RAMP[RAMP.length - 1][1];
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TREES = [
  { x: -6, z: -5, canopy: 2.2 },
  { x: 7, z: -8.5, canopy: 2.4 },
  { x: -8, z: 2.5, canopy: 1.9 },
  { x: 5, z: -1.2, canopy: 2.0 }
];

/** Build the courtyard cloud. Returns { positions, colors, count, parts, bounds }. Deterministic for a given detail. */
export function createCourtyardCloud(detail = 'high') {
  const { density } = COURTYARD_DETAIL[detail] || COURTYARD_DETAIL.high;
  const random = mulberry32(20261110);
  const positions = [], colors = [];
  const parts = {};
  let part = '';
  const begin = name => { part = name; parts[name] = 0; };
  const push = (x, y, z, brightness = 1) => {
    const c = heightColor(y);
    positions.push(x, y, z);
    colors.push(Math.min(1, c[0] * brightness), Math.min(1, c[1] * brightness), Math.min(1, c[2] * brightness));
    parts[part]++;
  };
  const count = base => Math.max(1, Math.round(base * density));

  // Ground: courtyard, passage floor, a strip beyond the passage and the open area to the south.
  begin('ground');
  const insideBuilding = (x, z) => {
    if (z < -21) return Math.abs(x) > 8 || z < -26;
    if (z >= -21 && z < -14) return Math.abs(x) > 1.8;
    if (x < -12) return z < 6;
    if (x > 12) return z < 3;
    return false;
  };
  for (let i = 0, n = count(42000); i < n; i++) {
    // Two thirds of the ground samples fall inside the courtyard, where the explorer spends most time.
    const inner = random() < 0.66;
    const x = inner ? -12 + random() * 24 : -16 + random() * 32, z = inner ? -14 + random() * 22 : -26 + random() * 40;
    if (insideBuilding(x, z)) continue;
    const paving = Math.abs(((x + 100) % 2) - 1) > 0.9 || Math.abs(((z + 100) % 2) - 1) > 0.9;
    const path = Math.abs(x) < 1.3 && z < 8;
    const fade = z > 6 ? 0.75 : 1;
    push(x, random() * 0.03, z, (0.6 + random() * 0.25) * (paving ? 1.3 : 1) * (path ? 1.15 : 1) * fade);
  }

  // Façades: wall planes with recessed window openings, framed edges and a dense cornice for readable silhouettes.
  begin('facades');
  function facade({ axis, fixed, from, to, height, opening = null, perArea = 95, inward = 1 }) {
    const length = to - from;
    const floors = Math.floor(height / 3);
    const windows = [];
    for (let floor = 0; floor < floors; floor++) {
      for (let u = from + 1.4; u + 1.3 <= to - 0.8; u += 2.7) {
        const win = { u0: u, u1: u + 1.3, v0: floor * 3 + 0.9, v1: floor * 3 + 2.6 };
        if (opening && win.u1 > opening.u0 - 0.3 && win.u0 < opening.u1 + 0.3 && win.v0 < opening.v1 + 0.6) continue;
        windows.push(win);
      }
    }
    const inOpening = (u, v) => opening && (opening.arch
      ? Math.abs(u - (opening.u0 + opening.u1) / 2) < (opening.u1 - opening.u0) / 2 &&
        (v < opening.v1 - (opening.u1 - opening.u0) / 2 || (v - (opening.v1 - (opening.u1 - opening.u0) / 2)) ** 2 + (u - (opening.u0 + opening.u1) / 2) ** 2 < ((opening.u1 - opening.u0) / 2) ** 2)
      : u > opening.u0 && u < opening.u1 && v < opening.v1);
    const inWindow = (u, v) => windows.some(w => u > w.u0 && u < w.u1 && v > w.v0 && v < w.v1);
    const place = (u, v, depth, brightness) => {
      if (axis === 'z') push(u, v, fixed + depth * inward, brightness);
      else push(fixed + depth * inward, v, u, brightness);
    };
    for (let i = 0, n = count(length * height * perArea); i < n; i++) {
      const u = from + random() * length, v = random() * height;
      if (inOpening(u, v) || inWindow(u, v)) continue;
      place(u, v, (random() - 0.5) * 0.06, 0.82 + random() * 0.2);
    }
    for (const w of windows) {
      const edge = count(70);
      for (let i = 0; i < edge; i++) {
        const t = random();
        place(w.u0 + t * (w.u1 - w.u0), w.v0, -0.12, 1.05);
        place(w.u0 + t * (w.u1 - w.u0), w.v1, -0.12, 0.95);
        place(w.u0, w.v0 + t * (w.v1 - w.v0), -0.12, 0.95);
        place(w.u1, w.v0 + t * (w.v1 - w.v0), -0.12, 0.95);
      }
    }
    for (let i = 0, n = count(length * 60); i < n; i++) {
      place(from + random() * length, height - random() * 0.25, random() * 0.25, 1.2);
    }
    for (let i = 0, n = count(height * 40); i < n; i++) {
      const v = random() * height;
      place(from, v, 0, 1.1);
      place(to, v, 0, 1.1);
    }
  }
  facade({ axis: 'z', fixed: -14, from: -12, to: 12, height: 9, opening: { u0: -1.8, u1: 1.8, v1: 3.4, arch: true }, inward: -1 });
  facade({ axis: 'x', fixed: -12, from: -14, to: 6, height: 7.5, opening: { u0: -4, u1: -2.6, v1: 2.6 }, inward: -1 });
  facade({ axis: 'x', fixed: 12, from: -14, to: 3, height: 8, opening: { u0: -7, u1: -5.4, v1: 2.8 }, inward: 1 });
  facade({ axis: 'z', fixed: 6, from: -16, to: -12, height: 7.5, perArea: 70 });
  facade({ axis: 'z', fixed: 3, from: 12, to: 16, height: 8, perArea: 70 });
  facade({ axis: 'z', fixed: -26, from: -8, to: 8, height: 7, perArea: 55, inward: -1 });

  // Passage: side walls and an arched ceiling through the north building.
  begin('passage');
  for (let i = 0, n = count(5200); i < n; i++) {
    const z = -21 + random() * 7;
    const pick = random();
    if (pick < 0.55) {
      const side = random() < 0.5 ? -1.8 : 1.8;
      push(side, random() * 1.6, z, 0.85 + random() * 0.15);
    } else {
      const angle = random() * Math.PI;
      push(Math.cos(angle) * 1.8, 1.6 + Math.sin(angle) * 1.8, z, 0.9 + random() * 0.15);
    }
  }

  // Trees: trunk, lumpy canopy, kerbed planter.
  begin('trees');
  for (const tree of TREES) {
    for (let i = 0, n = count(520); i < n; i++) {
      const a = random() * Math.PI * 2, y = random() * 2.9;
      const r = 0.2 + 0.06 * (1 - y / 2.9);
      push(tree.x + Math.cos(a) * r, y, tree.z + Math.sin(a) * r, 0.9);
    }
    for (let i = 0, n = count(4600); i < n; i++) {
      const a = random() * Math.PI * 2, c = random() * 2 - 1, s = Math.sqrt(1 - c * c);
      const lump = 1 + 0.16 * Math.sin(3 * a) * Math.sin(4 * c) + 0.08 * Math.sin(7 * a + c * 5);
      const shell = tree.canopy * lump * (0.68 + 0.32 * Math.sqrt(random()));
      push(tree.x + Math.cos(a) * s * shell, 4.3 + c * shell * 0.78, tree.z + Math.sin(a) * s * shell, 0.95 + random() * 0.15);
    }
    for (let i = 0, n = count(320); i < n; i++) {
      const a = random() * Math.PI * 2;
      push(tree.x + Math.cos(a) * 1.3, random() * 0.35, tree.z + Math.sin(a) * 1.3, 1.15);
    }
  }

  // Benches.
  begin('furniture');
  for (const bench of [{ x: -4.2, z: -5.6, w: 1.8 }, { x: 3.4, z: -3.4, w: 1.6 }]) {
    for (let i = 0, n = count(420); i < n; i++) {
      const u = (random() - 0.5) * bench.w, side = random();
      if (side < 0.6) push(bench.x + u, 0.45, bench.z + (random() - 0.5) * 0.5, 1.15);
      else push(bench.x + u, random() * 0.45, bench.z + (random() < 0.5 ? -0.25 : 0.25), 1.0);
    }
  }

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i]); maxX = Math.max(maxX, positions[i]);
    minY = Math.min(minY, positions[i + 1]); maxY = Math.max(maxY, positions[i + 1]);
    minZ = Math.min(minZ, positions[i + 2]); maxZ = Math.max(maxZ, positions[i + 2]);
  }
  return {
    positions: new Float32Array(positions), colors: new Float32Array(colors), count: positions.length / 3, parts,
    bounds: { minX, maxX, minY, maxY, minZ, maxZ }, detail, pointSize: (COURTYARD_DETAIL[detail] || COURTYARD_DETAIL.high).pointSize
  };
}

const SIGNALS = [
  { letter: 'A', x: 11.3, y: 1.2, z: -6.2, rssi: -61, spot: 'east doorway' },
  { letter: 'B', x: -4.2, y: 0.95, z: -5.6, rssi: -72, spot: 'west bench' },
  { letter: 'C', x: 0, y: 1.3, z: -17.5, rssi: -84, spot: 'inside the passage' },
  { letter: 'D', x: -11.45, y: 4.6, z: -7.4, rssi: -79, spot: 'west façade, upper window' },
  { letter: 'E', x: 5.4, y: 0.6, z: 0.4, rssi: -67, spot: 'beside the east planter' },
  { letter: 'F', x: 6.5, y: 1.0, z: 6.6, rssi: -58, spot: 'near the south entrance' }
];

/** Six simulated signals at authored positions. Snapshot schema matches the sparse and dense fixtures. */
export function courtyardSnapshot(now = Date.now()) {
  return {
    schema: SNAPSHOT_SCHEMA,
    source: 'synthetic courtyard: six simulated signals',
    capturedAt: new Date(now).toISOString(),
    note: 'Synthetic environment, simulated signals. Geometry and placements are authored fixtures, not reconstructed from BLE.',
    devices: SIGNALS.map((signal, index) => ({
      id: `sim-${signal.letter.toLowerCase()}`,
      number: index + 1,
      letter: signal.letter,
      name: `Simulated signal ${signal.letter}`,
      simulated: true,
      evidence: { brand: null, basis: 'none', manufacturerIds: [], serviceUuids: [], advertisedName: null },
      classification: { type: 'unknown', confidence: 'none', note: 'Simulated signal; there is no device evidence to classify.' },
      verification: null,
      signal: { rssi: signal.rssi, txPower: null, lastSeen: new Date(now).toISOString(), unit: 'simulated value; nothing was received' },
      arrangement: arrangementFor(index + 1),
      placement: {
        x: signal.x, y: signal.y, z: signal.z, spot: signal.spot,
        basis: 'authored fixture placement', units: 'scene units (not measured)'
      },
      measured: { position: null, distanceMeters: null, floor: null, note: 'Not measured. The courtyard placement is authored for this demo.' },
      calibration: [],
      note: null
    }))
  };
}
