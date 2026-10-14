// Kepler Station: hub, habitation ring, docking ring with ports, industrial
// decks, solar wings, beacons, plus a separate ore-processing facility.
import * as THREE from 'three';
import { STATION_POS, PROCESS_POS, PALETTE, mergeGeos, rand, glowTexture, smoothstep } from './config.js';

const hullMat = new THREE.MeshStandardMaterial({ color: 0x3a4048, roughness: 0.55, metalness: 0.85 });
const darkMat = new THREE.MeshStandardMaterial({ color: 0x23262c, roughness: 0.7, metalness: 0.7 });
const panelMat = new THREE.MeshStandardMaterial({ color: 0x14202f, roughness: 0.35, metalness: 0.6, emissive: 0x0a2038, emissiveIntensity: 0.6 });
const amberMat = new THREE.MeshBasicMaterial({ color: PALETTE.amber, toneMapped: true });
const amberSoft = new THREE.MeshStandardMaterial({ color: 0x2a2018, emissive: PALETTE.amber, emissiveIntensity: 1.6, roughness: 0.6, metalness: 0.4 });

export class Station {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.position.copy(STATION_POS);
    this.group.rotation.set(0.35, 0.4, -0.18);
    scene.add(this.group);

    this.dockPorts = [];   // { pos (local), normal (local), size }
    this.beacons = [];
    this.spinners = [];

    this._buildHub();
    this._buildHabRing();
    this._buildDockRing();
    this._buildIndustrial();
    this._buildSolar();
    this._buildBeacons();
    this._buildProcessing();

