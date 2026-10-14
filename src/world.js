// World: planet with procedural surface + night lights, clouds, atmosphere,
// starfield, nebulae, distant moons, asteroid belt.
import * as THREE from 'three';
import { PLANET_R, SUN_DIR, BELT_IN, BELT_OUT, makeRng, glowTexture } from './config.js';

const NOISE_GLSL = /* glsl */`
float hash31(vec3 p){ p = fract(p*0.3183099+0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float vnoise(vec3 x){
  vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash31(i+vec3(0,0,0)),hash31(i+vec3(1,0,0)),f.x),
                 mix(hash31(i+vec3(0,1,0)),hash31(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash31(i+vec3(0,0,1)),hash31(i+vec3(1,0,1)),f.x),
                 mix(hash31(i+vec3(0,1,1)),hash31(i+vec3(1,1,1)),f.x),f.y),f.z);
}
float fbm(vec3 p){ float a=0.5,s=0.0; for(int i=0;i<5;i++){ s+=a*vnoise(p); p*=2.03; a*=0.5; } return s; }
`;

export class World {
  constructor(scene) {
    this.scene = scene;
    this.time = 0;
    this._buildLights();
    this._buildPlanet();
    this._buildStars();
    this._buildNebulae();
    this._buildMoons();
    this._buildBelt();
  }

  _buildLights() {
    const sun = new THREE.DirectionalLight(0xfff2e0, 2.3);
    sun.position.copy(SUN_DIR).multiplyScalar(6000);
    this.scene.add(sun);
    this.scene.add(new THREE.AmbientLight(0x223344, 0.5));
    // faint planet-shine from below
    const bounce = new THREE.DirectionalLight(0x2a5a80, 0.55);
    bounce.position.set(0, -1, 0.3).multiplyScalar(1000);
    this.scene.add(bounce);
  }

  _buildPlanet() {
    // ---- surface
    const geo = new THREE.SphereGeometry(PLANET_R, 128, 80);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSunDir: { value: SUN_DIR.clone() },
      },
      vertexShader: /* glsl */`
        varying vec3 vObj; varying vec3 vWN; varying vec3 vWP;
        void main(){
          vObj = position;
          vWN = normalize(mat3(modelMatrix) * normal);
          vec4 wp = modelMatrix * vec4(position,1.0);
          vWP = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: NOISE_GLSL + /* glsl */`
        uniform float uTime; uniform vec3 uSunDir;
        varying vec3 vObj; varying vec3 vWN; varying vec3 vWP;

        float hgt(vec3 sp){
          float h = fbm(sp*3.2 + 11.7);
          float h2 = fbm(sp*9.0 + 4.1);
          return h + h2*0.12;
        }
        // fade out high-frequency detail once its footprint exceeds a pixel
        // (kills the single-frame shimmer/aliasing artifacts on the surface)
        float aaFade(vec3 p, float lo, float hi){
          vec3 d = fwidth(p);
          float m = max(max(d.x, d.y), d.z);
          return 1.0 - smoothstep(lo, hi, m);
        }

