// 3D view of one forward pass. Every number the model computes is one cell.
// Layout idea: each position of the text is a lane running left to right (the "residual stream",
// on the floor); attention and MLP are bridges above the lanes that add their result back.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const DX = 0.5;        // cell pitch along the flow (x)
const DZ = 1.0;        // lane pitch (z): one lane per position
const GAP = 3;         // space between slabs
const BRIDGE_Y = 4.5;  // height of the attention / MLP bridges above the stream
const SHEET_Y = 2.3;   // vertical distance between stacked sheets
const FOV = 40;

const POSITIVE = new THREE.Color(0.62, 1.0, 0.22);  // lime
const NEGATIVE = new THREE.Color(0.2, 0.85, 1.0);   // cyan
const BASE = new THREE.Color(0.02, 0.05, 0.09);
const DIM = 0.14;      // brightness of everything outside the current step

/**
 * Where every tensor sits. A slab shows `rows` x `cols` cells of `tensor`, starting at column
 * `colStart`. kind: 'signed' (scaled by the tensor's largest value), 'weight' or 'prob' (0..1).
 */
export function buildLayout(config, T) {
  const C = config.n_embd, H = config.n_head, V = config.vocab.length, W = C * DX;
  const slabs = [];
  let x = 0;
  const put = (id, o = {}) => slabs.push({
    id, tensor: o.tensor ?? id, colStart: o.colStart ?? 0, cols: o.cols ?? C, rows: o.rows ?? T,
    x, y: o.y ?? 0, z0: o.z0 ?? 0, dx: o.dx ?? DX, kind: o.kind ?? 'signed', hScale: o.hScale ?? 1,
    label: o.label ?? null, name: o.name ?? o.label ?? null,
  });

  put('tok', { label: 'vettore di ogni lettera' });
  put('pos', { y: BRIDGE_Y, label: 'vettore di ogni posizione' });
  x += W + GAP;
  put('x0', { label: 'somma: entra nel flusso' });
  x += W + GAP;

  for (let l = 0; l < config.n_layer; l++) {
    const id = (name) => `l${l}.${name}`;
    put(id('ln1'), { y: BRIDGE_Y, label: 'normalizzazione' });
    x += W + GAP;
    put(id('q'), { y: BRIDGE_Y + 2 * SHEET_Y, label: 'query: cosa cerco' });
    put(id('k'), { y: BRIDGE_Y + SHEET_Y, label: 'key: cosa offro' });
    put(id('v'), { y: BRIDGE_Y, label: 'value: cosa passo' });
    x += W + GAP;
    for (let h = 0; h < H; h++) {
      put(id(`att${h}`), { y: BRIDGE_Y, cols: T, kind: 'weight', name: `attenzione · testa ${h + 1}`, label: h === 0 ? 'attenzione: una griglia per testa' : null });
      x += T * DX + GAP * 0.6;
    }
    x += GAP * 0.4;
    put(id('mix'), { y: BRIDGE_Y, label: 'valori mescolati' });
    x += W + GAP;
    put(id('aout'), { y: BRIDGE_Y, label: 'uscita dell’attenzione' });
    x += W + GAP;
    put(id('x1'), { label: 'flusso + attenzione' });
    x += W + GAP;
    put(id('ln2'), { y: BRIDGE_Y, label: 'normalizzazione' });
    x += W + GAP;
    for (let s = 0; s < 4; s++) {
      put(id(`hid.${s}`), {
        tensor: id('hid'), colStart: s * C, y: BRIDGE_Y + s * SHEET_Y,
        label: s === 3 ? `strato nascosto: ${4 * C} numeri su 4 piani` : null,
      });
    }
    x += W + GAP;
    put(id('mlp'), { y: BRIDGE_Y, label: 'uscita del MLP' });
    x += W + GAP;
    put(id('x2'), { label: 'flusso + MLP' });
    x += W + GAP;
  }

  put('lnf', { label: 'normalizzazione finale' });
  x += W + GAP;
  put('logits', { cols: V, label: 'un punteggio per lettera' });
  x += V * DX + GAP;
  put('probs', { rows: 1, z0: T - 1, cols: V, kind: 'prob', hScale: 7, dx: 0.7, label: 'probabilità della prossima lettera' });
  x += V * 0.7;
  return { slabs, length: x };
}

const matches = (slab, focus) => focus === null || focus.some((f) => slab.id === f || slab.id.startsWith(f));

