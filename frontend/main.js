// Entry point: wires the event stream to the 3D brain and to the HUD.
// Events come from the backend (SSE) or, with ?local=1 or when no backend answers, from the
// in-browser simulator. Both use the same schema and go through handleEvent().
import { Brain, AGENTS } from './brain.js';
import { Hud } from './hud.js';
import { runLocalSim } from './localsim.js';
import { ANALOGIES, WHY } from './analogies.js';

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
hud.onWhy(() => hud.showInfo(WHY.title, WHY.paragraphs.map((text) => ({ text })), { wiki: WHY.wiki }));

// ---------- run state ----------

const run = {
  startTs: null,       // timestamp (event clock) of the event that opened the run
  active: new Map(),   // agent -> number of sub-tasks in progress (one agent can hold several)
  calls: 0,
  tokens: 0,
  tokensKnown: true,
};
let source = 'local';  // 'local' | 'backend'
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

async function start(goal) {
  if (source === 'local') {
    if (cancelLocal) cancelLocal();
    cancelLocal = runLocalSim(goal, handleEvent, { forceError: params.get('err') === '1' });
    return;
  }
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
  if (params.get('local') !== '1') {
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
  hud.setSimulated(simulated);
  hud.onStart(start);
  // ?demo=1 starts a run right away: handy for screen recording.
  if (params.get('demo') === '1') start(document.getElementById('goal').value.trim());
}

init();
