// Teaching content: what each agent does, what its brain region does, where the analogy holds
// and where it breaks, in Italian and English. Kept as plain data so another page (for example a
// wiki note) can reuse it.
//
// `wiki`: URL of a section of the wiki entry "Sciame di agenti" / "Agent swarm", or null.
// A link is shown only when it is set.
// fit: how well the analogy holds: 'buona' | 'parziale' | 'debole' (also the CSS class of the tag;
// the words shown are in i18n.js).

export const WHY = {
  it: {
    title: 'perché un cervello?',
    paragraphs: [
      'Uno sciame di agenti e un cervello hanno in comune un’idea: nessuna parte sa fare tutto. Ci sono parti specializzate, e il risultato nasce dai messaggi che si scambiano.',
      'Per questo ogni agente è disegnato su una regione che svolge un lavoro simile al suo: chi pianifica sta sul lobo frontale, chi ricorda sul lobo temporale, e così via.',
      'È un’immagine per capire, non un modello del cervello. Un cervello ha circa 86 miliardi di neuroni che lavorano tutti insieme e imparano di continuo. Qui ci sono cinque ruoli che chiamano a turno un modello linguistico, e tra un’esecuzione e l’altra non imparano nulla.',
      'Anche le regioni vere non hanno confini e compiti così netti: quasi ogni funzione coinvolge più aree. Tocca un agente per vedere dove il paragone regge e dove no.',
    ],
    wiki: 'https://wiki.daniellomario.com/it/agent-swarm#lanalogia-con-il-cervello',
  },
  en: {
    title: 'why a brain?',
    paragraphs: [
      'An agent swarm and a brain share one idea: no part can do everything. There are specialized parts, and the result comes from the messages they exchange.',
      'That is why each agent is drawn on a region that does a job like its own: the one that plans sits on the frontal lobe, the one that remembers on the temporal lobe, and so on.',
      'It is a picture to help understanding, not a model of the brain. A brain has about 86 billion neurons that all work together and keep learning. Here there are five roles that take turns calling a language model, and they learn nothing from one run to the next.',
      'Real regions do not have such sharp borders and tasks either: almost every function involves several areas. Touch an agent to see where the comparison holds and where it does not.',
    ],
    wiki: 'https://wiki.daniellomario.com/agent-swarm#the-brain-analogy',
  },
};

