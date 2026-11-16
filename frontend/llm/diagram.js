// Block diagram of the model, drawn the way papers draw a GPT (one transformer block, repeated).
// Each block lights up during its steps of the guide; hovering one says what goes in and what
// comes out, with the real sizes of the current text, and clicking it opens its step.
// Everything is drawn with createElementNS and textContent: no HTML strings.

const NS = 'http://www.w3.org/2000/svg';
const W = 260;          // viewBox width; blocks are laid out by hand in these units
const H = 416;
const CX = 118;         // x of the main column
const SKIP_X = 226;     // x of the residual connections that jump over a block
const LOOP_X = 254;     // x of the arrow from the output back to the input
const MAX_OUT = 3;      // next letters shown at the bottom

function el(tag, attrs, parent) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  parent?.appendChild(node);
  return node;
}

function text(parent, x, y, content, cls) {
  const t = el('text', { x, y, 'text-anchor': 'middle', 'dominant-baseline': 'middle' }, parent);
  if (cls) t.setAttribute('class', cls);
  t.textContent = content;
  return t;
}

export class Diagram {
  /**
   * @param {SVGSVGElement} svg
   * @param {HTMLElement} caption
   * @param {{n_embd: number, n_head: number, n_layer: number, block: number, vocab: string}} config
   * @param {object} L words of the diagram (i18n.js, `diagram`)
   */
  constructor(svg, caption, config, L) {
    this.svg = svg;
    this.caption = caption;
    this.L = L;
    this.tokens = 1;
    this.parts = [];     // {node, steps: string[]}: everything that lights up with the guide
    /** @type {(step: string) => void} */
    this.onSelect = () => {};
    /** @type {(focus: string[]|null) => void} called with null when the pointer leaves a block */
    this.onPreview = () => {};
    /** @type {(step: string) => number} position of a step in the guide, counted from 1 */
    this.stepNumber = () => 0;

    const C = config.n_embd, V = config.vocab.length, n = config.n_layer;
    const x = (t) => `${t} × ${C}`;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.classList.add('dg');
    svg.replaceChildren();

    const defs = el('defs', {}, svg);
    const marker = el('marker', { id: 'dg-arrow', viewBox: '0 0 6 6', refX: 5, refY: 3, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' }, defs);
    el('path', { d: 'M0 0 L6 3 L0 6 z', class: 'tip' }, marker);

    const lines = el('g', {}, svg);
    const flow = (d) => el('path', { d, class: 'flow' }, lines);
    const res = (d) => this.#light(el('path', { d, class: 'res' }, lines), ['res']);

    // Input to the embeddings, embeddings to the first sum.
    flow(`M${CX} 32 V36 H63 V42`);
    flow('M63 68 V82 H112');
    flow('M189 68 V82 H124');
    // The residual stream: straight down, with a jump around each sub-layer.
    res(`M${CX} 88 V120`);
    res(`M${CX} 110 H${SKIP_X} V190 H124`);
    res(`M${CX} 196 V210`);
    res(`M${CX} 202 H${SKIP_X} V272 H124`);
    res(`M${CX} 278 V298`);
    for (const y of [110, 202]) this.#light(el('circle', { cx: CX, cy: y, r: 2.5, class: 'dot' }, lines), ['res']);
    // The sub-layers on the way.
    for (const [y0, y1] of [[140, 148], [176, 184], [230, 238], [258, 266], [318, 326], [346, 354], [374, 384]]) {
      el('path', { d: `M${CX} ${y0} V${y1}`, class: 'flow', 'marker-end': 'url(#dg-arrow)' }, lines);
    }
    this.loop = this.#light(el('path', { d: '', class: 'loop', 'marker-end': 'url(#dg-arrow)' }, lines), ['sample']);

    // The repeated block: a dashed frame, clickable through its label only.
    const frame = this.#block({
      steps: ['layers'], focus: ['l1'], name: L.layers(n), info: () => L.frameInfo,
    });
    el('rect', { x: 22, y: 96, width: 218, height: 192, rx: 4, class: 'frame' }, frame);
    el('rect', { x: 186, y: 98, width: 52, height: 12, class: 'hit' }, frame);
    text(frame, 236, 105, L.layers(n), 'small end');

    const box = (o) => {
      const g = this.#block(o);
      el('rect', { x: o.x, y: o.y, width: o.w, height: o.h, rx: 3 }, g);
      const rows = Array.isArray(o.label) ? o.label : [o.label];
      rows.forEach((row, i) => text(g, o.x + o.w / 2, o.y + o.h / 2 + (i - (rows.length - 1) / 2) * 11, row));
      return g;
    };
    const add = (y, o) => {
      const g = this.#block({ ...o, name: L.add });
      el('circle', { cx: CX, cy: y, r: 6 }, g);
      el('path', { d: `M${CX - 3.5} ${y} H${CX + 3.5} M${CX} ${y - 3.5} V${y + 3.5}`, class: 'plus' }, g);
    };
    const main = { x: CX - 80, w: 160, h: 20 };

    box({ x: 4, y: 42, w: 118, h: 26, label: L.tok, steps: ['tok'], focus: ['tok'], info: (t) => `${L.table} ${V} × ${C} → ${x(t)}` });
    box({ x: 130, y: 42, w: 118, h: 26, label: L.pos, steps: ['pos'], focus: ['pos'], info: (t) => `${L.table} ${config.block} × ${C} → ${x(t)}` });
    add(82, { steps: ['pos', 'res'], focus: ['x0'], info: (t) => `${x(t)} + ${x(t)}` });
    box({ ...main, y: 120, label: L.ln, steps: ['ln'], focus: ['l0.ln1', 'l1.ln1'], info: (t) => `${x(t)} → ${x(t)}` });
    box({ ...main, y: 148, h: 28, label: L.attn, steps: ['qkv', 'att', 'mix'], focus: ['l0.q', 'l0.k', 'l0.v', 'l0.att', 'l0.mix', 'l0.aout'], info: (t) => `${L.heads(config.n_head)} · ${x(t)} → ${x(t)}` });
    add(190, { steps: ['mix', 'res'], focus: ['l0.x1', 'l1.x1'], info: (t) => `${x(t)} + ${x(t)}` });
    box({ ...main, y: 210, label: L.ln, steps: ['mlp'], focus: ['l0.ln2', 'l1.ln2'], info: (t) => `${x(t)} → ${x(t)}` });
    box({ ...main, y: 238, label: L.mlp, steps: ['mlp'], focus: ['l0.hid', 'l0.mlp'], info: (t) => `${x(t)} → ${t} × ${4 * C} → ${x(t)}` });
    add(272, { steps: ['mlp', 'res'], focus: ['l0.x2', 'l1.x2'], info: (t) => `${x(t)} + ${x(t)}` });
    box({ ...main, y: 298, label: L.lnf, steps: ['logits'], focus: ['lnf'], info: (t) => `${x(t)} → ${x(t)}` });
    box({ ...main, y: 326, label: L.linear, steps: ['logits'], focus: ['logits'], info: (t) => `${x(t)} → ${t} × ${V}` });
    box({ ...main, y: 354, label: L.softmax, steps: ['logits', 'sample'], focus: ['probs'], info: () => L.softInfo(V) });

    // Input letters at the top and the most likely next letters at the bottom: filled by setTokens/setOutput.
    this.input = this.#block({ steps: ['tok'], focus: ['tok'], name: L.text, info: (t) => L.textInfo(t) });
    this.output = this.#block({ steps: ['sample'], focus: ['probs'], name: L.out, info: () => L.outInfo });
    this.#explain(null);
  }

