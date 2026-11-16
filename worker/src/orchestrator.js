// Plan -> sub-tasks (dependencies respected, at most 3 at once) -> critic -> at most one
// revision -> final result. Same flow and same events as backend/orchestrator.py.
import { WORKERS } from './agents.js';
import { AgentFailure, complete } from './llm.js';
import { t } from './texts.js';

const MAX_SUBTASKS = 6;
const CONTEXT_CHARS = 6000; // each earlier result is cut to this length before it goes into a prompt
const clip = (text, lang) => (text.length <= CONTEXT_CHARS ? text : `${text.slice(0, CONTEXT_CHARS)}\n${t(lang, 'clipped')}`);

/** Extract and validate the plan from the planner's answer. Throws Error with the reason. */
export function parsePlan(text) {
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('nessun oggetto JSON nella risposta');
  let data;
  try { data = JSON.parse(text.slice(start, end + 1)); } catch { throw new Error('JSON non valido'); }
  const items = data?.subtasks;
  if (!Array.isArray(items) || items.length < 1 || items.length > MAX_SUBTASKS) {
    throw new Error(`'subtasks' deve essere una lista da 1 a ${MAX_SUBTASKS} elementi`);
  }
  const plan = [], ids = new Set();
  for (const item of items) {
    if (!item || typeof item !== 'object') throw new Error('ogni sotto-compito deve essere un oggetto');
    const { id, agent, task } = item, deps = item.depends_on ?? [];
    if (typeof id !== 'string' || !id.trim() || ids.has(id)) throw new Error(`id mancante o duplicato: ${JSON.stringify(id)}`);
    if (!WORKERS.includes(agent)) throw new Error(`agente non ammesso per ${id}: ${JSON.stringify(agent)}`);
    if (typeof task !== 'string' || !task.trim()) throw new Error(`descrizione mancante per ${id}`);
    if (!Array.isArray(deps) || !deps.every((d) => typeof d === 'string')) throw new Error(`depends_on di ${id} deve essere una lista di id`);
    ids.add(id);
    plan.push({ id, agent, task: task.trim(), dependsOn: [...new Set(deps)] });
  }
  for (const sub of plan) {
    for (const dep of sub.dependsOn) if (!ids.has(dep) || dep === sub.id) throw new Error(`dipendenza non valida in ${sub.id}: ${dep}`);
  }
  // Cycle check: keep removing sub-tasks whose dependencies are all resolved.
  const resolved = new Set();
  while (resolved.size < plan.length) {
    const ready = plan.filter((s) => !resolved.has(s.id) && s.dependsOn.every((d) => resolved.has(d)));
    if (!ready.length) throw new Error('dipendenze circolari');
    ready.forEach((s) => resolved.add(s.id));
  }
  if (!plan.some((s) => s.agent === 'executor')) throw new Error("manca un sotto-compito dell'executor che produca il risultato");
  return plan;
}

/** Run one goal to the end. Never throws for agent or provider failures: they become events. */
export async function runGoal(run, goal) {
  const { emit, budget, lang } = run;
  emit('task_started', 'orchestrator', t(lang, 'goal', { goal }), { payload: { goal, simulated: false } });
  try {
    const plan = await makePlan(run, goal);
    const results = await execute(run, goal, plan);
    const { text, verdict, revised } = await review(run, goal, plan, results);
    emit('final', 'orchestrator', t(lang, 'final_ready'), {
      payload: { result: text + t(lang, 'footer'), simulated: false, verdict, revised, calls: budget.calls, tokens: budget.tokens },
    });
  } catch (err) {
    const agent = err instanceof AgentFailure ? err.agent : 'orchestrator';
    const label = err instanceof AgentFailure ? err.message : t(lang, 'internal');
    emit('error', agent, label, { payload: { fatal: true, calls: budget.calls, tokens: budget.tokens } });
  }
}

async function makePlan(run, goal) {
  const { emit, lang } = run;
  emit('message', 'orchestrator', t(lang, 'ask_plan'), { target: 'planner' });
  emit('task_started', 'planner', t(lang, 'planning'));
  const messages = [{ role: 'user', content: t(lang, 'u_goal', { goal }) }];
  let answer = await complete(run, 'planner', messages, t(lang, 'p_plan'));
  let plan;
  try {
    plan = parsePlan(answer.text);
  } catch (first) {
    // One second chance, showing the planner what was wrong.
    emit('error', 'planner', t(lang, 'plan_retry', { reason: first.message }), { payload: { fatal: false } });
    messages.push(
      { role: 'assistant', content: answer.text },
      { role: 'user', content: t(lang, 'u_plan_fix', { reason: first.message }) },
    );
    answer = await complete(run, 'planner', messages, t(lang, 'p_plan_fix'));
    try { plan = parsePlan(answer.text); } catch (second) {
      throw new AgentFailure('planner', t(lang, 'plan_failed', { reason: second.message }));
    }
  }
  emit('task_done', 'planner', t(lang, 'plan_ready', { n: plan.length }), {
    payload: { plan: plan.map((s) => ({ id: s.id, agent: s.agent, task: s.task, depends_on: s.dependsOn })) },
  });
  emit('message', 'planner', t(lang, 'plan_sent'), { target: 'orchestrator' });
  return plan;
}

