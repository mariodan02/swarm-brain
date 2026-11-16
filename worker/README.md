# Swarm Brain API (Cloudflare Worker)

Runs the agents for the public, static copy of Swarm Brain, so that the page can use real
models without a server. Same flow and same event schema as the Python backend.

- `GET /status` → `{ mode, remaining, sitekey, now }`
- `POST /run` with `{ goal, token }` → the run's events as `text/event-stream`

A run starts only if all of these hold:

| Check | Value |
| --- | --- |
| The request comes from an allowed page | `ALLOWED_ORIGINS` |
| The visitor passed Cloudflare Turnstile | `token` in the request |
| Runs per visitor per hour | `IP_RUNS_PER_HOUR` (3) |
| Runs per day, all visitors together | `DAILY_RUNS` (50, Europe/Rome day) |
| Model calls per run | `MAX_CALLS_PER_RUN` (25) |

When a check fails the page says why and falls back to the in-browser simulator.
Counters live in Workers KV, which has no atomic increment: under simultaneous requests a cap
can be exceeded by a few runs. Visitor addresses are stored only as a salted hash, for one hour.

## Local test

```bash
cd worker && npm install
cat > .dev.vars <<'END'      # not committed
NVIDIA_API_KEY=your-key
TURNSTILE_SECRET=1x0000000000000000000000000000000AA
TURNSTILE_SITEKEY=1x00000000000000000000AA
ALLOWED_ORIGINS=http://127.0.0.1:8090
END
npx wrangler dev --port 8787

# in another terminal: a static copy of the page that talks to the local Worker
python3 tools/export_brain_page.py /tmp/site/lab/swarm-brain http://127.0.0.1:8787
(cd /tmp/site && python3 -m http.server 8090 --bind 127.0.0.1)
# open http://127.0.0.1:8090/lab/swarm-brain/
```

The two Turnstile values above are Cloudflare's public test keys: they always pass.

## Deploy

Needs a Cloudflare API token with: Workers Scripts (edit), Workers KV Storage (edit),
Turnstile (edit), Workers Routes and DNS (edit) on the zone.

```bash
export CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=...
npx wrangler kv namespace create LIMITS        # put the id in wrangler.jsonc
# create a Turnstile widget for the page's hostname; put its sitekey in wrangler.jsonc
npx wrangler secret put TURNSTILE_SECRET
npx wrangler secret put NVIDIA_API_KEY
npx wrangler deploy
```

Then export the page with the Worker's address:

```bash
python3 tools/export_brain_page.py ~/dev/wiki/lab/swarm-brain https://swarm-api.daniellomario.com
```

The prompts in `src/agents.js` mirror `backend/agents.py`: change both together.
