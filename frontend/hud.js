// HUD panels: agent list with activity tracks, event log, counters, timer, goal input, final result.
// All text goes in through textContent: agent output is never parsed as HTML.

const MAX_LOG_LINES = 200;
const MIN_TRACK_SPAN = 30; // seconds shown by the activity tracks before they start to compress
const $ = (id) => document.getElementById(id);

function clock(seconds) {
  const s = Math.max(0, seconds);
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = (s % 60).toFixed(1).padStart(4, '0');
  return `${mm}:${ss}`;
}

export class Hud {
  /**
   * @param {{id: string, region: string}[]} agents
   * @param {object} T interface words (i18n.js)
   */
  constructor(agents, T) {
    this.T = T;
    this.rows = new Map();
    this.tracks = new Map();
    this.segments = [];      // {agent, el, t0, t1|null}: one bar per stretch of work
    this.ticks = [];         // {el, t}: error marks
    this.startedAt = null;
    this.stoppedAt = null;
    this.timerId = null;
    this.logCount = 0;

    const list = $('agent-list');
    for (const a of agents) {
      const li = document.createElement('li');
      li.className = 'idle';
      for (const [cls, text] of [['dot', ''], ['name', `${a.id}.md`], ['state', 'idle']]) {
        const span = document.createElement('span');
        span.className = cls;
        span.textContent = text;
        li.appendChild(span);
      }
      const track = document.createElement('div');
      track.className = 'track';
      li.appendChild(track);
      list.appendChild(li);
      this.rows.set(a.id, li);
      this.tracks.set(a.id, track);
    }

    $('final-close').addEventListener('click', () => this.hideFinal());
    $('info-close').addEventListener('click', () => this.hideInfo());
  }

  /** @param {(agent: string) => void} cb called when an agent row is clicked or activated by keyboard */
  onAgentSelect(cb) {
    for (const [agent, li] of this.rows) {
      li.tabIndex = 0;
      li.setAttribute('role', 'button');
      li.addEventListener('click', () => cb(agent));
      li.addEventListener('keydown', (e) => { if (e.key === 'Enter') cb(agent); });
    }
  }

  /**
   * Make the event log collapsible.
   * @param {boolean} collapsed initial state
   * @param {() => void} cb called after every change (the layout has to be measured again)
   */
  setupLogToggle(collapsed, cb) {
    const apply = (value) => {
      document.body.classList.toggle('log-collapsed', value);
      $('log-toggle').setAttribute('aria-expanded', String(!value));
      $('log-toggle').textContent = value ? '▸' : '▾';
      cb();
    };
    $('log-toggle').addEventListener('click', () => apply(!document.body.classList.contains('log-collapsed')));
    apply(collapsed);
  }

  /** @param {() => void} cb */
  onWhy(cb) { $('why').addEventListener('click', cb); }

  /**
   * Show the teaching card.
   * @param {string} title
   * @param {{heading?: string, text: string}[]} sections
   * @param {{fit?: string, wiki?: string|null}} [extra]
   */
  showInfo(title, sections, extra = {}) {
    $('info-title').textContent = title;
    const body = $('info-body');
    body.replaceChildren();
    for (const s of sections) {
      if (s.heading) {
        const h = document.createElement('h3');
        h.textContent = s.heading;
        body.appendChild(h);
      }
      const p = document.createElement('p');
      p.textContent = s.text;
      body.appendChild(p);
    }
    if (extra.fit) {
      const tag = document.createElement('span');
      tag.className = `fit ${extra.fit}`;
      tag.textContent = this.T.fit[extra.fit] ?? extra.fit;
      body.appendChild(tag);
    }
    if (extra.wiki) {
      const a = document.createElement('a');
      a.href = extra.wiki;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = this.T.wikiMore;
      body.append(document.createElement('br'), a);
    }
    $('info').hidden = false;
    body.scrollTop = 0;
  }

  hideInfo() { $('info').hidden = true; }

  /** @param {(goal: string) => void} cb */
  onStart(cb) {
    $('cmd').addEventListener('submit', (e) => {
      e.preventDefault();
      const goal = $('goal').value.trim();
      if (goal && !$('go').disabled) cb(goal);
    });
  }

  /** Show the SIMULATED badge whenever no real model is being called. */
  setSimulated(on) { $('mode').hidden = !on; }

  setRunning(on) {
    $('go').disabled = on;
    $('go').textContent = on ? this.T.running : this.T.start;
  }

