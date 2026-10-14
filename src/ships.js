// Ship geometry per class + propulsion VFX: luminous cores, layered plumes,
// exhaust particles, ribbon trails, maneuvering thruster flashes, jump effects.
import * as THREE from 'three';
import { PALETTE, mergeGeos, rand, glowTexture, clamp } from './config.js';

// ---------------------------------------------------------------- materials
const hullMats = {};
function hullMat(cls) {
  if (!hullMats[cls]) {
    const base = { roughness: 0.55, metalness: 0.85 };
    const colors = { freighter: 0x23272e, courier: 0x2a2f37, miner: 0x302e28, patrol: 0x333942, drone: 0x3c424b, capital: 0x1d2026, unknown: 0x15171b };
    hullMats[cls] = new THREE.MeshStandardMaterial({ color: colors[cls] ?? 0x343a44, ...base });
  }
  return hullMats[cls];
}
function winMat() {
  return new THREE.MeshStandardMaterial({ color: 0x1a140c, emissive: 0xffc87a, emissiveIntensity: 1.7, roughness: 0.6, metalness: 0.3 });
}
function coreMat(color) {
  return new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: 5.0, roughness: 0.3, metalness: 0 });
}

const PLUME_VS = /* glsl */`
  varying float vT;
  void main(){
    vT = -position.z; // 0 at engine, 1 at plume tip (unit cone)
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
  }`;
const PLUME_FS = /* glsl */`
  uniform vec3 uColor; uniform float uThrottle; uniform float uTime;
  varying float vT;
  void main(){
    float body = pow(1.0 - vT, 1.6);
    float shimmer = 0.82 + 0.18*sin(uTime*34.0 + vT*26.0) + 0.08*sin(uTime*57.0 - vT*40.0);
    float a = body * shimmer * uThrottle;
    vec3 col = uColor * (0.7 + body*1.8) + vec3(1.0)*pow(1.0-vT, 6.0)*0.9;
    gl_FragColor = vec4(col * a, a);
  }`;

function plumeGeometry() {
  const g = new THREE.ConeGeometry(1, 1, 10, 1, true);
  g.rotateX(Math.PI / 2);          // apex -> +? ; apex at +z*0.5, base at -z*0.5
  g.translate(0, 0, -0.5);         // apex at 0, base at -1  (extends backward)
  return g;
}
const _plumeGeo = plumeGeometry();

// ---------------------------------------------------------------- class defs
export const CLASS_DEFS = {};