export const ANALOGIES = {
  it: {
    planner: {
      fit: 'buona',
      does: 'Riceve l’obiettivo e lo divide in pochi sotto-compiti, decidendo chi li svolge e in che ordine.',
      brain: 'La parte anteriore del lobo frontale (corteccia prefrontale) è legata alle funzioni esecutive: fissare uno scopo, pianificare i passi, frenare le azioni fuori luogo.',
      holds: 'In entrambi i casi c’è una parte che, prima di agire, trasforma uno scopo in una sequenza di passi.',
      breaks: 'Il planner scrive il piano una volta sola, come un elenco. Nel cervello pianificare e agire si intrecciano di continuo e coinvolgono molte aree.',
      wiki: 'https://wiki.daniellomario.com/it/agent-swarm#pianificare-corteccia-prefrontale',
    },
    researcher: {
      fit: 'parziale',
      does: 'Raccoglie e ordina ciò che il modello sa su un tema. Non ha accesso al web: usa solo quello che ha imparato in addestramento.',
      brain: 'Il lobo parietale unisce le informazioni che arrivano dai sensi (tatto, posizione del corpo, spazio) e aiuta a dirigere l’attenzione.',
      holds: 'Entrambi mettono insieme informazioni sparse in un quadro che le altre parti possono usare.',
      breaks: 'Il lobo parietale lavora su ciò che i sensi percepiscono ora. Il researcher non percepisce nulla: ripesca dalla memoria del modello, e può sbagliare.',
      wiki: 'https://wiki.daniellomario.com/it/agent-swarm#raccogliere-informazioni-lobo-parietale',
    },
    memory: {
      fit: 'buona',
      does: 'Riassume i risultati raccolti in un contesto breve e condiviso, che gli agenti successivi ricevono.',
      brain: 'Nella parte interna del lobo temporale c’è l’ippocampo, necessario per formare nuovi ricordi di fatti ed eventi.',
      holds: 'Entrambi conservano ciò che è appena successo perché serva più tardi.',
      breaks: 'L’ippocampo consolida i ricordi nel tempo, cambiando le connessioni tra neuroni. Qui la memoria è un riassunto di testo che sparisce a fine esecuzione.',
      wiki: 'https://wiki.daniellomario.com/it/agent-swarm#ricordare-ippocampo',
    },
    executor: {
      fit: 'parziale',
      does: 'Scrive il risultato finale usando il materiale ricevuto, e lo riscrive se il critic chiede una revisione.',
      brain: 'La corteccia motoria primaria invia i comandi per i movimenti volontari: è l’ultimo passaggio prima dell’azione.',
      holds: 'Entrambi sono l’anello finale: trasformano ciò che è stato deciso in qualcosa di concreto.',
      breaks: 'La corteccia motoria fa parte del lobo frontale: disegnarla come regione separata è una semplificazione. E scrivere un testo richiede scelte proprie, non solo eseguire.',
      wiki: 'https://wiki.daniellomario.com/it/agent-swarm#agire-corteccia-motoria',
    },
    critic: {
      fit: 'buona',
      does: 'Rilegge la bozza, cerca errori e parti mancanti, e dà un verdetto: va bene oppure va rivista.',
      brain: 'La corteccia cingolata anteriore sta sulla faccia interna di ogni emisfero, sopra il centro del cervello. Si attiva quando commettiamo un errore o quando due risposte possibili sono in conflitto, e segnala che serve più controllo.',
      holds: 'In entrambi i casi una parte non produce il lavoro ma lo sorveglia: si accorge che qualcosa non va e fa correggere.',
      breaks: 'Il critic legge la bozza solo alla fine, una volta. La cingolata anteriore controlla di continuo, in frazioni di secondo, e ha anche altri compiti, legati al dolore e alle emozioni.',
      wiki: 'https://wiki.daniellomario.com/it/agent-swarm#controllare-corteccia-cingolata-anteriore',
    },
    orchestrator: {
      fit: 'parziale',
      does: 'Smista il lavoro: chiede il piano, assegna i sotto-compiti rispettando le dipendenze, passa i risultati, chiude. È codice normale, non un modello.',
      brain: 'Al centro del cervello c’è il talamo, una stazione di smistamento: quasi tutti i segnali dei sensi passano da lì prima di arrivare alla corteccia.',
      holds: 'In entrambi i casi quasi tutti i messaggi passano da un punto centrale che li instrada.',
      breaks: 'Il talamo instrada ma non comanda: il cervello non ha un capo unico. L’orchestratore invece decide tutto, con regole fisse scritte da un programmatore.',
      wiki: 'https://wiki.daniellomario.com/it/agent-swarm#coordinare-talamo',
    },
  },
  en: {
    planner: {
      fit: 'buona',
      does: 'Receives the goal and splits it into a few sub-tasks, deciding who does them and in what order.',
      brain: 'The front part of the frontal lobe (prefrontal cortex) is linked to executive functions: setting a goal, planning the steps, holding back actions that do not fit.',
      holds: 'In both cases there is a part that, before acting, turns a goal into a sequence of steps.',
      breaks: 'The planner writes the plan only once, as a list. In the brain, planning and acting are interwoven all the time and involve many areas.',
      wiki: 'https://wiki.daniellomario.com/agent-swarm#planning-prefrontal-cortex',
    },
    researcher: {
      fit: 'parziale',
      does: 'Gathers and arranges what the model knows about a topic. It has no web access: it uses only what it learned in training.',
      brain: 'The parietal lobe combines the information that comes from the senses (touch, body position, space) and helps direct attention.',
      holds: 'Both bring scattered information together into a picture the other parts can use.',
      breaks: 'The parietal lobe works on what the senses perceive right now. The researcher perceives nothing: it fishes from the model’s memory, and it can be wrong.',
      wiki: 'https://wiki.daniellomario.com/agent-swarm#gathering-information-parietal-lobe',
    },
    memory: {
      fit: 'buona',
      does: 'Summarizes the results gathered so far into a short, shared context that the later agents receive.',
      brain: 'In the inner part of the temporal lobe sits the hippocampus, which is needed to form new memories of facts and events.',
      holds: 'Both keep what has just happened so that it can be used later.',
      breaks: 'The hippocampus consolidates memories over time by changing the connections between neurons. Here the memory is a text summary that disappears at the end of the run.',
      wiki: 'https://wiki.daniellomario.com/agent-swarm#remembering-hippocampus',
    },
    executor: {
      fit: 'parziale',
      does: 'Writes the final result from the material it receives, and rewrites it if the critic asks for a revision.',
      brain: 'The primary motor cortex sends the commands for voluntary movements: it is the last step before action.',
      holds: 'Both are the final link: they turn what has been decided into something concrete.',
      breaks: 'The motor cortex is part of the frontal lobe: drawing it as a separate region is a simplification. And writing a text takes choices of its own, not just carrying out orders.',
      wiki: 'https://wiki.daniellomario.com/agent-swarm#acting-motor-cortex',
    },
    critic: {
      fit: 'buona',
      does: 'Rereads the draft, looks for mistakes and missing parts, and gives a verdict: fine, or needs revising.',
      brain: 'The anterior cingulate cortex lies on the inner face of each hemisphere, above the middle of the brain. It becomes active when we make a mistake or when two possible responses conflict, and it signals that more control is needed.',
      holds: 'In both cases a part does not produce the work but watches over it: it notices that something is wrong and gets it corrected.',
      breaks: 'The critic reads the draft only at the end, once. The anterior cingulate checks all the time, in fractions of a second, and has other jobs too, linked to pain and emotion.',
      wiki: 'https://wiki.daniellomario.com/agent-swarm#checking-anterior-cingulate-cortex',
    },
    orchestrator: {
      fit: 'parziale',
      does: 'Routes the work: asks for the plan, hands out the sub-tasks respecting their dependencies, passes results along, closes the run. It is ordinary code, not a model.',
      brain: 'At the centre of the brain is the thalamus, a sorting station: almost all signals from the senses pass through it before reaching the cortex.',
      holds: 'In both cases almost every message passes through a central point that routes it.',
      breaks: 'The thalamus routes but does not command: the brain has no single boss. The orchestrator instead decides everything, with fixed rules written by a programmer.',
      wiki: 'https://wiki.daniellomario.com/agent-swarm#coordinating-thalamus',
    },
  },
};
