// Shared constants, palette and small math helpers.
import * as THREE from 'three';

export const PLANET_R = 900;
export const STATION_POS = new THREE.Vector3(0, 90, 1150);
export const STATION_RADIUS = 150;          // bounding sphere for camera collision
export const PROCESS_POS = new THREE.Vector3(330, -60, 1330); // ore processing facility
export const BELT_IN = 1560, BELT_OUT = 1980;

export const SUN_DIR = new THREE.Vector3(-0.72, 0.22, 0.62).normalize();

export const PALETTE = {
  freighter: 0x2f6bd8,   // deep electric blue
  courier:   0x3fd4ff,   // cyan
  miner:     0x2fe8c8,   // teal
  patrol:    0xbfe4ff,   // white-blue
  drone:     0x63b7ff,   // soft blue
  capital:   0x8f7bff,   // violet-blue
  unknown:   0xff5e7a,   // red (unidentified)
  jump:      0xa86bff,   // violet
  amber:     0xffb45e,   // station lighting
};

export const CLASS_LABEL = {
  freighter: 'Heavy Cargo Freighter',
  courier:   'System Courier',
  miner:     'Mining Vessel',
  patrol:    'Patrol Cutter',
  drone:     'Maintenance Drone',
  capital:   'Capital Ship',
  unknown:   'Unidentified Vessel',
};

// ---------------------------------------------------------------- helpers
export const rand = (a, b) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = arr => arr[Math.floor(Math.random() * arr.length)];
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const damp = (lambda, dt) => 1 - Math.exp(-lambda * dt);

// deterministic-ish seeded rng for procedural layout
export function makeRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// merge non-indexed geometries (position/normal/uv) — avoids external addon dep
export function mergeGeos(geos) {
  const parts = geos.map(g => g.index ? g.toNonIndexed() : g);
  let total = 0;
  for (const g of parts) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), uv = new Float32Array(total * 2);
  let o = 0;
  for (const g of parts) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3);
    if (g.attributes.normal) nor.set(g.attributes.normal.array, o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
    o += n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return out;
}

// radial-gradient sprite texture (cached by color)
const _spriteCache = new Map();
export function glowTexture(colorHex = 0xffffff, soft = 0.5) {
  const key = colorHex + '_' + soft;
  if (_spriteCache.has(key)) return _spriteCache.get(key);
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const col = new THREE.Color(colorHex);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  const rgb = `${Math.round(col.r*255)},${Math.round(col.g*255)},${Math.round(col.b*255)}`;
  g.addColorStop(0, `rgba(${rgb},1)`);
  g.addColorStop(soft, `rgba(${rgb},0.35)`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  _spriteCache.set(key, tex);
  return tex;
}

// ---------------------------------------------------------------- names
const NAME_A = ['Meridian','Vagrant','Halcyon','Ironwake','Solace','Nightjar','Petrel','Cormorant','Alderaan','Borealis','Cinder','Wayfarer','Tanager','Longview','Kestrel','Ouroboros','Vesper','Hearth','Zenith','Marlin','Northwind','Quiet','Rimei','Tessellate','Umbra','Valiant','Wanderlight','Aphelion','Perihelion','Gannet','Sable','Tidewatcher','Fathom','Lodestar','Quarry','Silverwake','Duskrunner','Halyard','Copperline','Windward'];
const NAME_B = ['Drift','Song','Reach','Fall','Wake','Run','Hope','Ledger','Crossing','Tally','Reckoning','Pass','Herald','Charge','Vow','Current','Sweep','Crown','Trace','Circuit'];
const PREFIX = { freighter: 'FC', courier: 'CUR', miner: 'MIN', patrol: 'SEC', drone: 'DRN', capital: 'CAP', unknown: 'UNK' };
const _usedNames = new Set();
export function shipName(cls) {
  for (let i = 0; i < 60; i++) {
    const n = `${PREFIX[cls]}-${randInt(100, 99)}${pick(['A','B','C','D','X',''])} ${pick(NAME_A)} ${pick(NAME_B)}`;
    if (!_usedNames.has(n)) { _usedNames.add(n); return n; }
  }
  return `${PREFIX[cls]}-${randInt(1000,9999)} ${pick(NAME_A)}`;
}