function defFreighter() {
  const p = [];
  p.push(new THREE.BoxGeometry(10, 9, 40));
  p.push((() => { const g = new THREE.BoxGeometry(6, 6, 9); g.translate(0, 0, 24); return g; })());
  p.push((() => { const g = new THREE.BoxGeometry(13, 9, 6); g.translate(0, 0, -23); return g; })());
  for (const s of [-1, 1]) { const g = new THREE.BoxGeometry(4.5, 6.5, 11); g.translate(s * 7.6, 0, 4); p.push(g); }
  for (const s of [-1, 1]) { const g = new THREE.BoxGeometry(1, 7, 9); g.translate(s * 6, 5, -19); p.push(g); }
  const w = [];
  for (let i = 0; i < 5; i++) { const g = new THREE.BoxGeometry(3.4, 0.5, 1.1); g.translate(0, 4.6, 6 + i * 3.4); w.push(g); }
  return {
    hull: mergeGeos(p), wins: mergeGeos(w), len: 52,
    engines: [{ x: -4.5, y: 0, z: -26.5, r: 2.3 }, { x: 4.5, y: 0, z: -26.5, r: 2.3 }],
    engineColor: PALETTE.freighter, trailW: 2.4, trailLen: 52,
  };
}
function defCourier() {
  const p = [];
  const body = new THREE.CylinderGeometry(1.7, 1.7, 10, 10); body.rotateX(Math.PI / 2); p.push(body);
  const nose = new THREE.ConeGeometry(1.7, 5, 10); nose.rotateX(Math.PI / 2); nose.translate(0, 0, 7.5); p.push(nose);
  for (const s of [-1, 1]) { const g = new THREE.BoxGeometry(5.5, 0.5, 4); g.translate(s * 3.6, 0, -1); g.rotateY(s * -0.35); p.push(g); }
  for (const s of [-1, 1]) { const g = new THREE.BoxGeometry(0.5, 2.6, 2.6); g.translate(s * 6.1, 1, -2); p.push(g); }
  const w = [(() => { const g = new THREE.BoxGeometry(1.3, 0.7, 1.6); g.translate(0, 1.1, 4.2); return g; })()];
  return {
    hull: mergeGeos(p), wins: mergeGeos(w), len: 15,
    engines: [{ x: -1.6, y: 0, z: -6.5, r: 1.0 }, { x: 1.6, y: 0, z: -6.5, r: 1.0 }],
    engineColor: PALETTE.courier, trailW: 0.9, trailLen: 40,
  };
}
function defMiner() {
  const p = [];
  p.push(new THREE.BoxGeometry(8, 7, 14));
  const hop = new THREE.BoxGeometry(6.5, 5.5, 6); hop.translate(0, -1, -9.5); p.push(hop);
  const arm = new THREE.CylinderGeometry(0.8, 0.5, 9, 8); arm.rotateX(Math.PI / 2); arm.translate(0, -1.5, 11); p.push(arm);
  const tip = new THREE.ConeGeometry(0.9, 2.4, 8); tip.rotateX(Math.PI / 2); tip.translate(0, -1.5, 16.5); p.push(tip);
  for (const s of [-1, 1]) { const g = new THREE.BoxGeometry(1, 4, 6); g.translate(s * 4.8, 2, -4); p.push(g); }
  const w = [(() => { const g = new THREE.BoxGeometry(4, 0.5, 1); g.translate(0, 3.6, 3); return g; })(),
             (() => { const g = new THREE.BoxGeometry(1, 1, 0.6); g.translate(0, 2, 7.1); return g; })()];
  return {
    hull: mergeGeos(p), wins: mergeGeos(w), len: 28,
    engines: [{ x: -3.4, y: 1, z: -12.5, r: 1.5 }, { x: 3.4, y: 1, z: -12.5, r: 1.5 }],
    engineColor: PALETTE.miner, trailW: 1.3, trailLen: 44, beam: { origin: new THREE.Vector3(0, -1.5, 17.5), len: 16 },
  };
}
function defPatrol() {
  const p = [];
  const body = new THREE.ConeGeometry(1.9, 9, 8); body.rotateX(Math.PI / 2); body.translate(0, 0, 3); p.push(body);
  const mid = new THREE.CylinderGeometry(1.9, 1.5, 6, 8); mid.rotateX(Math.PI / 2); mid.translate(0, 0, -3); p.push(mid);
  for (const s of [-1, 1]) { const g = new THREE.BoxGeometry(6, 0.4, 3.4); g.translate(s * 3.8, 0, -2); g.rotateY(s * -0.5); p.push(g); }
  for (const s of [-1, 1]) { const g = new THREE.CylinderGeometry(1.1, 1.1, 4, 8); g.rotateX(Math.PI / 2); g.translate(s * 2.2, 0, -6.5); p.push(g); }
  const w = [(() => { const g = new THREE.BoxGeometry(1.1, 0.6, 1.2); g.translate(0, 1.4, 3.5); return g; })()];
  return {
    hull: mergeGeos(p), wins: mergeGeos(w), len: 16,
    engines: [{ x: -2.2, y: 0, z: -8.6, r: 1.1 }, { x: 2.2, y: 0, z: -8.6, r: 1.1 }],
    engineColor: PALETTE.patrol, trailW: 1.0, trailLen: 42,
  };
}
function defDrone() {
  const p = [];
  p.push(new THREE.BoxGeometry(1.7, 1.3, 2.8));
  const arm = new THREE.BoxGeometry(4, 0.3, 0.3); p.push(arm);
  const dish = new THREE.CylinderGeometry(0.7, 0.7, 0.2, 8); dish.translate(0, 0.9, 0.4); p.push(dish);
  const w = [(() => { const g = new THREE.BoxGeometry(0.6, 0.4, 0.3); g.translate(0, 0.2, 1.45); return g; })()];
  return {
    hull: mergeGeos(p), wins: mergeGeos(w), len: 4,
    engines: [{ x: 0, y: 0, z: -1.9, r: 0.5 }],
    engineColor: PALETTE.drone, trailW: 0.28, trailLen: 26,
  };
}
function defCapital() {
  const p = [];
  p.push(new THREE.BoxGeometry(22, 16, 120));
  const bow = new THREE.ConeGeometry(11, 26, 6); bow.rotateX(Math.PI / 2); bow.translate(0, 0, 73); p.push(bow);
  const bridge = new THREE.BoxGeometry(13, 9, 26); bridge.translate(0, 13, 34); p.push(bridge);
  const tower = new THREE.BoxGeometry(6, 6, 10); tower.translate(0, 21, 40); p.push(tower);
  for (const s of [-1, 1]) { const g = new THREE.BoxGeometry(4, 10, 30); g.translate(s * 14, -2, -30); p.push(g); }
  for (const s of [-1, 1]) for (const z of [-52, -34]) { const g = new THREE.CylinderGeometry(4.5, 4.5, 12, 10); g.rotateX(Math.PI / 2); g.translate(s * 8, -4, z - 6); p.push(g); }
  const w = [];
  for (let i = 0; i < 14; i++) for (const s of [-1, 1]) {
    const g = new THREE.BoxGeometry(0.6, 1.2, 2.2); g.translate(s * 11.2, 3, -40 + i * 6); w.push(g);
  }
  for (let i = 0; i < 6; i++) { const g = new THREE.BoxGeometry(8, 0.6, 1.6); g.translate(0, 17.6, 26 + i * 3.4); w.push(g); }
  return {
    hull: mergeGeos(p), wins: mergeGeos(w), len: 150,
    engines: [
      { x: -8, y: -4, z: -70, r: 4.2 }, { x: 8, y: -4, z: -70, r: 4.2 },
      { x: -8, y: -4, z: -52, r: 3.0 }, { x: 8, y: -4, z: -52, r: 3.0 },
    ],
    engineColor: PALETTE.capital, trailW: 6.5, trailLen: 64,
  };
}
function defUnknown() {
  const p = [];
  const body = new THREE.ConeGeometry(2.4, 12, 6); body.rotateX(Math.PI / 2); p.push(body);
  for (const s of [-1, 1]) { const g = new THREE.BoxGeometry(4, 0.5, 3); g.translate(s * 3, 0, -3); g.rotateY(s * -0.6); p.push(g); }
  return {
    hull: mergeGeos(p), wins: mergeGeos([]), len: 14,
    engines: [{ x: 0, y: 0, z: -6.5, r: 1.3 }],
    engineColor: PALETTE.unknown, trailW: 0.9, trailLen: 36,
  };
}
CLASS_DEFS.freighter = defFreighter();
CLASS_DEFS.courier = defCourier();
CLASS_DEFS.miner = defMiner();
CLASS_DEFS.patrol = defPatrol();
CLASS_DEFS.drone = defDrone();
CLASS_DEFS.capital = defCapital();
CLASS_DEFS.unknown = defUnknown();

