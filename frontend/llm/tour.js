// The guided tour: one step per idea. `focus` lists the slabs to light up (ids or id prefixes,
// see buildLayout in scene.js); null lights everything. Texts get the model's real numbers.
import { LINKS } from './links.js';

/**
 * @param {{n_embd: number, n_head: number, n_layer: number, block: number, vocab: string}} c
 * @param {{params: number, verses: number}} info
 * @param {'it'|'en'} lang
 */
export function buildTour(c, info, lang) {
  const n = (v) => v.toLocaleString(lang === 'it' ? 'it-IT' : 'en-US');
  const texts = lang === 'it' ? italian(c, n(info.params), n(info.verses)) : english(c, n(info.params), n(info.verses));
  // `id` names the step for the block diagram (diagram.js), which lights up the blocks of each step.
  const steps = [
    { id: 'intro', focus: null, along: true },
    { id: 'tok', focus: ['tok'] },
    { id: 'pos', focus: ['pos', 'x0'] },
    { id: 'res', focus: ['x0', 'l0.x1', 'l0.x2', 'l1.x1', 'l1.x2'], along: true },
    { id: 'ln', focus: ['l0.ln1'] },
    { id: 'qkv', focus: ['l0.q', 'l0.k', 'l0.v'] },
    { id: 'att', focus: ['l0.att'] },
    { id: 'mix', focus: ['l0.mix', 'l0.aout', 'l0.x1'] },
    { id: 'mlp', focus: ['l0.ln2', 'l0.hid', 'l0.mlp', 'l0.x2'] },
    { id: 'layers', focus: ['l1'], along: true },
    { id: 'logits', focus: ['lnf', 'logits', 'probs'] },
    { id: 'sample', focus: ['probs'], link: { href: LINKS.wiki[lang], text: texts.linkText } },
  ];
  return steps.map((step, i) => ({ ...step, title: texts.steps[i][0], text: texts.steps[i].slice(1) }));
}

