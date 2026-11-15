// "Dentro un LLM" / "Inside an LLM": runs the tiny model in the browser and shows every number
// of the computation. Italian or English: ?lang=it|en, otherwise the browser language.
import { loadModel, forward, softmax, sample } from './gpt.js';
import { LLMScene } from './scene.js';
import { buildTour } from './tour.js';
import { pickLang, TEXT } from './i18n.js';
import { LINKS } from './links.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const vertical = params.get('vertical') === '1';
document.body.classList.toggle('vertical', vertical);

const lang = pickLang();
const T = TEXT[lang];
const other = lang === 'it' ? 'en' : 'it';
document.documentElement.lang = lang;
document.title = T.title;
$('brand').replaceChildren(T.brand[0], Object.assign(document.createElement('span'), { textContent: T.brand[1] }));
$('guide-label').textContent = T.guide;
$('prev').textContent = T.prev;
$('next').textContent = T.next;
$('next-title').textContent = T.nextLetter;
$('word').placeholder = T.placeholder;
$('temp-text').textContent = T.temperature;
$('one').textContent = T.one;
$('auto').textContent = T.auto;
$('clear').textContent = T.clear;
$('back').href = LINKS.back[lang].href;
$('back').textContent = LINKS.back[lang].text;
$('lang-switch').textContent = other.toUpperCase();
$('lang-switch').hreflang = other;

const model = await loadModel('model.json');
const { vocab, block } = model.config;
const maxLetters = block - 1;                       // the first position is the start mark
const show = (i) => (i === 0 ? '·' : vocab[i]);     // how a vocabulary entry is written on screen
const vocabLetters = [...vocab].map((_, i) => show(i));

$('model-info').textContent = T.modelInfo(model.info.params.toLocaleString(T.locale), model.config.n_layer);
$('word').maxLength = maxLetters;

const scene = new LLMScene($('scene'), $('labels'), model.config, T.scene);
const tour = buildTour(model.config, model.info, lang);

const state = {
  step: Math.min(tour.length - 1, Math.max(0, Number(params.get('step')) || 0)),
  ended: false,       // the model chose the end mark: the word is complete
  probs: null,
  picked: -1,         // vocabulary index of the last letter the model chose
  timer: null,
};

// ---------- layout ----------

function layout() {
  const stack = vertical || window.innerWidth < 820;
  document.body.classList.toggle('stack', stack);
  const stage = $('stage').getBoundingClientRect();
  const rect = (id) => $(id).getBoundingClientRect();
  const free = stack
    ? { left: 0, right: stage.width, top: rect('nextletter').bottom - stage.top, bottom: rect('guide').top - stage.top }
    : { left: rect('guide').right - stage.left, right: stage.width, top: rect('head').bottom - stage.top, bottom: rect('bar').top - stage.top };
  scene.setViewport(stage.width, stage.height, free);
}

// ---------- model ----------

/** Keep only a-z (accents removed), at most maxLetters. */
function clean(text) {
  return text.toLowerCase().normalize('NFD').replace(/[^a-z]/g, '').slice(0, maxLetters);
}

function temperature() { return Number($('temp').value); }

/** Run the model on the current word and redraw everything. */
function run() {
  const word = clean($('word').value);
  if ($('word').value !== word) $('word').value = word;
  const tokens = [0, ...[...word].map((ch) => vocab.indexOf(ch))];
  const out = forward(model, tokens);
  state.probs = softmax(out.logits, temperature());
  out.tensors.set('probs', { id: 'probs', rows: 1, cols: vocab.length, data: state.probs });
  scene.setTrace(out.tensors, tokens.map(show), vocabLetters);
  renderTop();
  const full = word.length >= maxLetters;
  $('one').disabled = $('auto').disabled = state.ended || full;
  $('ended').hidden = !state.ended && !full;
  $('ended').textContent = state.ended ? T.ended : T.full;
}

function renderTop() {
  const list = $('nextlist');
  list.replaceChildren();
  const order = [...state.probs.keys()].sort((a, b) => state.probs[b] - state.probs[a]).slice(0, 5);
  for (const i of order) {
    const li = document.createElement('li');
    if (i === state.picked) li.className = 'picked';
    const letter = document.createElement('span');
    letter.className = 'l';
    letter.textContent = i === 0 ? T.end : vocab[i];
    if (i === 0) letter.style.fontSize = '10px';
    const bar = document.createElement('span');
    bar.className = 'b';
    const fill = document.createElement('i');
    fill.style.width = `${(state.probs[i] * 100).toFixed(1)}%`;
    bar.appendChild(fill);
    const pct = document.createElement('span');
    pct.className = 'p';
    pct.textContent = `${(state.probs[i] * 100).toFixed(1)}%`;
    li.append(letter, bar, pct);
    list.appendChild(li);
  }
}

