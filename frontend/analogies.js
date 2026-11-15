// Teaching content: what each agent does, what its brain region does, where the analogy holds
// and where it breaks. Kept as plain data so another page (for example a wiki note) can reuse it.
//
// `wiki`: URL of a page with more detail, or null. A link is shown only when it is set.

export const WHY = {
  title: 'perché un cervello?',
  paragraphs: [
    'Uno sciame di agenti e un cervello hanno in comune un’idea: nessuna parte sa fare tutto. Ci sono parti specializzate, e il risultato nasce dai messaggi che si scambiano.',
    'Per questo ogni agente è disegnato su una regione che svolge un lavoro simile al suo: chi pianifica sta sul lobo frontale, chi ricorda sul lobo temporale, e così via.',
    'È un’immagine per capire, non un modello del cervello. Un cervello ha circa 86 miliardi di neuroni che lavorano tutti insieme e imparano di continuo. Qui ci sono cinque ruoli che chiamano a turno un modello linguistico, e tra un’esecuzione e l’altra non imparano nulla.',
    'Anche le regioni vere non hanno confini e compiti così netti: quasi ogni funzione coinvolge più aree. Tocca un agente per vedere dove il paragone regge e dove no.',
  ],
  wiki: null,
};

// fit: how well the analogy holds: 'buona' | 'parziale' | 'debole'
export const ANALOGIES = {
  planner: {
    fit: 'buona',
    does: 'Riceve l’obiettivo e lo divide in pochi sotto-compiti, decidendo chi li svolge e in che ordine.',
    brain: 'La parte anteriore del lobo frontale (corteccia prefrontale) è legata alle funzioni esecutive: fissare uno scopo, pianificare i passi, frenare le azioni fuori luogo.',
    holds: 'In entrambi i casi c’è una parte che, prima di agire, trasforma uno scopo in una sequenza di passi.',
    breaks: 'Il planner scrive il piano una volta sola, come un elenco. Nel cervello pianificare e agire si intrecciano di continuo e coinvolgono molte aree.',
    wiki: null,
  },
  researcher: {
    fit: 'parziale',
    does: 'Raccoglie e ordina ciò che il modello sa su un tema. Non ha accesso al web: usa solo quello che ha imparato in addestramento.',
    brain: 'Il lobo parietale unisce le informazioni che arrivano dai sensi (tatto, posizione del corpo, spazio) e aiuta a dirigere l’attenzione.',
    holds: 'Entrambi mettono insieme informazioni sparse in un quadro che le altre parti possono usare.',
    breaks: 'Il lobo parietale lavora su ciò che i sensi percepiscono ora. Il researcher non percepisce nulla: ripesca dalla memoria del modello, e può sbagliare.',
    wiki: null,
  },
  memory: {
    fit: 'buona',
    does: 'Riassume i risultati raccolti in un contesto breve e condiviso, che gli agenti successivi ricevono.',
    brain: 'Nella parte interna del lobo temporale c’è l’ippocampo, necessario per formare nuovi ricordi di fatti ed eventi.',
    holds: 'Entrambi conservano ciò che è appena successo perché serva più tardi.',
    breaks: 'L’ippocampo consolida i ricordi nel tempo, cambiando le connessioni tra neuroni. Qui la memoria è un riassunto di testo che sparisce a fine esecuzione.',
    wiki: null,
  },
  executor: {
    fit: 'parziale',
    does: 'Scrive il risultato finale usando il materiale ricevuto, e lo riscrive se il critic chiede una revisione.',
    brain: 'La corteccia motoria primaria invia i comandi per i movimenti volontari: è l’ultimo passaggio prima dell’azione.',
    holds: 'Entrambi sono l’anello finale: trasformano ciò che è stato deciso in qualcosa di concreto.',
    breaks: 'La corteccia motoria fa parte del lobo frontale: disegnarla come regione separata è una semplificazione. E scrivere un testo richiede scelte proprie, non solo eseguire.',
    wiki: null,
  },
  critic: {
    fit: 'buona',
    does: 'Rilegge la bozza, cerca errori e parti mancanti, e dà un verdetto: va bene oppure va rivista.',
    brain: 'La corteccia cingolata anteriore sta sulla faccia interna di ogni emisfero, sopra il centro del cervello. Si attiva quando commettiamo un errore o quando due risposte possibili sono in conflitto, e segnala che serve più controllo.',
    holds: 'In entrambi i casi una parte non produce il lavoro ma lo sorveglia: si accorge che qualcosa non va e fa correggere.',
    breaks: 'Il critic legge la bozza solo alla fine, una volta. La cingolata anteriore controlla di continuo, in frazioni di secondo, e ha anche altri compiti, legati al dolore e alle emozioni.',
    wiki: null,
  },
  orchestrator: {
    fit: 'parziale',
    does: 'Smista il lavoro: chiede il piano, assegna i sotto-compiti rispettando le dipendenze, passa i risultati, chiude. È codice normale, non un modello.',
    brain: 'Al centro del cervello c’è il talamo, una stazione di smistamento: quasi tutti i segnali dei sensi passano da lì prima di arrivare alla corteccia.',
    holds: 'In entrambi i casi quasi tutti i messaggi passano da un punto centrale che li instrada.',
    breaks: 'Il talamo instrada ma non comanda: il cervello non ha un capo unico. L’orchestratore invece decide tutto, con regole fisse scritte da un programmatore.',
    wiki: null,
  },
};
