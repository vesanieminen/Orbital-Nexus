// Cinematic camera director: shot list with smooth eased blends, manual
// orbit/zoom override, resume-from-current-viewpoint, follow & station modes.
import * as THREE from 'three';
import { STATION_POS, STATION_RADIUS, PLANET_R, SUN_DIR, damp, rand, pick, clamp, smoothstep } from './config.js';

export class Director {
  constructor(camera, station, fleet, world) {
    this.camera = camera;
    this.station = station;
    this.fleet = fleet;
    this.world = world;

    this.mode = 'cine';           // cine | station | follow
    this.manual = false;
    this.followed = null;

    this.pos = new THREE.Vector3(1500, 700, 2600);
    this.target = STATION_POS.clone();
    this._desiredPos = this.pos.clone();
    this._desiredTgt = this.target.clone();
    this._fromPos = this.pos.clone();
    this._fromTgt = this.target.clone();
    this._blend = 1;
    this._blendDur = 2.6;

    this.shot = null;
    this._shotTimer = 0;
    this._lastType = '';
    this._capitalShown = null;

    // manual orbit params
    this.mTheta = 0; this.mPhi = 0.3; this.mDist = 900;
    this.mTarget = STATION_POS.clone();
    this._t = 0;

    this._pickShot('WIDE');       // opening: striking wide shot
    this._syncDesired(0);
    this.pos.copy(this._desiredPos); this.target.copy(this._desiredTgt);
    this.camera.position.copy(this.pos);
  }

  // ---------------------------------------------------------------- shots
  _pickShot(force = null) {
    const f = this.fleet;
    let type = force;
    if (!type) {
      // capital arrival priority
      const cap = f.lastCapital;
      if (cap && !cap.dead && cap.state !== 'DOCKED' && this._capitalShown !== cap.id &&
          cap.pos.distanceTo(STATION_POS) > 900) type = 'CAPITAL';
      if (!type) {
        const pool = ['ORBIT', 'DOLLY', 'FLYBY', 'TRACK', 'MINING', 'ORBIT', 'TRACK', 'DOLLY'];
        type = pick(pool);
        if (type === this._lastType) type = pick(pool);
      }
    }
    this._lastType = type;
    const s = { type, dur: 10 };
    const st = STATION_POS;

    switch (type) {
      case 'WIDE': {
        const a = rand(0.4, 1.4);
        s.anchor = st.clone();
        s.pos = st.clone().add(new THREE.Vector3(Math.cos(a) * 1350, 380 + rand(-120, 200), Math.sin(a) * 1350));
        s.tgt = st.clone();
        s.dur = 11;
        break;
      }
      case 'ORBIT': {
        s.ang = rand(0, Math.PI * 2);
        s.angSpeed = rand(0.05, 0.11) * (Math.random() < 0.5 ? -1 : 1);
        s.radius = rand(520, 950);
        s.height = rand(60, 320) * (Math.random() < 0.5 ? -1 : 1);
        s.dur = rand(14, 20);
        break;
      }
      case 'DOLLY': {
        const g1 = pick(this.fleet.gates), g2 = pick(this.fleet.gates);
        s.a = g1.clone(); s.b = g2.clone();
        s.t = 0;
        s.speed = 1 / s.dur;
        s.dur = rand(9, 13);
        break;
      }
      case 'FLYBY': {
        const cands = f.ships.filter(sh => ['freighter', 'courier', 'patrol', 'capital'].includes(sh.cls) && sh.state !== 'DOCKED');
        if (!cands.length) { this._pickShot('ORBIT'); return; }
        s.ship = pick(cands);
        s.t = 0;
        s.side = new THREE.Vector3(rand(-1, 1), rand(-0.4, 0.8), rand(-1, 1)).normalize().multiplyScalar(s.ship.def.len * 1.1 + 25);
        s.dur = rand(7, 10);
        break;
      }
      case 'TRACK': {
        const cands = f.ships.filter(sh => sh.state === 'APPROACH' || sh.state === 'CRUISE' || sh.state === 'DEPART');
        if (!cands.length) { this._pickShot('ORBIT'); return; }
        s.ship = pick(cands);
        s.off = new THREE.Vector3(rand(-1, 1) > 0 ? 1 : -1, rand(0.2, 0.7), rand(-0.6, -0.2))
          .normalize().multiplyScalar(s.ship.def.len * 1.4 + 40);
        s.dur = rand(10, 14);
        break;
      }
      case 'MINING': {
        const miners = f.ships.filter(sh => sh.cls === 'miner' && sh.site >= 0);
        if (!miners.length) { this._pickShot('ORBIT'); return; }
        s.ship = pick(miners);
        s.dur = rand(9, 13);
        break;
      }
      case 'CAPITAL': {
        s.ship = f.lastCapital;
        this._capitalShown = s.ship.id;
        s.dur = 14;
        break;
      }
    }
    this.shot = s;
    this._shotTimer = s.dur;
    this._fromPos.copy(this.pos);
    this._fromTgt.copy(this.target);
    this._blend = 0;
  }

