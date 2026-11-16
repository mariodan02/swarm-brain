// Interface words of the dashboard in Italian and English. The teaching cards are in analogies.js;
// the labels of real runs come from the backend or the Worker, in the language sent with the goal.

/** ?lang=it|en wins; otherwise the browser language (Italian → it, anything else → en). */
export function pickLang() {
  const asked = new URLSearchParams(location.search).get('lang');
  if (asked === 'it' || asked === 'en') return asked;
  return (navigator.language || '').toLowerCase().startsWith('it') ? 'it' : 'en';
}

export const TEXT = {
  it: {
    locale: 'it-IT',
    why: 'perché un cervello?',
    llmLink: 'dentro un LLM →',
    close: 'Chiudi',
    logToggle: 'Chiudi o apri il log',
    placeholder: 'Scrivi un obiettivo per lo sciame…',
    // Example goals: one is picked at random each time the page loads.
    goals: [
      'Spiega perché il cielo è blu a un ragazzo di 12 anni',
      'Confronta energia solare ed eolica: vantaggi, limiti e un riassunto finale',
      'Racconta in breve come è nata la stampa a caratteri mobili e perché ha cambiato l’Europa',
      'Spiega come funziona un vaccino a mRNA in cinque punti',
      'Proponi tre idee per ridurre lo spreco di cibo in una mensa scolastica',
    ],
    start: 'AVVIA',
    running: 'IN CORSO',
    notAvailable: 'n/d',
    fit: { buona: 'analogia buona', parziale: 'analogia parziale', debole: 'analogia debole' },
    wikiMore: 'approfondisci nella wiki ↗',
    card: { does: 'nello sciame', brain: 'nel cervello', holds: 'dove il paragone regge', breaks: 'dove si rompe' },
    regions: {
      planner: 'lobo frontale',
      researcher: 'lobo parietale',
      memory: 'lobo temporale',
      executor: 'corteccia motoria',
      critic: 'cingolata anteriore',
      orchestrator: 'talamo',
    },
    note: {
      useSim: (reason) => `${reason} · uso il simulatore`,
      turnstile: 'Verifica anti-bot non riuscita',
      apiDown: 'Servizio degli agenti non raggiungibile',
      refused: (status) => `Avvio rifiutato (${status})`,
      refusedWhy: (status, detail) => `Avvio rifiutato (${status}): ${detail}`,
      invalid: 'richiesta non valida',
      streamLost: 'Connessione con gli agenti interrotta',
      backendDown: 'Backend non raggiungibile',
      dailyOut: 'Esecuzioni reali di oggi esaurite',
    },
    sim: {
      plan: [
        'Raccogli le informazioni di base',
        'Approfondisci un secondo aspetto',
        'Sintetizza il contesto condiviso',
        'Scrivi la bozza della risposta',
        'Controlla qualità e coerenza',
      ],
      goal: (g) => `Obiettivo: ${g}`,
      askPlan: 'Richiesta piano',
      planning: 'Scomposizione in sotto-compiti',
      pPlan: 'piano JSON',
      planReady: (n) => `Piano pronto: ${n} sotto-compiti`,
      planSent: 'Piano consegnato',
      assign: (id, task) => `Assegna ${id}: ${task}`,
      pass: (id) => `Passa il risultato di ${id}`,
      done: (id) => `${id} completato`,
      result: (id) => `Risultato ${id}`,
      rate: 'modello occupato · riprovo tra 2 s (tentativo 1 di 3)',
      tokens: (n) => `LLM ◂ ${n} token`,
      reviseAsked: 'Revisione richiesta',
      revising: 'Revisione della bozza',
      pRevision: 'revisione',
      revised: 'Bozza rivista',
      finalVersion: 'Versione finale',
      finalReady: 'Risultato finale pronto',
      text: (goal, plan) =>
        `[SIMULATO] Nessun modello è stato chiamato.\n\nObiettivo: ${goal}\n\n` +
        'Questa sequenza di eventi è generata nel browser per provare la grafica. ' +
        `Il testo che leggi è un segnaposto, non un risultato.\n\nPiano simulato:\n${plan}`,
    },
  },
  en: {
    locale: 'en-US',
    why: 'why a brain?',
    llmLink: 'inside an LLM →',
    close: 'Close',
    logToggle: 'Close or open the log',
    placeholder: 'Write a goal for the swarm…',
    goals: [
      'Explain why the sky is blue to a 12-year-old',
      'Compare solar and wind power: advantages, limits and a short summary',
      'Tell briefly how movable-type printing began and why it changed Europe',
      'Explain how an mRNA vaccine works in five points',
      'Suggest three ideas to cut food waste in a school canteen',
    ],
    start: 'START',
    running: 'RUNNING',
    notAvailable: 'n/a',
    fit: { buona: 'good analogy', parziale: 'partial analogy', debole: 'weak analogy' },
    wikiMore: 'read more in the wiki ↗',
    card: { does: 'in the swarm', brain: 'in the brain', holds: 'where the comparison holds', breaks: 'where it breaks' },
    regions: {
      planner: 'frontal lobe',
      researcher: 'parietal lobe',
      memory: 'temporal lobe',
      executor: 'motor cortex',
      critic: 'anterior cingulate',
      orchestrator: 'thalamus',
    },
    note: {
      useSim: (reason) => `${reason} · using the simulator`,
      turnstile: 'Anti-bot check failed',
      apiDown: 'The agents service cannot be reached',
      refused: (status) => `Start refused (${status})`,
      refusedWhy: (status, detail) => `Start refused (${status}): ${detail}`,
      invalid: 'invalid request',
      streamLost: 'Connection with the agents lost',
      backendDown: 'Backend cannot be reached',
      dailyOut: 'Today’s real runs are used up',
    },
    sim: {
      plan: [
        'Gather the basic information',
        'Look into a second aspect',
        'Summarize the shared context',
        'Write the draft answer',
        'Check quality and consistency',
      ],
      goal: (g) => `Goal: ${g}`,
      askPlan: 'Plan requested',
      planning: 'Splitting into sub-tasks',
      pPlan: 'JSON plan',
      planReady: (n) => `Plan ready: ${n} sub-tasks`,
      planSent: 'Plan delivered',
      assign: (id, task) => `Assign ${id}: ${task}`,
      pass: (id) => `Passes on the result of ${id}`,
      done: (id) => `${id} done`,
      result: (id) => `Result of ${id}`,
      rate: 'model busy · retrying in 2 s (attempt 1 of 3)',
      tokens: (n) => `LLM ◂ ${n} tokens`,
      reviseAsked: 'Revision requested',
      revising: 'Revising the draft',
      pRevision: 'revision',
      revised: 'Draft revised',
      finalVersion: 'Final version',
      finalReady: 'Final result ready',
      text: (goal, plan) =>
        `[SIMULATED] No model was called.\n\nGoal: ${goal}\n\n` +
        'This sequence of events is generated in the browser to try out the graphics. ' +
        `The text you are reading is a placeholder, not a result.\n\nSimulated plan:\n${plan}`,
    },
  },
};
