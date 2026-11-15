// The guided tour: one step per idea. `focus` lists the slabs to light up (ids or id prefixes,
// see buildLayout in scene.js); null lights everything. Texts get the model's real numbers.

export const WIKI_URL = 'https://wiki.daniellomario.com/it/LLM-inference';

/** @param {{n_embd: number, n_head: number, n_layer: number, block: number, vocab: string}} c @param {{params: number, words: number}} info */
export function buildTour(c, info) {
  const params = info.params.toLocaleString('it-IT'), words = info.words.toLocaleString('it-IT');
  return [
    {
      title: 'Dentro un LLM',
      focus: null,
      along: true,
      text: [
        `Questo è un modello linguistico vero, solo minuscolo: ${params} parametri contro i miliardi dei modelli che usi di solito. Il calcolo avviene adesso, nel tuo browser.`,
        `Ha letto le ${words} parole diverse della Divina Commedia e ha imparato un solo compito: data una parola iniziata, indovinare la lettera che viene dopo.`,
        'Ogni cubetto è un numero. Verde è positivo, azzurro è negativo, più alto e luminoso vuol dire più grande. Passa il mouse su un cubetto per leggerlo.',
        'Non conosce il significato delle parole: ne ha imparato solo il suono. Per questo ne inventa di nuove che sembrano di Dante.',
      ],
    },
    {
      title: '1 · Lettere che diventano numeri',
      focus: ['tok'],
      text: [
        'Un modello lavora solo con numeri. Il testo viene diviso in pezzi chiamati token: qui un token è una lettera, e il punto segna l’inizio e la fine della parola.',
        `Ogni token ha una riga in una tabella imparata durante l’addestramento: ${c.n_embd} numeri, il suo vettore. Lettere usate in modo simile finiscono con vettori simili.`,
        'Nei modelli grandi un token è un pezzo di parola e il vocabolario ne contiene decine di migliaia. Il principio è lo stesso.',
      ],
    },
    {
      title: '2 · Dove si trova ogni lettera',
      focus: ['pos', 'x0'],
      text: [
        'Così com’è, il modello non saprebbe l’ordine delle lettere: «roma» e «amor» gli sembrerebbero uguali.',
        'Per questo a ogni vettore si somma un secondo vettore, che dipende solo dalla posizione: prima, seconda, terza lettera.',
        'La somma è ciò che entra nel modello.',
      ],
    },
    {
      title: '3 · Le corsie',
      focus: ['x0', 'l0.x1', 'l0.x2', 'l1.x1', 'l1.x2'],
      along: true,
      text: [
        'Ogni lettera ha la sua corsia, che attraversa tutto il modello. In gergo si chiama flusso residuo.',
        'I blocchi che seguono non sostituiscono il contenuto della corsia: ci aggiungono qualcosa. Sono i ponti che vedi sopra, e ogni ponte riscende per sommarsi.',
        'È un’idea semplice ma decisiva: permette di impilare molti strati senza che l’informazione iniziale si perda.',
      ],
    },
    {
      title: '4 · Rimettere in scala',
      focus: ['l0.ln1'],
      text: [
        'Prima di ogni ponte i numeri di ciascuna corsia vengono normalizzati: si toglie la media e si divide per quanto sono sparsi.',
        'Non aggiunge informazione. Serve a tenere i valori in un intervallo comodo, e rende l’addestramento stabile.',
      ],
    },
    {
      title: '5 · Tre domande per ogni lettera',
      focus: ['l0.q', 'l0.k', 'l0.v'],
      text: [
        'Qui comincia l’attenzione, l’unico punto in cui le corsie si parlano. Ogni lettera produce tre vettori.',
        'Query: che cosa sto cercando nelle altre lettere. Key: che cosa ho da offrire. Value: che cosa passo a chi mi sceglie.',
        `Tutto questo avviene ${c.n_head} volte in parallelo, in ${c.n_head} «teste» che imparano a cercare cose diverse: ogni testa usa un terzo dei numeri.`,
      ],
    },
    {
      title: '6 · Chi guarda chi',
      focus: ['l0.att'],
      text: [
        'Si confronta la query di ogni lettera con la key di tutte le lettere precedenti: più si somigliano, più il punteggio è alto. I punteggi di ogni riga diventano percentuali che sommano a 100.',
        'Ogni quadrato è una testa. La riga è la lettera che guarda, la colonna quella guardata.',
        'Metà del quadrato è vuota: una lettera non può guardare quelle che vengono dopo. È ciò che permette al modello di scrivere una lettera alla volta.',
      ],
    },
    {
      title: '7 · Le corsie si scambiano informazioni',
      focus: ['l0.mix', 'l0.aout', 'l0.x1'],
      text: [
        'Ogni lettera raccoglie i value delle lettere che ha guardato, in proporzione alle percentuali. Gli archi mostrano quanto l’ultima lettera prende da ciascuna delle altre.',
        'Il risultato viene rimescolato e sommato alla corsia. Ora ogni corsia sa qualcosa delle lettere che la precedono.',
      ],
    },
    {
      title: '8 · Elaborare, ognuna per sé',
      focus: ['l0.ln2', 'l0.hid', 'l0.mlp', 'l0.x2'],
      text: [
        `Il secondo ponte è una piccola rete neurale (MLP), applicata a ogni corsia separatamente. Allarga i ${c.n_embd} numeri a ${4 * c.n_embd}, spegne quelli negativi, poi li riporta a ${c.n_embd}.`,
        'Se l’attenzione raccoglie informazioni, qui il modello le usa: è dove sta la maggior parte dei suoi parametri.',
        'Anche questo risultato si somma alla corsia.',
      ],
    },
    {
      title: '9 · Di nuovo, più in profondità',
      focus: ['l1'],
      along: true,
      text: [
        `Attenzione e MLP formano uno strato. Questo modello ne ha ${c.n_layer}; quelli grandi ne hanno decine.`,
        'Il secondo strato fa le stesse operazioni con parametri diversi, e lavora su corsie già arricchite dal primo. Strato dopo strato le combinazioni diventano più astratte.',
      ],
    },
    {
      title: '10 · Un punteggio per ogni lettera',
      focus: ['lnf', 'logits', 'probs'],
      text: [
        `Alla fine ogni corsia viene trasformata in ${c.vocab.length} punteggi, uno per ogni lettera possibile. Si chiamano logit.`,
        'Per indovinare la prossima lettera conta solo l’ultima corsia. I suoi punteggi diventano probabilità: le barre alte in fondo.',
        'Il modello quindi non «sceglie una lettera»: dà una probabilità a tutte.',
      ],
    },
    {
      title: '11 · Scrivere, una lettera alla volta',
      focus: ['probs'],
      text: [
        'Si pesca una lettera secondo le probabilità, la si aggiunge al testo, e tutto il calcolo riparte con una corsia in più. È il ciclo autoregressivo: un LLM scrive così, un token alla volta.',
        'Prova in basso. La temperatura regola il rischio: bassa sceglie quasi sempre la lettera più probabile, alta rende le scelte più varie.',
        'Qui a ogni lettera si ricalcola tutto. I sistemi veri conservano i conti già fatti per le corsie precedenti: è la cache KV.',
      ],
      link: { href: WIKI_URL, text: 'continua nella wiki: inferenza degli LLM ↗' },
    },
  ];
}
