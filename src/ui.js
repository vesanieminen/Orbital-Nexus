// HUD wiring: controls, click-to-select, manual orbit/zoom input, info panel.
import * as THREE from 'three';
import { CLASS_LABEL } from './config.js';

const $ = id => document.getElementById(id);

export class UI {
  constructor(canvas, director, fleet, state, music) {
    this.canvas = canvas; this.director = director; this.fleet = fleet; this.state = state; this.music = music;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.selected = null;
    this._infoTimer = 0;
    this._down = null;
    this.cinema = false;

    // ---- controls bar
    $('pauseBtn').addEventListener('click', () => this.togglePause());
    $('speed').addEventListener('input', e => {
      this.state.speed = parseFloat(e.target.value);
      $('speedVal').textContent = this.state.speed.toFixed(2) + '×';
    });
    $('density').addEventListener('input', e => {
      this.state.density = parseInt(e.target.value, 10);
      $('densityVal').textContent = this.state.density;
      this.fleet.targetCount = this.state.density;
    });
    $('modeCine').addEventListener('click', () => this.setMode('cine'));
    $('modeStation').addEventListener('click', () => this.setMode('station'));
    $('modeFollow').addEventListener('click', () => this.setMode('follow'));
    $('routesBtn').addEventListener('click', () => {
      this.fleet.routeLines.visible = !this.fleet.routeLines.visible;
      $('routesBtn').classList.toggle('active', this.fleet.routeLines.visible);
    });
    $('cineModeBtn').addEventListener('click', () => this.toggleCinema());
    $('musicBtn').addEventListener('click', () => {
      const on = this.music.toggle();
      $('musicBtn').classList.toggle('active', on);
    });
    $('resumeBtn').addEventListener('click', () => {
      this.director.resumeCinematic();
      $('resumeBtn').classList.remove('show');
    });
    $('infoClose').addEventListener('click', () => this.select(null));

    // ---- pointer input on canvas
    canvas.addEventListener('pointerdown', e => {
      this._down = { x: e.clientX, y: e.clientY, t: performance.now() };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', e => {
      if (!this._down) return;
      const dx = e.movementX ?? 0, dy = e.movementY ?? 0;
      if (Math.abs(e.clientX - this._down.x) + Math.abs(e.clientY - this._down.y) > 6) {
        this._dragged = true;
        this.director.orbit(dx * 0.005, dy * 0.005);
        this._showResume();
      }
    });
    canvas.addEventListener('pointerup', e => {
      if (this._down && !this._dragged && performance.now() - this._down.t < 400) {
        this._clickSelect(e);
      }
      this._down = null; this._dragged = false;
    });
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      this.director.zoom(Math.exp(e.deltaY * 0.0012));
      this._showResume();
    }, { passive: false });

    // ---- keyboard
    window.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT') return;
      switch (e.code) {
        case 'Space': e.preventDefault(); this.togglePause(); break;
        case 'KeyC': {
          const order = ['cine', 'station', 'follow'];
          const next = order[(order.indexOf(this.director.mode) + 1) % 3];
          this.setMode(next);
          break;
        }
        case 'KeyR': $('routesBtn').click(); break;
        case 'KeyM': $('musicBtn').click(); break;
        case 'KeyH': this.toggleCinema(); break;
        case 'KeyP': this.director.resumeCinematic(); $('resumeBtn').classList.remove('show'); break;
        case 'Escape': this.select(null); break;
      }
    });
  }

  togglePause() {
    this.state.paused = !this.state.paused;
    $('pauseBtn').innerHTML = this.state.paused ? '&#9654; Resume' : '&#10074;&#10074; Pause';
    $('pauseBtn').classList.toggle('active', this.state.paused);
  }

  toggleCinema() {
    this.cinema = !this.cinema;
    document.getElementById('hud').classList.toggle('hidden', this.cinema);
    document.getElementById('infopanel').classList.toggle('hidden', this.cinema);
    $('cineModeBtn').classList.toggle('active', this.cinema);
    if (this.cinema) {
      const h = $('hint');
      h.textContent = 'Cinematic mode — press H to show controls';
      h.classList.add('show');
      setTimeout(() => h.classList.remove('show'), 3000);
    }
  }

  setMode(mode) {
    if (mode === 'follow') {
      const ship = this.selected || this._nearestShip();
      if (!ship) return;
      this.director.setMode('follow', ship);
    } else {
      this.director.setMode(mode);
    }
    $('modeCine').classList.toggle('active', mode === 'cine');
    $('modeStation').classList.toggle('active', mode === 'station');
    $('modeFollow').classList.toggle('active', mode === 'follow');
  }

  _nearestShip() {
    const cam = this.director.camera.position;
    let best = null, bd = 1e18;
    for (const s of this.fleet.ships) {
      if (s.dead || s.cls === 'drone') continue;
      const d = s.pos.distanceToSquared(cam);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  _clickSelect(e) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.director.camera);
    const meshes = [];
    for (const s of this.fleet.ships) if (!s.dead) meshes.push(s.visual.hull);
    const hits = this.raycaster.intersectObjects(meshes, false);
    let agent = hits.length ? hits[0].object.userData.agent : null;
    if (!agent) {
      // screen-space fallback: nearest ship within 28 px of the click
      const cam = this.director.camera;
      const px = (this.pointer.x + 1) / 2 * rect.width;
      const py = (1 - this.pointer.y) / 2 * rect.height;
      let bd = 28;
      for (const s of this.fleet.ships) {
        if (s.dead || s.cls === 'drone') continue;
        const v = s.pos.clone().project(cam);
        if (v.z > 1) continue;
        const sx = (v.x + 1) / 2 * rect.width, sy = (1 - v.y) / 2 * rect.height;
        const d = Math.hypot(sx - px, sy - py);
        if (d < bd) { bd = d; agent = s; }
      }
    }
    if (agent) {
      this.select(agent);
      this.director.setMode('follow', agent);
      $('modeFollow').classList.add('active');
      $('modeCine').classList.remove('active');
      $('modeStation').classList.remove('active');
    }
  }

  select(agent) {
    this.selected = agent;
    this.fleet.selected = agent;
    const panel = document.getElementById('infopanel');
    if (!agent) { panel.classList.remove('show'); return; }
    panel.classList.add('show');
    $('iName').textContent = agent.name;
    $('iClass').textContent = CLASS_LABEL[agent.cls] || agent.cls;
    this._updateInfo();
  }

  _updateInfo() {
    const a = this.selected;
    if (!a) return;
    if (a.dead) { this.select(null); return; }
    $('iDest').textContent = a.destLabel;
    $('iTask').textContent = a.taskLabel;
    $('iVel').textContent = a.vel.length().toFixed(1) + ' u/s';
    const cam = this.director.camera.position;
    const r = a.pos.distanceTo(cam);
    $('iRange').textContent = r > 9999 ? (r / 1000).toFixed(1) + ' ku' : Math.round(r) + ' u';
  }

  _showResume() {
    if (this.director.mode === 'cine' || this.director.manual) $('resumeBtn').classList.add('show');
  }

  update(dt, fps, simTime) {
    this._infoTimer -= dt;
    if (this._infoTimer <= 0) {
      this._infoTimer = 0.25;
      $('fps').textContent = Math.round(fps);
      $('shipcount').textContent = this.fleet.ships.filter(s => !s.dead).length + ' vessels';
      const m = Math.floor(simTime / 60), s2 = Math.floor(simTime % 60);
      $('simtime').textContent = `T+ ${String(m).padStart(2, '0')}:${String(s2).padStart(2, '0')}`;
      this._updateInfo();
    }
    // resume button visibility
    if (this.director.manual && this.director.mode === 'cine') $('resumeBtn').classList.add('show');
  }
}
