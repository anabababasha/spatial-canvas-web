// Synthetic observation snapshots for the Space 3D prototype.
//
// The record shape follows the walking-test export (number, advertised name, manufacturer ids, service UUIDs,
// RSSI, last seen) but every value in this file is invented. Nothing here is a capture, and the fixture must
// never be mistaken for field evidence. Classifications stay "unknown" unless an operator verification exists;
// brand evidence (a manufacturer id or an advertised name) tints the glyph and nothing more.

import { SNAPSHOT_SCHEMA, arrangementFor } from './renderer-interface.js';

const MINUTE = 60000;

function seconds(ago, now) {
  return new Date(now - ago * 1000).toISOString();
}

function device(now, spec) {
  const {
    number, name = null, manufacturerIds = [], serviceUuids = [], brand = null, basis = 'none',
    classification = null, rssi = -70, txPower = null, ageSeconds = 2, verification = null, calibration = [], note = null
  } = spec;
  const evidence = { brand, basis, manufacturerIds, serviceUuids, advertisedName: name };
  return {
    id: `fixture-${String(number).padStart(3, '0')}`,
    number,
    name,
    evidence,
    classification: classification || {
      type: 'unknown', confidence: 'none',
      note: brand ? 'Brand evidence only; the device type is not asserted.' : 'No identifying evidence.'
    },
    verification,
    signal: { rssi, txPower, lastSeen: seconds(ageSeconds, now), unit: 'dBm as reported; signal strength only' },
    arrangement: arrangementFor(number),
    measured: { position: null, distanceMeters: null, floor: null, note: 'Not measured. No distance, wall or floor is known.' },
    calibration,
    note
  };
}

/**
 * Calibration intervals named in the task brief for this experiment. The recording itself was not present in the
 * workspace when this fixture was written, so no sample values appear here and nothing was modified. None of the
 * intervals is validated or verified: cal-2 and cal-3 are unvalidated operator-labelled measurements, and cal-1 is
 * suspected mistaken metadata that this experiment excludes. No correction relationship is confirmed, no model is
 * retrained and no ranging formula is applied anywhere in this prototype.
 */
export const calibrationPolicy = Object.freeze({
  source: 'Task brief, 2026-11-10. Original recording not available in this workspace; preserved unchanged wherever it lives.',
  note: 'No interval is validated. cal-2 and cal-3 are unvalidated operator-labelled measurements; cal-1 is suspected mistaken metadata and is excluded. No correction relationship is confirmed, no model is retrained and no ranging formula is applied.',
  intervals: [
    {
      id: 'cal-1', targetNumber: 1, operatorLabel: 'Smart tv Lg', status: 'suspected mistaken metadata', excluded: true,
      reason: 'cal-2 labels the same target "Windows laptop". Excluded from this experiment; the original record is preserved unchanged.'
    },
    {
      id: 'cal-2', targetNumber: 1, operatorLabel: 'Windows laptop', status: 'unvalidated operator-labelled measurement', excluded: false,
      reason: 'Operator label only; not validated and not device verification.'
    },
    {
      id: 'cal-3', targetNumber: 4, operatorLabel: 'LG webOS TV (advertised name)', status: 'unvalidated operator-labelled measurement', excluded: false,
      reason: 'Operator label only; the advertised name is untrusted data and nothing is validated.'
    }
  ]
});

function calibrationFor(number) {
  return calibrationPolicy.intervals.filter(interval => interval.targetNumber === number).map(interval => ({ ...interval }));
}

