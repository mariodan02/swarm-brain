// Procedural point-cloud brain: one BufferGeometry, one shader, region state through uniforms.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/**
 * Agents in region-index order. Axes: x = left/right, y = up, z = front.
 * `anchor` is where arcs start/end, `label` is where the HTML label floats.
 */
export const AGENTS = [
  { id: 'planner',      region: 'lobo frontale',     anchor: [0.26, 0.30, 0.74],   label: [0.42, 0.50, 1.02] },
  { id: 'researcher',   region: 'lobo parietale',    anchor: [0.34, 0.50, -0.22],  label: [0.62, 0.80, -0.36] },
  { id: 'memory',       region: 'lobo temporale',    anchor: [0.69, -0.24, 0.12],  label: [1.02, -0.40, 0.26] },
  { id: 'executor',     region: 'corteccia motoria', anchor: [-0.36, 0.49, 0.18],  label: [-0.66, 0.78, 0.26] },
  { id: 'critic',       region: 'lobo occipitale',   anchor: [-0.26, 0.20, -0.80], label: [-0.46, 0.34, -1.08] },
  { id: 'orchestrator', region: 'nucleo centrale',   anchor: [0.0, -0.05, -0.02],  label: [-0.72, -0.70, 0.40] },
];

const NEUTRAL = 6;          // cerebellum and brainstem: no agent
const REGIONS = 7;
const FOV = 40;
const TARGET = new THREE.Vector3(0, -0.12, 0);

// Deterministic RNG so the brain looks the same on every load.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Cheap warped-sine field in about [-1.1, 1.1]: gives gyri/sulci without a noise library.
function fold(x, y, z) {
  return 0.5 * Math.sin(x * 11 + Math.sin(z * 7) * 2.2)
       + 0.3 * Math.sin(y * 13 + Math.sin(x * 9) * 2.0)
       + 0.3 * Math.sin(z * 10 + Math.sin(y * 8) * 2.0);
}

function regionOf(x, y, z, f) {
  const zz = z + 0.03 * f; // jitter the borders so they are not ruler-straight
  if (y < -0.10 && zz > -0.42 && zz < 0.50 && Math.abs(x) > 0.30) return 2; // temporal
  if (zz > 0.30) return 0;   // frontal
  if (zz > 0.04) return 3;   // motor strip
  if (zz > -0.42) return 1;  // parietal
  return 4;                  // occipital
}

