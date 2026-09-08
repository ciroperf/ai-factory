# Tris (tic-tac-toe): 1v1 locale o contro CPU

**In una riga:** tris giocabile nel browser, 1v1 locale o contro una CPU che
gioca a caso, senza framework ne' build — progetto vetrina per l'Officina
Agenti.

## Le tre cose che contano

1. **Logica di gioco separata dal DOM** (`src/game.js` non tocca mai
   `document`). Scelta contro l'alternativa piu' rapida di scrivere tutto
   dentro `app.js`: qui la separazione ha permesso di testare vittorie,
   pareggi e mosse invalide con `node --test` senza toccare un browser
   (`test/game.test.js`, 8 test). E' la decisione che rende il progetto
   testabile, non un vezzo architetturale.

2. **`makeMove` ritorna una board nuova invece di mutare quella passata**
   (`src/game.js`, `makeMove`). Contro la mutazione diretta dell'array. Il
   motivo tecnico e' verificato dal test stesso
   (`makeMove ritorna una nuova board senza mutare l'originale`,
   `test/game.test.js`), ma nel codice non c'e' una riga che spieghi
   *perche'* servisse l'immutabilita' qui (nessun altro punto del codice
   dipende dalla vecchia board dopo la mossa). E' plausibile che la scelta
   serva a rendere `game.js` piu' facile da testare in isolamento, ma questo
   non e' scritto da nessuna parte — va detto in colloquio come inferenza,
   non come fatto documentato.

3. **CPU con mossa casuale, non minimax** (`src/ai.js`, `getCpuMove`). Scelta
   di default: il PR #12 non motiva perche' non e' stato implementato un
   avversario "intelligente" (minimax/alpha-beta), semplicemente sceglie
   un indice libero a caso tra le celle disponibili. Nessuna menzione nel
   codice o nel PR di limiti di tempo, di scope o di difficolta' voluta.

## Concetti che devi saper spiegare

- **Rappresentazione della board come array piatto di 9 celle** invece di
  matrice 3x3, con le combinazioni vincenti precalcolate in
  `WINNING_LINES` (`src/game.js`). Semplifica `checkWinner` a un loop su 8
  triplette fisse invece di controllare righe/colonne/diagonali con
  indici 2D.
- **Macchina a stati minimale nel modulo UI**: `mode`, `board`,
  `currentPlayer`, `winner` sono variabili module-level in `src/app.js`,
  aggiornate da `applyMove`/`handleReset`/`handleModeSelect` e seguite
  sempre da una chiamata a `render()` che ridisegna tutto da zero
  (re-render completo, non un diff del DOM).
- **`isCpuTurn()` come guardia doppia** (`src/app.js`): usata sia per
  disabilitare le celle nel render (`button.disabled = ... || isCpuTurn()`)
  sia per bloccare `handleCellClick`. Se la si rimuove da uno dei due punti,
  il giocatore umano puo' giocare al posto della CPU cliccando in fretta.
- **Turno della CPU incatenato dentro `handleCellClick`**
  (`src/app.js`, `playCpuMove` chiamato subito dopo `applyMove` se
  `isCpuTurn()` e' vero): non c'e' un ciclo di gioco o un `setTimeout`,
  la mossa della CPU e' sincrona e immediata dopo quella del giocatore.
- **Persistenza zero**: `mode`, `board` e tutto lo stato vivono solo in
  memoria JS; un refresh della pagina azzera tutto, compresa la modalita'
  scelta (`src/app.js`, variabili module-level, nessun `localStorage`).

## Domande da colloquio a cui ora sai rispondere

- **Perche' la board e' un array di 9 elementi invece di una matrice 3x3?**
  Perche' semplifica il controllo del vincitore: `WINNING_LINES` elenca le
  8 triplette di indici vincenti e `checkWinner` (`src/game.js`) le scorre
  con un solo loop, senza gestire righe/colonne/diagonali come casi
  separati.

- **Come fai a testare la logica di gioco senza un browser?**
  `game.js` e `ai.js` non importano ne' toccano `document`: ricevono la
  board come argomento e ritornano un risultato. `node --test` importa
  direttamente questi moduli (`test/game.test.js`, `test/ai.test.js`) e li
  chiama come funzioni pure.

- **Cosa succede se un giocatore clicca due volte di fretta durante il
  turno della CPU?**
  Niente: `handleCellClick` controlla `isCpuTurn()` e ritorna subito senza
  applicare la mossa, e le celle sono gia' disabilitate via `button.disabled`
  nel render. La doppia guardia (render + handler) e' li' apposta.

- **Perche' `makeMove` lancia un'eccezione invece di ignorare la mossa in
  silenzio su una cella occupata?**
  Nel codice non c'e' motivazione esplicita. In pratica l'eccezione non e'
  mai raggiungibile da `app.js`, perche' l'interfaccia disabilita gia' le
  celle occupate prima del click: la guardia vera e' nell'UI, l'eccezione in
  `game.js` e' un secondo livello di difesa per chi chiama la funzione
  direttamente (es. i test).

- **La CPU e' imbattibile o battibile?** Battibile sempre: sceglie una
  cella libera a caso (`Math.random()` in `getCpuMove`, `src/ai.js`), non
  valuta mai la board per bloccare o vincere. Contro un giocatore che gioca
  bene, la CPU perde quasi sempre.

## Cosa NON copre

- **Nessuna CPU "intelligente"**: non c'e' minimax, non c'e' euristica di
  blocco/vittoria, non c'e' alcuna valutazione della board. Una domanda
  classica da colloquio ("come implementeresti un avversario imbattibile?")
  non trova risposta nel codice: andrebbe discussa a parte (minimax con
  potatura alpha-beta, dato che la board e' piccola e l'albero e'
  interamente esplorabile).
- **Nessuna persistenza o storico partite**: niente punteggio cumulativo,
  niente `localStorage`, niente replay delle mosse.
- **Nessuna gestione di più partite in rete o multiplayer remoto**: il
  "1v1 locale" e' due persone sulla stessa tastiera/schermo, non due client
  connessi.
- **Nessun test end-to-end automatizzato**: la copertura DOM/interazione
  (`app.js`) e' stata verificata solo manualmente con Playwright durante lo
  sviluppo (citato nei PR), ma non esiste un test headless nel repository —
  `node --test` copre solo `game.js` e `ai.js`.
- **Nessuna gestione di accessibilita' esplicita**: non ci sono `aria-label`
  o attributi per screen reader sulle celle del tabellone; se chiesto in
  colloquio va detto chiaramente che non e' stato considerato.
- **Cambio modalita' a partita in corso**: per tornare alla schermata di
  scelta modalita' serve ricaricare la pagina (`README.md`, sezione stato
  del progetto); non c'e' un pulsante dedicato.

## Prossimo passo per imparare

Sostituire `getCpuMove` con un minimax (con o senza potatura alpha-beta):
la board e' piccola (max 9 celle, profondita' massima 9), quindi e' un
esercizio pratico e completabile per capire ricorsione, valutazione dello
stato terminale e differenza tra scegliere-a-caso e scegliere-ottimo,
riusando `checkWinner` e `makeMove` gia' esistenti in `game.js` senza
toccarli.