async function execute(run, goal, plan) {
  const { emit, lang } = run;
  const byId = new Map(plan.map((s) => [s.id, s]));
  const results = new Map();
  const shared = []; // what the memory agent wrote: given to every later sub-task
  const started = new Map();

  // Each sub-task waits for its dependencies; llm.js keeps at most 3 requests in flight.
  const one = (sub) => {
    if (!started.has(sub.id)) {
      started.set(sub.id, (async () => {
        await Promise.all(sub.dependsOn.map((dep) => one(byId.get(dep))));
        emit('message', 'orchestrator', t(lang, 'assign', { id: sub.id, task: sub.task }), { target: sub.agent, payload: { task: sub.id } });
        const parts = [t(lang, 'u_overall', { goal }), t(lang, 'u_subtask', { id: sub.id, task: sub.task })];
        if (shared.length && sub.agent !== 'memory') parts.push(`${t(lang, 'u_shared')}\n${clip(shared.join('\n\n'), lang)}`);
        for (const dep of sub.dependsOn) {
          const source = byId.get(dep).agent;
          if (source !== sub.agent) emit('message', source, t(lang, 'pass', { id: dep }), { target: sub.agent, payload: { task: dep } });
          parts.push(`${t(lang, 'u_result_of', { id: dep, agent: source })}\n${clip(results.get(dep), lang)}`);
        }
        emit('task_started', sub.agent, `${sub.id} · ${sub.task}`, { payload: { task: sub.id } });
        const answer = await complete(run, sub.agent, [{ role: 'user', content: parts.join('\n\n') }], sub.task);
        results.set(sub.id, answer.text);
        if (sub.agent === 'memory') shared.push(answer.text);
        emit('task_done', sub.agent, t(lang, 'done', { id: sub.id }) + (answer.truncated ? t(lang, 'truncated') : ''), {
          payload: { task: sub.id, chars: answer.text.length, truncated: answer.truncated },
        });
        emit('message', sub.agent, t(lang, 'result', { id: sub.id }), { target: 'orchestrator', payload: { task: sub.id } });
      })());
    }
    return started.get(sub.id);
  };
  await Promise.all(plan.map(one));
  return results;
}

async function review(run, goal, plan, results) {
  const { emit, lang } = run;
  const draftId = plan.filter((s) => s.agent === 'executor').at(-1).id;
  const draft = results.get(draftId);

  emit('message', 'executor', t(lang, 'to_check'), { target: 'critic', payload: { task: draftId } });
  emit('task_started', 'critic', t(lang, 'checking'));
  const user = `${t(lang, 'u_goal', { goal })}\n\n${t(lang, 'u_draft')}\n${clip(draft, lang)}`;
  const check = await complete(run, 'critic', [{ role: 'user', content: user }], t(lang, 'p_check'));
  const firstLine = (check.text.split('\n').find((line) => line.trim()) ?? '').toUpperCase();
  const revise = firstLine.includes('RIVEDERE') || firstLine.includes('REVISE'); // Italian or English prompt
  const verdict = revise ? 'RIVEDERE' : 'OK'; // payload value, the same in both languages
  emit('task_done', 'critic', t(lang, revise ? 'verdict_revise' : 'verdict_ok'), { payload: { verdict } });
  if (!revise) {
    emit('message', 'critic', t(lang, 'approved'), { target: 'orchestrator' });
    return { text: draft, verdict, revised: false };
  }
  emit('message', 'critic', t(lang, 'revise_asked'), { target: 'executor' });
  emit('task_started', 'executor', t(lang, 'revising'));
  const content = `${t(lang, 'u_goal', { goal })}\n\n${t(lang, 'u_draft')}\n${clip(draft, lang)}` +
    `\n\n${t(lang, 'u_notes')}\n${clip(check.text, lang)}`;
  const revised = await complete(run, 'executor', [{ role: 'user', content }], t(lang, 'p_revision'));
  emit('task_done', 'executor', t(lang, 'revised') + (revised.truncated ? t(lang, 'truncated') : ''));
  emit('message', 'executor', t(lang, 'final_version'), { target: 'orchestrator' });
  return { text: revised.text, verdict, revised: true };
}
