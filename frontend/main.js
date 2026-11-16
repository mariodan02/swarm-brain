// Entry point: wires the event stream to the 3D brain and to the HUD.
// Events come from one of three sources, all with the same schema, all through handleEvent():
//   backend  the Python backend on the same host (SSE)
//   api      a static copy calling the Cloudflare Worker in worker/ (real agents, with limits)
//   local    the in-browser simulator: ?local=1, no backend, or the Worker refused the run
import { Brain, AGENTS } from './brain.js';
import { Hud } from './hud.js';
import { runLocalSim } from './localsim.js';
import { ANALOGIES, WHY } from './analogies.js';
import { turnstileToken } from './turnstile.js';

const params = new URLSearchParams(location.search);
const vertical = params.get('vertical') === '1';
const light = params.get('theme') === 'light';
document.body.classList.toggle('vertical', vertical);
document.body.classList.toggle('light', light);

const app = document.getElementById('app');
const brain = new Brain(document.getElementById('scene'), document.getElementById('labels'), { light });
const hud = new Hud(AGENTS);

// ---------- layout ----------

// Tell the brain which rectangle the HUD leaves free, so it stays centred there.
function layout() {
  const stack = vertical || window.innerWidth < 820;
  document.body.classList.toggle('stack', stack);
  const stage = app.getBoundingClientRect();
  const rect = (id) => document.getElementById(id).getBoundingClientRect();
  const free = stack
    ? { left: 0, right: stage.width, top: rect('agents').bottom - stage.top, bottom: rect('log').top - stage.top }
    : {
        left: rect('agents').right - stage.left,
        right: rect('log').left - stage.left,
        top: rect('top').bottom - stage.top,
        bottom: rect('cmd').top - stage.top,
      };
  brain.setViewport(stage.width, stage.height, free);
}
new ResizeObserver(layout).observe(app);
window.addEventListener('resize', layout);
layout();

// ---------- teaching card ----------

function showAgentInfo(agent) {
  const info = ANALOGIES[agent];
  const meta = AGENTS.find((a) => a.id === agent);
  if (!info || !meta) return;
  hud.showInfo(`${agent}.md · ${meta.region}`, [
    { heading: 'nello sciame', text: info.does },
    { heading: 'nel cervello', text: info.brain },
    { heading: 'dove il paragone regge', text: info.holds },
    { heading: 'dove si rompe', text: info.breaks },
  ], { fit: info.fit, wiki: info.wiki });
  brain.kick(agent, 1.2); // light up the region so it is clear which one the card is about
}
hud.onAgentSelect(showAgentInfo);
brain.onSelect = showAgentInfo;
// On a phone the log starts closed: it would take most of the screen. ?vertical=1 (recording) keeps it open.
hud.setupLogToggle(window.innerWidth < 600 && !vertical, layout);
hud.onWhy(() => hud.showInfo(WHY.title, WHY.paragraphs.map((text) => ({ text })), { wiki: WHY.wiki }));

// ---------- run state ----------

const run = {
  startTs: null,       // timestamp (event clock) of the event that opened the run
  active: new Map(),   // agent -> number of sub-tasks in progress (one agent can hold several)
  calls: 0,
  tokens: 0,
  tokensKnown: true,
};
let source = 'local';  // 'local' | 'backend' | 'api'
let api = null;        // { url, sitekey } when source is 'api'
let localReason = null; // why a copy with real agents is using the simulator, shown in the log
let simulated = true;  // true whenever no real model is called
let clockSkew = 0;     // client clock minus server clock, seconds
let cancelLocal = null;
const seen = new Set(); // event ids already handled (the stream replays the current run on reconnect)

function setState(agent, state) {
  brain.setState(agent, state);
  hud.setAgentState(agent, state);
}

/** The orchestrator's opening event resets everything: every connected page starts in sync. */
function beginRun(ev) {
  run.startTs = ev.ts;
  run.active.clear();
  run.calls = 0;
  run.tokens = 0;
  run.tokensKnown = true;
  brain.reset();
  AGENTS.forEach((a) => hud.setAgentState(a.id, 'idle'));
  hud.clearLog();
  hud.clearTracks();
  hud.hideFinal();
  hud.setCounters(0, 0);
  hud.setRunning(true);
  // When the page joins a run already in progress the timer starts from the time already spent.
  hud.startTimer(Math.max(0, Date.now() / 1000 - clockSkew - ev.ts));
}

function endRun(t) {
  hud.stopTimer(t);
  hud.setRunning(false);
}

