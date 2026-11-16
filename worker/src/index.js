// HTTP entry point of the Worker.
//   GET  /status  -> { mode, remaining, sitekey, now }
//   POST /run     -> { goal, token }  the answer is the run's event stream (text/event-stream)
// A run starts only from an allowed page, after a Turnstile check, and within two limits:
// runs per visitor per hour and runs per day for everybody.
import { Slots } from './llm.js';
import { runGoal } from './orchestrator.js';

const LABEL_MAX = 80;
const FULL_LABEL_MAX = 300; // a label cut at LABEL_MAX keeps its full text in payload.full_label
const GOAL_MIN = 3, GOAL_MAX = 400;

const json = (data, status, cors) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...cors },
});

function corsFor(request, env) {
  const origin = request.headers.get('origin');
  const allowed = env.ALLOWED_ORIGINS.split(',').map((o) => o.trim());
  if (!origin || !allowed.includes(origin)) return null;
  return { 'access-control-allow-origin': origin, vary: 'Origin' };
}

// The counting day follows Italian time.
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());

async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function count(env, key) {
  return Number.parseInt((await env.LIMITS.get(key)) ?? '0', 10) || 0;
}

/**
 * Check both limits and, if there is room, count this run.
 * KV has no atomic increment: under simultaneous requests the caps can be exceeded by a few runs.
 * @returns {Promise<string|null>} the reason for refusing, or null
 */
async function takeRun(env, ip) {
  const hour = Math.floor(Date.now() / 3600000);
  // The address is stored only as a salted hash, and only for an hour.
  const ipKey = `ip:${await sha256(`${env.TURNSTILE_SECRET}:${ip}:${hour}`)}`;
  const dayKey = `day:${today()}`;
  const [byIp, byDay] = await Promise.all([count(env, ipKey), count(env, dayKey)]);
  if (byDay >= Number(env.DAILY_RUNS)) return 'Esecuzioni reali di oggi esaurite';
  if (byIp >= Number(env.IP_RUNS_PER_HOUR)) return 'Hai raggiunto il limite di esecuzioni reali per quest’ora';
  await Promise.all([
    env.LIMITS.put(ipKey, String(byIp + 1), { expirationTtl: 3700 }),
    env.LIMITS.put(dayKey, String(byDay + 1), { expirationTtl: 2 * 86400 }),
  ]);
  return null;
}

async function turnstileOk(env, token, ip) {
  if (typeof token !== 'string' || !token || token.length > 2048) return false;
  const body = new FormData();
  body.append('secret', env.TURNSTILE_SECRET);
  body.append('response', token);
  body.append('remoteip', ip);
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
    return (await res.json()).success === true;
  } catch {
    return false;
  }
}

function stream(env, ctx, goal, cors) {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const abort = new AbortController(); // the visitor left: stop calling the model
  const write = (text) => writer.write(encoder.encode(text)).catch(() => abort.abort());
  const emit = (type, agent, label, { target = null, payload = {} } = {}) => {
    if (label.length > LABEL_MAX) payload = { full_label: label.slice(0, FULL_LABEL_MAX), ...payload };
    write(`data: ${JSON.stringify({ id: crypto.randomUUID(), ts: Date.now() / 1000, type, agent, target, label: label.slice(0, LABEL_MAX), payload })}\n\n`);
  };
  const ping = setInterval(() => write(': ping\n\n'), 10000);
  const run = {
    env, emit, signal: abort.signal, slots: new Slots(),
    budget: { calls: 0, max: Number(env.MAX_CALLS_PER_RUN), tokens: 0 },
  };
  ctx.waitUntil(runGoal(run, goal).finally(() => {
    clearInterval(ping);
    return writer.close().catch(() => {});
  }));
  return new Response(readable, {
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', ...cors },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cors = corsFor(request, env);

    if (request.method === 'OPTIONS') {
      if (!cors) return new Response(null, { status: 403 });
      return new Response(null, {
        status: 204,
        headers: { ...cors, 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' },
      });
    }

    if (request.method === 'GET' && url.pathname === '/status') {
      const used = await count(env, `day:${today()}`);
      return json({
        mode: 'live',
        remaining: Math.max(0, Number(env.DAILY_RUNS) - used),
        sitekey: env.TURNSTILE_SITEKEY,
        now: Date.now() / 1000,
      }, 200, cors ?? {});
    }

    if (request.method === 'POST' && url.pathname === '/run') {
      if (!cors) return json({ detail: 'Origine non ammessa' }, 403, {});
      let body;
      try { body = await request.json(); } catch { return json({ detail: 'Richiesta non valida' }, 400, cors); }
      const goal = typeof body?.goal === 'string' ? body.goal.trim() : '';
      if (goal.length < GOAL_MIN || goal.length > GOAL_MAX) {
        return json({ detail: `L’obiettivo deve avere da ${GOAL_MIN} a ${GOAL_MAX} caratteri` }, 422, cors);
      }
      const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
      if (!(await turnstileOk(env, body.token, ip))) return json({ detail: 'Verifica anti-bot non superata' }, 403, cors);
      const refused = await takeRun(env, ip);
      if (refused) return json({ detail: refused }, 429, cors);
      return stream(env, ctx, goal, cors);
    }

    return json({ detail: 'Non trovato' }, 404, cors ?? {});
  },
};
