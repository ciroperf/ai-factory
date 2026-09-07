# Officina Agenti — control plane

Questo file viene letto a ogni run. Resta corto: ogni riga costa token
in ognuna delle run di ogni agente.

## Regole valide per tutti gli agenti

1. **Mai push su `main`.** Lavora solo sul tuo branch, apri una PR, fermati.
2. **Mai fare merge.** Il merge lo fa una persona.
3. **Se il compito non e' chiaro, commenta la domanda e fermati.** Non
   indovinare: una domanda costa cento volte meno di una PR sbagliata.
4. **Leggi in modo mirato.** Usa Grep e Glob per trovare il punto giusto,
   non leggere file interi "per contesto". Non aprire mai `node_modules`,
   `.next`, `dist`, `build`, `public/images`, `*.lock`.
5. **Un compito, una PR.** Non allargare lo scope: se noti altro da fare,
   scrivilo nella descrizione della PR invece di farlo.
6. **Niente segreti nel codice.** Nessuna chiave, nessun token, nemmeno
   negli esempi.

## Struttura del repo

- `config.yml` — configurazione unica del sistema. Non modificarlo se non
  te lo chiede esplicitamente il compito.
- `state/projects.json` — registro dei progetti. Aggiornalo quando cambia
  la fase di un progetto (`idea | planned | building | review | published`).
- `state/feed.md` — digest delle release, generato da uno script prima
  della run dello Scout.
- `prompts/` — le istruzioni dei singoli agenti.
- `learnings/` — output dell'agente Mentor, uno per progetto.
- `docs/` — la PWA di controllo, pubblicata su GitHub Pages. E' vanilla
  JS senza build e senza dipendenze: mantienila cosi'.

## Stile

Commenti e messaggi di commit in italiano. Codice, nomi di variabili e
identificatori in inglese. Messaggi di commit in forma imperativa, una riga.