export function sparseSnapshot(now = Date.now()) {
  return {
    schema: SNAPSHOT_SCHEMA,
    source: 'synthetic fixture: sparse',
    capturedAt: new Date(now).toISOString(),
    note: 'Invented values shaped like the walking-test export. Arrangement slots come from arrival order only.',
    devices: [
      device(now, { number: 1, manufacturerIds: ['0006'], brand: 'microsoft', basis: 'manufacturer-id', rssi: -58, calibration: calibrationFor(1) }),
      device(now, {
        number: 2, name: 'Hue bulb', serviceUuids: ['fe0f'], brand: 'hue', basis: 'name-and-service', rssi: -74,
        classification: { type: 'light', confidence: 'tentative', basis: 'name-and-service', note: 'Advertised name plus FE0F support a tentative lighting family; neither alone establishes it.' }
      }),
      device(now, { number: 3, manufacturerIds: ['004c'], brand: 'apple', basis: 'manufacturer-id', rssi: -81, note: 'Apple company data alone does not identify a wearable, phone or tracker.' }),
      device(now, { number: 4, name: 'LG webOS TV', brand: 'lg', basis: 'advertised-name', rssi: -66, calibration: calibrationFor(4), note: 'The advertised name claims a TV; an advertised name is untrusted data, so the type stays unknown.' }),
      device(now, {
        number: 5, name: 'HP-Print-7C', manufacturerIds: ['0003'], brand: 'none', basis: 'advertised-name', rssi: -70,
        verification: { label: 'Office printer (synthetic fixture)', method: 'synthetic fixture standing in for a label-photo verification', verifiedAt: seconds(900, now), synthetic: true },
        classification: { type: 'printer', confidence: 'verified', basis: 'synthetic fixture', synthetic: true, note: 'Synthetic fixture only: it exercises the verified-type glyph path. No real-world asset was verified.' }
      }),
      device(now, { number: 6, rssi: -90, ageSeconds: 75, note: 'Unresolved beacon; aged past 60 seconds and drawn dimmed.' })
    ]
  };
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

const BRAND_POOL = [
  { brand: 'apple', basis: 'manufacturer-id', manufacturerIds: ['004c'] },
  { brand: 'microsoft', basis: 'manufacturer-id', manufacturerIds: ['0006'] },
  { brand: 'google', basis: 'manufacturer-id', manufacturerIds: ['00e0'] },
  { brand: 'samsung', basis: 'manufacturer-id', manufacturerIds: ['0075'] },
  { brand: 'lg', basis: 'advertised-name', name: 'LG webOS TV' },
  { brand: null, basis: 'none' },
  { brand: null, basis: 'none' }
];

export function denseSnapshot(count = 120, seed = 7, now = Date.now()) {
  const random = mulberry32(seed);
  const devices = [];
  for (let number = 1; number <= count; number++) {
    const pick = BRAND_POOL[Math.floor(random() * BRAND_POOL.length)];
    const spec = {
      number, rssi: -55 - Math.floor(random() * 40), ageSeconds: random() < 0.1 ? 70 + Math.floor(random() * 30) : Math.floor(random() * 20),
      brand: pick.brand, basis: pick.basis, manufacturerIds: pick.manufacturerIds || [], name: pick.name || null
    };
    if (random() < 0.08) {
      const type = ['printer', 'access-point', 'display'][Math.floor(random() * 3)];
      spec.verification = { label: `${type} ${number} (synthetic fixture)`, method: 'synthetic fixture standing in for a label-photo verification', verifiedAt: seconds(600, now), synthetic: true };
      spec.classification = { type, confidence: 'verified', basis: 'synthetic fixture', synthetic: true, note: 'Synthetic fixture only; no real-world asset was verified.' };
    }
    devices.push(device(now, spec));
  }
  return {
    schema: SNAPSHOT_SCHEMA,
    source: `synthetic fixture: dense (${count}, seed ${seed})`,
    capturedAt: new Date(now).toISOString(),
    note: 'Deterministic invented population for density and frame-time checks.',
    devices
  };
}

/**
 * A later observation of the same population: RSSI jitter, refreshed timestamps and a few devices ageing out.
 * Ids and arrangement slots are unchanged, so a renderer must update in place rather than rebuild.
 */
export function tickSnapshot(snapshot, step, now = Date.now()) {
  const random = mulberry32(1000 + step);
  return {
    ...snapshot,
    capturedAt: new Date(now).toISOString(),
    devices: snapshot.devices.map((item, index) => {
      const jitter = Math.round((random() - 0.5) * 6);
      const ages = (index + step) % 15 === 0;
      return {
        ...item,
        signal: {
          ...item.signal,
          rssi: Math.max(-99, Math.min(-40, (item.signal.rssi ?? -70) + jitter)),
          lastSeen: ages ? new Date(now - 1.5 * MINUTE).toISOString() : new Date(now).toISOString()
        }
      };
    })
  };
}