        void main(){
          vec3 sp = normalize(vObj);
          float h  = hgt(sp);
          float land = smoothstep(0.50, 0.545, h);

          float lat = abs(sp.y);
          float ice = smoothstep(0.72, 0.86, lat + fbm(sp*6.0)*0.08);

          // ocean with coastal shelf band
          vec3 deep = vec3(0.012, 0.055, 0.13);
          vec3 shallow = vec3(0.03, 0.16, 0.28);
          vec3 ocean = mix(deep, shallow, smoothstep(0.35, 0.52, h));
          float shelf = smoothstep(0.455, 0.505, h) * (1.0 - land);
          ocean = mix(ocean, vec3(0.07, 0.28, 0.36), shelf * 0.75);

          // land with fine striation detail
          vec3 green = vec3(0.06, 0.14, 0.07);
          vec3 arid  = vec3(0.26, 0.20, 0.11);
          vec3 rock  = vec3(0.16, 0.14, 0.13);
          vec3 landc = mix(green, arid, smoothstep(0.15, 0.5, fbm(sp*5.0+30.0)));
          landc = mix(landc, rock, smoothstep(0.60, 0.72, h));
          float det = fbm(sp*26.0 + h*6.0);
          landc = mix(landc, landc*1.35, (det-0.5)*0.9*aaFade(sp*26.0, 0.02, 0.09));
          vec3 surf = mix(ocean, landc, land);
          surf = mix(surf, vec3(0.75,0.78,0.82), ice);

          // terrain relief: perturb the normal from the height gradient over land
          vec3 t1 = normalize(cross(sp, vec3(0.0, 1.0, 0.001)));
          vec3 t2 = cross(sp, t1);
          float e = 0.006;
          float hu = hgt(normalize(sp + t1*e)), hv = hgt(normalize(sp + t2*e));
          float mountains = land * smoothstep(0.52, 0.62, h) * aaFade(sp*9.0, 0.02, 0.08);
          vec3 nrm = normalize(vWN + (t1*(hu-h) + t2*(hv-h)) * (0.22/e) * mountains);

          float sun = dot(nrm, uSunDir);
          float day = smoothstep(-0.12, 0.30, dot(vWN, uSunDir));
          float diff = max(sun, 0.0);

          vec3 col = surf * (0.045 + diff * 1.25);

          // ocean sun glint
          vec3 V = normalize(cameraPosition - vWP);
          vec3 H = normalize(uSunDir + V);
          float spec = pow(max(dot(vWN,H),0.0), 90.0) * (1.0-land) * day;
          col += vec3(0.9,0.85,0.7) * spec * 0.8;

          // night city lights (alias-faded so specks don't pop between frames)
          float pop = fbm(sp*34.0 + 7.0);
          float coast = 1.0 - smoothstep(0.50, 0.62, h);
          float cities = land * (1.0-ice) * pow(smoothstep(0.60, 0.75, pop), 2.0) * (0.35 + 0.65*coast);
          float flick = 0.9 + 0.1*sin(uTime*2.0 + pop*90.0);
          col += vec3(1.0, 0.62, 0.25) * cities * flick * (1.0-day) * 0.45 * aaFade(sp*34.0, 0.03, 0.12);

          // terminator warm band
          float band = smoothstep(0.0,0.18,sun) * (1.0-smoothstep(0.18,0.45,sun));
          col += vec3(0.5,0.22,0.08) * band * 0.10;

          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.planetMat = mat;
    this.planet = new THREE.Mesh(geo, mat);
    this.planet.rotation.z = 0.12;
    this.planet.renderOrder = 1;
    this.scene.add(this.planet);

    // ---- clouds
    const cloudMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uTime: { value: 0 }, uSunDir: { value: SUN_DIR.clone() } },
      vertexShader: /* glsl */`
        varying vec3 vObj; varying vec3 vWN;
        void main(){
          vObj = position; vWN = normalize(mat3(modelMatrix)*normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
        }`,
      fragmentShader: NOISE_GLSL + /* glsl */`
        uniform float uTime; uniform vec3 uSunDir;
        varying vec3 vObj; varying vec3 vWN;
        float aaFade(vec3 p, float lo, float hi){
          vec3 d = fwidth(p);
          float m = max(max(d.x, d.y), d.z);
          return 1.0 - smoothstep(lo, hi, m);
        }
        void main(){
          vec3 sp = normalize(vObj);
          vec3 q = sp*4.2 + vec3(uTime*0.004, uTime*0.0015, uTime*0.0015);
          // domain-warped weather: swirls and fronts instead of blobs
          vec3 warp = vec3(fbm(q*1.9 + 5.0), fbm(q*1.9 + 9.0), fbm(q*1.9 + 17.0));
          float c = fbm(q + warp*0.85);
          float a = smoothstep(0.44, 0.70, c);
          // wispy high-frequency edges, alias-faded at grazing angles
          float wisp = fbm(q*4.5) * aaFade(q*4.5, 0.05, 0.2);
          a = clamp(a + (wisp - 0.5) * 0.3 * a, 0.0, 1.0);
          float sun = dot(vWN, uSunDir);
          float day = smoothstep(-0.15, 0.35, sun);
          vec3 col = vec3(0.9,0.93,0.97) * (0.06 + day*1.15);
          col += vec3(0.55,0.3,0.15) * smoothstep(0.0,0.2,sun)*(1.0-smoothstep(0.2,0.5,sun)) * 0.35;
          gl_FragColor = vec4(col, a * 0.85);
        }`,
    });
    this.cloudMat = cloudMat;
    this.clouds = new THREE.Mesh(new THREE.SphereGeometry(PLANET_R + 14, 96, 60), cloudMat);
    this.clouds.rotation.z = 0.12;
    this.clouds.renderOrder = 2;
    this.scene.add(this.clouds);

    // ---- atmosphere rim (backside additive)
    const atmoMat = new THREE.ShaderMaterial({
      transparent: true, side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uSunDir: { value: SUN_DIR.clone() } },
      vertexShader: /* glsl */`
        varying vec3 vWN; varying vec3 vWP;
        void main(){
          vWN = normalize(mat3(modelMatrix)*normal);
          vec4 wp = modelMatrix*vec4(position,1.0); vWP = wp.xyz;
          gl_Position = projectionMatrix*viewMatrix*wp;
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uSunDir;
        varying vec3 vWN; varying vec3 vWP;
        void main(){
          vec3 V = normalize(cameraPosition - vWP);
          float rim = pow(1.0 - abs(dot(normalize(-vWN), V)), 3.2);
          float sun = smoothstep(-0.45, 0.55, dot(-vWN, uSunDir));
          vec3 col = mix(vec3(0.10,0.30,0.65), vec3(0.35,0.62,1.0), rim);
          gl_FragColor = vec4(col * rim * (0.25 + sun*1.1), rim * (0.25 + sun*0.9));
        }`,
    });
    this.atmosphere = new THREE.Mesh(new THREE.SphereGeometry(PLANET_R + 70, 64, 40), atmoMat);
    this.atmosphere.renderOrder = 3;
    this.scene.add(this.atmosphere);
  }

  _buildStars() {
    const N = 6500;
    const rng = makeRng(1337);
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), size = new Float32Array(N), phase = new Float32Array(N);
    const c = new THREE.Color();
    for (let i = 0; i < N; i++) {
      const u = rng() * 2 - 1, t = rng() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      const R = 9000 + rng() * 800;
      pos[i*3] = Math.cos(t) * r * R; pos[i*3+1] = u * R; pos[i*3+2] = Math.sin(t) * r * R;
      const h = rng();
      if (h < 0.6) c.setHSL(0.6, 0.15, 0.75 + rng()*0.25);
      else if (h < 0.85) c.setHSL(0.09, 0.35, 0.7 + rng()*0.2);
      else c.setHSL(0.55, 0.5, 0.7 + rng()*0.25);
      col[i*3] = c.r; col[i*3+1] = c.g; col[i*3+2] = c.b;
      size[i] = 0.7 + Math.pow(rng(), 3) * 3.4;
      phase[i] = rng() * Math.PI * 2;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uTime: { value: 0 }, uPR: { value: 1 } },
      vertexShader: /* glsl */`
        attribute vec3 aColor; attribute float aSize; attribute float aPhase;
        uniform float uTime; uniform float uPR;
        varying vec3 vC; varying float vA;
        void main(){
          vC = aColor;
          vA = 0.75 + 0.25*sin(uTime*(0.6+aPhase*0.4)+aPhase*7.0);
          vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = aSize * uPR;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        varying vec3 vC; varying float vA;
        void main(){
          vec2 d = gl_PointCoord - 0.5;
          float m = smoothstep(0.5, 0.1, length(d));
          gl_FragColor = vec4(vC * vA * 1.4, m * vA);
        }`,
    });
    this.starMat = mat;
    this.stars = new THREE.Points(g, mat);
    this.stars.frustumCulled = false;
    this.scene.add(this.stars);
  }

  _buildNebulae() {
    const defs = [
      { color: 0x7a3fd0, size: 5200, pos: [-5200, 1800, -7200], op: 0.30 },
      { color: 0x1f6fa8, size: 4600, pos: [6400, -900, -6800], op: 0.24 },
      { color: 0x2fa891, size: 3800, pos: [1500, 3200, -8200], op: 0.20 },
      { color: 0x9a4f8f, size: 3000, pos: [-7200, -2200, -3800], op: 0.18 },
    ];
    this.nebulae = [];
    for (const d of defs) {
      const tex = this._nebulaTexture(d.color);
      const mat = new THREE.MeshBasicMaterial({
        map: tex, transparent: true, opacity: d.op, blending: THREE.AdditiveBlending,
        depthWrite: false, side: THREE.DoubleSide,
      });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(d.size, d.size), mat);
      m.position.set(...d.pos);
      m.lookAt(0, 0, 0);
      m.rotateZ(Math.random() * Math.PI);
      this.scene.add(m);
      this.nebulae.push(m);
    }
  }

  _nebulaTexture(colorHex) {
    const S = 512;
    const c = document.createElement('canvas'); c.width = c.height = S;
    const ctx = c.getContext('2d');
    const col = new THREE.Color(colorHex);
    const rng = makeRng(colorHex);
    // layered soft blobs
    for (let i = 0; i < 90; i++) {
      const x = S/2 + (rng()-0.5)*S*0.8, y = S/2 + (rng()-0.5)*S*0.8;
      const r = 30 + rng()*160;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const a = 0.02 + rng()*0.05;
      const tint = 0.6 + rng()*0.6;
      g.addColorStop(0, `rgba(${Math.min(255,col.r*255*tint)|0},${Math.min(255,col.g*255*tint)|0},${Math.min(255,col.b*255*tint)|0},${a})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.fill();
    }
    // dust lanes: subtractive streaks
    ctx.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 26; i++) {
      const x = S/2 + (rng()-0.5)*S, y = S/2 + (rng()-0.5)*S;
      const r = 20 + rng()*90;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(0,0,0,${0.15+rng()*0.2})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    // stars inside nebula
    for (let i = 0; i < 120; i++) {
      const x = rng()*S, y = rng()*S;
      ctx.fillStyle = `rgba(255,255,255,${0.15+rng()*0.4})`;
      ctx.fillRect(x, y, 1.4, 1.4);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  _buildMoons() {
    const mk = (r, pos, shade, craters) => {
      const g = new THREE.SphereGeometry(r, 48, 32);
      // subtle crater displacement
      const p = g.attributes.position;
      const rng = makeRng(r);
      for (let i = 0; i < p.count; i++) {
        const v = new THREE.Vector3().fromBufferAttribute(p, i).normalize();
        const d = Math.sin(v.x*craters)*Math.sin(v.y*craters*1.3)*Math.sin(v.z*craters*0.7);
        p.setXYZ(i, p.getX(i)+v.x*d*r*0.02, p.getY(i)+v.y*d*r*0.02, p.getZ(i)+v.z*d*r*0.02);
      }
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: shade, roughness: 1, metalness: 0 }));
      m.position.set(...pos);
      this.scene.add(m);
      return m;
    };
    this.moon1 = mk(150, [-4600, 1100, -6200], 0x8a8d94, 9);
    this.moon2 = mk(70, [5300, -500, -3400], 0x6f6a62, 13);
  }

  _buildBelt() {
    // displaced icosahedron base rock
    const base = new THREE.IcosahedronGeometry(1, 1);
    const p = base.attributes.position;
    const rng = makeRng(42);
    const seen = new Map();
    for (let i = 0; i < p.count; i++) {
      const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
      let d = seen.get(key);
      if (d === undefined) { d = 1 + (rng() - 0.5) * 0.55; seen.set(key, d); }
      const v = new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)).normalize().multiplyScalar(d);
      p.setXYZ(i, v.x, v.y, v.z);
    }
    base.computeVertexNormals();

    const N = 420;
    const mat = new THREE.MeshStandardMaterial({ color: 0x6b6459, roughness: 0.95, metalness: 0.05 });
    this.belt = new THREE.InstancedMesh(base, mat, N);
    this.beltGroup = new THREE.Group();
    this.beltGroup.rotation.x = 0.16;
    this.beltGroup.add(this.belt);
    this.scene.add(this.beltGroup);

    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    this.beltSpin = 0.0035; // rad/s around planet axis
    for (let i = 0; i < N; i++) {
      const ang = rng() * Math.PI * 2;
      const r = BELT_IN + rng() * (BELT_OUT - BELT_IN);
      const y = (rng() - 0.5) * 260;
      const s = 3 + Math.pow(rng(), 2.2) * 22;
      e.set(rng()*Math.PI, rng()*Math.PI, rng()*Math.PI);
      q.setFromEuler(e);
      m.compose(new THREE.Vector3(Math.cos(ang)*r, y, Math.sin(ang)*r), q, new THREE.Vector3(s, s*(0.7+rng()*0.5), s));
      this.belt.setMatrixAt(i, m);
    }
    this.belt.instanceMatrix.needsUpdate = true;

    // mining sites (local to belt group)
    this.miningSites = [];
    for (let i = 0; i < 8; i++) {
      const ang = rng() * Math.PI * 2;
      const r = BELT_IN + 120 + rng() * (BELT_OUT - BELT_IN - 300);
      this.miningSites.push(new THREE.Vector3(Math.cos(ang)*r, (rng()-0.5)*160, Math.sin(ang)*r));
    }
  }

  siteWorld(i, out) {
    return out.copy(this.miningSites[i]).applyMatrix4(this.beltGroup.matrixWorld);
  }

  update(dt, camera) {
    this.time += dt;
    this.planetMat.uniforms.uTime.value = this.time;
    this.cloudMat.uniforms.uTime.value = this.time;
    this.starMat.uniforms.uTime.value = this.time;
    this.planet.rotation.y += dt * 0.006;
    this.clouds.rotation.y += dt * 0.009;
    this.beltGroup.rotation.y += dt * this.beltSpin;
    this.beltGroup.updateMatrixWorld();
  }

  setQuality(pr) { this.starMat.uniforms.uPR.value = pr; }
}
