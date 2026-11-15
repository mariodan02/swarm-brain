// The tiny GPT, computed for real in the browser. Same arithmetic as tools/train_tiny_gpt.py;
// forward() keeps every intermediate tensor so the page can draw it.

/**
 * @typedef {{id: string, rows: number, cols: number, data: Float32Array}} Tensor
 * rows = positions in the text, cols = numbers per position; data is row-major.
 */

/** @param {string} url */
export async function loadModel(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`model.json: HTTP ${res.status}`);
  const raw = await res.json();
  const w = {};
  for (const [name, t] of Object.entries(raw.tensors)) w[name] = Float32Array.from(t.data);
  return { config: raw.config, info: raw.info, test: raw.test, w };
}

// y[t] = W x[t] + b, for every position t. W is (outDim x inDim), row-major.
function linear(x, T, inDim, W, b, outDim) {
  const y = new Float32Array(T * outDim);
  for (let t = 0; t < T; t++) {
    for (let o = 0; o < outDim; o++) {
      let s = b ? b[o] : 0;
      const wo = o * inDim, xt = t * inDim;
      for (let i = 0; i < inDim; i++) s += W[wo + i] * x[xt + i];
      y[t * outDim + o] = s;
    }
  }
  return y;
}

// Per position: subtract the mean, divide by the standard deviation, then learned scale and shift.
function layerNorm(x, T, C, gain, bias) {
  const y = new Float32Array(T * C);
  for (let t = 0; t < T; t++) {
    let mean = 0;
    for (let i = 0; i < C; i++) mean += x[t * C + i];
    mean /= C;
    let variance = 0;
    for (let i = 0; i < C; i++) variance += (x[t * C + i] - mean) ** 2;
    const inv = 1 / Math.sqrt(variance / C + 1e-5);
    for (let i = 0; i < C; i++) y[t * C + i] = (x[t * C + i] - mean) * inv * gain[i] + bias[i];
  }
  return y;
}

const gelu = (v) => 0.5 * v * (1 + Math.tanh(0.7978845608028654 * (v + 0.044715 * v ** 3)));

function add(a, b) {
  const y = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) y[i] = a[i] + b[i];
  return y;
}

/** Probabilities from logits; temperature below 1 sharpens them, above 1 flattens them. */
export function softmax(logits, temperature = 1) {
  let max = -Infinity;
  for (const v of logits) max = Math.max(max, v);
  const p = new Float32Array(logits.length);
  let sum = 0;
  for (let i = 0; i < logits.length; i++) sum += p[i] = Math.exp((logits[i] - max) / temperature);
  for (let i = 0; i < p.length; i++) p[i] /= sum;
  return p;
}

/**
 * Run the model on `tokens` (1 to config.block token ids).
 * @returns {{T: number, tensors: Map<string, Tensor>, logits: Float32Array}} every intermediate
 *   tensor by id, and the logits of the last position (the scores for the next letter).
 */
export function forward(model, tokens) {
  const { n_embd: C, n_head: H, n_layer: L, vocab, block } = model.config;
  const V = vocab.length, T = tokens.length, D = C / H, w = model.w;
  if (T < 1 || T > block) throw new Error(`need 1..${block} tokens, got ${T}`);
  const tensors = new Map();
  const keep = (id, rows, cols, data) => { tensors.set(id, { id, rows, cols, data }); return data; };

  const tok = new Float32Array(T * C), pos = new Float32Array(T * C);
  for (let t = 0; t < T; t++) {
    tok.set(w['wte.weight'].subarray(tokens[t] * C, tokens[t] * C + C), t * C);
    pos.set(w['wpe.weight'].subarray(t * C, t * C + C), t * C);
  }
  keep('tok', T, C, tok);
  keep('pos', T, C, pos);
  let x = keep('x0', T, C, add(tok, pos));

  for (let l = 0; l < L; l++) {
    const p = `h.${l}.`, id = (name) => `l${l}.${name}`;

    // --- attention: every position looks back at the earlier ones ---
    const n1 = keep(id('ln1'), T, C, layerNorm(x, T, C, w[p + 'ln1.weight'], w[p + 'ln1.bias']));
    const qkv = linear(n1, T, C, w[p + 'qkv.weight'], w[p + 'qkv.bias'], 3 * C);
    const q = new Float32Array(T * C), k = new Float32Array(T * C), v = new Float32Array(T * C);
    for (let t = 0; t < T; t++) {
      q.set(qkv.subarray(t * 3 * C, t * 3 * C + C), t * C);
      k.set(qkv.subarray(t * 3 * C + C, t * 3 * C + 2 * C), t * C);
      v.set(qkv.subarray(t * 3 * C + 2 * C, t * 3 * C + 3 * C), t * C);
    }
    keep(id('q'), T, C, q);
    keep(id('k'), T, C, k);
    keep(id('v'), T, C, v);

    const mixed = new Float32Array(T * C);
    for (let h = 0; h < H; h++) {
      const att = new Float32Array(T * T); // row i: how much position i looks at each position j
      for (let i = 0; i < T; i++) {
        const scores = new Float32Array(i + 1); // j <= i only: the future is hidden
        for (let j = 0; j <= i; j++) {
          let s = 0;
          for (let d = 0; d < D; d++) s += q[i * C + h * D + d] * k[j * C + h * D + d];
          scores[j] = s / Math.sqrt(D);
        }
        const weights = softmax(scores);
        for (let j = 0; j <= i; j++) {
          att[i * T + j] = weights[j];
          for (let d = 0; d < D; d++) mixed[i * C + h * D + d] += weights[j] * v[j * C + h * D + d];
        }
      }
      keep(id(`att${h}`), T, T, att);
    }
    keep(id('mix'), T, C, mixed);
    const attOut = keep(id('aout'), T, C, linear(mixed, T, C, w[p + 'proj.weight'], w[p + 'proj.bias'], C));
    x = keep(id('x1'), T, C, add(x, attOut));

    // --- MLP: each position on its own ---
    const n2 = keep(id('ln2'), T, C, layerNorm(x, T, C, w[p + 'ln2.weight'], w[p + 'ln2.bias']));
    const hidden = linear(n2, T, C, w[p + 'fc.weight'], w[p + 'fc.bias'], 4 * C);
    for (let i = 0; i < hidden.length; i++) hidden[i] = gelu(hidden[i]);
    keep(id('hid'), T, 4 * C, hidden);
    const mlpOut = keep(id('mlp'), T, C, linear(hidden, T, 4 * C, w[p + 'out.weight'], w[p + 'out.bias'], C));
    x = keep(id('x2'), T, C, add(x, mlpOut));
  }

  const nf = keep('lnf', T, C, layerNorm(x, T, C, w['ln_f.weight'], w['ln_f.bias']));
  const all = keep('logits', T, V, linear(nf, T, C, w['head.weight'], null, V));
  return { T, tensors, logits: all.slice((T - 1) * V, T * V) };
}

/** Pick an index at random according to the probabilities. */
export function sample(probs, random = Math.random) {
  let r = random();
  for (let i = 0; i < probs.length; i++) if ((r -= probs[i]) <= 0) return i;
  return probs.length - 1;
}
