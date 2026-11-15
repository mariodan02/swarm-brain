# Swarm Brain

Dashboard 3D in tempo reale: uno sciame di agenti IA mostrato come regioni di un cervello.
Scrivi un obiettivo, un orchestratore lo divide in sotto-compiti, agenti specializzati li svolgono,
e ogni loro azione diventa un evento che anima il cervello nel browser.

| Agente | Regione | Cosa fa |
| --- | --- | --- |
| `planner` | lobo frontale | divide l'obiettivo in sotto-compiti (piano JSON) |
| `researcher` | lobo parietale | raccoglie ciò che il modello sa sul tema |
| `memory` | lobo temporale | riassume i risultati in un contesto condiviso |
| `executor` | corteccia motoria | scrive il risultato e lo rivede se serve |
| `critic` | lobo occipitale | controlla la bozza e dà un verdetto |
| `orchestrator` | centro | smista il lavoro; è codice, non chiama modelli |

## Avvio rapido (simulato, senza chiavi)

Serve Python 3.11 o più recente.

```bash
cd swarm-brain
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
MODE=simulated .venv/bin/uvicorn backend.main:app --port 5173 --timeout-graceful-shutdown 2
```

Apri <http://localhost:5173/>, scrivi un obiettivo e premi **AVVIA**.
In questa modalità nessun modello viene chiamato: gli eventi sono generati da un simulatore e
l'etichetta **SIMULATED** resta visibile. Il backend serve anche il frontend, quindi basta una porta.

Se il backend gira su un server remoto, inoltra la porta dal tuo computer:

```bash
ssh -N -L 5173:127.0.0.1:5173 utente@server
```

## Agenti reali (NVIDIA o altro endpoint compatibile OpenAI)

1. Crea il file delle variabili d'ambiente e inserisci la chiave:

   ```bash
   cp .env.example .env
   # in .env: MODE=live e NVIDIA_API_KEY=la-tua-chiave
   ```

2. Scegli un modello tra quelli disponibili per la tua chiave:

   ```bash
   .venv/bin/python list_models.py          # tutti
   .venv/bin/python list_models.py llama    # solo gli id che contengono "llama"
   ```

3. Incolla l'id in `defaults.model` dentro `backend/config.yaml`.

4. Prova una singola chiamata, poi avvia:

   ```bash
   .venv/bin/python -m backend.llm "Rispondi con una parola: ciao"
   .venv/bin/uvicorn backend.main:app --port 5173 --timeout-graceful-shutdown 2
   ```

5. Compito di esempio, dalla pagina oppure da terminale:

   ```bash
   curl -X POST localhost:5173/task -H 'content-type: application/json' \
        -d '{"goal": "Ricerca i trend dell agritech in Italia e scrivi un report breve"}'
   curl -N localhost:5173/events    # flusso degli eventi
   ```

Se manca la chiave o il modello, `POST /task` risponde 503 con il motivo. Non viene mai prodotto
un risultato finto al posto di quello reale.

**Limite importante:** nessun agente ha accesso al web. Il `researcher` usa solo ciò che il modello
ha imparato in addestramento, e il risultato finale porta una nota che lo dice. I fatti vanno verificati.

## Configurazione (`backend/config.yaml`)

Ogni agente eredita da `defaults` e può cambiare `provider`, `base_url`, `api_key_env`, `model`,
`temperature`, `max_tokens`. Le chiavi non stanno mai nel file: `api_key_env` è il *nome* della
variabile d'ambiente che le contiene. Dopo una modifica riavvia il backend.

| Limite | Default | Significato |
| --- | --- | --- |
| `max_concurrency` | 3 | richieste al modello in corso nello stesso momento |
| `requests_per_minute` | 30 | richieste al minuto, tentativi ripetuti inclusi |
| `max_calls_per_run` | 25 | chiamate per esecuzione; oltre, l'esecuzione si ferma con un evento `error` |
| `max_tokens_per_call` | 1024 | tetto di `max_tokens` per ogni chiamata |
| `max_retries` | 5 | nuovi tentativi su 429, errori di rete e 5xx, con attesa che raddoppia |