function italian(c, params, verses) {
  return {
    linkText: 'continua nella wiki: inferenza degli LLM ↗',
    steps: [
      [
        'Dentro un LLM',
        `Questo è un modello linguistico vero, solo minuscolo: ${params} parametri contro i miliardi dei modelli che usi di solito. Il calcolo avviene adesso, nel tuo browser.`,
        `Ha letto ${verses} versi della Divina Commedia e ha imparato un solo compito: dato l’inizio di un verso, indovinare la lettera che viene dopo. Anche lo spazio tra le parole conta come una lettera.`,
        'Ogni cubetto è un numero. Verde è positivo, azzurro è negativo, più alto e luminoso vuol dire più grande. Passa il mouse su un cubetto per leggerlo.',
        'Non conosce il significato di niente: ha imparato solo come suonano le parole e quali tendono a seguirsi. Per questo scrive versi che sembrano di Dante ma non vogliono dire nulla, e spesso inventa parole.',
      ],
      [
        '1 · Lettere che diventano numeri',
        'Un modello lavora solo con numeri. Il testo viene diviso in pezzi chiamati token: qui un token è una lettera o uno spazio (␣), e il punto segna l’inizio e la fine del verso.',
        `Ogni token ha una riga in una tabella imparata durante l’addestramento: ${c.n_embd} numeri, il suo vettore. Lettere usate in modo simile finiscono con vettori simili.`,
        'Nei modelli grandi un token è un pezzo di parola e il vocabolario ne contiene decine di migliaia. Il principio è lo stesso.',
      ],
      [
        '2 · Dove si trova ogni lettera',
        'Così com’è, il modello non saprebbe l’ordine delle lettere: «roma» e «amor» gli sembrerebbero uguali.',
        'Per questo a ogni vettore si somma un secondo vettore, che dipende solo dalla posizione: prima, seconda, terza lettera.',
        'La somma è ciò che entra nel modello.',
      ],
      [
        '3 · Le corsie',
        'Ogni lettera ha la sua corsia, che attraversa tutto il modello. In gergo si chiama flusso residuo.',
        'I blocchi che seguono non sostituiscono il contenuto della corsia: ci aggiungono qualcosa. Sono i ponti che vedi sopra, e ogni ponte riscende per sommarsi.',
        'È un’idea semplice ma decisiva: permette di impilare molti strati senza che l’informazione iniziale si perda.',
      ],
      [
        '4 · Rimettere in scala',
        'Prima di ogni ponte i numeri di ciascuna corsia vengono normalizzati: si toglie la media e si divide per quanto sono sparsi.',
        'Non aggiunge informazione. Serve a tenere i valori in un intervallo comodo, e rende l’addestramento stabile.',
      ],
      [
        '5 · Tre domande per ogni lettera',
        'Qui comincia l’attenzione, l’unico punto in cui le corsie si parlano. Ogni lettera produce tre vettori.',
        'Query: che cosa sto cercando nelle altre lettere. Key: che cosa ho da offrire. Value: che cosa passo a chi mi sceglie.',
        `Tutto questo avviene ${c.n_head} volte in parallelo, in ${c.n_head} «teste» che imparano a cercare cose diverse: ogni testa usa un terzo dei numeri.`,
      ],
      [
        '6 · Chi guarda chi',
        'Si confronta la query di ogni lettera con la key di tutte le lettere precedenti: più si somigliano, più il punteggio è alto. I punteggi di ogni riga diventano percentuali che sommano a 100.',
        'Ogni quadrato è una testa. La riga è la lettera che guarda, la colonna quella guardata.',
        'Metà del quadrato è vuota: una lettera non può guardare quelle che vengono dopo. È ciò che permette al modello di scrivere una lettera alla volta.',
      ],
      [
        '7 · Le corsie si scambiano informazioni',
        'Ogni lettera raccoglie i value delle lettere che ha guardato, in proporzione alle percentuali. Gli archi mostrano quanto l’ultima lettera prende da ciascuna delle altre.',
        'Il risultato viene rimescolato e sommato alla corsia. Ora ogni corsia sa qualcosa delle lettere che la precedono.',
      ],
      [
        '8 · Elaborare, ognuna per sé',
        `Il secondo ponte è una piccola rete neurale (MLP), applicata a ogni corsia separatamente. Allarga i ${c.n_embd} numeri a ${4 * c.n_embd}, spegne quelli negativi, poi li riporta a ${c.n_embd}.`,
        'Se l’attenzione raccoglie informazioni, qui il modello le usa: è dove sta la maggior parte dei suoi parametri.',
        'Anche questo risultato si somma alla corsia.',
      ],
      [
        '9 · Di nuovo, più in profondità',
        `Attenzione e MLP formano uno strato. Questo modello ne ha ${c.n_layer}; quelli grandi ne hanno decine.`,
        'Il secondo strato fa le stesse operazioni con parametri diversi, e lavora su corsie già arricchite dal primo. Strato dopo strato le combinazioni diventano più astratte.',
      ],
      [
        '10 · Un punteggio per ogni lettera',
        `Alla fine ogni corsia viene trasformata in ${c.vocab.length} punteggi, uno per ogni token possibile: le lettere, lo spazio e il punto finale. Si chiamano logit.`,
        'Per indovinare la prossima lettera conta solo l’ultima corsia. I suoi punteggi diventano probabilità: le barre alte in fondo.',
        'Il modello quindi non «sceglie una lettera»: dà una probabilità a tutte.',
      ],
      [
        '11 · Scrivere, una lettera alla volta',
        'Si pesca una lettera secondo le probabilità, la si aggiunge al testo, e tutto il calcolo riparte con una corsia in più. È il ciclo autoregressivo: un LLM scrive così, un token alla volta.',
        'Prova in basso. La temperatura regola il rischio: bassa sceglie quasi sempre la lettera più probabile, alta rende le scelte più varie.',
        'Qui a ogni lettera si ricalcola tutto. I sistemi veri conservano i conti già fatti per le corsie precedenti: è la cache KV.',
      ],
    ],
  };
}

