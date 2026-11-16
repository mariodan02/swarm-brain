// In-browser event simulator: no backend, no model. Emits the same event schema the backend will use:
// { id, ts, type, agent, target, label, payload }

const rnd = (a, b) => a + Math.random() * (b - a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

const PLAN = [
  { id: 't1', agent: 'researcher', deps: [], title: 'Raccogli le informazioni di base' },
  { id: 't2', agent: 'researcher', deps: [], title: 'Approfondisci un secondo aspetto' },
  { id: 't3', agent: 'memory', deps: ['t1', 't2'], title: 'Sintetizza il contesto condiviso' },
  { id: 't4', agent: 'executor', deps: ['t3'], title: 'Scrivi la bozza della risposta' },
  { id: 't5', agent: 'critic', deps: ['t4'], title: 'Controlla qualità e coerenza' },
];

/**
 * Run one simulated task.
 * @param {string} goal
 * @param {(ev: object) => void} emit
 * @param {{forceError?: boolean}} [opts]
 * @returns {() => void} cancel function: after it is called no more events are emitted
 */
export function runLocalSim(goal, emit, opts = {}) {
  let cancelled = false;
  const withError = opts.forceError || Math.random() < 0.5;

  const send = (type, agent, target, label, payload = {}) => {
    if (cancelled) return;
    emit({ id: uid(), ts: Date.now() / 1000, type, agent, target, label: label.slice(0, 80), payload });
  };

  async function llm(agent, what, retryOnce = false) {
    send('tool_call', agent, null, `LLM ▸ ${what}`, { tool: 'llm', phase: 'start' });
    if (retryOnce) {
      await sleep(rnd(500, 900));
      send('error', agent, null, '429 rate limit · nuovo tentativo tra 2 s', { fatal: false, status: 429 });
      await sleep(2000);
    }
    await sleep(rnd(1200, 3200));
    const prompt = Math.round(rnd(250, 900)), completion = Math.round(rnd(120, 650));
    send('tool_call', agent, null, `LLM ◂ ${prompt + completion} token`, {
      tool: 'llm', phase: 'end', tokens: { prompt, completion, total: prompt + completion },
    });
  }

  async function subtask(t) {
    send('message', 'orchestrator', t.agent, `Assegna ${t.id}: ${t.title}`, { task: t.id });
    await sleep(rnd(300, 600));
    for (const dep of t.deps) {
      const source = PLAN.find((p) => p.id === dep).agent;
      if (source !== t.agent) send('message', source, t.agent, `Passa il risultato di ${dep}`, { task: dep });
    }
    send('task_started', t.agent, null, `${t.id} · ${t.title}`, { task: t.id });
    await llm(t.agent, t.title, withError && t.id === 't2');
    send('task_done', t.agent, null, `${t.id} completato`, { task: t.id });
    send('message', t.agent, 'orchestrator', `Risultato ${t.id}`, { task: t.id });
  }

  (async () => {
    send('task_started', 'orchestrator', null, `Obiettivo: ${goal}`, { goal });
    await sleep(600);
    send('message', 'orchestrator', 'planner', 'Richiesta piano', {});
    await sleep(400);
    send('task_started', 'planner', null, 'Scomposizione in sotto-compiti', {});
    await llm('planner', 'piano JSON');
    send('task_done', 'planner', null, `Piano pronto: ${PLAN.length} sotto-compiti`, { plan: PLAN });
    send('message', 'planner', 'orchestrator', 'Piano consegnato', {});
    await sleep(500);

    // Same scheduling rule as the real orchestrator: respect dependencies, at most 3 at once.
    const done = new Set(), running = new Map();
    while (done.size < PLAN.length) {
      for (const t of PLAN) {
        if (running.size >= 3) break;
        if (done.has(t.id) || running.has(t.id) || !t.deps.every((d) => done.has(d))) continue;
        running.set(t.id, subtask(t).then(() => { running.delete(t.id); done.add(t.id); }));
      }
      await Promise.race(running.values());
    }

    // One revision round asked by the critic.
    await sleep(400);
    send('message', 'critic', 'executor', 'Revisione richiesta', {});
    await sleep(400);
    send('task_started', 'executor', null, 'Revisione della bozza', {});
    await llm('executor', 'revisione');
    send('task_done', 'executor', null, 'Bozza rivista', {});
    send('message', 'executor', 'orchestrator', 'Versione finale', {});
    await sleep(700);

    send('final', 'orchestrator', null, 'Risultato finale pronto', {
      simulated: true,
      result:
        `[SIMULATO] Nessun modello è stato chiamato.\n\n` +
        `Obiettivo: ${goal}\n\n` +
        `Questa sequenza di eventi è generata nel browser per provare la grafica. ` +
        `Il testo che leggi è un segnaposto, non un risultato.\n\n` +
        `Piano simulato:\n` + PLAN.map((t) => `  ${t.id}  ${t.agent.padEnd(11)} ${t.title}`).join('\n'),
    });
  })();

  return () => { cancelled = true; };
}