## Parametri dell'URL

| Parametro | Effetto |
| --- | --- |
| `?vertical=1` | layout 9:16 per registrare lo schermo |
| `?demo=1` | avvia subito un compito con l'obiettivo nella casella |
| `?theme=light` | tema chiaro |
| `?local=1` | usa il simulatore nel browser, senza backend |
| `?err=1` | con `?local=1`: forza un errore 429 simulato |

Per un video verticale: `http://localhost:5173/?vertical=1&demo=1`.

## Parte didattica

Un clic su un agente (nell'elenco o sull'etichetta 3D) apre una scheda: cosa fa l'agente, cosa fa
la regione del cervello, dove il paragone regge e dove si rompe. **perché un cervello?** in alto
spiega l'idea generale. I testi stanno in `frontend/analogies.js`; ogni voce ha un campo `wiki`
per collegare una pagina di approfondimento (il link appare solo se il campo è compilato).

Il frontend funziona anche da solo come pagina statica (`?local=1`), quindi si può pubblicare
dentro un altro sito senza backend.

## Dentro un LLM (`/llm/`)

Seconda pagina, indipendente dal backend: <http://localhost:5173/llm/>. Mostra in 3D il calcolo di un
modello linguistico vero ma minuscolo (16.080 parametri, 2 strati), eseguito nel browser. Una guida in
12 passi accompagna dal testo alle probabilità della prossima lettera; in basso si può scrivere
l'inizio di una parola e farla completare, una lettera alla volta.

- Il modello lavora a lettere ed è stato addestrato sulle 12.338 parole diverse della Divina
  Commedia (edizione Project Gutenberg, pubblico dominio). Inventa parole che suonano come quelle
  di Dante; non ne conosce il significato.
- Ogni cubetto è un numero calcolato davvero: `frontend/llm/gpt.js` rifà gli stessi conti di PyTorch
  (differenza massima sui punteggi: 5,5e-6, controllata con il vettore di prova dentro `model.json`).
- Per riaddestrarlo: istruzioni in testa a `tools/train_tiny_gpt.py` (serve `torch`, circa 3 minuti su CPU).
- `?step=N` apre la guida al passo N (da 0); `?vertical=1` forza il layout 9:16.
- È una pagina statica: la cartella `frontend/llm/` più `frontend/style.css` bastano per pubblicarla altrove.

## Eventi

`GET /events` è un flusso SSE. Ogni evento:

```json
{ "id": "…", "ts": 1794611812.8, "type": "task_started|message|tool_call|task_done|error|final",
  "agent": "planner", "target": null, "label": "max 80 caratteri", "payload": {} }
```

- `tool_call`: chiamata al modello, con `payload.phase` = `start`, `end` (e `payload.tokens`) o `failed`.
- `error`: `payload.fatal` = `true` chiude l'esecuzione; `false` è un tentativo che verrà ripetuto.
- `final`: `payload.result` è il testo finale; `payload.simulated` dice se è un segnaposto.

Altre rotte: `POST /task` (`{"goal": "…"}`; 409 se un compito è già in corso), `GET /status`.

## Struttura

```
backend/   main.py (API e SSE) · orchestrator.py · agents.py (prompt) · llm.py (limiti e retry)
           events.py (schema e bus) · simulator.py (MODE=simulated) · config.yaml
frontend/  index.html · main.js · brain.js (cervello 3D) · hud.js (pannelli) · analogies.js
           localsim.js (simulatore nel browser) · style.css
frontend/llm/  index.html · main.js · gpt.js (il modello) · scene.js (3D) · tour.js (testi della guida)
               model.json (pesi) · llm.css
tools/train_tiny_gpt.py · list_models.py · .env.example
```