function slabBox(slab) {
  return new THREE.Box3(
    new THREE.Vector3(slab.x, slab.y, slab.z0 - 0.5),
    new THREE.Vector3(slab.x + slab.cols * slab.dx, slab.y + slab.hScale, slab.z0 + slab.rows * DZ - 0.5),
  );
}

export class LLMScene {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {HTMLElement} labelLayer
   * @param {object} config model config
   */
  constructor(canvas, labelLayer, config) {
    this.config = config;
    this.labelLayer = labelLayer;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    this.size = { w: 1, h: 1 };
    this.free = { left: 0, top: 0, right: 1, bottom: 1 };
    this.slabs = [];
    this.focus = null;
    this.labels = [];      // {el, at: Vector3, slab: number|null}
    /** @type {((hit: {slab: object, row: number, col: number, value: number}|null, x: number, y: number) => void)|null} */
    this.onHover = null;
    this.pointer = null;   // {x, y, cx, cy} when a hover test is due
    this.tween = null;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(this.pixelRatio);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x02050b);
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 2000);
    this.camera.position.set(-20, 14, 30);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.495; // stay above the floor
    this.controls.addEventListener('start', () => { this.tween = null; }); // the user takes over

    // One instanced mesh for every cell, sized for the longest text.
    const full = buildLayout(config, config.block);
    this.capacity = full.slabs.reduce((n, s) => n + s.rows * s.cols, 0);
    this.cells = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), this.capacity);
    this.cells.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.cells.setColorAt(0, BASE);
    this.cells.frustumCulled = false;
    this.scene.add(this.cells);
    this.value = new Float32Array(this.capacity);   // normalised value of each cell, -1..1
    this.raw = new Float32Array(this.capacity);     // the real number
    this.slabOf = new Uint16Array(this.capacity);
    this.rowOf = new Uint16Array(this.capacity);
    this.colOf = new Uint16Array(this.capacity);

    this.lines = new THREE.Group();   // lanes, ramps and attention arcs: rebuilt for every text
    this.scene.add(this.lines);

    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(this.pixelRatio);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.4, 0.5, 0.35));
    this.composer.addPass(new OutputPass());

    this.raycaster = new THREE.Raycaster();
    canvas.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.pointer = { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1, cx: e.clientX, cy: e.clientY };
    });
    canvas.addEventListener('pointerleave', () => { this.pointer = null; this.onHover?.(null, 0, 0); });

    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this.#frame());
  }

  /**
   * Draw one forward pass.
   * @param {Map<string, {rows: number, cols: number, data: Float32Array}>} tensors must include 'probs' (1 x vocab)
   * @param {string[]} letters the text, one string per position
   * @param {string[]} vocabLetters display form of each vocabulary entry
   */
  setTrace(tensors, letters, vocabLetters) {
    const T = letters.length;
    const { slabs, length } = buildLayout(this.config, T);
    this.slabs = slabs;
    this.length = length;
    this.T = T;

    const m = new THREE.Matrix4();
    let i = 0;
    slabs.forEach((slab, si) => {
      const t = tensors.get(slab.tensor);
      let scale = 1;
      if (slab.kind === 'signed') {
        let max = 1e-9;
        for (const v of t.data) max = Math.max(max, Math.abs(v));
        scale = 1 / max;
      }
      for (let r = 0; r < slab.rows; r++) {
        for (let c = 0; c < slab.cols; c++) {
          const v = t.data[r * t.cols + slab.colStart + c];
          const vn = v * scale;
          const h = (0.06 + 0.94 * Math.abs(vn)) * 0.9 * slab.hScale;
          m.makeScale(slab.dx * 0.8, h, DZ * 0.8);
          m.setPosition(slab.x + (c + 0.5) * slab.dx, slab.y + h / 2, slab.z0 + r * DZ);
          this.cells.setMatrixAt(i, m);
          this.value[i] = vn;
          this.raw[i] = v;
          this.slabOf[i] = si;
          this.rowOf[i] = r;
          this.colOf[i] = c;
          i++;
        }
      }
    });
    this.cells.count = i;
    this.cells.instanceMatrix.needsUpdate = true;
    this.cells.computeBoundingSphere();

    this.#buildLines(tensors);
    this.#buildLabels(tensors, letters, vocabLetters);
    this.#paint();
  }

  #buildLines(tensors) {
    for (const child of [...this.lines.children]) {
      this.lines.remove(child);
      child.geometry.dispose();
      child.material.dispose();
    }
    const T = this.T, pts = [];
    // Lanes: the residual stream of each position, from the first slab to the last.
    for (let t = 0; t < T; t++) pts.push(-1, 0.02, t * DZ, this.length, 0.02, t * DZ);
    // Ramps: up from the stream to a bridge, and back down where the result is added.
    const ramp = (from, to) => {
      const a = this.slabs.find((s) => s.id === from), b = this.slabs.find((s) => s.id === to);
      const z = ((T - 1) * DZ) / 2;
      pts.push(a.x + a.cols * a.dx, a.y + 0.3, z, b.x, b.y + 0.3, z);
    };
    ramp('tok', 'x0');
    ramp('pos', 'x0');
    for (let l = 0; l < this.config.n_layer; l++) {
      ramp(l === 0 ? 'x0' : `l${l - 1}.x2`, `l${l}.ln1`);
      ramp(`l${l}.aout`, `l${l}.x1`);
      ramp(`l${l}.x1`, `l${l}.ln2`);
      ramp(`l${l}.mlp`, `l${l}.x2`);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.lines.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x12506a, transparent: true, opacity: 0.7 })));

    // Attention arcs: how much the last position (the one predicting) takes from each lane,
    // averaged over the heads. Drawn just before the "mixed values" slab.
    for (let l = 0; l < this.config.n_layer; l++) {
      const mix = this.slabs.find((s) => s.id === `l${l}.mix`);
      const weight = new Float32Array(T);
      for (let h = 0; h < this.config.n_head; h++) {
        const att = tensors.get(`l${l}.att${h}`);
        for (let j = 0; j < T; j++) weight[j] += att.data[(T - 1) * T + j] / this.config.n_head;
      }
      for (let j = 0; j < T - 1; j++) {
        const from = new THREE.Vector3(mix.x - 1, mix.y + 0.2, j * DZ);
        const to = new THREE.Vector3(mix.x - 1, mix.y + 0.2, (T - 1) * DZ);
        const top = from.clone().add(to).multiplyScalar(0.5).setY(mix.y + 0.8 + (T - 1 - j) * 0.55);
        const arc = new THREE.BufferGeometry().setFromPoints(new THREE.QuadraticBezierCurve3(from, top, to).getPoints(24));
        const line = new THREE.Line(arc, new THREE.LineBasicMaterial({
          color: POSITIVE, transparent: true, opacity: 0.08 + 0.92 * weight[j], blending: THREE.AdditiveBlending, depthWrite: false,
        }));
        line.userData.focusId = `l${l}.mix`;
        this.lines.add(line);
      }
    }
  }

  #buildLabels(tensors, letters, vocabLetters) {
    this.labelLayer.replaceChildren();
    this.labels = [];
    const add = (text, sub, at, slab, cls) => {
      const el = document.createElement('div');
      el.className = cls;
      const a = document.createElement('span');
      a.className = 'f';
      a.textContent = text;
      el.appendChild(a);
      if (sub) {
        const b = document.createElement('span');
        b.className = 's';
        b.textContent = sub;
        el.appendChild(b);
      }
      this.labelLayer.appendChild(el);
      this.labels.push({ el, at, slab });
    };
    // One letter in front of each lane.
    letters.forEach((letter, t) => add(letter, null, new THREE.Vector3(-1.6, 0.3, t * DZ), null, 'lane'));
    // Slab names: shown only for the slabs of the current step.
    this.slabs.forEach((slab, si) => {
      if (!slab.label) return;
      const at = new THREE.Vector3(slab.x + (slab.cols * slab.dx) / 2, slab.y + slab.hScale + 0.9, slab.z0 - 0.9);
      add(slab.label, `${slab.rows} × ${slab.tensor.endsWith('hid') ? 4 * slab.cols : slab.cols}`, at, si, 'blabel');
    });
    // The most likely next letters (at most three, 5% or more), above their bars.
    const probs = tensors.get('probs').data, slab = this.slabs.findIndex((s) => s.id === 'probs');
    const s = this.slabs[slab];
    [...probs.keys()].filter((c) => probs[c] >= 0.05).sort((a, b) => probs[b] - probs[a]).slice(0, 3).forEach((c) => {
      const at = new THREE.Vector3(s.x + (c + 0.5) * s.dx, s.y + probs[c] * 0.9 * s.hScale + 1.1, s.z0);
      add(c === 0 ? 'fine' : vocabLetters[c], `${(probs[c] * 100).toFixed(0)}%`, at, slab, 'lane top');
    });
  }

  // Cell colours: lime for positive, cyan for negative, brighter when larger; dim outside the focus.
  #paint() {
    const lit = this.slabs.map((s) => matches(s, this.focus));
    const color = new THREE.Color();
    for (let i = 0; i < this.cells.count; i++) {
      const v = this.value[i], a = Math.abs(v) ** 0.9 * 0.9;
      color.copy(v >= 0 ? POSITIVE : NEGATIVE).multiplyScalar(a).add(BASE);
      if (!lit[this.slabOf[i]]) color.multiplyScalar(DIM);
      this.cells.setColorAt(i, color);
    }
    this.cells.instanceColor.needsUpdate = true;
    for (const line of this.lines.children) {
      if (line.userData.focusId) line.visible = this.focus !== null && this.focus.some((f) => line.userData.focusId.startsWith(f));
    }
    for (const label of this.labels) {
      if (label.slab === null) continue;
      label.el.hidden = this.focus === null || !lit[label.slab];
    }
  }

  /**
   * Light up some slabs and move the camera to them.
   * @param {string[]|null} focus slab ids or id prefixes; null = everything
   * @param {{along?: boolean, instant?: boolean}} [opts] along = look down the lanes
   */
  setFocus(focus, opts = {}) {
    this.focus = focus;
    this.lastOpts = opts;
    this.#paint();
    const box = new THREE.Box3();
    for (const slab of this.slabs) if (matches(slab, focus)) box.union(slabBox(slab));
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const { w, h } = this.size, f = this.free;
    const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const half = Math.min(Math.atan((tan * Math.max(80, f.bottom - f.top)) / h), Math.atan((tan * Math.max(80, f.right - f.left)) / h));
    let target = sphere.center.clone(), position;
    if (opts.along) {
      // Stand behind the start and look down the lanes: the far end fades into the distance.
      const reach = Math.min(box.max.x - box.min.x, 90);
      target = new THREE.Vector3(box.min.x + reach * 0.42, 2, sphere.center.z);
      position = new THREE.Vector3(box.min.x - reach * 0.2, reach * 0.24, sphere.center.z + reach * 0.34);
    } else {
      const dir = new THREE.Vector3(-0.42, 0.6, 1).normalize();
      position = target.clone().add(dir.multiplyScalar(sphere.radius / Math.sin(half)));
    }
    if (opts.instant) {
      this.camera.position.copy(position);
      this.controls.target.copy(target);
      this.tween = null;
    } else {
      this.tween = { t: 0, p0: this.camera.position.clone(), t0: this.controls.target.clone(), p1: position, t1: target };
    }
  }

  /** Same idea as the brain page: keep the picture centred in the area the panels leave free. */
  setViewport(w, h, free) {
    if (w < 2 || h < 2) return;
    this.size = { w, h };
    this.free = free;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.setViewOffset(w, h, w / 2 - (free.left + free.right) / 2, h / 2 - (free.top + free.bottom) / 2, w, h);
    this.camera.updateProjectionMatrix();
  }

  #frame() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    if (this.tween) {
      const tw = this.tween;
      tw.t = Math.min(1, tw.t + dt / 0.9);
      const e = tw.t * tw.t * (3 - 2 * tw.t);
      this.camera.position.lerpVectors(tw.p0, tw.p1, e);
      this.controls.target.lerpVectors(tw.t0, tw.t1, e);
      if (tw.t >= 1) this.tween = null;
    }
    this.controls.update();

    if (this.pointer && this.onHover) {
      const p = this.pointer;
      this.pointer = null;
      this.raycaster.setFromCamera(new THREE.Vector2(p.x, p.y), this.camera);
      const hit = this.raycaster.intersectObject(this.cells)[0];
      if (hit && hit.instanceId !== undefined) {
        const i = hit.instanceId;
        this.onHover({ slab: this.slabs[this.slabOf[i]], row: this.rowOf[i], col: this.colOf[i], value: this.raw[i] }, p.cx, p.cy);
      } else {
        this.onHover(null, 0, 0);
      }
    }

    const { w, h } = this.size, v = new THREE.Vector3();
    for (const label of this.labels) {
      if (label.el.hidden) continue;
      v.copy(label.at).project(this.camera);
      const visible = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      label.el.style.opacity = visible ? '1' : '0';
      if (visible) label.el.style.transform = `translate(${((v.x * 0.5 + 0.5) * w).toFixed(1)}px, ${((-v.y * 0.5 + 0.5) * h).toFixed(1)}px) translate(-50%, -50%)`;
    }
    this.composer.render(dt);
  }
}