/** Single entry point for every event, whatever its source. */
function handleEvent(ev) {
  const payload = ev.payload || {};
  if (ev.type === 'task_started' && ev.agent === 'orchestrator' && payload.goal !== undefined) beginRun(ev);
  const t = run.startTs === null ? 0 : Math.max(0, ev.ts - run.startTs);
  // Events replayed after a page reload are old: update the state, skip their animations.
  const fresh = Date.now() / 1000 - clockSkew - ev.ts < 3;
  // LLM calls are not listed: the LLM and TOK counters already tell that story.
  if (ev.type !== 'tool_call') hud.log(ev, t);

  switch (ev.type) {
    case 'task_started': {
      const n = (run.active.get(ev.agent) || 0) + 1;
      run.active.set(ev.agent, n);
      if (n === 1) hud.markStart(ev.agent, t);
      setState(ev.agent, 'working');
      break;
    }

    case 'task_done': {
      const left = Math.max(0, (run.active.get(ev.agent) || 0) - 1);
      run.active.set(ev.agent, left);
      if (left === 0) {
        hud.markEnd(ev.agent, t);
        setState(ev.agent, 'done');
      }
      break;
    }

    case 'message':
      if (ev.target && fresh) brain.pulse(ev.agent, ev.target);
      break;

    case 'tool_call':
      if (payload.phase === 'start') {
        run.calls += 1;
        if (fresh) brain.kick(ev.agent);
      } else if (payload.phase === 'end') {
        if (payload.tokens && Number.isFinite(payload.tokens.total)) run.tokens += payload.tokens.total;
        else run.tokensKnown = false;
      }
      hud.setCounters(run.calls, run.tokensKnown ? run.tokens : null);
      break;

    case 'error':
      hud.markError(ev.agent, t);
      if (payload.fatal) {
        for (const [agent, n] of run.active) if (n > 0 && agent !== ev.agent) setState(agent, 'idle');
        run.active.clear();
        setState(ev.agent, 'error');
        endRun(t);
      } else if (fresh) {
        brain.flashError(ev.agent);
        hud.flashAgent(ev.agent);
      }
      break;

    case 'final':
      hud.markEnd('orchestrator', t);
      setState('orchestrator', 'done');
      hud.showFinal(String(payload.result ?? ''), Boolean(payload.simulated) || simulated);
      endRun(t);
      break;
  }
}

/** A line in the log written by the page itself (not an agent event). */
function uiNote(label) {
  hud.log({ type: 'error', agent: 'ui', target: null, label }, hud.elapsed());
}

// ---------- event sources ----------

function connectBackend() {
  const es = new EventSource('/events');
  es.onmessage = (e) => {
    let ev;
    try { ev = JSON.parse(e.data); } catch { return; }
    if (!ev || seen.has(ev.id)) return;
    seen.add(ev.id);
    handleEvent(ev);
  };
  // EventSource reconnects by itself; nothing else to do on error.
}

function startLocal(goal) {
  simulated = true;
  hud.setSimulated(true);
  if (cancelLocal) cancelLocal();
  cancelLocal = runLocalSim(goal, handleEvent, { forceError: params.get('err') === '1' });
  // Written after the run has opened, because a new run clears the log.
  if (localReason) uiNote(`${localReason} · uso il simulatore`);
}

/** Real agents through the Worker. Any refusal falls back to the simulator, and says why. */
async function startApi(goal) {
  hud.setRunning(true);
  const fallback = (why) => {
    localReason = why;
    startLocal(goal);
  };
  let token;
  try {
    token = await turnstileToken(api.sitekey, document.getElementById('ts'));
  } catch {
    return fallback('Verifica anti-bot non riuscita');
  }
  let res;
  try {
    res = await fetch(`${api.url}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal, token }),
    });
  } catch {
    return fallback('Servizio degli agenti non raggiungibile');
  }
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({}));
    return fallback(typeof body.detail === 'string' ? body.detail : `Avvio rifiutato (${res.status})`);
  }
  simulated = false;
  localReason = null;
  hud.setSimulated(false);
  // The answer is the run's event stream: "data: {json}" blocks separated by a blank line.
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '', closed = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let cut;
      while ((cut = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        if (!block.startsWith('data: ')) continue; // keep-alive comment
        let ev;
        try { ev = JSON.parse(block.slice(6)); } catch { continue; }
        handleEvent(ev);
        if (ev.type === 'final' || (ev.type === 'error' && ev.payload?.fatal)) closed = true;
      }
    }
  } catch { /* connection lost: reported below */ }
  if (!closed) {
    uiNote('Connessione con gli agenti interrotta');
    endRun();
  }
}

async function start(goal) {
  if (source === 'local') return startLocal(goal);
  if (source === 'api') return startApi(goal);
  hud.setRunning(true);
  try {
    const res = await fetch('/task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      uiNote(`Avvio rifiutato (${res.status}): ${typeof body.detail === 'string' ? body.detail : 'richiesta non valida'}`);
      if (res.status !== 409) hud.setRunning(false);
    }
  } catch {
    uiNote('Backend non raggiungibile');
    hud.setRunning(false);
  }
}

async function init() {
  // A static copy (data-static on <html>, set by tools/export_brain_page.py) has no backend.
  const isStatic = 'static' in document.documentElement.dataset;
  if (params.get('local') !== '1' && !isStatic) {
    try {
      const res = await fetch('/status', { cache: 'no-store' });
      if (res.ok) {
        const status = await res.json();
        source = 'backend';
        simulated = status.mode === 'simulated';
        clockSkew = Date.now() / 1000 - status.now;
        connectBackend();
      }
    } catch { /* no backend: stay on the local simulator */ }
  }
  // Static copy with real agents: data-api holds the Worker's address.
  const apiUrl = document.documentElement.dataset.api;
  if (apiUrl && params.get('local') !== '1') {
    try {
      const res = await fetch(`${apiUrl}/status`, { cache: 'no-store' });
      const status = res.ok ? await res.json() : null;
      if (status?.remaining > 0) {
        source = 'api';
        api = { url: apiUrl, sitekey: status.sitekey };
        simulated = false;
        clockSkew = Date.now() / 1000 - status.now;
      } else if (status) {
        localReason = 'Esecuzioni reali di oggi esaurite';
      }
    } catch { /* Worker unreachable: stay on the local simulator */ }
  }
  hud.setSimulated(simulated);
  hud.onStart(start);
  // ?demo=1 starts a run right away: handy for screen recording.
  if (params.get('demo') === '1') start(document.getElementById('goal').value.trim());
}

init();