  _syncDesired(dt) {
    const s = this.shot, st = STATION_POS;
    if (!s) return;
    this._shotTimer -= dt;
    if (this._shotTimer <= 0 && this.mode === 'cine') { this._pickShot(); return; }

    switch (s.type) {
      case 'WIDE': {
        // slow drift around the anchor, station off-center, planet behind
        const drift = new THREE.Vector3(Math.sin(this._t * 0.07) * 120, Math.cos(this._t * 0.05) * 60, Math.cos(this._t * 0.06) * 120);
        this._desiredPos.copy(s.pos).add(drift);
        this._desiredTgt.copy(s.tgt).add(new THREE.Vector3(60, -20, 0)); // off-center framing
        break;
      }
      case 'ORBIT': {
        s.ang += s.angSpeed * dt;
        this._desiredPos.set(
          st.x + Math.cos(s.ang) * s.radius,
          st.y + s.height + Math.sin(this._t * 0.1) * 40,
          st.z + Math.sin(s.ang) * s.radius);
        this._desiredTgt.copy(st);
        break;
      }
      case 'DOLLY': {
        s.t = Math.min(1, s.t + dt / s.dur);
        const e = smoothstep(0, 1, s.t);
        this._desiredPos.lerpVectors(s.a, s.b, e);
        const ahead = new THREE.Vector3().subVectors(s.b, s.a).normalize();
        this._desiredTgt.copy(this._desiredPos).addScaledVector(ahead, 200);
        this._desiredTgt.y -= 30;
        break;
      }
      case 'FLYBY': {
        const sh = s.ship;
        if (sh.dead) { this._pickShot(); return; }
        s.t = Math.min(1, s.t + dt / s.dur);
        const e = smoothstep(0, 1, s.t);
        const fwd = sh.forward;
        this._desiredPos.copy(sh.pos).addScaledVector(fwd, (0.5 - e) * (sh.def.len * 4 + 120)).add(s.side);
        this._desiredTgt.copy(sh.pos);
        break;
      }
      case 'TRACK': {
        const sh = s.ship;
        if (sh.dead) { this._pickShot(); return; }
        this._desiredPos.copy(sh.pos).add(s.off);
        this._desiredTgt.copy(sh.pos);
        break;
      }
      case 'MINING': {
        const sh = s.ship;
        if (sh.dead) { this._pickShot(); return; }
        const wp = this.world.siteWorld(sh.site, new THREE.Vector3());
        const orbit = new THREE.Vector3(Math.cos(this._t * 0.25) * 90, 35 + Math.sin(this._t * 0.2) * 20, Math.sin(this._t * 0.25) * 90);
        this._desiredPos.copy(wp).add(orbit);
        this._desiredTgt.copy(sh.pos);
        break;
      }
      case 'CAPITAL': {
        const sh = s.ship;
        if (sh.dead) { this._pickShot(); return; }
        const away = new THREE.Vector3().subVectors(sh.pos, STATION_POS).normalize();
        const back = sh.pos.clone().addScaledVector(away, -(sh.def.len * 3 + 200));
        const side = new THREE.Vector3().crossVectors(away, SUN_DIR).normalize().multiplyScalar(sh.def.len * 2 + 140);
        this._desiredPos.copy(back).add(side).add(new THREE.Vector3(0, 140, 0));
        this._desiredTgt.copy(sh.pos);
        break;
      }
    }
  }

