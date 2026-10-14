// Fleet: purposeful traffic with full mission lifecycles.
// Waypoint graph + per-class state machines + steering (seek/arrival/separation)
// + events (patrol intercepts, unidentified vessels, capital arrivals).
import * as THREE from 'three';
import { ShipVisual, CLASS_DEFS } from './ships.js';
import {
  STATION_POS, PLANET_R, PALETTE, CLASS_LABEL, shipName, rand, randInt, pick, clamp, damp,
} from './config.js';

const JUMPS = [
  { pos: new THREE.Vector3(3400, 520, -2300), name: 'JP Halcyon Gate' },
  { pos: new THREE.Vector3(-3700, -340, -1600), name: 'JP Vesper Reach' },
  { pos: new THREE.Vector3(1900, 760, 3700), name: 'JP Northwind Lock' },
  { pos: new THREE.Vector3(-2500, 620, 3100), name: 'JP Cinder Fall' },
];

const MIX = [
  ['freighter', 0.24], ['courier', 0.26], ['miner', 0.16], ['patrol', 0.14], ['drone', 0.20],
];

let _id = 0;

export class Fleet {
  constructor(scene, world, station, fx) {
    this.scene = scene; this.world = world; this.station = station; this.fx = fx;
    this.ships = [];
    this.time = 0;
    this.targetCount = 55;
    this._spawnAccum = 0;
    this._unknownTimer = rand(40, 80);
    this._capitalTimer = rand(90, 150);
    this._dummy = new THREE.Object3D();

    // gates around station
    this.gates = [
      new THREE.Vector3(1, 0.15, -0.3).normalize().multiplyScalar(430).add(STATION_POS),
      new THREE.Vector3(-0.8, 0.35, 0.5).normalize().multiplyScalar(430).add(STATION_POS),
      new THREE.Vector3(0.25, -0.55, 1).normalize().multiplyScalar(430).add(STATION_POS),
    ];
    // courier loops (recognizable routes)
    this.courierLoops = [
      [this.gates[0], new THREE.Vector3(-2300, 300, -1200), this.gates[1]],
      [this.gates[2], new THREE.Vector3(2600, -100, 1900), this.gates[0]],
      [this.gates[1], new THREE.Vector3(900, 900, -2600), this.gates[2], new THREE.Vector3(-1500, -200, 2400)],
    ];
    // patrol orbits
    this.patrolLoops = [this._orbitLoop(560, 0.0, 7), this._orbitLoop(700, 0.7, 6), this._orbitLoop(480, -0.5, 5)];

    // port occupancy
    this.ports = this.station.dockPorts.map((p, i) => ({ i, occupant: null, queue: [] }));

    // route overlay (hidden by default)
    this._buildRouteOverlay();

    // initial fleet, already underway
    for (let i = 0; i < this.targetCount; i++) this._spawn(true);
  }