    this.group.updateMatrixWorld(true);
  }

  _buildHub() {
    const parts = [];
    // central spine
    parts.push(new THREE.CylinderGeometry(9, 9, 110, 16).toNonIndexed());
    const hub = new THREE.Mesh(mergeGeos(parts), hullMat);
    this.group.add(hub);
    // hub ring segments
    for (const y of [-38, 0, 38]) {
      const t = new THREE.Mesh(new THREE.TorusGeometry(13, 3, 8, 24), darkMat);
      t.rotation.x = Math.PI / 2; t.position.y = y;
      this.group.add(t);
    }
    // command module on top
    const cmd = new THREE.Mesh(new THREE.SphereGeometry(14, 20, 14), hullMat);
    cmd.position.y = 62; this.group.add(cmd);
    const cmdWin = new THREE.Mesh(new THREE.SphereGeometry(14.4, 20, 8, 0, Math.PI*2, 1.1, 0.5), amberSoft);
    cmdWin.position.y = 62; this.group.add(cmdWin);
    // antenna mast
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 40, 6), darkMat);
    mast.position.y = 88; this.group.add(mast);
    const dish = new THREE.Mesh(new THREE.SphereGeometry(7, 16, 8, 0, Math.PI*2, 0, 1.1), new THREE.MeshStandardMaterial({ color: 0x8b929c, roughness: 0.4, metalness: 0.6, side: THREE.DoubleSide }));
    dish.position.y = 106; dish.rotation.x = Math.PI; this.group.add(dish);
  }

  _buildHabRing() {
    const ring = new THREE.Group();
    const torus = new THREE.Mesh(new THREE.TorusGeometry(62, 6.5, 12, 64), hullMat);
    torus.rotation.x = Math.PI / 2;
    ring.add(torus);
    // spokes
    const spokeGeo = new THREE.CylinderGeometry(1.6, 1.6, 50, 6);
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Mesh(spokeGeo, darkMat);
      const a = (i / 6) * Math.PI * 2;
      s.position.set(Math.cos(a) * 31, 0, Math.sin(a) * 31);
      s.rotation.z = Math.PI / 2; s.rotation.y = -a;
      ring.add(s);
    }
    // windows: instanced emissive boxes around the ring
    const winGeo = new THREE.BoxGeometry(1.4, 1.6, 0.6);
    const N = 110;
    const wins = new THREE.InstancedMesh(winGeo, amberMat, N);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const up = i % 2 === 0;
      e.set(0, -a, 0);
      q.setFromEuler(e);
      m.compose(new THREE.Vector3(Math.cos(a) * 62, up ? 6.9 : -6.9, Math.sin(a) * 62), q, new THREE.Vector3(1, 1, 1));
      wins.setMatrixAt(i, m);
    }
    wins.instanceMatrix.needsUpdate = true;
    ring.add(wins);
    ring.position.y = 0;
    this.group.add(ring);
    this.spinners.push({ obj: ring, speed: 0.05 });
  }

  _buildDockRing() {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(84, 2.6, 8, 72), darkMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -30;
    this.group.add(ring);

    // 6 docking ports on the outer edge of the dock ring
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.26;
      const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const pos = dir.clone().multiplyScalar(84).setY(-30);
      // port frame
      const frame = new THREE.Mesh(new THREE.TorusGeometry(7, 0.9, 6, 20), amberSoft);
      frame.position.copy(pos);
      frame.lookAt(pos.clone().add(dir));
      this.group.add(frame);
      // guide lights
      const gl = new THREE.Mesh(new THREE.SphereGeometry(0.9, 8, 8), amberMat);
      gl.position.copy(pos).addScaledVector(dir, 1.5);
      this.group.add(gl);
      this.dockPorts.push({ pos, normal: dir.clone(), size: 1 });
    }
    // capital berth: large port at spine base — attached via a base module
    // and struts so the glowing ring reads as part of the station, not debris
    const capPos = new THREE.Vector3(0, -72, 0);
    const capNorm = new THREE.Vector3(0, -1, 0);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(14, 10, 14, 12), hullMat);
    base.position.y = -62; this.group.add(base);
    const baseRing = new THREE.Mesh(new THREE.TorusGeometry(14.5, 1.2, 6, 20), darkMat);
    baseRing.rotation.x = Math.PI / 2; baseRing.position.y = -56; this.group.add(baseRing);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const from = new THREE.Vector3(Math.cos(a) * 8, -58, Math.sin(a) * 8);
      const to = new THREE.Vector3(Math.cos(a) * 24, -72, Math.sin(a) * 24);
      const dir = new THREE.Vector3().subVectors(to, from);
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, dir.length(), 6), darkMat);
      strut.position.copy(from).addScaledVector(dir, 0.5);
      strut.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      this.group.add(strut);
    }
    const frame = new THREE.Mesh(new THREE.TorusGeometry(26, 2, 8, 32), amberSoft);
    frame.rotation.x = Math.PI / 2; frame.position.copy(capPos);
    this.group.add(frame);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const gl = new THREE.Mesh(new THREE.SphereGeometry(1.1, 6, 6), amberMat);
      gl.position.set(Math.cos(a) * 26, -72, Math.sin(a) * 26);
      this.group.add(gl);
    }
    this.dockPorts.push({ pos: capPos, normal: capNorm, size: 26 });
  }

  _buildIndustrial() {
    const parts = [];
    // deck slabs and containers hanging off the spine
    const slab = new THREE.BoxGeometry(30, 3, 18); slab.applyMatrix4(new THREE.Matrix4().makeTranslation(24, -55, 0)); parts.push(slab);
    const truss = new THREE.CylinderGeometry(1, 1, 30, 6); truss.applyMatrix4(new THREE.Matrix4().makeTranslation(16, -42, 0).multiply(new THREE.Matrix4().makeRotationZ(0.5))); parts.push(truss);
    for (let i = 0; i < 7; i++) {
      const b = new THREE.BoxGeometry(5, 4, 7);
      b.applyMatrix4(new THREE.Matrix4().makeTranslation(16 + (i % 3) * 6, -58.5, -6 + Math.floor(i / 3) * 6));
      parts.push(b);
    }
    const deck = new THREE.Mesh(mergeGeos(parts), darkMat);
    this.group.add(deck);
    // deck strip lights
    for (let i = 0; i < 5; i++) {
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.7, 6, 6), amberMat);
      l.position.set(12 + i * 6, -56.5, 9.2);
      this.group.add(l);
    }
  }

  _buildSolar() {
    const wingGeo = new THREE.BoxGeometry(70, 0.5, 16);
    for (const s of [-1, 1]) {
      const w = new THREE.Mesh(wingGeo, panelMat);
      w.position.set(s * 62, 24, 0);
      w.rotation.z = s * 0.12;
      this.group.add(w);
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 55, 6), darkMat);
      arm.position.set(s * 30, 24, 0);
      arm.rotation.z = Math.PI / 2;
      this.group.add(arm);
      this.spinners.push({ obj: w, speed: 0.012 * s, axis: 'y', pivot: this.group.position });
    }
  }

  _buildBeacons() {
    const mk = (pos, color, rate) => {
      const mat = new THREE.SpriteMaterial({ map: glowTexture(color), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
      const s = new THREE.Sprite(mat);
      s.position.copy(pos); s.scale.setScalar(10);
      this.group.add(s);
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.8, 6, 6), new THREE.MeshBasicMaterial({ color }));
      core.position.copy(pos); this.group.add(core);
      this.beacons.push({ sprite: s, core, rate, phase: Math.random() * 10 });
    };
    mk(new THREE.Vector3(62, 5, 0), 0xff3b3b, 1.1);
    mk(new THREE.Vector3(-62, 5, 0), 0x35ff7a, 1.1);
    mk(new THREE.Vector3(0, 108, 0), PALETTE.amber, 0.6);
    mk(new THREE.Vector3(84, -30, 0), 0x4fd8ff, 1.6);
    mk(new THREE.Vector3(-84, -30, 0), 0x4fd8ff, 1.6);
  }

  _buildProcessing() {
    const g = new THREE.Group();
    g.position.copy(PROCESS_POS);
    g.rotation.set(0.2, 1.1, 0.1);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(16, 20, 34, 10), hullMat);
    g.add(body);
    const hopper = new THREE.Mesh(new THREE.ConeGeometry(14, 16, 10), darkMat);
    hopper.position.y = -24; hopper.rotation.x = Math.PI;
    g.add(hopper);
    // flare stack with amber glow
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 3.5, 30, 8), darkMat);
    stack.position.set(14, 26, 0); g.add(stack);
    const flare = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(PALETTE.amber), color: PALETTE.amber, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    flare.position.set(14, 44, 0); flare.scale.setScalar(22);
    g.add(flare);
    this.flare = flare;
    // port for miners
    const portPos = new THREE.Vector3(0, 0, 26);
    const portNorm = new THREE.Vector3(0, 0, 1);
    const frame = new THREE.Mesh(new THREE.TorusGeometry(8, 1, 6, 20), amberSoft);
    frame.position.copy(portPos); frame.lookAt(portPos.clone().add(portNorm));
    g.add(frame);
    this.processPort = { pos: portPos, normal: portNorm };
    // strip lights
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.8, 6, 6), amberMat);
      l.position.set(Math.cos(a) * 17, 8, Math.sin(a) * 17);
      g.add(l);
    }
    this.scene.add(g);
    this.processGroup = g;
    g.updateMatrixWorld(true);
  }

  // world-space helpers
  portWorld(i, out) { return out.copy(this.dockPorts[i].pos).applyMatrix4(this.group.matrixWorld); }
  portNormalWorld(i, out) {
    return out.copy(this.dockPorts[i].normal).transformDirection(this.group.matrixWorld);
  }
  processPortWorld(out) { return out.copy(this.processPort.pos).applyMatrix4(this.processGroup.matrixWorld); }
  processNormalWorld(out) { return out.copy(this.processPort.normal).transformDirection(this.processGroup.matrixWorld); }

  update(dt, time) {
    for (const s of this.spinners) {
      if (s.axis === 'y') s.obj.rotation.y += dt * s.speed;
      else s.obj.rotation.y += dt * s.speed;
    }
    for (const b of this.beacons) {
      const v = smoothstep(0.25, 0.75, Math.abs(Math.sin(time * b.rate + b.phase)));
      b.sprite.material.opacity = 0.15 + v * 0.85;
      b.sprite.scale.setScalar(7 + v * 6);
      b.core.visible = v > 0.4;
    }
    this.flare.scale.setScalar(20 + Math.sin(time * 7.3) * 3 + Math.sin(time * 13.1) * 2);
  }
}