// ---------------------------------------------------------------- trail
class Trail {
  constructor(def, color) {
    this.N = def.trailLen;
    const n = this.N;
    this.pts = [];
    const pos = new Float32Array(n * 2 * 3);
    const alpha = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const a = Math.pow(1 - i / (n - 1), 1.6);
      alpha[i * 2] = a; alpha[i * 2 + 1] = a;
    }
    const idx = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
    g.setIndex(idx);
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: 1 } },
      vertexShader: `attribute float aAlpha; varying float vA;
        void main(){ vA = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 uColor; uniform float uOpacity; varying float vA;
        void main(){ gl_FragColor = vec4(uColor * vA * 1.6, vA * uOpacity); }`,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.width = def.trailW;
    this.last = new THREE.Vector3();
    this.hasLast = false;
  }
  reset(p) {
    this.pts.length = 0;
    for (let i = 0; i < this.N; i++) this.pts.push(p.clone());
    this.hasLast = false;
  }
  push(p, minDist) {
    if (!this.hasLast || p.distanceToSquared(this.last) > minDist * minDist) {
      this.pts.push(p.clone());
      if (this.pts.length > this.N) this.pts.shift();
      this.last.copy(p);
      this.hasLast = true;
    }
  }
  update(camPos) {
    const pos = this.geo.attributes.position.array;
    const n = this.N, pts = this.pts;
    const dir = new THREE.Vector3(), toCam = new THREE.Vector3(), perp = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const p = pts[Math.min(i, pts.length - 1)];
      const pn = pts[Math.min(i + 1, pts.length - 1)];
      dir.subVectors(pn, p);
      if (dir.lengthSq() < 1e-8) dir.set(1, 0, 0);
      toCam.subVectors(camPos, p);
      perp.crossVectors(dir, toCam).normalize();
      if (!isFinite(perp.x)) perp.set(1, 0, 0);
      const w = this.width * (1 - i / (n - 1)) * 0.5 + 0.02;
      pos[i * 6] = p.x + perp.x * w; pos[i * 6 + 1] = p.y + perp.y * w; pos[i * 6 + 2] = p.z + perp.z * w;
      pos[i * 6 + 3] = p.x - perp.x * w; pos[i * 6 + 4] = p.y - perp.y * w; pos[i * 6 + 5] = p.z - perp.z * w;
    }
    this.geo.attributes.position.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- ship visual
