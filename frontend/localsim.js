// In-browser event simulator: no backend, no model. Emits the same event schema the backend will use:
// { id, ts, type, agent, target, label, payload }

const rnd = (a, b) => a + Math.random() * (b - a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

// Agents and dependencies of the simulated plan; the titles come in the page's language (i18n.js, `sim`).
const SHAPE = [
  { id: 't1', agent: 'researcher', deps: [] },
  { id: 't2', agent: 'researcher', deps: [] },
  { id: 't3', agent: 'memory', deps: ['t1', 't2'] },
  { id: 't4', agent: 'executor', deps: ['t3'] },
  { id: 't5', agent: 'critic', deps: ['t4'] },
];

/**
 * Run one simulated task.
 * @param {string} goal
 * @param {(ev: object) => void} emit
 * @param {object} S words of the simulated run (i18n.js, `sim`)
 * @param {{forceError?: boolean}} [opts]
 * @returns {() => void} cancel function: after it is called no more events are emitted
 */
export function runLocalSim(goal, emit, S, opts = {}) {
  let cancelled = false;
  const PLAN = SHAPE.map((t, i) => ({ ...t, title: S.plan[i] }));
  const withError = opts.forceError || Math.random() < 0.5;

  const send = (type, agent, target, label, payload = {}) => {
    if (cancelled) return;
    emit({ id: uid(), ts: Date.now() / 1000, type, agent, target, label: label.slice(0, 80), payload });
  };

  async function llm(agent, what, retryOnce = false) {
    send('tool_call', agent, null, `LLM ▸ ${what}`, { tool: 'llm', phase: 'start' });
    if (retryOnce) {
      await sleep(rnd(500, 900));
      send('error', agent, null, S.rate, { fatal: false, status: 429 });
      await sleep(2000);
    }
    await sleep(rnd(1200, 3200));
    const prompt = Math.round(rnd(250, 900)), completion = Math.round(rnd(120, 650));
    send('tool_call', agent, null, S.tokens(prompt + completion), {
      tool: 'llm', phase: 'end', tokens: { prompt, completion, total: prompt + completion },
    });
  }

  async function subtask(t) {
    send('message', 'orchestrator', t.agent, S.assign(t.id, t.title), { task: t.id });
    await sleep(rnd(300, 600));
    for (const dep of t.deps) {
      const source = PLAN.find((p) => p.id === dep).agent;
      if (source !== t.agent) send('message', source, t.agent, S.pass(dep), { task: dep });
    }
    send('task_started', t.agent, null, `${t.id} · ${t.title}`, { task: t.id });
    await llm(t.agent, t.title, withError && t.id === 't2');
    send('task_done', t.agent, null, S.done(t.id), { task: t.id });
    send('message', t.agent, 'orchestrator', S.result(t.id), { task: t.id });
  }

  (async () => {
    send('task_started', 'orchestrator', null, S.goal(goal), { goal });
    await sleep(600);
    send('message', 'orchestrator', 'planner', S.askPlan, {});
    await sleep(400);
    send('task_started', 'planner', null, S.planning, {});
    await llm('planner', S.pPlan);
    send('task_done', 'planner', null, S.planReady(PLAN.length), { plan: PLAN });
    send('message', 'planner', 'orchestrator', S.planSent, {});
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
    send('message', 'critic', 'executor', S.reviseAsked, {});
    await sleep(400);
    send('task_started', 'executor', null, S.revising, {});
    await llm('executor', S.pRevision);
    send('task_done', 'executor', null, S.revised, {});
    send('message', 'executor', 'orchestrator', S.finalVersion, {});
    await sleep(700);

    send('final', 'orchestrator', null, S.finalReady, {
      simulated: true,
      result: S.text(goal, PLAN.map((t) => `  ${t.id}  ${t.agent.padEnd(11)} ${t.title}`).join('\n')),
    });
  })();

  return () => { cancelled = true; };
}