  // ---------------------------------------------------------------- modes
  setMode(mode, ship = null) {
    if (mode === 'follow') {
      if (!ship) return;
      this.followed = ship;
      this.mode = 'follow';
    } else if (mode === 'station') {
      this.mode = 'station';
    } else {
      this.mode = 'cine';
      this.manual = false;
      this._pickShot();
    }
    this._fromPos.copy(this.pos);
    this._fromTgt.copy(this.target);
    this._blend = 0;
  }

  resumeCinematic() {
    // start a fresh shot but blend from the current viewpoint — no snapping
    this.manual = false;
    if (this.mode !== 'cine') this.mode = 'cine';
    this._pickShot();
  }

  takeManualControl() {
    if (!this.manual) {
      // derive orbit params from current camera state
      const anchor = this.mode === 'follow' && this.followed ? this.followed.pos : this.target;
      this.mTarget.copy(anchor);
      const off = new THREE.Vector3().subVectors(this.pos, anchor);
      this.mDist = clamp(off.length(), 150, 6000);
      this.mTheta = Math.atan2(off.z, off.x);
      this.mPhi = clamp(Math.asin(off.y / Math.max(off.length(), 0.001)), -1.35, 1.35);
      this.manual = true;
    }
  }

  orbit(dTheta, dPhi) {
    this.takeManualControl();
    this.mTheta -= dTheta;
    this.mPhi = clamp(this.mPhi + dPhi, -1.35, 1.35);
  }
  zoom(factor) {
    this.takeManualControl();
    this.mDist = clamp(this.mDist * factor, 25, 6500);
  }

  // ---------------------------------------------------------------- update
  update(dt, time) {
    this._t = time;
    if (this.mode === 'follow' && this.followed && !this.followed.dead) {
      const sh = this.followed;
      const q = sh.visual.group.quaternion;
      const off = new THREE.Vector3(sh.def.len * 0.5 + 8, sh.def.len * 0.5 + 8, -(sh.def.len * 1.8 + 30)).applyQuaternion(q);
      this._desiredPos.copy(sh.pos).add(off);
      this._desiredTgt.copy(sh.pos).addScaledVector(sh.forward, sh.def.len * 0.4);
    } else if (this.mode === 'station') {
      const a = time * 0.06;
      this._desiredPos.set(STATION_POS.x + Math.cos(a) * 420, STATION_POS.y + 140 + Math.sin(time * 0.1) * 30, STATION_POS.z + Math.sin(a) * 420);
      this._desiredTgt.copy(STATION_POS);
    } else if (this.mode === 'cine' && !this.manual) {
      this._syncDesired(dt);
    }

    if (this.manual) {
      const anchor = this.mode === 'follow' && this.followed && !this.followed.dead ? this.followed.pos : this.mTarget;
      this._desiredPos.set(
        anchor.x + Math.cos(this.mTheta) * Math.cos(this.mPhi) * this.mDist,
        anchor.y + Math.sin(this.mPhi) * this.mDist,
        anchor.z + Math.sin(this.mTheta) * Math.cos(this.mPhi) * this.mDist);
      this._desiredTgt.copy(anchor);
    }

    // blend from previous viewpoint into the new desired path
    if (this._blend < 1) {
      this._blend = Math.min(1, this._blend + dt / this._blendDur);
      const e = smoothstep(0, 1, this._blend);
      this.pos.lerpVectors(this._fromPos, this._desiredPos, e);
      this.target.lerpVectors(this._fromTgt, this._desiredTgt, e);
      // once blended, keep damping toward desired for smoothness
      if (this._blend >= 1) { this._fromPos.copy(this.pos); this._fromTgt.copy(this.target); }
    } else {
      this.pos.lerp(this._desiredPos, damp(2.2, dt));
      this.target.lerp(this._desiredTgt, damp(2.6, dt));
    }

    this._collide();
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.target);
  }

  _collide() {
    // never inside station volume
    const d = this.pos.distanceTo(STATION_POS);
    const minS = STATION_RADIUS + 18;
    if (d < minS) this.pos.sub(STATION_POS).multiplyScalar(minS / d).add(STATION_POS);
    // never inside atmosphere
    const pd = this.pos.length();
    const minP = PLANET_R + 60;
    if (pd < minP) this.pos.multiplyScalar(minP / pd);
  }
}