  /** Mark a node as one that lights up during the given steps. */
  #light(node, steps) {
    this.parts.push({ node, steps });
    return node;
  }

  /** A clickable group: lights up with its steps, previews its slabs, explains itself. */
  #block({ steps, focus, name, info, label }) {
    const g = el('g', { class: 'blk', tabindex: 0, role: 'button' }, this.svg);
    const title = name ?? (Array.isArray(label) ? label.join(' ') : label);
    g.setAttribute('aria-label', title);
    const enter = () => {
      this.#explain(title, info(this.tokens), steps[0]);
      this.onPreview(focus);
    };
    const leave = () => {
      this.#explain(null);
      this.onPreview(null);
    };
    g.addEventListener('pointerenter', enter);
    g.addEventListener('pointerleave', leave);
    g.addEventListener('focus', enter);
    g.addEventListener('blur', leave);
    g.addEventListener('click', () => this.onSelect(steps[0]));
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.onSelect(steps[0]); } });
    return this.#light(g, steps);
  }

  #explain(title, info, step) {
    this.caption.replaceChildren();
    if (title === null) {
      this.caption.textContent = this.L.hint;
      return;
    }
    const b = document.createElement('b');
    b.textContent = title;
    this.caption.append(b, document.createElement('br'), `${info} · ${this.L.goTo(this.stepNumber(step))}`);
  }

  /** Light up the parts of one guide step (null: none). */
  setStep(step) {
    for (const { node, steps } of this.parts) node.classList.toggle('on', step !== null && steps.includes(step));
  }

  /** @param {string[]} letters as written on screen, start mark included @param {number[]} ids vocabulary indices */
  setTokens(letters, ids) {
    this.tokens = letters.length;
    const g = this.input;
    g.replaceChildren();
    const w = 16, gap = 2, total = letters.length * (w + gap) - gap;
    const left = CX - total / 2;
    letters.forEach((letter, i) => {
      const x = left + i * (w + gap);
      el('rect', { x, y: 2, width: w, height: 18, rx: 2 }, g);
      text(g, x + w / 2, 11.5, letter);
      text(g, x + w / 2, 28, ids[i], 'small');
    });
    this.inputRight = left + total;
    this.#drawLoop();
  }

  /** @param {{letter: string, p: number}[]} top most likely next letters, best first */
  setOutput(top) {
    const g = this.output;
    g.replaceChildren();
    const shown = top.slice(0, MAX_OUT);
    const w = 46, gap = 6, total = shown.length * (w + gap) - gap;
    const left = CX - total / 2;
    shown.forEach(({ letter, p }, i) => {
      const x = left + i * (w + gap);
      el('rect', { x, y: 384, width: w, height: 22, rx: 2 }, g);
      text(g, x + 12, 395.5, letter);
      text(g, x + 31, 395.5, `${Math.round(p * 100)}%`, 'small');
    });
    this.outputRight = left + total;
    this.#drawLoop();
  }

  /** The chosen letter goes back to the input: the autoregressive loop. */
  #drawLoop() {
    if (this.inputRight === undefined || this.outputRight === undefined) return;
    this.loop.setAttribute('d', `M${this.outputRight + 3} 395 H${LOOP_X} V11 H${this.inputRight + 5}`);
  }
}
