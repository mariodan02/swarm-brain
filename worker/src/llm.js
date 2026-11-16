// One chat completion against an OpenAI-compatible endpoint, with the same safety rules as
// backend/llm.py: call budget per run, at most 3 requests in flight, retries with backoff.
import { AGENTS } from './agents.js';
import { t } from './texts.js';

const MAX_CONCURRENCY = 3;
const MAX_RETRIES = 3;            // after the first attempt, on 429 / 5xx / network errors
const REQUEST_TIMEOUT_MS = 60000;

/** A run could not go on; `agent` is the one that failed. Becomes a fatal `error` event. */
export class AgentFailure extends Error {
  constructor(agent, message) {
    super(message);
    this.agent = agent;
  }
}

/** Limits how many model requests are in flight at once. */
export class Slots {
  #free = MAX_CONCURRENCY;
  #waiting = [];

  async run(fn) {
    if (this.#free > 0) this.#free--;
    else await new Promise((resolve) => this.#waiting.push(resolve));
    try {
      return await fn();
    } finally {
      const next = this.#waiting.shift();
      if (next) next();
      else this.#free++;
    }
  }
}

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const id = setTimeout(resolve, ms);
  signal.addEventListener('abort', () => { clearTimeout(id); reject(new Error('aborted')); }, { once: true });
});

/**
 * @param {object} run {env, emit, signal, slots, lang, budget: {calls, max, tokens}}
 * @param {string} agent
 * @param {{role: string, content: string}[]} messages without the system prompt
 * @param {string} purpose short text for the event label
 * @returns {Promise<{text: string, truncated: boolean}>}
 */
export async function complete(run, agent, messages, purpose) {
  const { env, emit, signal, budget, lang } = run;
  const cfg = AGENTS[agent];
  if (budget.calls >= budget.max) throw new AgentFailure(agent, t(lang, 'max_calls', { n: budget.max }));
  const call = ++budget.calls;
  const body = JSON.stringify({
    model: env.MODEL,
    messages: [{ role: 'system', content: cfg.system[lang] ?? cfg.system.it }, ...messages],
    temperature: cfg.temperature,
    max_tokens: cfg.maxTokens,
    ...(env.EXTRA_BODY ? JSON.parse(env.EXTRA_BODY) : {}),
  });

  emit('tool_call', agent, `LLM ▸ ${purpose}`, { payload: { tool: 'llm', phase: 'start', model: env.MODEL, call } });
  const started = Date.now();
  let reason = '';
  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    let status = null;
    try {
      const res = await run.slots.run(() => fetch(`${env.BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${env.NVIDIA_API_KEY}`, 'content-type': 'application/json' },
        body,
        signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
      }));
      status = res.status;
      if (res.ok) {
        const data = await res.json();
        const choice = data.choices?.[0];
        const text = (choice?.message?.content ?? '').trim();
        const usage = data.usage
          ? { prompt: data.usage.prompt_tokens, completion: data.usage.completion_tokens, total: data.usage.total_tokens }
          : null;
        if (usage) budget.tokens += usage.total;
        emit('tool_call', agent, usage ? t(lang, 'llm_tokens', { n: usage.total }) : t(lang, 'llm_no_usage'), {
          payload: { tool: 'llm', phase: 'end', call, tokens: usage, ms: Date.now() - started },
        });
        if (!text) throw new AgentFailure(agent, t(lang, 'empty'));
        return { text, truncated: choice?.finish_reason === 'length' };
      }
      await res.body?.cancel();
      reason = status === 429 ? t(lang, 'busy_model') : t(lang, 'http_error', { status });
      if (status !== 429 && status < 500) break; // 4xx other than 429: retrying will not help
    } catch (err) {
      if (err instanceof AgentFailure) throw err;
      if (signal.aborted) throw new AgentFailure(agent, t(lang, 'aborted'));
      reason = err?.name === 'TimeoutError' ? 'timeout' : t(lang, 'net_error');
    }
    if (attempt > MAX_RETRIES) break;
    const wait = Math.min(8000, 2000 * 2 ** (attempt - 1)) * (1 + Math.random() * 0.25);
    emit('error', agent, t(lang, 'retry', { reason, attempt, total: MAX_RETRIES + 1, delay: Math.round(wait / 1000) }), {
      payload: { fatal: false, status, attempt },
    });
    try { await sleep(wait, signal); } catch { throw new AgentFailure(agent, t(lang, 'aborted')); }
  }
  emit('tool_call', agent, `LLM ✕ ${reason}`, { payload: { tool: 'llm', phase: 'failed', call } });
  throw new AgentFailure(agent, t(lang, 'call_failed', { reason }));
}