function english(c, params, verses) {
  return {
    linkText: 'continue in the wiki: LLM inference ↗',
    steps: [
      [
        'Inside an LLM',
        `This is a real language model, just a tiny one: ${params} parameters, against the billions of the models you usually use. The computation runs right now, in your browser.`,
        `It has read ${verses} verses of Dante’s Divine Comedy, in Italian, and learned a single task: given the start of a verse, guess the next letter. The space between words counts as a letter too.`,
        'Every small cube is a number. Green is positive, blue is negative, and taller and brighter means larger. Hover over a cube to read it.',
        'It does not know what anything means: it has only learned how words sound and which ones tend to follow each other. That is why it writes verses that sound like Dante’s but mean nothing, and often invents words.',
      ],
      [
        '1 · Letters become numbers',
        'A model works only with numbers. The text is split into pieces called tokens: here a token is one letter or a space (␣), and the dot marks the start and the end of a verse.',
        `Each token has a row in a table learned during training: ${c.n_embd} numbers, its vector. Letters used in similar ways end up with similar vectors.`,
        'In large models a token is a piece of a word, and the vocabulary holds tens of thousands of them. The principle is the same.',
      ],
      [
        '2 · Where each letter is',
        'As it stands, the model would not know the order of the letters: “roma” and “amor” would look the same to it.',
        'So a second vector is added to each one, and it depends only on the position: first, second, third letter.',
        'The sum is what enters the model.',
      ],
      [
        '3 · The lanes',
        'Each letter has its own lane, which runs through the whole model. It is called the residual stream.',
        'The blocks that follow do not replace what is in the lane: they add something to it. They are the bridges you see above, and each bridge comes back down to be added in.',
        'It is a simple idea but a decisive one: it lets many layers be stacked without losing the original information.',
      ],
      [
        '4 · Back to scale',
        'Before each bridge, the numbers of each lane are normalized: the mean is subtracted and the result is divided by how spread out they are.',
        'It adds no information. It keeps the values in a convenient range and makes training stable.',
      ],
      [
        '5 · Three questions for each letter',
        'Attention starts here: it is the only place where the lanes talk to each other. Each letter produces three vectors.',
        'Query: what I am looking for in the other letters. Key: what I have to offer. Value: what I pass on to whoever picks me.',
        `All of this happens ${c.n_head} times in parallel, in ${c.n_head} “heads” that learn to look for different things: each head uses a third of the numbers.`,
      ],
      [
        '6 · Who looks at whom',
        'The query of each letter is compared with the key of every earlier letter: the more alike they are, the higher the score. The scores of each row become percentages that add up to 100.',
        'Each square is one head. The row is the letter that looks, the column is the letter it looks at.',
        'Half of each square is empty: a letter cannot look at the letters after it. This is what lets the model write one letter at a time.',
      ],
      [
        '7 · The lanes exchange information',
        'Each letter collects the values of the letters it looked at, in proportion to the percentages. The arcs show how much the last letter takes from each of the others.',
        'The result is mixed once more and added to the lane. Now each lane knows something about the letters before it.',
      ],
      [
        '8 · Processing, each on its own',
        `The second bridge is a small neural network (MLP), applied to each lane separately. It widens the ${c.n_embd} numbers to ${4 * c.n_embd}, switches off the negative ones, then brings them back to ${c.n_embd}.`,
        'If attention gathers information, this is where the model uses it: most of its parameters are here.',
        'This result is added to the lane as well.',
      ],
      [
        '9 · Again, deeper',
        `Attention and MLP together make one layer. This model has ${c.n_layer}; large ones have dozens.`,
        'The second layer does the same operations with different parameters, on lanes already enriched by the first. Layer after layer, the combinations become more abstract.',
      ],
      [
        '10 · A score for each letter',
        `At the end each lane is turned into ${c.vocab.length} scores, one for every possible token: the letters, the space and the end mark. They are called logits.`,
        'To guess the next letter only the last lane counts. Its scores become probabilities: the tall bars at the end.',
        'So the model does not “choose a letter”: it gives a probability to all of them.',
      ],
      [
        '11 · Writing, one letter at a time',
        'A letter is drawn according to the probabilities, added to the text, and the whole computation starts again with one more lane. This is the autoregressive loop: an LLM writes like this, one token at a time.',
        'Try it below. The temperature sets the risk: low almost always picks the most likely letter, high makes the choices more varied.',
        'Here everything is recomputed for every letter. Real systems keep the work already done for the earlier lanes: that is the KV cache.',
      ],
    ],
  };
}