  /** @param {string} agent @param {'idle'|'working'|'done'|'error'} state */
  setAgentState(agent, state) {
    const li = this.rows.get(agent);
    if (!li) return;
    li.className = state;
    li.querySelector('.state').textContent = state;
  }

  /** Brief red highlight for a non-fatal error; the agent state is left as it was. */
  flashAgent(agent) {
    const li = this.rows.get(agent);
    if (!li) return;
    li.classList.add('flash');
    setTimeout(() => li.classList.remove('flash'), 1200);
  }

  /** @param {number} calls @param {number|null} tokens null = the provider gave no usage data */
  setCounters(calls, tokens) {
    $('calls').textContent = String(calls);
    $('tokens').textContent = tokens === null ? this.T.notAvailable : tokens.toLocaleString(this.T.locale);
  }

  // ---------- timer ----------

  /** @param {number} [offset] seconds already elapsed (when joining a run in progress) */
  startTimer(offset = 0) {
    if (this.timerId) clearInterval(this.timerId);
    this.startedAt = performance.now() - offset * 1000;
    this.stoppedAt = null;
    this.timerId = setInterval(() => this.#tick(), 100);
  }

  /** @param {number} [at] run time of the closing event; defaults to now */
  stopTimer(at) {
    if (this.timerId) clearInterval(this.timerId);
    this.timerId = null;
    if (this.startedAt === null) return;
    this.stoppedAt = at ?? this.elapsed();
    for (const s of this.segments) if (s.t1 === null) this.#close(s, this.stoppedAt);
    this.#tick();
  }

  elapsed() {
    if (this.startedAt === null) return 0;
    return this.stoppedAt ?? (performance.now() - this.startedAt) / 1000;
  }

  #tick() {
    const now = this.elapsed();
    $('timer').textContent = clock(now);
    const span = Math.max(MIN_TRACK_SPAN, now);
    for (const s of this.segments) {
      s.el.style.left = `${(s.t0 / span) * 100}%`;
      s.el.style.width = `${(Math.max(0, (s.t1 ?? now) - s.t0) / span) * 100}%`;
    }
    for (const k of this.ticks) k.el.style.left = `${(k.t / span) * 100}%`;
  }

  // ---------- activity tracks ----------

  /** An agent starts a stretch of work at run time `t` (seconds). */
  markStart(agent, t) {
    const track = this.tracks.get(agent);
    if (!track) return;
    const el = document.createElement('i');
    el.className = 'open';
    track.appendChild(el);
    this.segments.push({ agent, el, t0: t, t1: null });
  }

  markEnd(agent, t) {
    const seg = this.segments.findLast((s) => s.agent === agent && s.t1 === null);
    if (seg) this.#close(seg, t);
  }

  markError(agent, t) {
    const track = this.tracks.get(agent);
    if (!track) return;
    const el = document.createElement('i');
    el.className = 'err';
    track.appendChild(el);
    this.ticks.push({ el, t });
  }

  #close(seg, t) {
    seg.t1 = Math.max(seg.t0, t);
    seg.el.className = '';
  }

  clearTracks() {
    for (const track of this.tracks.values()) track.replaceChildren();
    this.segments = [];
    this.ticks = [];
  }

  // ---------- log ----------

  /** Append one event to the log (at run time `t`) and keep it scrolled to the newest line. */
  log(ev, t) {
    const list = $('log-list');
    const li = document.createElement('li');
    li.className = ev.type;
    const time = document.createElement('span');
    time.className = 't';
    time.textContent = clock(t);
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = ev.target ? `${ev.agent} → ${ev.target}` : ev.agent;
    const msg = document.createElement('span');
    msg.className = 'msg';
    // label is cut at 80 characters; payload.full_label has the whole text when it was cut
    msg.textContent = String(ev.payload?.full_label ?? ev.label ?? '');
    li.append(time, who, msg);
    list.appendChild(li);
    while (list.children.length > MAX_LOG_LINES) list.firstChild.remove();
    list.scrollTop = list.scrollHeight;
    $('log-count').textContent = String(++this.logCount);
  }

  clearLog() {
    $('log-list').replaceChildren();
    this.logCount = 0;
    $('log-count').textContent = '0';
  }

  // ---------- final result ----------

  /** @param {string} text @param {boolean} simulated */
  showFinal(text, simulated) {
    $('final-title').textContent = simulated ? 'result.md · SIMULATED' : 'result.md';
    $('final-text').textContent = text;
    $('final').hidden = false;
  }

  hideFinal() { $('final').hidden = true; }
}