function buildBrainGeometry() {
  const rnd = mulberry32(20261113);
  const pos = [], reg = [], rand = [], bright = [];
  const push = (x, y, z, r, b) => { pos.push(x, y, z); reg.push(r); rand.push(rnd()); bright.push(b); };
  const dir = () => {
    const u = rnd() * 2 - 1, phi = rnd() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    return [s * Math.cos(phi), u, s * Math.sin(phi)];
  };

  // Cortex: one ellipsoid shaped into two hemispheres with a groove along the midline.
  const cortex = (n, interior) => {
    for (let i = 0; i < n; i++) {
      const [dx, dy, dz] = dir();
      let x = dx * 0.70, y = dy * 0.58, z = dz * 0.88;
      if (y < 0) y *= 0.72;                    // flatter underside
      x *= 1 - 0.14 * (z / 0.88);              // narrower at the front
      const g = Math.exp(-((x / 0.10) ** 2));  // longitudinal fissure
      y *= 1 - 0.22 * g;
      z *= 1 - 0.22 * g;
      x += Math.sign(x) * 0.025;
      const f = fold(x, y, z);
      // Zero-crossings of the fold field draw thin winding lines: keep more points there.
      const line = Math.exp(-((f / 0.14) ** 2));
      if (!interior && rnd() > 0.28 + 0.72 * line) { i--; continue; }
      const s = interior
        ? 0.35 + 0.58 * Math.sqrt(rnd())
        : 1 + 0.035 * f - 0.05 * rnd() * rnd();
      x *= s; y *= s; z *= s;
      push(x, y, z, regionOf(x, y, z, f), interior ? 0.2 : 0.22 + 0.78 * line);
    }
  };
  cortex(21000, false);
  cortex(4000, true);

  // Temporal lobes: a bulge low on each side.
  for (let i = 0; i < 3000; i++) {
    const side = i % 2 ? 1 : -1;
    const [dx, dy, dz] = dir();
    let x = dx * 0.20, y = dy * 0.17, z = dz * 0.46;
    const f = fold(x * 1.3 + side, y * 1.3, z * 1.3);
    const line = Math.exp(-((f / 0.14) ** 2));
    if (rnd() > 0.28 + 0.72 * line) { i--; continue; }
    const s = 1 + 0.05 * f - 0.06 * rnd() * rnd();
    push(side * 0.50 + x * s, -0.24 + y * s, 0.10 + z * s, 2, 0.22 + 0.78 * line);
  }

  // Cerebellum (fine horizontal striations) and brainstem: neutral, they only complete the silhouette.
  for (let i = 0; i < 2500; i++) {
    const [dx, dy, dz] = dir();
    const s = 1 - 0.10 * rnd() * rnd();
    const x = dx * 0.40 * s, y = -0.40 + dy * 0.20 * s, z = -0.58 + dz * 0.26 * s;
    push(x + Math.sign(x) * 0.012, y, z, NEUTRAL, 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(y * 70)));
  }
  for (let i = 0; i < 500; i++) {
    const t = rnd(), a = rnd() * Math.PI * 2, r = 0.09 - 0.03 * t;
    push(Math.cos(a) * r, -0.35 - 0.60 * t, -0.18 - 0.12 * t + Math.sin(a) * r, NEUTRAL, 0.45);
  }

  // Orchestrator: dense core at the centre, visible through the cortex (additive blending).
  for (let i = 0; i < 2500; i++) {
    const [dx, dy, dz] = dir();
    const s = Math.cbrt(rnd());
    push(dx * 0.20 * s, -0.05 + dy * 0.16 * s, -0.02 + dz * 0.26 * s, 5, 0.9);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aRegion', new THREE.Float32BufferAttribute(reg, 1));
  geo.setAttribute('aRand', new THREE.Float32BufferAttribute(rand, 1));
  geo.setAttribute('aFold', new THREE.Float32BufferAttribute(bright, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.2);
  return geo;
}

const BRAIN_VERT = /* glsl */ `
uniform float uTime;
uniform float uScale;
uniform float uAct[${REGIONS}];
uniform float uLime[${REGIONS}];
uniform float uErr[${REGIONS}];
uniform vec3 uBase;     // palette (see PALETTES)
uniform vec3 uActive;
uniform vec3 uDone;
uniform vec3 uError;
attribute float aRegion;
attribute float aRand;
attribute float aFold;
varying vec3 vColor;

void main() {
  int r = int(aRegion + 0.5);
  float act = uAct[r];
  float lime = uLime[r];
  float err = clamp(uErr[r], 0.0, 1.0);

  // A wave moving outward from the centre makes an active region pulse.
  float wave = 0.5 + 0.5 * sin(uTime * 5.0 - length(position) * 9.0 + aRand * 1.5);
  float shimmer = 0.8 + 0.2 * sin(uTime * 1.3 + aRand * 40.0);
  float relief = 0.3 + 0.7 * aFold;

  vec3 col = uBase * relief * shimmer;
  col += uActive * act * (0.25 + 0.75 * wave) * relief;
  col += uDone * lime * relief;
  float blink = 0.55 + 0.45 * sin(uTime * 22.0);
  col = mix(col, uError * blink * relief, err);

  vec3 p = position * (1.0 + act * 0.012 * wave);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;

  // Rim light: points seen edge-on are brighter, which gives the translucent x-ray shell.
  vec3 n = normalize(normalMatrix * normalize(position + vec3(0.0, 0.1, 0.0)));
  float rim = 0.32 + 1.3 * pow(1.0 - abs(dot(n, normalize(-mv.xyz))), 1.5);
  vColor = col * rim;

  float size = (0.0055 + 0.0070 * aRand) * (1.0 + 0.35 * act + 0.3 * err);
  gl_PointSize = max(1.3, size * uScale / -mv.z);
}`;

const BRAIN_FRAG = /* glsl */ `
varying vec3 vColor;
void main() {
  float a = smoothstep(0.5, 0.1, length(gl_PointCoord - 0.5));
  gl_FragColor = vec4(vColor, a * 0.75);
}`;

// Arc shaders: aT runs 0..1 along the curve, uHead is where the impulse is now.
const ARC_LINE_VERT = /* glsl */ `
attribute float aT;
varying float vT;
void main() { vT = aT; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const ARC_LINE_FRAG = /* glsl */ `
uniform float uHead;
uniform float uFade;
uniform vec3 uColor;
varying float vT;
void main() {
  float d = uHead - vT;
  float trail = d >= 0.0 ? exp(-d * 7.0) : 0.0;
  gl_FragColor = vec4(uColor, (0.10 + 0.9 * trail) * uFade);
}`;

const ARC_DOT_VERT = /* glsl */ `
uniform float uHead;
uniform float uScale;
attribute float aT;
varying float vGlow;
void main() {
  float d = uHead - aT;
  vGlow = d >= 0.0 ? exp(-d * 16.0) : exp(d * 90.0);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = (0.008 + 0.034 * vGlow) * uScale / -mv.z;
}`;

const ARC_DOT_FRAG = /* glsl */ `
uniform float uFade;
uniform vec3 uColor;
varying float vGlow;
void main() {
  float a = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5));
  gl_FragColor = vec4(uColor * (1.0 + vGlow), a * vGlow * uFade);
}`;

// Two palettes. The optional light theme (?theme=light) is drawn as its negative and flipped by a CSS invert() on the
// canvas: additive light on black becomes ink on white, so every colour here is the complement
// of the colour you see (teal ink is stored as orange, and so on).
const C = (r, g, b, k = 1) => new THREE.Color(r * k, g * k, b * k);
const PALETTES = {
  dark: {
    background: 0x02050b, stars: 0x1d5f80, rings: 0x0f4a63, leader: 0x1a6f8f,
    base: C(0.020, 0.085, 0.180), active: C(0.10, 0.50, 0.66), done: C(0.135, 0.25, 0.036), error: C(1.0, 0.07, 0.13),
    arcs: { cyan: C(0.20, 0.85, 1.0), lime: C(0.62, 1.0, 0.22), red: C(1.0, 0.2, 0.28) },
  },
  light: {
    background: 0x0e0a07, stars: 0x6a4a36, rings: 0x8a5a40, leader: 0x9a6648,
    base: C(1.0, 0.58, 0.42, 0.15), active: C(1.0, 0.50, 0.32, 0.50), done: C(0.62, 0.36, 1.0, 0.16), error: C(0.17, 0.91, 0.82, 0.75),
    arcs: { cyan: C(1.0, 0.45, 0.28, 0.9), lime: C(0.62, 0.36, 1.0, 0.9), red: C(0.17, 0.91, 0.82, 0.9) },
  },
};

export class Brain {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {HTMLElement} labelLayer container for the HTML region labels
   * @param {{light?: boolean}} [opts] light = draw the negative for the CSS-inverted light theme
   */
  constructor(canvas, labelLayer, opts = {}) {
    this.palette = opts.light ? PALETTES.light : PALETTES.dark;
    this.index = new Map(AGENTS.map((a, i) => [a.id, i]));
    this.state = AGENTS.map(() => 'idle');
    this.act = new Array(REGIONS).fill(0);   // smoothed "working" glow
    this.bump = new Array(REGIONS).fill(0);  // short extra glow (impulse arrival, LLM call)
    this.lime = new Array(REGIONS).fill(0);
    this.err = new Array(REGIONS).fill(0);
    this.arcs = [];
    /** @type {((agent: string) => void) | null} called when a region label is clicked */
    this.onSelect = null;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5); // bloom is fill-rate bound
    this.size = { w: 1, h: 1 };

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(this.pixelRatio);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(this.palette.background);
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 60);
    this.camera.position.set(2.4, 0.9, 2.7);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.copy(TARGET);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.7;
    this.controls.minDistance = 1.8;
    this.controls.maxDistance = 12;

    this.uniforms = {
      uTime: { value: 0 },
      uScale: { value: 1 },
      uAct: { value: new Array(REGIONS).fill(0) },
      uLime: { value: new Array(REGIONS).fill(0) },
      uErr: { value: new Array(REGIONS).fill(0) },
      uBase: { value: this.palette.base },
      uActive: { value: this.palette.active },
      uDone: { value: this.palette.done },
      uError: { value: this.palette.error },
    };
    const matOpts = {
      vertexShader: BRAIN_VERT,
      fragmentShader: BRAIN_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    };
    const geometry = buildBrainGeometry();
    this.scene.add(new THREE.Points(geometry, new THREE.ShaderMaterial({ ...matOpts, uniforms: this.uniforms })));

    this.#buildBackdrop();
    this.#buildLabels(labelLayer);

    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(this.pixelRatio);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.5, 0.22);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this.#frame());
  }

  // Far dust plus a ring platform under the brain: depth cues that cost almost nothing.
  #buildBackdrop() {
    const rnd = mulberry32(7);
    const stars = [];
    for (let i = 0; i < 700; i++) {
      const u = rnd() * 2 - 1, phi = rnd() * Math.PI * 2, s = Math.sqrt(1 - u * u), r = 5 + rnd() * 9;
      stars.push(s * Math.cos(phi) * r, u * r, s * Math.sin(phi) * r);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(stars, 3));
    this.scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({
      color: this.palette.stars, size: 0.03, transparent: true, opacity: 0.7, depthWrite: false,
    })));

    const ringMat = new THREE.LineBasicMaterial({ color: this.palette.rings, transparent: true, opacity: 0.55 });
    for (const [r, n] of [[0.95, 128], [1.25, 128]]) {
      const pts = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a) * r, -1.08, Math.sin(a) * r));
      }
      this.scene.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), ringMat));
    }
  }

  #buildLabels(layer) {
    this.anchors = AGENTS.map((a) => new THREE.Vector3(...a.anchor));
    this.labelPos = AGENTS.map((a) => new THREE.Vector3(...a.label));
    this.labels = AGENTS.map((a) => {
      const el = document.createElement('div');
      el.className = 'blabel idle';
      const file = document.createElement('span');
      file.className = 'f';
      file.textContent = `${a.id}.md`;
      const sub = document.createElement('span');
      sub.className = 's';
      sub.textContent = a.region;
      el.append(file, sub);
      el.addEventListener('click', () => this.onSelect?.(a.id));
      layer.appendChild(el);
      return el;
    });

    // Leader lines from each region to its label.
    const seg = [];
    AGENTS.forEach((_, i) => seg.push(...this.anchors[i].toArray(), ...this.labelPos[i].toArray()));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
    this.scene.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      color: this.palette.leader, transparent: true, opacity: 0.6, depthWrite: false,
    })));
  }

  /** @param {string} agent @param {'idle'|'working'|'done'|'error'} state */
  setState(agent, state) {
    const i = this.index.get(agent);
    if (i === undefined) return;
    this.state[i] = state;
    this.labels[i].className = `blabel ${state}`;
    if (state === 'done') this.lime[i] = 1;
    if (state === 'error') this.err[i] = 1;
  }

  /** Short extra glow, e.g. when an LLM call starts. */
  kick(agent, amount = 0.6) {
    const i = this.index.get(agent);
    if (i !== undefined) this.bump[i] = Math.max(this.bump[i], amount);
  }

  /** Red flash that fades by itself (non-fatal error). */
  flashError(agent) {
    const i = this.index.get(agent);
    if (i !== undefined) this.err[i] = 1;
  }

  /** Send a light impulse along a curved arc between two regions. */
  pulse(from, to, color = 'cyan') {
    const ia = this.index.get(from), ib = this.index.get(to);
    if (ia === undefined || ib === undefined || ia === ib) return;
    const a = this.anchors[ia], b = this.anchors[ib];
    const mid = a.clone().add(b).multiplyScalar(0.5);
    let ctrl;
    if (from === 'orchestrator' || to === 'orchestrator') {
      // Inside the brain: a gentle bend is enough.
      ctrl = mid.clone().multiplyScalar(1.15).add(new THREE.Vector3(0, 0.14, 0));
    } else {
      // Between cortex regions: lift the arc outside the surface.
      const out = mid.lengthSq() > 1e-4 ? mid.clone().normalize() : new THREE.Vector3(0, 1, 0);
      ctrl = out.multiplyScalar(Math.max(a.length(), b.length()) + a.distanceTo(b) * 0.5);
    }
    const N = 96;
    const pts = new THREE.QuadraticBezierCurve3(a, ctrl, b).getPoints(N - 1);
    const pos = new Float32Array(N * 3), t = new Float32Array(N);
    pts.forEach((p, i) => { p.toArray(pos, i * 3); t[i] = i / (N - 1); });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aT', new THREE.BufferAttribute(t, 1));

    const uniforms = {
      uHead: { value: 0 },
      uFade: { value: 1 },
      uColor: { value: this.palette.arcs[color] || this.palette.arcs.cyan },
      uScale: this.uniforms.uScale,
    };
    const common = { uniforms, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending };
    const line = new THREE.Line(geo, new THREE.ShaderMaterial({ ...common, vertexShader: ARC_LINE_VERT, fragmentShader: ARC_LINE_FRAG }));
    const dots = new THREE.Points(geo, new THREE.ShaderMaterial({ ...common, vertexShader: ARC_DOT_VERT, fragmentShader: ARC_DOT_FRAG }));
    line.frustumCulled = dots.frustumCulled = false;
    this.scene.add(line, dots);
    this.arcs.push({ line, dots, geo, uniforms, t: 0, target: ib, arrived: false });
  }

  /** Back to the resting state (new run). */
  reset() {
    AGENTS.forEach((a) => this.setState(a.id, 'idle'));
    this.lime.fill(0);
    this.err.fill(0);
    this.bump.fill(0);
  }

  /**
   * Resize and keep the brain centred in the area the HUD leaves free.
   * @param {number} w stage width in CSS px
   * @param {number} h stage height in CSS px
   * @param {{left:number, top:number, right:number, bottom:number}} free
   */
  setViewport(w, h, free) {
    if (w < 2 || h < 2) return;
    this.size = { w, h };
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    const fw = Math.max(80, free.right - free.left), fh = Math.max(80, free.bottom - free.top);
    const cx = (free.left + free.right) / 2, cy = (free.top + free.bottom) / 2;
    // Shift the projection so the orbit target lands at the centre of the free area.
    this.camera.setViewOffset(w, h, w / 2 - cx, h / 2 - cy, w, h);
    this.camera.updateProjectionMatrix();

    const t = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const dist = THREE.MathUtils.clamp(Math.max((1.12 * h) / (t * fh), (1.45 * h) / (t * fw)), 2.4, 11);
    const offset = this.camera.position.clone().sub(this.controls.target).setLength(dist);
    this.camera.position.copy(this.controls.target).add(offset);
    this.uniforms.uScale.value = (h * this.pixelRatio) / (2 * t);
  }

  #frame() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    this.uniforms.uTime.value += dt;
    const k = 1 - Math.exp(-dt * 6);

    for (let i = 0; i < AGENTS.length; i++) {
      const s = this.state[i];
      this.act[i] += ((s === 'working' ? 1 : 0) - this.act[i]) * k;
      this.bump[i] *= Math.exp(-dt * 2.5);
      // The orchestrator core keeps a faint lime tint: it is the palette accent.
      const limeFloor = s === 'done' ? 0.35 : i === 5 ? 0.18 : 0;
      this.lime[i] = Math.max(limeFloor, this.lime[i] * Math.exp(-dt * 0.9));
      this.err[i] = Math.max(s === 'error' ? 0.45 : 0, this.err[i] * Math.exp(-dt * 1.0));
      this.uniforms.uAct.value[i] = this.act[i] + this.bump[i];
      this.uniforms.uLime.value[i] = this.lime[i];
      this.uniforms.uErr.value[i] = this.err[i];
    }

    for (let i = this.arcs.length - 1; i >= 0; i--) {
      const arc = this.arcs[i];
      arc.t += dt / 0.9;
      arc.uniforms.uHead.value = Math.min(arc.t, 1);
      if (arc.t >= 1 && !arc.arrived) {
        arc.arrived = true;
        this.bump[arc.target] = Math.max(this.bump[arc.target], 0.9);
      }
      if (arc.t > 1) arc.uniforms.uFade.value = Math.max(0, 1 - (arc.t - 1) / 0.7);
      if (arc.t > 1.7) {
        this.scene.remove(arc.line, arc.dots);
        arc.geo.dispose();
        arc.line.material.dispose();
        arc.dots.material.dispose();
        this.arcs.splice(i, 1);
      }
    }

    this.controls.update();
    this.#placeLabels();
    this.composer.render(dt);
  }

  #placeLabels() {
    const { w, h } = this.size;
    const view = this.camera.position.clone().sub(this.controls.target).normalize();
    const v = new THREE.Vector3();
    for (let i = 0; i < AGENTS.length; i++) {
      v.copy(this.labelPos[i]).project(this.camera);
      const x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
      // Fade labels that are on the far side of the brain.
      const facing = v.copy(this.labelPos[i]).sub(this.controls.target).normalize().dot(view);
      const el = this.labels[i];
      el.style.opacity = THREE.MathUtils.clamp(0.25 + (facing + 0.6) * 0.95, 0.25, 1).toFixed(2);
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
    }
  }
}
