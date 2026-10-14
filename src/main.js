// Entry: renderer + post-processing + adaptive quality + main loop.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { STATION_POS, SUN_DIR, damp } from './config.js';
import { World } from './world.js';
import { Station } from './station.js';
import { FX } from './ships.js';
import { Fleet } from './fleet.js';
import { Director } from './camera.js';
import { UI } from './ui.js';
import { Music } from './music.js';

// ---------------------------------------------------------------- renderer
const app = document.getElementById('app');
const canvas = document.createElement('canvas');
app.appendChild(canvas);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 1.5, 24000);

// ---------------------------------------------------------------- world
const world = new World(scene);
const station = new Station(scene);
const fx = new FX(scene);
const fleet = new Fleet(scene, world, station, fx);
const director = new Director(camera, station, fleet, world);

const state = { paused: false, speed: 1, density: 55 };
const music = new Music();
const ui = new UI(canvas, director, fleet, state, music);

// engine-light for followed / featured ships
const shipLight = new THREE.PointLight(0x6fc4ff, 0, 420, 1.8);
scene.add(shipLight);

// ---------------------------------------------------------------- post fx
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.65, 0.82);
composer.addPass(bloom);

const gradePass = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null },
    uCA: { value: 0.0016 },
    uVig: { value: 0.38 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uCA; uniform float uVig;
    varying vec2 vUv;
    void main(){
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      // subtle chromatic aberration toward edges
      vec2 off = c * uCA * (0.3 + r2 * 3.0);
      float cr = texture2D(tDiffuse, vUv + off).r;
      vec4  cm = texture2D(tDiffuse, vUv);
      float cb = texture2D(tDiffuse, vUv - off).b;
      vec3 col = vec3(cr, cm.g, cb);
      // vignette
      col *= 1.0 - uVig * smoothstep(0.12, 0.75, r2);
      gl_FragColor = vec4(col, cm.a);
    }`,
});
composer.addPass(gradePass);
composer.addPass(new OutputPass());

// ---------------------------------------------------------------- adaptive quality
const quality = { particles: true, particleRate: 0.55, trailsFar: false, tier: 2 };
const tiers = [
  { pr: 0.65, bloom: 0.42, particles: false, particleRate: 0, trailsFar: false },
  { pr: 0.85, bloom: 0.5, particles: true, particleRate: 0.3, trailsFar: false },
  { pr: 1.0, bloom: 0.55, particles: true, particleRate: 0.55, trailsFar: true },
];
let maxPR = Math.min(devicePixelRatio || 1, 1.75);
function applyTier(t) {
  quality.tier = t;
  const cfg = tiers[t];
  const pr = Math.min(maxPR, cfg.pr * maxPR);
  renderer.setPixelRatio(pr);
  composer.setPixelRatio(pr);
  composer.setSize(innerWidth, innerHeight);
  bloom.strength = cfg.bloom;
  quality.particles = cfg.particles;
  quality.particleRate = cfg.particleRate;
  quality.trailsFar = cfg.trailsFar;
  world.setQuality(pr);
  fx.setQuality(pr);
}
applyTier(2);
window.__sim = { director, fleet, world, station, renderer, quality, state, ui, fx, music };

// ---------------------------------------------------------------- resize
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});
renderer.setSize(innerWidth, innerHeight);
composer.setSize(innerWidth, innerHeight);

// ---------------------------------------------------------------- loop
const clock = new THREE.Clock();
let simTime = 0;
let fpsEMA = 60;
let adaptTimer = 0;
let firstFrame = true;

function frame() {
  requestAnimationFrame(frame);
  const rawDt = Math.min(clock.getDelta(), 0.05);
  const fps = 1 / Math.max(rawDt, 1e-4);
  fpsEMA = fpsEMA * 0.92 + fps * 0.08;

  // adaptive quality every ~2.5s
  adaptTimer -= rawDt;
  if (adaptTimer <= 0) {
    adaptTimer = 2.5;
    if (fpsEMA < 42 && quality.tier > 0) applyTier(quality.tier - 1);
    else if (fpsEMA > 57 && quality.tier < 2 && fpsEMA < 100) applyTier(quality.tier + 1);
  }

  const dt = state.paused ? 0 : rawDt * state.speed;
  simTime += dt;

  try {
    world.update(dt, camera);
    station.update(dt, simTime);
    fleet.update(dt, camera.position, quality);
    fx.update(dt);
    director.update(rawDt, simTime);
  } catch (err) {
    console.error('sim step failed:', err);
  }

  // engine illumination for followed / capital ships
  const feat = (director.followed && !director.followed.dead) ? director.followed
    : (fleet.lastCapital && !fleet.lastCapital.dead && fleet.lastCapital.pos.distanceToSquared(camera.position) < 1600 * 1600) ? fleet.lastCapital : null;
  if (feat) {
    shipLight.position.copy(feat.pos);
    shipLight.color.set(feat.def.engineColor);
    shipLight.intensity = damp(shipLight.intensity, 900 * (0.25 + feat.throttle) * Math.pow(feat.def.len / 52, 2), rawDt * 6);
    shipLight.distance = feat.def.len * 8 + 120;
  } else {
    shipLight.intensity = damp(shipLight.intensity, 0, rawDt * 4);
  }

  composer.render();
  ui.update(rawDt, fpsEMA, simTime);

  if (firstFrame) {
    firstFrame = false;
    document.getElementById('loading').classList.add('done');
    const h = document.getElementById('hint');
    h.classList.add('show');
    setTimeout(() => h.classList.remove('show'), 9000);
  }
}
frame();