  _orbitLoop(r, tilt, n) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const p = new THREE.Vector3(Math.cos(a) * r, Math.sin(a * 2) * r * 0.25 + Math.sin(tilt) * 120, Math.sin(a) * r);
      p.applyAxisAngle(new THREE.Vector3(0, 0, 1), tilt);
      pts.push(p.add(STATION_POS.clone()));
    }
    return pts;
  }

  _pickClass() {
    let r = Math.random(), acc = 0;
    for (const [c, w] of MIX) { acc += w; if (r <= acc) return c; }
    return 'courier';
  }

  _spawn(midMission = false) {
    const cls = this._pickClass();
    const s = this._makeShip(cls, midMission);
    this.ships.push(s);
    return s;
  }

  _makeShip(cls, midMission, opts = {}) {
    const def = CLASS_DEFS[cls];
    const visual = new ShipVisual(cls, this.scene, this.fx);
    const params = {
      freighter: { maxSpeed: 55, accel: 13, sep: 34 },
      courier:   { maxSpeed: 135, accel: 42, sep: 16 },
      miner:     { maxSpeed: 72, accel: 17, sep: 24 },
      patrol:    { maxSpeed: 115, accel: 36, sep: 18 },
      drone:     { maxSpeed: 15, accel: 7, sep: 6 },
      capital:   { maxSpeed: 24, accel: 5, sep: 60 },
      unknown:   { maxSpeed: 95, accel: 26, sep: 16 },
    }[cls];
    const s = {
      id: ++_id, cls, def, params, visual,
      name: opts.name || shipName(cls),
      pos: new THREE.Vector3(), vel: new THREE.Vector3(),
      state: 'CRUISE', timer: 0, route: [], routeIdx: 0,
      destLabel: '—', taskLabel: 'Transit',
      port: -1, site: -1, loop: -1, queueSlot: 0,
      forward: new THREE.Vector3(0, 0, 1),
      throttle: 0, flashCd: 0, unloadTimer: 0,
      escorts: null, intercepted: null,
    };
    visual.group.userData.agent = s;
    visual.hull.userData.agent = s;

    if (cls === 'drone') {
      s.loop = randInt(0, 1);
      s.route = this._dronePath();
      s.routeIdx = randInt(0, s.route.length - 1);
      s.pos.copy(s.route[s.routeIdx]);
      s.visual.trail.reset(s.pos);
      s.state = 'EVA';
    } else if (opts.at) {
      s.pos.copy(opts.at);
      s.visual.trail.reset(s.pos);
    } else if (midMission) {
      this._placeMidMission(s);
    } else {
      const jp = pick(JUMPS);
      s.pos.copy(jp.pos).add(new THREE.Vector3(rand(-80, 80), rand(-40, 40), rand(-80, 80)));
      s.visual.trail.reset(s.pos);
      this.fx.jumpFX(s.pos, cls === 'capital' ? 90 : 34);
      s.state = 'JUMP_IN'; s.timer = 1.1;
      s.destLabel = 'Kepler Station';
    }
    visual.group.position.copy(s.pos);
    if (!midMission) this._initRole(s);
    return s;
  }

  // Scatter the initial fleet across the whole mission lifecycle. Dropping
  // everyone onto the inbound lane at once made the opening minutes a conga
  // line arriving at the station together.
  _placeMidMission(s) {
    const jp = pick(JUMPS);
    const gate = pick(this.gates);
    const roll = Math.random();

    if (s.cls === 'courier') {
      // mid-run on a courier loop leg
      this._setCourierLoop(s);
      const leg = randInt(0, s.route.length - 1);
      s.pos.lerpVectors(s.route[leg], s.route[(leg + 1) % s.route.length], rand(0.15, 0.85));
      s.routeIdx = (leg + 1) % s.route.length;
      if (roll < 0.25) { s.state = 'HOLD'; s.timer = rand(0.5, 2); s.taskLabel = 'Waypoint hold'; }
    } else if (s.cls === 'patrol') {
      // on patrol orbit
      s.route = this.patrolLoops[s.loop = randInt(0, this.patrolLoops.length - 1)];
      s.routeIdx = randInt(0, s.route.length - 1);
      s.pos.copy(s.route[s.routeIdx]).add(new THREE.Vector3(rand(-60, 60), rand(-30, 30), rand(-60, 60)));
      s.destLabel = 'Patrol orbit'; s.taskLabel = 'Patrol sweep';
    } else if (s.cls === 'miner') {
      s.site = randInt(0, this.world.miningSites.length - 1);
      if (roll < 0.45) {
        // actively mining at a site
        this.world.siteWorld(s.site, s.pos);
        s.pos.add(new THREE.Vector3(rand(-50, 50), rand(-30, 30), rand(-50, 50)));
        s.state = 'MINING'; s.timer = rand(4, 24);
        s.destLabel = `Asteroid Site ${s.site + 1}`;
        s.taskLabel = 'Mining operation — cutting beam active';
        if (s.visual.beam) s.visual.beam.visible = true;
        if (s.visual.beamMat) s.visual.beamMat.uniforms.uOn.value = 1;
      } else if (roll < 0.65) {
        // unloading ore at the processing facility
        this.station.processPortWorld(s.pos);
        s.pos.add(new THREE.Vector3(rand(-30, 30), rand(-20, 20), rand(-30, 30)));
        s.state = 'UNLOAD'; s.timer = rand(2, 14);
        s.destLabel = 'Ore Processing'; s.taskLabel = 'Transferring ore';
      } else {
        // in transit somewhere out in the belt
        const other = randInt(0, this.world.miningSites.length - 1);
        this.world.siteWorld(other, s.pos);
        s.pos.add(new THREE.Vector3(rand(-350, 350), rand(-120, 120), rand(-350, 350)));
        s.state = 'TO_SITE';
        s.destLabel = `Asteroid Site ${s.site + 1}`;
        s.taskLabel = 'Transit to asteroid site';
      }
    } else if (roll < 0.4) {
      // inbound, spread along the full length of the lane
      s.pos.lerpVectors(jp.pos, gate, rand(0.05, 0.9));
      s.pos.add(new THREE.Vector3(rand(-60, 60), rand(-30, 30), rand(-60, 60)));
      s.route = [gate];
      s.destLabel = 'Kepler Station';
      this._assignDock(s);
    } else if (roll < 0.6) {
      // outbound departure burn
      s.pos.lerpVectors(gate, jp.pos, rand(0.1, 0.8));
      s.route = [jp.pos];
      s.state = 'DEPART'; s.timer = rand(3, 8);
      s.destLabel = jp.name; s.taskLabel = 'Departure burn';
    } else if (roll < 0.75 && this._parkAtPort(s)) {
      // parked at a dock, partway through cargo transfer
    } else {
      // holding short of the gate, waiting for a dock slot
      s.pos.lerpVectors(jp.pos, gate, rand(0.5, 0.9));
      s.route = [gate];
      s.state = 'HOLD'; s.timer = rand(2, 14);
      s.destLabel = 'Kepler Station'; s.taskLabel = 'Holding for dock slot';
    }
    s.visual.trail.reset(s.pos);
  }

  // park a midMission ship at a free berth, mid-transfer
  _parkAtPort(s) {
    const capPort = this.ports.length - 1;
    const free = this.ports.filter(p => !p.occupant && (s.cls === 'capital') === (p.i === capPort));
    if (!free.length) return false;
    const p = pick(free);
    p.occupant = s.id;
    s.port = p.i;
    this.station.portWorld(p.i, s.pos);
    const n = this.station.portNormalWorld(p.i, new THREE.Vector3());
    s.pos.addScaledVector(n, s.cls === 'capital' ? 34 : 12);
    s._dockFwd = n.multiplyScalar(-1);
    s.state = 'DOCKED';
    s.unloadTimer = s.cls === 'capital' ? rand(50, 70) : rand(16, 34);
    s.timer = rand(0.3, 0.85) * s.unloadTimer;
    s.destLabel = `Kepler Station · Dock ${p.i + 1}`;
    s.taskLabel = 'Docked — cargo transfer';
    return true;
  }

  _initRole(s) {
    if (s.cls === 'courier' && !s.route.length) this._setCourierLoop(s);
    if (s.cls === 'patrol') {
      s.route = this.patrolLoops[s.loop = randInt(0, this.patrolLoops.length - 1)];
      s.destLabel = 'Patrol orbit'; s.taskLabel = 'Patrol sweep';
    }
    if (s.cls === 'miner' && s.site < 0 && (s.state === 'CRUISE' || s.state === 'JUMP_IN')) {
      s.site = randInt(0, this.world.miningSites.length - 1);
      s.state = 'TO_SITE'; s.destLabel = `Asteroid Site ${s.site + 1}`;
      s.taskLabel = 'Transit to asteroid site';
    }
  }

  _dronePath() {
    // points on the station exterior (world space, refreshed each visit)
    const pts = [];
    const g = this.station.group;
    const local = [
      new THREE.Vector3(62, 6, 0), new THREE.Vector3(30, -30, 40), new THREE.Vector3(-62, 5, 0),
      new THREE.Vector3(-20, -55, 20), new THREE.Vector3(0, 66, 12), new THREE.Vector3(24, -56, -10),
      new THREE.Vector3(84, -30, 0), new THREE.Vector3(0, -78, 26),
    ];
    for (const p of local) pts.push(p.clone().applyMatrix4(g.matrixWorld));
    return pts;
  }

  _assignDock(s) {
    // choose port with shortest queue (capital berth only for capital)
    let best = null;
    const minI = s.cls === 'capital' ? this.ports.length - 1 : 0;
    const maxI = s.cls === 'capital' ? this.ports.length : this.ports.length - 1;
    for (let i = minI; i < maxI; i++) {
      const p = this.ports[i];
      if (!best || p.queue.length < best.queue.length) best = p;
    }
    if (!best) best = this.ports[minI];
    if (s.port >= 0) this._releasePort(s);
    s.port = best.i;
    best.queue.push(s.id);
    s.queueSlot = best.queue.length - 1;
    s.state = 'APPROACH';
    s.taskLabel = 'Inbound — holding in queue';
    s.destLabel = `Kepler Station · Dock ${best.i + 1}`;
  }

  _releasePort(s) {
    if (s.port < 0) return;
    const p = this.ports[s.port];
    p.queue = p.queue.filter(id => id !== s.id);
    if (p.occupant === s.id) p.occupant = null;
    s.port = -1;
  }

  _portQueuePos(s, out) {
    const p = this.station.portWorld(s.port, out);
    const n = this.station.portNormalWorld(s.port, this._tmpN || (this._tmpN = new THREE.Vector3()));
    // spacing must exceed the pair separation radius, or queued ships shove
    // each other out of formation and wander (freighter sep 34 → pair 68)
    const cap = s.cls === 'capital';
    const base = cap ? 300 : (s.cls === 'freighter' ? 100 : 80);
    const step = cap ? 100 : (s.cls === 'freighter' ? 70 : 36);
    return out.addScaledVector(n, base + s.queueSlot * step);
  }

  // ------------------------------------------------------------ update
  update(dt, camPos, quality) {
    this.time += dt;
    this._managePopulation(dt);
    this._events(dt);

    const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3();

    for (const s of this.ships) {
      if (s.dead) continue;
      this._step(s, dt, tmpA, tmpB, tmpC, camPos, quality);
    }

    // separation (O(n^2), fine at this scale)
    const n = this.ships.length;
    for (let i = 0; i < n; i++) {
      const a = this.ships[i];
      if (a.dead) continue;
      for (let j = i + 1; j < n; j++) {
        const b = this.ships[j];
        if (b.dead) continue;
        const r = a.params.sep + b.params.sep;
        const d2 = a.pos.distanceToSquared(b.pos);
        if (d2 < r * r && d2 > 0.01) {
          const d = Math.sqrt(d2);
          // parked ships hold station; queued ships hold formation — hard
          // pushes there are what made ships circle each other aimlessly
          const pa = a.state === 'DOCKED' || a.state === 'DOCK';
          const pb = b.state === 'DOCKED' || b.state === 'DOCK';
          if (pa && pb) continue;
          const qa = pa || a.state === 'APPROACH';
          const qb = pb || b.state === 'APPROACH';
          const k = (qa && qb) ? 2.5 : 14;
          tmpA.subVectors(a.pos, b.pos).multiplyScalar((1 - d / r) * k * dt / d);
          if (!pa) a.pos.add(tmpA);
          if (!pb) b.pos.sub(tmpA);
        }
      }
    }

    // keep off planet & station
    for (const s of this.ships) {
      const pd = s.pos.length();
      if (pd < PLANET_R + 130) s.pos.multiplyScalar((PLANET_R + 130) / pd);
      const sd = s.pos.distanceTo(STATION_POS);
      const minD = 170 + (s.cls === 'capital' ? 60 : 0);
      if (sd < minD && s.state !== 'DOCKED' && s.state !== 'DOCK' && s.cls !== 'drone') {
        s.pos.sub(STATION_POS).multiplyScalar(minD / Math.max(sd, 0.01)).add(STATION_POS);
      }
    }

    // visuals
    for (const s of this.ships) {
      s.visual.group.position.copy(s.pos);
      // orientation: face velocity, but queued/docking ships face the port so
      // they hold a stable attitude instead of yawing on near-zero velocity noise
      let look = null;
      if (s.state === 'DOCK' || s.state === 'DOCKED') look = s._dockFwd || s.vel;
      else if (s.state === 'APPROACH' && s.vel.lengthSq() < 120 && s.port >= 0) {
        look = this._face || (this._face = new THREE.Vector3());
        this.station.portNormalWorld(s.port, look).multiplyScalar(-1);
      } else if (s.vel.lengthSq() > 0.02) look = s.vel;
      if (look && look.lengthSq() > 1e-6) {
        this._dummy.position.set(0, 0, 0);
        this._dummy.up.set(0, 1, 0);
        tmpA.copy(look).normalize();
        this._dummy.lookAt(tmpA);
        s.visual.group.quaternion.slerp(this._dummy.quaternion, damp(s.cls === 'capital' ? 1.2 : 4.5, dt));
      }
      s.visual.setThrottle(s.throttle);
      s.visual.update(dt, this.time, camPos, quality);

      // exhaust particles near camera
      if (quality.particles && s.throttle > 0.25 && s.cls !== 'drone') {
        const d2 = s.pos.distanceToSquared(camPos);
        if (d2 < 1100 * 1100 && Math.random() < quality.particleRate) {
          const ei = randInt(0, s.def.engines.length - 1);
          s.visual.engineWorld(ei, tmpA);
          tmpB.copy(s.forward).multiplyScalar(-1);
          this.fx.spawnExhaust(tmpA, tmpB, s.def.engineColor, s.params.maxSpeed * 0.5 * s.throttle, s.cls === 'capital' ? 3 : 1.2);
        }
      }
    }
    this._sweep();
  }

  _step(s, dt, tmpA, tmpB, tmpC, camPos, quality) {
    s.timer -= dt;
    s.flashCd -= dt;
    const P = s.params;

    switch (s.state) {
      case 'JUMP_IN':
        s.throttle = 0;
        if (s.timer <= 0) {
          if (s.cls === 'courier' && s.loop >= 0) s.state = 'CRUISE';
          else if (s.cls === 'freighter') { this._assignDock(s); }
          else if (s.cls === 'capital') { this._assignDock(s); }
          else s.state = 'CRUISE';
        }
        break;

      case 'CRUISE': {
        let target = null;
        if (s.route.length) {
          target = s.route[s.routeIdx % s.route.length];
          if (s.cls === 'drone') target = s.route[s.routeIdx % s.route.length]; // refreshed world pts
        }
        if (!target) { s.route = [pick(this.gates)]; target = s.route[0]; }
        if (s.pos.distanceTo(target) < 60) {
          if (s.cls === 'courier') {
            s.routeIdx++;
            s.timer = rand(1, 2.5); s.state = 'HOLD';
            s.taskLabel = 'Waypoint hold';
            s.destLabel = s.route[s.routeIdx % s.route.length] === this.gates[0] || s.route[s.routeIdx % s.route.length] === this.gates[1] || s.route[s.routeIdx % s.route.length] === this.gates[2] ? 'Kepler Station' : 'Outer relay';
          } else if (s.cls === 'patrol') {
            s.routeIdx++;
          } else if (s.cls === 'miner') {
            if (s.site < 0) s.site = randInt(0, this.world.miningSites.length - 1);
            s.state = 'TO_SITE';
            s.destLabel = `Asteroid Site ${s.site + 1}`;
            s.taskLabel = 'Transit to asteroid site';
          } else {
            this._assignDock(s);
          }
        }
        this._seek(s, target, dt, tmpA, tmpB, 1.0);
        if (s.cls === 'freighter' && s.taskLabel === 'Transit') s.taskLabel = 'Inbound — cruise';
        if (s.cls === 'patrol') s.taskLabel = 'Patrol sweep';
        if (s.cls === 'miner' && s.site >= 0) s.taskLabel = 'Transit to asteroid site';
        break;
      }

      case 'HOLD':
        s.throttle = 0.05 + Math.max(0, 0.4 - s.vel.length() / P.maxSpeed) * 0.3;
        s.vel.multiplyScalar(1 - damp(2, dt));
        if (s.timer <= 0) { s.state = 'CRUISE'; }
        break;

      case 'APPROACH': {
        if (s.port < 0 || !this.ports[s.port]) { this._assignDock(s); break; }
        const p = this.ports[s.port];
        // advance in queue
        s.queueSlot = p.queue.indexOf(s.id);
        if (s.queueSlot < 0) { p.queue.push(s.id); s.queueSlot = p.queue.length - 1; }
        const qp = this._q1 || (this._q1 = new THREE.Vector3());
        this._portQueuePos(s, qp);
        this._seek(s, qp, dt, tmpA, tmpB, 1.0);
        s.taskLabel = p.occupant ? 'Queued for docking' : 'Final approach';
        const qd = s.pos.distanceTo(qp);
        if (qd < 60) s.vel.multiplyScalar(1 - damp(1.4, dt)); // settle into station-keeping
        if (qd < 26 && !p.occupant) {
          s.state = 'DOCK';
          p.occupant = s.id;
          p.queue = p.queue.filter(id => id !== s.id);
          s.queueSlot = -1;
          s.taskLabel = 'Docking maneuver';
        }
        break;
      }

      case 'DOCK': {
        const wp = this.station.portWorld(s.port, tmpA);
        const n = this.station.portNormalWorld(s.port, tmpB);
        const off = s.cls === 'capital' ? 34 : 12;
        tmpC.copy(wp).addScaledVector(n, off);
        const d = s.pos.distanceTo(tmpC);
        this._seek(s, tmpC, dt, tmpA, tmpB, 0.35);
        s._dockFwd = (s._dockFwd || new THREE.Vector3()).copy(n).multiplyScalar(-1);
        s.taskLabel = 'Docking maneuver';
        if (d < 4 && s.vel.length() < 3) {
          s.state = 'DOCKED';
          s.timer = s.cls === 'capital' ? rand(50, 70) : rand(16, 34);
          s.unloadTimer = s.timer;
          s.taskLabel = 'Docked — cargo transfer';
          s.throttle = 0;
        }
        if (s.flashCd <= 0 && Math.random() < 0.5) {
          s.visual.engineWorld(0, tmpA);
          this.fx.thrusterFlash(tmpA, s.cls === 'capital' ? 10 : 3);
          s.flashCd = rand(0.3, 0.8);
        }
        break;
      }

      case 'DOCKED': {
        const wp = this.station.portWorld(s.port, tmpA);
        const n = this.station.portNormalWorld(s.port, tmpB);
        tmpC.copy(wp).addScaledVector(n, s.cls === 'capital' ? 34 : 12);
        s.pos.lerp(tmpC, damp(6, dt));
        s.vel.set(0, 0, 0);
        s.throttle = 0;
        const frac = clamp(s.timer / Math.max(s.unloadTimer, 0.01), 0, 1);
        s.taskLabel = s.cls === 'freighter' ? `Docked — unloading ${Math.round((1 - frac) * 100)}%` : 'Docked — resupply';
        if (s.timer <= 0) {
          this._releasePort(s);
          s.state = 'DEPART';
          s.timer = rand(4, 7);
          const jp = pick(JUMPS);
          s.route = [jp.pos];
          s.destLabel = jp.name;
          s.taskLabel = 'Departure burn';
          if (s.flashCd <= 0) { s.visual.engineWorld(0, tmpA); this.fx.thrusterFlash(tmpA, 4); s.flashCd = 0.5; }
        }
        break;
      }

      case 'DEPART': {
        this._seek(s, s.route[0], dt, tmpA, tmpB, 1.0);
        if (s.pos.distanceTo(s.route[0]) < 90 || s.timer <= 0) {
          this.fx.jumpFX(s.pos, s.cls === 'capital' ? 110 : 36);
          if (s.cls === 'capital') { this._remove(s); break; }
          const jp = pick(JUMPS);
          s.pos.copy(jp.pos).add(new THREE.Vector3(rand(-60, 60), rand(-30, 30), rand(-60, 60)));
          s.vel.set(0, 0, 0);
          s.visual.trail.reset(s.pos);
          s.state = 'JUMP_IN'; s.timer = 1.1;
          s.destLabel = 'Kepler Station';
          if (s.cls === 'courier') this._setCourierLoop(s);
        }
        break;
      }

      case 'MINING': {
        const wp = this.world.siteWorld(s.site, tmpA);
        s.pos.lerp(wp, damp(0.4, dt));
        s.vel.multiplyScalar(1 - damp(3, dt));
        s.throttle = 0.06;
        if (s.timer <= 0) {
          if (s.visual.beam) s.visual.beam.visible = false;
          if (s.visual.beamMat) s.visual.beamMat.uniforms.uOn.value = 0;
          s.state = 'TO_PROCESS';
          s.destLabel = 'Ore Processing';
          s.taskLabel = 'Loaded — returning to processing';
        }
        break;
      }

      case 'TO_PROCESS': {
        this.station.processPortWorld(tmpA);
        tmpB.copy(tmpA);
        this._seek(s, tmpB, dt, tmpA, tmpC, 1.0);
        if (s.pos.distanceTo(tmpB) < 40) {
          s.state = 'UNLOAD'; s.timer = rand(10, 18);
          s.taskLabel = 'Transferring ore';
        }
        break;
      }

      case 'UNLOAD': {
        this.station.processPortWorld(tmpA);
        tmpC.copy(tmpA).addScaledVector(this.station.processNormalWorld(tmpB), 16);
        s.pos.lerp(tmpC, damp(2.5, dt));
        s.vel.multiplyScalar(1 - damp(4, dt));
        s.throttle = 0.05;
        if (s.timer <= 0) {
          s.state = 'TO_SITE';
          s.site = randInt(0, this.world.miningSites.length - 1);
          s.destLabel = `Asteroid Site ${s.site + 1}`;
          s.taskLabel = 'Transit to asteroid site';
        }
        break;
      }

      case 'TO_SITE': {
        const wp = this._q2 || (this._q2 = new THREE.Vector3());
        this.world.siteWorld(s.site, wp);
        this._seek(s, wp, dt, tmpA, tmpB, 1.0);
        if (s.pos.distanceTo(wp) < 70) {
          s.state = 'MINING'; s.timer = rand(14, 26);
          if (s.visual.beam) s.visual.beam.visible = true;
          if (s.visual.beamMat) s.visual.beamMat.uniforms.uOn.value = 1;
          s.taskLabel = 'Mining operation — cutting beam active';
        }
        break;
      }

      case 'EVA': {
        // drones: crawl along station exterior
        if (s.timer <= 0) {
          s.routeIdx = (s.routeIdx + 1) % s.route.length;
          s.route[s.routeIdx] = this._dronePath()[s.routeIdx];
          s.timer = rand(6, 14);
          s.taskLabel = Math.random() < 0.5 ? 'EVA transit' : 'Hull inspection';
        }
        const wp = s.route[s.routeIdx];
        this._seek(s, wp, dt, tmpA, tmpB, 1.0);
        break;
      }

      case 'INTERCEPT': {
        const t = s.intercepted;
        if (!t || t.dead || !this.ships.includes(t)) { s.state = 'CRUISE'; s.intercepted = null; break; }
        tmpA.copy(t.pos).addScaledVector(t.vel, 1.2);
        this._seek(s, tmpA, dt, tmpA, tmpB, 1.0);
        s.taskLabel = 'Intercepting unidentified vessel';
        s.destLabel = t.name;
        if (s.pos.distanceTo(t.pos) < 40) {
          s.state = 'BRAVO'; s.timer = rand(6, 11);
          s.taskLabel = 'Hailing unidentified vessel';
          if (s.flashCd <= 0) { s.visual.engineWorld(0, tmpA); this.fx.thrusterFlash(tmpA, 3); s.flashCd = 0.6; }
        }
        break;
      }

      case 'BRAVO': {
        const t = s.intercepted;
        if (t && !t.dead && this.ships.includes(t)) {
          tmpA.copy(t.pos).add(new THREE.Vector3(28, 4, 0).applyQuaternion(t.visual.group.quaternion));
          this._seek(s, tmpA, dt, tmpA, tmpB, 0.4);
        }
        if (s.timer <= 0) {
          s.state = 'CRUISE'; s.intercepted = null;
          s.taskLabel = 'Patrol sweep';
          s.destLabel = 'Patrol orbit';
        }
        break;
      }
    }

    // integrate
    s.pos.addScaledVector(s.vel, dt);
    if (s.vel.lengthSq() > 1e-6) s.forward.copy(s.vel).normalize();
  }

  _seek(s, target, dt, tmpA, tmpB, scale) {
    tmpA.subVectors(target, s.pos);
    const dist = tmpA.length();
    const maxS = s.params.maxSpeed * scale;
    // arrival profile: slow down proportional to sqrt(distance)
    const desiredSpeed = Math.min(maxS, Math.sqrt(2 * s.params.accel * Math.max(dist, 0.5)));
    tmpA.multiplyScalar(desiredSpeed / Math.max(dist, 0.001));
    tmpB.subVectors(tmpA, s.vel); // steering
    const maxSteer = s.params.accel * dt;
    if (tmpB.length() > maxSteer) tmpB.setLength(maxSteer);
    s.vel.add(tmpB);
    const sp = s.vel.length();
    if (sp > maxS) s.vel.setLength(maxS);
    // throttle: engine effort
    const effort = tmpB.length() / Math.max(maxSteer, 1e-6);
    s.throttle = clamp(0.12 + effort * 0.88, 0, 1);
    // thruster flashes on sharp maneuvers
    if (effort > 0.75 && s.flashCd <= 0 && Math.random() < 0.35 && s.cls !== 'drone') {
      s.visual.engineWorld(randInt(0, s.def.engines.length - 1), tmpA);
      this.fx.thrusterFlash(tmpA, s.def.len * 0.15 + 1.5);
      s.flashCd = rand(0.5, 1.2);
    }
  }

  _setCourierLoop(s) {
    s.loop = randInt(0, this.courierLoops.length - 1);
    s.route = this.courierLoops[s.loop];
    s.routeIdx = 0;
    s.destLabel = 'Outer relay';
    s.taskLabel = 'Courier run';
  }

  // ------------------------------------------------------------ population & events
  _managePopulation(dt) {
    const regular = this.ships.filter(s => s.cls !== 'unknown' && s.cls !== 'capital').length;
    if (regular < this.targetCount) {
      this._spawnAccum += dt;
      if (this._spawnAccum > 1.2) {
        this._spawnAccum = 0;
        const s = this._spawn(false);
        if (s.cls === 'courier') this._setCourierLoop(s);
        if (s.cls === 'miner') {
          s.site = randInt(0, this.world.miningSites.length - 1);
          s.state = 'TO_SITE'; s.destLabel = `Asteroid Site ${s.site + 1}`;
        }
        if (s.cls === 'patrol') { s.route = this.patrolLoops[s.loop = randInt(0, this.patrolLoops.length - 1)]; s.destLabel = 'Patrol orbit'; }
      }
    } else if (regular > this.targetCount) {
      // remove a ship far from camera, not docked
      let victim = null, bestD = -1;
      for (const s of this.ships) {
        if (s.cls === 'unknown' || s.cls === 'capital' || s.state === 'DOCKED' || s.state === 'DOCK') continue;
        const d = s.pos.length(); // far from planet center = far from action
        if (d > bestD) { bestD = d; victim = s; }
      }
      if (victim) this._remove(victim);
    }
  }

  _remove(s) {
    if (s.dead) return;
    s.dead = true;
    this._releasePort(s);
    if (this.selected === s) this.selected = null;
  }
  _sweep() {
    if (!this.ships.some(s => s.dead)) return;
    for (let i = this.ships.length - 1; i >= 0; i--) {
      const s = this.ships[i];
      if (s.dead) { s.visual.dispose(this.scene); this.ships.splice(i, 1); }
    }
  }

  _events(dt) {
    // unidentified vessel appears, wanders, gets intercepted, flees
    this._unknownTimer -= dt;
    if (this._unknownTimer <= 0) {
      this._unknownTimer = rand(70, 140);
      const jp = pick(JUMPS);
      const u = this._makeShip('unknown', false, { at: jp.pos.clone(), name: 'UNIDENTIFIED CONTACT' });
      u.state = 'CRUISE';
      u.route = [STATION_POS.clone().add(new THREE.Vector3(rand(-300, 300), rand(-150, 150), rand(-300, 300)))];
      u.destLabel = 'UNKNOWN'; u.taskLabel = 'Unidentified — approaching from ' + jp.name;
      u.fleeTimer = rand(25, 45);
      this.ships.push(u);
      this.fx.jumpFX(jp.pos, 30, PALETTE.unknown);
      // nearest patrol diverts
      let best = null, bd = 1e18;
      for (const s of this.ships) if (s.cls === 'patrol') {
        const d = s.pos.distanceToSquared(u.pos);
        if (d < bd) { bd = d; best = s; }
      }
      if (best) { best.state = 'INTERCEPT'; best.intercepted = u; }
    }

    // unknowns flee after their dwell time
    for (const s of this.ships) {
      if (s.cls === 'unknown') {
        s.fleeTimer -= dt;
        if (s.fleeTimer <= 0) {
          this.fx.jumpFX(s.pos, 30, PALETTE.unknown);
          this._remove(s);
          break;
        }
      }
    }

    // capital ship arrival with escorts
    this._capitalTimer -= dt;
    if (this._capitalTimer <= 0) {
      this._capitalTimer = rand(240, 420);
      const jp = pick(JUMPS);
      this.fx.jumpFX(jp.pos, 120);
      const cap = this._makeShip('capital', false, { at: jp.pos.clone() });
      cap.state = 'JUMP_IN'; cap.timer = 2.2;
      cap.destLabel = 'Kepler Station · Capital Berth';
      this.ships.push(cap);
      cap.escorts = [];
      for (let i = 0; i < 4; i++) {
        const e = this._makeShip('courier', false, { at: jp.pos.clone().add(new THREE.Vector3(rand(-60, 60), rand(-30, 30), rand(-60, 60))) });
        e.state = 'ESCORT'; e.timer = 999; e.escortOf = cap; e.escortSlot = i;
        e.destLabel = 'Capital escort'; e.taskLabel = 'Escorting capital ship';
        this.ships.push(e);
        cap.escorts.push(e);
      }
      this.lastCapital = cap;
      this.onCapital && this.onCapital(cap);
    }
  }

  // escort behavior handled here (custom state)
  _stepEscort(s, dt, tmpA, tmpB, tmpC) {
    const cap = s.escortOf;
    if (!cap || cap.dead || !this.ships.includes(cap)) { this._remove(s); return; }
    const q = cap.visual.group.quaternion;
    const off = [new THREE.Vector3(-26, 6, -30), new THREE.Vector3(26, 6, -30), new THREE.Vector3(-16, 10, 40), new THREE.Vector3(16, 10, 40)][s.escortSlot];
    tmpA.copy(off).applyQuaternion(q).add(cap.pos);
    this._seek(s, tmpA, dt, tmpB, tmpC, 1.0);
    if (cap.state === 'DOCKED' || cap.state === 'DOCK') {
      s.state = 'CRUISE'; this._setCourierLoop(s);
      s.route = [pick(this.gates)];
      cap.escorts && (cap.escorts = cap.escorts.filter(x => x !== s));
    }
  }

  pick(shipMesh) {
    return shipMesh.userData.agent || null;
  }

  _buildRouteOverlay() {
    const mat = new THREE.LineBasicMaterial({ color: 0x3f8ac6, transparent: true, opacity: 0.5 });
    const g = new THREE.BufferGeometry();
    const pts = [];
    const push = (a, b) => { pts.push(a.x, a.y, a.z, b.x, b.y, b.z); };
    // lanes that would clip the planet are bent into arcs that clear it
    const tmpAB = new THREE.Vector3(), tmpP = new THREE.Vector3();
    const clearance = (a, b) => {
      tmpAB.subVectors(b, a);
      const t = clamp(-a.dot(tmpAB) / Math.max(tmpAB.lengthSq(), 1e-6), 0, 1);
      return tmpP.copy(a).addScaledVector(tmpAB, t).length();
    };
    const arc = (a, b, segs = 22) => {
      const mid = tmpP.addVectors(a, b).multiplyScalar(0.5).clone();
      const ctrl = mid.length() < PLANET_R + 420 ? mid.setLength(PLANET_R + 420) : mid;
      let prev = a;
      for (let i = 1; i <= segs; i++) {
        const t = i / segs, it = 1 - t;
        tmpAB.set(
          it * it * a.x + 2 * it * t * ctrl.x + t * t * b.x,
          it * it * a.y + 2 * it * t * ctrl.y + t * t * b.y,
          it * it * a.z + 2 * it * t * ctrl.z + t * t * b.z);
        push(prev, tmpAB);
        prev = tmpAB.clone();
      }
    };
    const lane = (a, b) => { clearance(a, b) < PLANET_R + 160 ? arc(a, b) : push(a, b); };
    for (const jp of JUMPS) for (const gt of this.gates) lane(jp.pos, gt);
    for (const loop of this.courierLoops) for (let i = 0; i < loop.length; i++) lane(loop[i], loop[(i + 1) % loop.length]);
    for (const loop of this.patrolLoops) for (let i = 0; i < loop.length; i++) push(loop[i], loop[(i + 1) % loop.length]);
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.routeLines = new THREE.LineSegments(g, mat);
    this.routeLines.visible = false;
    this.scene.add(this.routeLines);
  }
}

// patch: escort state needs to run inside _step — hook via prototype
const _origStep = Fleet.prototype._step;
Fleet.prototype._step = function (s, dt, a, b, c, camPos, q) {
  if (s.state === 'ESCORT') { this._stepEscort(s, dt, a, b, c); s.pos.addScaledVector(s.vel, dt); if (s.vel.lengthSq() > 1e-6) s.forward.copy(s.vel).normalize(); return; }
  return _origStep.call(this, s, dt, a, b, c, camPos, q);
};