/** Draw one letter from the probabilities and append it. Returns false when the word is over. */
function addLetter() {
  if (state.ended || clean($('word').value).length >= maxLetters) return false;
  const choice = sample(state.probs);
  state.picked = choice;
  if (choice === 0) {
    state.ended = true;
    run();
    return false;
  }
  $('word').value += vocab[choice];
  run();
  refocus();
  return clean($('word').value).length < maxLetters;
}

function stopAuto() {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
}

// ---------- tour ----------

function refocus(instant = false) {
  const step = tour[state.step];
  scene.setFocus(step.focus, { along: step.along, instant });
}

function showStep(instant = false) {
  const step = tour[state.step];
  $('step-count').textContent = `${state.step + 1} / ${tour.length}`;
  $('lang-switch').href = `?lang=${other}&step=${state.step}${vertical ? '&vertical=1' : ''}`;
  $('step-title').textContent = step.title;
  const body = $('step-text');
  body.replaceChildren();
  for (const text of step.text) {
    const p = document.createElement('p');
    p.textContent = text;
    body.appendChild(p);
  }
  if (step.link) {
    const p = document.createElement('p'), a = document.createElement('a');
    a.href = step.link.href;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = step.link.text;
    p.appendChild(a);
    body.appendChild(p);
  }
  $('guide-body').scrollTop = 0;
  $('prev').disabled = state.step === 0;
  $('next').disabled = state.step === tour.length - 1;
  layout(); // the guide's height changes with the text
  refocus(instant);
}

function go(delta) {
  const next = Math.min(tour.length - 1, Math.max(0, state.step + delta));
  if (next === state.step) return;
  state.step = next;
  showStep();
}

// ---------- hover ----------

scene.onHover = (hit, x, y) => {
  const tip = $('tip');
  if (!hit) { tip.hidden = true; return; }
  const { slab, row, col, value } = hit;
  const letters = [0, ...[...clean($('word').value)].map((ch) => vocab.indexOf(ch))].map(show);
  let where;
  if (slab.kind === 'weight') where = T.tip.looks(T.q(letters[row]), T.q(letters[col]));
  else if (slab.kind === 'prob') where = T.tip.letter(T.q(vocabLetters[col]));
  else if (slab.id === 'logits') where = `${T.tip.lane(T.q(letters[row]))} · ${T.tip.letter(T.q(vocabLetters[col]))}`;
  else where = `${T.tip.lane(T.q(letters[row]))} · ${T.tip.number(slab.colStart + col + 1)}`;
  const shown = slab.kind === 'signed' ? value.toFixed(3) : `${(value * 100).toFixed(1)}%`;
  tip.replaceChildren();
  const b = document.createElement('b');
  b.textContent = slab.name ?? T.scene.hidName;
  tip.append(b, document.createElement('br'), `${where} · ${shown}`);
  tip.hidden = false;
  tip.style.left = `${Math.min(x + 14, window.innerWidth - tip.offsetWidth - 8)}px`;
  tip.style.top = `${y + 14}px`;
};

// ---------- wiring ----------

$('prev').addEventListener('click', () => go(-1));
$('next').addEventListener('click', () => go(1));
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement && e.target.type === 'text') return;
  if (e.key === 'ArrowRight') go(1);
  if (e.key === 'ArrowLeft') go(-1);
});

$('word').addEventListener('input', () => {
  stopAuto();
  state.ended = false;
  state.picked = -1;
  run();
  refocus();
});
const showTemperature = () => {
  $('temp-out').textContent = temperature().toLocaleString(T.locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
};
$('temp').addEventListener('input', () => {
  showTemperature();
  run();
});
$('one').addEventListener('click', () => { stopAuto(); addLetter(); });
$('bar').addEventListener('submit', (e) => {
  e.preventDefault();
  stopAuto();
  if (addLetter()) state.timer = setInterval(() => { if (!addLetter()) stopAuto(); }, 450);
});
$('clear').addEventListener('click', () => {
  stopAuto();
  $('word').value = '';
  state.ended = false;
  state.picked = -1;
  run();
  refocus();
});

new ResizeObserver(layout).observe($('stage'));
window.addEventListener('resize', layout);
layout();
showTemperature();
run();
showStep(true);
