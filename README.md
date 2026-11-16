# Swarm Brain

A real-time 3D dashboard that shows a swarm of AI agents as the regions of a brain.
You type a goal, an orchestrator splits it into subtasks, specialized agents carry them out,
and every action they take becomes an event that animates the brain in the browser.

| Agent | Brain region | What it does |
| --- | --- | --- |
| `planner` | prefrontal cortex | splits the goal into subtasks (a JSON plan) |
| `researcher` | parietal lobe | gathers what the model knows about the topic |
| `memory` | hippocampus (temporal lobe) | summarizes the results into a shared context |
| `executor` | motor cortex | writes the result and revises it if needed |
| `critic` | anterior cingulate cortex | checks the draft and gives a verdict |
| `orchestrator` | thalamus (centre) | routes the work; it is plain code and calls no model |

The dashboard interface is in Italian. The companion page [Inside an LLM](#inside-an-llm-llm)
is available in English and Italian.

## Quick start (simulated, no API key)

Requires Python 3.11 or newer.

```bash
cd swarm-brain
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
MODE=simulated .venv/bin/uvicorn backend.main:app --port 5173 --timeout-graceful-shutdown 2
```

Open <http://localhost:5173/>, type a goal and press **AVVIA** (start).
In this mode no model is called: events come from a simulator and the **SIMULATED** badge stays
visible. The backend also serves the frontend, so a single port is enough.

If the backend runs on a remote server, forward the port from your computer:

```bash
ssh -N -L 5173:127.0.0.1:5173 user@server
```

To keep it running on a server across reboots, `deploy/swarm-brain.service` is a systemd unit
(install and log commands are at the top of the file; adjust `User` and the paths). It reads `MODE`
and the key from `.env`, and it has to be restarted after a change to the backend or to `config.yaml`.

## Real agents (NVIDIA or any OpenAI-compatible endpoint)

1. Create the environment file and add your key:

   ```bash
   cp .env.example .env
   # in .env: MODE=live and NVIDIA_API_KEY=your-key
   ```

2. Pick one of the models available to your key:

   ```bash
   .venv/bin/python list_models.py          # all of them
   .venv/bin/python list_models.py llama    # only ids containing "llama"
   ```

3. Paste the id into `defaults.model` in `backend/config.yaml`. The file ships with
   `nvidia/nemotron-3.5-lightning-30b-a3b`, which answered in 1–3 seconds per call when tested;
   many ids in the list answer 404 or time out on the free tier. For a model that reasons before
   answering, `extra_body` can switch the reasoning off (see the comment in the file).

4. Try a single call, then start the server:

   ```bash
   .venv/bin/python -m backend.llm "Answer with one word: hello"
   .venv/bin/uvicorn backend.main:app --port 5173 --timeout-graceful-shutdown 2
   ```

5. Run an example task, from the page or from a terminal:

   ```bash
   curl -X POST localhost:5173/task -H 'content-type: application/json' \
        -d '{"goal": "Research agritech trends in Italy and write a short report"}'
   curl -N localhost:5173/events    # event stream
   ```

If the key or the model is missing, `POST /task` answers 503 with the reason. A fake result is
never produced in place of a real one.

**Important limit:** no agent has web access. The `researcher` only uses what the model learned
during training, and the final result carries a note saying so. Facts must be checked.

## Configuration (`backend/config.yaml`)

Every agent inherits from `defaults` and can override `provider`, `base_url`, `api_key_env`,
`model`, `temperature` and `max_tokens`. Keys never go in the file: `api_key_env` is the *name*
of the environment variable that holds the key. Restart the backend after a change.

| Limit | Default | Meaning |
| --- | --- | --- |
| `max_concurrency` | 3 | model requests in flight at the same time |
| `requests_per_minute` | 30 | requests per minute, retries included |
| `max_calls_per_run` | 25 | calls per run; beyond it the run stops with an `error` event |
| `max_tokens_per_call` | 1024 | upper bound for `max_tokens` on every call |
| `max_retries` | 5 | retries on 429, network errors and 5xx, with a wait that doubles each time |

## URL parameters

| Parameter | Effect |
| --- | --- |
| `?vertical=1` | 9:16 layout for screen recording |
| `?demo=1` | starts a task right away with the goal in the input box |
| `?theme=light` | light theme |
| `?local=1` | uses the in-browser simulator, no backend needed |
| `?err=1` | with `?local=1`: forces a simulated 429 error |

For a vertical video: `http://localhost:5173/?vertical=1&demo=1`.

## Why a brain

Clicking an agent (in the list or on its 3D label) opens a card: what the agent does, what the
brain region does, where the comparison holds and where it breaks. **perché un cervello?** (why a
brain?) at the top explains the general idea. The texts live in `frontend/analogies.js`; each card
links to the matching section of the wiki entry
[Sciame di agenti](https://wiki.daniellomario.com/it/agent-swarm) (English version:
[Agent swarm](https://wiki.daniellomario.com/agent-swarm)), which explains the analogies with sources.

The frontend also works on its own as a static page. `tools/export_brain_page.py <folder> [api]`
makes such a copy: with only the in-browser simulator, or, given the address of the Cloudflare
Worker in [`worker/`](worker/), with real agents behind an anti-bot check and daily limits.
One copy is published at <https://wiki.daniellomario.com/lab/swarm-brain/>.

## Inside an LLM (`/llm/`)

A second page, independent of the backend: <http://localhost:5173/llm/>, also published at
<https://wiki.daniellomario.com/lab/inside-an-llm/>. It shows in 3D the computation of a real but
tiny language model (16,080 parameters, 2 layers), run in the browser. A 12-step guide goes from the
text to the probabilities of the next letter; at the bottom you can type the start of a verse and let
the model complete it, one letter at a time. A block diagram of the model, drawn the way papers draw
a GPT, sits next to the guide: each block lights up during its step, shows the tensor shapes for the
current text on hover, and opens its step on click.

- The model works on letters and spaces (context: 44 positions) and was trained on 14,206 of the
  14,233 verses of Dante's *Divine Comedy* (the ones that fit; Project Gutenberg edition, public
  domain). It writes verses that sound like Dante's Italian; it does not know what they mean.
- Every cube is a number that is really computed: `frontend/llm/transformer.js` does the same arithmetic as
  PyTorch (largest difference on the scores: 1.6e-5, checked against the test vector in `model.json`).
- To retrain it: instructions at the top of `tools/train_tiny_gpt.py` (needs `torch`, about 20 minutes on a 4-core CPU).
- `?lang=en|it` picks the language (default: the browser's), `?step=N` opens the guide at step N
  (from 0), `?vertical=1` forces the 9:16 layout.
- Do not name a script `gpt.js`: EasyList, the default ad-block list, blocks every `/gpt.js` script
  (it is the name of Google's ad tag), and the whole page then fails to start.
- It is a static page. `tools/export_llm_page.py <folder>` copies it, with the shared stylesheet,
  into a self-contained folder for another site (this is how the wiki copy is made).

## Events

`GET /events` is an SSE stream. Each event:

```json
{ "id": "…", "ts": 1794611812.8, "type": "task_started|message|tool_call|task_done|error|final",
  "agent": "planner", "target": null, "label": "at most 80 characters", "payload": {} }
```

- `tool_call`: a model call, with `payload.phase` = `start`, `end` (plus `payload.tokens`) or `failed`.
- `error`: `payload.fatal` = `true` ends the run; `false` is an attempt that will be retried.
- Labels longer than 80 characters are cut, and the whole text (up to 300) is in `payload.full_label`; the log shows that.
- `final`: `payload.result` is the final text; `payload.simulated` tells whether it is a placeholder.

Other routes: `POST /task` (`{"goal": "…"}`; 409 if a task is already running), `GET /status`.

## Layout

```
backend/       main.py (API and SSE) · orchestrator.py · agents.py (prompts) · llm.py (limits, retries)
               events.py (schema and bus) · simulator.py (MODE=simulated) · config.yaml
frontend/      index.html · main.js · brain.js (3D brain) · hud.js (panels) · analogies.js
               localsim.js (in-browser simulator) · turnstile.js · style.css
worker/        Cloudflare Worker that runs the agents for the public static copy
frontend/llm/  index.html · main.js · transformer.js (the model) · scene.js (3D) · diagram.js (block diagram)
               tour.js (guide texts)
               i18n.js (interface words) · links.js · model.json (weights) · llm.css
tools/         train_tiny_gpt.py · export_llm_page.py · export_brain_page.py
deploy/        swarm-brain.service (systemd unit for a server)
list_models.py · .env.example
```
