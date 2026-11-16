"""Words of the event labels, of the prompts' scaffolding and of the final note, in Italian and English.

The language is the page's (sent with POST /task), not the goal's: agents still answer in the
language of the goal, as their system prompts say. worker/src/texts.js holds the same table.
"""
from __future__ import annotations

from typing import Literal

Lang = Literal["it", "en"]
LANGS: tuple[Lang, ...] = ("it", "en")

TEXTS: dict[str, dict[str, str]] = {
    "it": {
        # event labels
        "goal": "Obiettivo: {goal}",
        "ask_plan": "Richiesta piano",
        "planning": "Scomposizione in sotto-compiti",
        "plan_retry": "Piano non valido: {reason} · nuova richiesta",
        "plan_failed": "Piano non valido dopo 2 tentativi: {reason}",
        "plan_ready": "Piano pronto: {n} sotto-compiti",
        "plan_sent": "Piano consegnato",
        "assign": "Assegna {id}: {task}",
        "pass": "Passa il risultato di {id}",
        "done": "{id} completato",
        "truncated": " (risposta troncata)",
        "result": "Risultato {id}",
        "to_check": "Bozza da controllare",
        "checking": "Controllo di qualità della bozza",
        "verdict_ok": "Verdetto: OK",
        "verdict_revise": "Verdetto: RIVEDERE",
        "approved": "Bozza approvata",
        "revise_asked": "Revisione richiesta",
        "revising": "Revisione della bozza",
        "revised": "Bozza rivista",
        "final_version": "Versione finale",
        "final_ready": "Risultato finale pronto",
        "internal": "Errore interno",
        "internal_x": "Errore interno: {name}",
        "busy": "Un compito è già in corso",
        "too_short": "Obiettivo troppo corto",
        # model calls
        "p_plan": "piano JSON",
        "p_plan_fix": "piano JSON (correzione)",
        "p_check": "controllo qualità",
        "p_revision": "revisione",
        "llm_tokens": "LLM ◂ {n} token",
        "llm_no_usage": "LLM ◂ risposta (token n/d)",
        "retry": "{reason} · tentativo {attempt}/{total} · riprovo tra {delay} s",
        "call_failed": "Chiamata LLM fallita ({reason})",
        "max_calls": "Limite di {n} chiamate LLM per esecuzione raggiunto",
        "max_tokens": "max_tokens {wanted} oltre il limite di {limit} per chiamata",
        "empty": "Il modello ha restituito una risposta vuota",
        "net_error": "errore di rete",
        "http_error": "errore HTTP {status}",
        # prompt scaffolding
        "u_goal": "Obiettivo: {goal}",
        "u_overall": "Obiettivo generale: {goal}",
        "u_subtask": "Il tuo sotto-compito ({id}): {task}",
        "u_shared": "Contesto condiviso (memoria):",
        "u_result_of": "Risultato di {id} ({agent}):",
        "u_draft": "Bozza:",
        "u_notes": "Note di revisione del critic:",
        "u_plan_fix": "Il piano non è valido: {reason}. Rispondi solo con il JSON corretto.",
        "clipped": "[… testo tagliato per lunghezza]",
        "footer": (
            "\n\n—\nNota: testo prodotto da modelli linguistici senza accesso al web. "
            "I fatti riportati non sono stati verificati su fonti esterne."
        ),
        # simulator
        "sim_t1": "Raccogli le informazioni di base",
        "sim_t2": "Approfondisci un secondo aspetto",
        "sim_t3": "Sintetizza il contesto condiviso",
        "sim_t4": "Scrivi la bozza della risposta",
        "sim_t5": "Controlla qualità e coerenza",
        "sim_429": "429 rate limit · nuovo tentativo tra 2 s",
        "sim_result": (
            "[SIMULATO] Nessun modello è stato chiamato.\n\n"
            "Obiettivo: {goal}\n\n"
            "Questa sequenza di eventi è generata dal simulatore del backend (MODE=simulated). "
            "Il testo che leggi è un segnaposto, non un risultato.\n\n"
            "Piano simulato:\n{plan}"
        ),
    },
    "en": {
        "goal": "Goal: {goal}",
        "ask_plan": "Plan requested",
        "planning": "Splitting into sub-tasks",
        "plan_retry": "Invalid plan: {reason} · asking again",
        "plan_failed": "Invalid plan after 2 attempts: {reason}",
        "plan_ready": "Plan ready: {n} sub-tasks",
        "plan_sent": "Plan delivered",
        "assign": "Assign {id}: {task}",
        "pass": "Passes on the result of {id}",
        "done": "{id} done",
        "truncated": " (answer cut short)",
        "result": "Result of {id}",
        "to_check": "Draft to check",
        "checking": "Quality check of the draft",
        "verdict_ok": "Verdict: OK",
        "verdict_revise": "Verdict: REVISE",
        "approved": "Draft approved",
        "revise_asked": "Revision requested",
        "revising": "Revising the draft",
        "revised": "Draft revised",
        "final_version": "Final version",
        "final_ready": "Final result ready",
        "internal": "Internal error",
        "internal_x": "Internal error: {name}",
        "busy": "A task is already running",
        "too_short": "Goal too short",
        "p_plan": "JSON plan",
        "p_plan_fix": "JSON plan (fix)",
        "p_check": "quality check",
        "p_revision": "revision",
        "llm_tokens": "LLM ◂ {n} tokens",
        "llm_no_usage": "LLM ◂ answer (tokens n/a)",
        "retry": "{reason} · attempt {attempt}/{total} · retrying in {delay} s",
        "call_failed": "LLM call failed ({reason})",
        "max_calls": "Limit of {n} LLM calls per run reached",
        "max_tokens": "max_tokens {wanted} is over the limit of {limit} per call",
        "empty": "The model returned an empty answer",
        "net_error": "network error",
        "http_error": "HTTP error {status}",
        "u_goal": "Goal: {goal}",
        "u_overall": "Overall goal: {goal}",
        "u_subtask": "Your sub-task ({id}): {task}",
        "u_shared": "Shared context (memory):",
        "u_result_of": "Result of {id} ({agent}):",
        "u_draft": "Draft:",
        "u_notes": "The critic's revision notes:",
        "u_plan_fix": "The plan is not valid: {reason}. Answer only with the corrected JSON.",
        "clipped": "[… text cut for length]",
        "footer": (
            "\n\n—\nNote: text written by language models with no web access. "
            "The facts in it have not been checked against outside sources."
        ),
        "sim_t1": "Gather the basic information",
        "sim_t2": "Look into a second aspect",
        "sim_t3": "Summarize the shared context",
        "sim_t4": "Write the draft answer",
        "sim_t5": "Check quality and consistency",
        "sim_429": "429 rate limit · retrying in 2 s",
        "sim_result": (
            "[SIMULATED] No model was called.\n\n"
            "Goal: {goal}\n\n"
            "This sequence of events comes from the backend simulator (MODE=simulated). "
            "The text you are reading is a placeholder, not a result.\n\n"
            "Simulated plan:\n{plan}"
        ),
    },
}


def t(lang: str, key: str, **values: object) -> str:
    """The text for `key` in `lang` (Italian when the language is unknown), with the values filled in."""
    table = TEXTS.get(lang, TEXTS["it"])
    return table[key].format(**values) if values else table[key]