export class ShipVisual {
  constructor(cls, scene, fx) {
    const def = CLASS_DEFS[cls];
    this.cls = cls; this.def = def; this.fx = fx;
    this.group = new THREE.Group();

    this.hull = new THREE.Mesh(def.hull, hullMat(cls));
    this.hull.castShadow = false;
    this.group.add(this.hull);
    if (def.wins.attributes.position.count > 0) {
      this.wins = new THREE.Mesh(def.wins, winMat());
      this.group.add(this.wins);
    }

    // engine cores + plumes
    this.cores = []; this.plumes = [];
    const cm = coreMat(def.engineColor);
    for (const e of def.engines) {
      const core = new THREE.Mesh(new THREE.SphereGeometry(e.r * 0.75, 10, 8), cm);
      core.position.set(e.x, e.y, e.z);
      this.group.add(core); this.cores.push({ mesh: core, r: e.r });
      const pm = new THREE.ShaderMaterial({
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        uniforms: { uColor: { value: new THREE.Color(def.engineColor) }, uThrottle: { value: 0 }, uTime: { value: 0 } },
        vertexShader: PLUME_VS, fragmentShader: PLUME_FS,
      });
      const plume = new THREE.Mesh(_plumeGeo, pm);
      plume.position.set(e.x, e.y, e.z - e.r * 0.6);
      plume.scale.set(e.r * 0.9, e.r * 0.9, 0.01);
      this.group.add(plume); this.plumes.push({ mesh: plume, pm, r: e.r });
    }

    // nav lights (blink)
    this.nav = [];
    if (cls !== 'unknown') {
      const mk = (x, z, color) => {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(color), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
        s.position.set(x, 0.5, z); s.scale.setScalar(def.len * 0.07 + 1.0);
        this.group.add(s); this.nav.push(s);
      };
      mk(-def.len * 0.16, def.len * 0.3, 0xff4455);
      mk(def.len * 0.16, def.len * 0.3, 0x44ff88);
      mk(0, -def.len * 0.42, 0xffffff);
    }

    // mining beam
    if (def.beam) {
      const bg = new THREE.CylinderGeometry(0.5, 1.4, def.beam.len, 8, 1, true);
      bg.rotateX(Math.PI / 2); bg.translate(0, 0, def.beam.len / 2);
      this.beamMat = new THREE.ShaderMaterial({
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        uniforms: { uTime: { value: 0 }, uOn: { value: 0 } },
        vertexShader: `varying float vT; void main(){ vT = position.z / ${def.beam.len}.0; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
        fragmentShader: `uniform float uTime; uniform float uOn; varying float vT;
          void main(){ float f = 0.6+0.4*sin(uTime*40.0+vT*30.0); float a = uOn * f * (1.0-vT*0.5);
          gl_FragColor = vec4(vec3(0.4,1.0,0.9)*a*2.2, a); }`,
      });
      this.beam = new THREE.Mesh(bg, this.beamMat);
      this.beam.position.copy(def.beam.origin);
      this.beam.visible = false;
      this.group.add(this.beam);
    }

    this.trail = new Trail(def, def.engineColor);
    scene.add(this.group);
    scene.add(this.trail.mesh);

    this.throttle = 0;
    this._time = 0;
    this.hull.userData.shipMesh = this;
  }

  setThrottle(t) { this.throttle = clamp(t, 0, 1); }

  update(dt, time, camPos, quality) {
    this._time += dt;
    const thr = this.throttle;
    for (const p of this.plumes) {
      p.pm.uniforms.uThrottle.value = thr;
      p.pm.uniforms.uTime.value = this._time;
      const len = p.r * (1.5 + thr * 9);
      p.mesh.scale.set(p.r * (0.85 + thr * 0.35), p.r * (0.85 + thr * 0.35), Math.max(0.01, len));
      p.mesh.visible = thr > 0.02;
    }
    const pulse = 0.8 + 0.2 * Math.sin(this._time * 12);
    for (const c of this.cores) {
      const s = (0.5 + thr * 0.9) * pulse;
      c.mesh.scale.setScalar(Math.max(0.15, s));
    }
    // nav blink
    if (this.nav.length) {
      const on = Math.sin(time * 2.2 + this.group.id) > 0.1;
      for (const s of this.nav) s.visible = on;
    }
    if (this.beamMat) this.beamMat.uniforms.uTime.value = this._time;
    // trail LOD: skip update when far
    const d2 = this.group.position.distanceToSquared(camPos);
    const far = d2 > 900 * 900;
    this.trail.mesh.visible = !far || quality.trailsFar;
    if (this.trail.mesh.visible) this.trail.update(camPos);
  }

  engineWorld(i, out) {
    const e = this.def.engines[i];
    return out.set(e.x, e.y, e.z).applyMatrix4(this.group.matrixWorld);
  }
  dispose(scene) {
    scene.remove(this.group);
    scene.remove(this.trail.mesh);
    this.trail.mat.dispose(); this.trail.geo.dispose();
  }
}

// ---------------------------------------------------------------- FX pools
export class FX {
  constructor(scene) {
    this.scene = scene;
    this._buildParticles();
    this._buildFlashes();
    this._buildJumps();
  }

  _buildParticles() {
    const N = this.MAXP = 1600;
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), alpha = new Float32Array(N), size = new Float32Array(N);
    this.pVel = new Float32Array(N * 3);
    this.pLife = new Float32Array(N);
    this.pMax = new Float32Array(N);
    this.pHead = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
    this.pGeo = g;
    this.pMat = new THREE.ShaderMaterial({
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      uniforms: { uPR: { value: 1 } },
      vertexShader: `attribute vec3 aColor; attribute float aAlpha; attribute float aSize;
        uniform float uPR; varying vec3 vC; varying float vA;
        void main(){ vC=aColor; vA=aAlpha; vec4 mv=modelViewMatrix*vec4(position,1.0);
          gl_PointSize = aSize * uPR * (300.0 / max(-mv.z, 1.0)); gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `varying vec3 vC; varying float vA;
        void main(){ vec2 d=gl_PointCoord-0.5; float m=smoothstep(0.5,0.05,length(d));
          gl_FragColor = vec4(vC*vA*2.0, m*vA); }`,
    });
    this.pPoints = new THREE.Points(g, this.pMat);
    this.pPoints.frustumCulled = false;
    this.scene.add(this.pPoints);
    this._c = new THREE.Color();
  }

  spawnExhaust(pos, dir, color, speed, size = 1.2) {
    const i = this.pHead; this.pHead = (this.pHead + 1) % this.MAXP;
    const p = this.pGeo.attributes.position.array;
    const v = this.pVel;
    p[i*3] = pos.x + rand(-0.5, 0.5); p[i*3+1] = pos.y + rand(-0.5, 0.5); p[i*3+2] = pos.z + rand(-0.5, 0.5);
    const sp = speed * rand(0.5, 1.2);
    v[i*3] = dir.x * sp + rand(-2, 2); v[i*3+1] = dir.y * sp + rand(-2, 2); v[i*3+2] = dir.z * sp + rand(-2, 2);
    const c = this.pGeo.attributes.aColor.array;
    this._c.set(color);
    c[i*3] = this._c.r; c[i*3+1] = this._c.g; c[i*3+2] = this._c.b;
    const life = rand(0.5, 1.1);
    this.pLife[i] = life; this.pMax[i] = life;
    this.pGeo.attributes.aSize.array[i] = size * rand(0.7, 1.5);
  }

  _buildFlashes() {
    this.flashes = [];
    const tex = glowTexture(0xbfe4ff, 0.35);
    for (let i = 0; i < 26; i++) {
      const m = new THREE.SpriteMaterial({ map: tex, color: 0xcfeaff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 });
      const s = new THREE.Sprite(m); s.visible = false; s.scale.setScalar(1);
      this.scene.add(s);
      this.flashes.push({ s, life: 0, max: 1, size: 1 });
    }
    this.fHead = 0;
  }
  thrusterFlash(pos, size = 3) {
    const f = this.flashes[this.fHead]; this.fHead = (this.fHead + 1) % this.flashes.length;
    f.s.position.copy(pos); f.s.visible = true;
    f.life = f.max = rand(0.25, 0.45); f.size = size;
  }

  _buildJumps() {
    this.jumps = [];
    const ringTex = this._ringTexture();
    for (let i = 0; i < 6; i++) {
      const g = new THREE.Group();
      const ring = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTex, color: PALETTE.jump, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
      const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(PALETTE.jump, 0.3), color: PALETTE.jump, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
      g.add(ring); g.add(flash); g.visible = false;
      this.scene.add(g);
      this.jumps.push({ g, ring, flash, life: 0, max: 1, size: 1 });
    }
    this.jHead = 0;
  }
  _ringTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const ctx = c.getContext('2d');
    ctx.strokeStyle = 'rgba(255,255,255,1)'; ctx.lineWidth = 7;
    ctx.beginPath(); ctx.arc(64, 64, 52, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 16;
    ctx.beginPath(); ctx.arc(64, 64, 52, 0, Math.PI * 2); ctx.stroke();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  jumpFX(pos, size = 40, color = PALETTE.jump) {
    const j = this.jumps[this.jHead]; this.jHead = (this.jHead + 1) % this.jumps.length;
    j.g.position.copy(pos); j.g.visible = true;
    j.life = j.max = 1.6; j.size = size;
    j.ring.material.color.set(color); j.flash.material.color.set(color);
  }

  update(dt) {
    // particles
    const p = this.pGeo.attributes.position.array, v = this.pVel, life = this.pLife, max = this.pMax;
    const al = this.pGeo.attributes.aAlpha.array;
    for (let i = 0; i < this.MAXP; i++) {
      if (life[i] <= 0) { al[i] = 0; continue; }
      life[i] -= dt;
      p[i*3] += v[i*3] * dt; p[i*3+1] += v[i*3+1] * dt; p[i*3+2] += v[i*3+2] * dt;
      v[i*3] *= (1 - dt * 0.8); v[i*3+1] *= (1 - dt * 0.8); v[i*3+2] *= (1 - dt * 0.8);
      al[i] = Math.max(0, life[i] / max[i]);
    }
    this.pGeo.attributes.position.needsUpdate = true;
    this.pGeo.attributes.aAlpha.needsUpdate = true;
    this.pGeo.attributes.aColor.needsUpdate = true;
    this.pGeo.attributes.aSize.needsUpdate = true;
    // flashes
    for (const f of this.flashes) {
      if (f.life <= 0) continue;
      f.life -= dt;
      const t = Math.max(0, f.life / f.max);
      f.s.material.opacity = t;
      f.s.scale.setScalar(f.size * (1.6 - t * 0.6));
      if (f.life <= 0) f.s.visible = false;
    }
    // jumps
    for (const j of this.jumps) {
      if (j.life <= 0) continue;
      j.life -= dt;
      const t = 1 - Math.max(0, j.life / j.max);
      j.ring.material.opacity = (1 - t) * 0.9;
      j.ring.scale.setScalar(j.size * (0.2 + t * 2.4));
      j.flash.material.opacity = Math.pow(1 - t, 2) * 1.2;
      j.flash.scale.setScalar(j.size * (0.5 + t * 0.8));
      if (j.life <= 0) j.g.visible = false;
    }
  }

  setQuality(pr) { this.pMat.uniforms.uPR.value = pr; }
}
