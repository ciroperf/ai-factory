# Officina Agenti

Agenti AI che portano avanti progetti personali su GitHub, aprono PR sui repo,
pubblicano sul portfolio e alla fine spiegano cosa c'e' da imparare.

Niente server, niente database: il backend e' GitHub. Le Issue sono la coda dei
prompt, i workflow run sono lo stato di avanzamento, le PR sono i risultati, un
file JSON e' il registro. Il modello arriva dalla tua sottoscrizione Azure
tramite Microsoft Foundry, autenticato via OIDC — nessuna chiave statica.

```
config.yml          l'unico file da configurare
prompts/            le istruzioni dei cinque agenti
scripts/officina.py tutto cio' che si puo' decidere senza un modello
templates/          i workflow da copiare negli altri repo
docs/               la PWA, pubblicata su GitHub Pages
state/              il registro dei progetti
learnings/          l'output del Mentor
```

---

## Setup

Serve una volta sola. Circa quaranta minuti, di cui trenta su Azure.

### 1. Il repo

Crea `ai-factory` **pubblico** e copiaci dentro questi file.

Pubblico non e' un dettaglio: i minuti di GitHub Actions sono gratis e
illimitati sui repo pubblici, GitHub Pages funziona senza piano a pagamento, e
la PWA puo' leggere lo stato senza token. Qui non finisce nulla di segreto —
i segreti stanno nei Secrets, che restano privati anche in un repo pubblico.

Poi crea le etichette (Issues > Labels):

| Etichetta | A cosa serve |
|---|---|
| `idea` | proposta dello Scout, in attesa del tuo giudizio |
| `idea:approved` | la aggiungi tu (o la PWA): sveglia l'Architect |
| `agent:build` | compito pronto: sveglia il Builder |
| `agent:queued` | compito in coda, non ancora sbloccato |

### 2. Da dove arrivano i modelli

Si sceglie con una riga in `config.yml`:

```yaml
provider: subscription   # subscription | api-key | foundry
```

| Provider | Cosa serve | Come si paga |
|---|---|---|
| `subscription` | `CLAUDE_CODE_OAUTH_TOKEN` | consuma i limiti del piano Claude che gia' hai, nessuna fattura nuova |
| `api-key` | `ANTHROPIC_API_KEY` da [console.claude.com](https://console.claude.com) | a consumo, costo separato e prevedibile |
| `foundry` | i tre segreti Azure qui sotto | sulla tua sottoscrizione Azure |

**Con `subscription`** (il default): installa la CLI di Claude Code, esegui
`claude setup-token`, copia il token che stampa. E' un token a vita lunga
legato al tuo abbonamento, quindi trattalo come una password.

**Con `foundry`**: serve una sottoscrizione Azure **a pagamento** — i modelli
Claude passano dall'Azure Marketplace, e trial, student e sponsored vengono
rifiutati con *"no valid payment method"*. Poi:

1. Su [ai.azure.com](https://ai.azure.com/) crea la risorsa. Annota il **nome**
   e riportalo in `foundry.resource`.
2. Crea i deployment (Haiku e Sonnet bastano) scegliendo una **versione
   specifica**, mai "auto-update to latest". Dai al deployment lo stesso nome
   dell'ID del modello: cosi' `models:` in `config.yml` e' gia' corretto.
3. Registra un'app **Microsoft Entra** con una *federated identity credential*
   per i tuoi repo
   ([guida](https://learn.microsoft.com/en-us/azure/developer/github/connect-from-azure-openid-connect)),
   e assegnale il ruolo **Azure AI User** sulla risorsa.
4. Annota client ID, tenant ID, subscription ID. Metti un **budget alert**.

Cambiare provider piu' avanti significa cambiare quella riga e aggiungere il
segreto: i workflow si adattano da soli.

### 3. Segreti su GitHub

I secrets di Actions **non esistono a livello di account personale**: stanno sui
repository (oppure su un'organizzazione). Quindi vai in
`https://github.com/<utente>/ai-factory/settings/secrets/actions` e aggiungi:

| Segreto | Quando serve |
|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` | provider `subscription` |
| `ANTHROPIC_API_KEY` | provider `api-key` |
| `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` | provider `foundry` |
| `GH_ADMIN_TOKEN` | sempre: PAT classico con scope `repo`, serve all'Architect per **creare** i repo dei progetti e al workflow `sync-secrets` per propagare le credenziali |

Stessi segreti anche nel repo del portfolio, escluso `GH_ADMIN_TOKEN`.

**E i repo che crea l'Architect?** Nascerebbero senza credenziale. Ci pensa il
workflow `sync-secrets`: quando mergi la PR dell'Architect, `state/projects.json`
cambia su `main` e il workflow copia il segreto in tutti i repo registrati. Il
valore non passa mai da un agente, sta solo in quel job.

Se un giorno preferisci non pensarci, sposta i repo in un'**organizzazione**
gratuita: i secrets a livello di org valgono per tutti i repo pubblici anche sul
piano Free, presenti e futuri.

Se usi i template `agent-builder.yml` e `agent-publisher.yml`, ricordati di
allineare anche la riga `PROVIDER:` in cima a quei file.

### 4. La GitHub App

Installa la [Claude GitHub App](https://github.com/apps/claude) sui repo
interessati. E' l'identita' con cui gli agenti fanno commit e commentano: senza,
i workflow partono ma non riescono a scrivere.

### 5. GitHub Pages

*Settings > Pages*: sorgente **Deploy from a branch**, branch `main`, cartella
`/docs`. Dopo un minuto la PWA e' su
`https://<tuo-utente>.github.io/ai-factory/`.

Aprila dal telefono e usa "Aggiungi alla schermata Home": diventa un'app.

### 6. Il token per la PWA

L'app legge senza token. Per **scrivere** — creare issue, approvare idee,
mettere in pausa — serve un
[fine-grained PAT](https://github.com/settings/personal-access-tokens/new):

- **Repository access**: solo i repo dell'Officina.
- **Permissions**: `Issues` read/write, `Contents` read/write, `Actions` read/write.
- **Expiration**: 90 giorni.

Incollalo nelle impostazioni dell'app (l'icona a ingranaggio). Resta su quel
dispositivo, in `localStorage`, e non viene mai inviato altrove. La pagina non
carica codice da terzi proprio per questo motivo: tienila cosi'.

### 7. Il repo del portfolio

1. **Prima di tutto**, proteggi `main`: *Settings > Branches > Add rule*,
   `main`, spunta "Require a pull request before merging". Da questo momento
   nemmeno un prompt sbagliato puo' far partire un deploy.
2. Copia `templates/agent-publisher.yml` in `.github/workflows/`.
3. Aggiungi i tre segreti Azure.

### 8. La prima prova

Apri una issue in `ai-factory` con il template "Idea di progetto", mettici
l'etichetta `idea:approved` e guarda la scheda Actions. Se l'Architect crea il
repo, il sistema funziona.

Se vuoi provare senza spendere: metti `limits.paused: true` in `config.yml`,
lancia il workflow e verifica che si fermi al preflight.

---

## Come si usa, un giorno qualsiasi

1. **Lunedi' mattina** lo Scout apre tre idee. Le trovi nella scheda *Idee*.
2. **Approvi** quella che ti convince. L'Architect crea il repo, scrive
   `CLAUDE.md` e spacca il lavoro in cinque-otto compiti; ne apre uno.
3. **Il Builder** lavora sul compito e apre una PR. Ti arriva la notifica.
4. **Revisioni e fai merge.** Se qualcosa non va, commenti `@claude sistema X`
   sulla PR e riprende da li'.
5. Finiti i compiti, **il Publisher** apre la PR sul portfolio. Guardi la
   preview del branch, e se ti piace fai merge: il deploy parte da solo.
6. **Il Mentor** scrive `learnings/<slug>.md`. Lo leggi dalla scheda *Imparato*
   il giorno prima di un colloquio.

Tu decidi due cose: quali idee approvare e quali PR mergiare. Il resto e'
automatico, e nessun agente puo' fare merge.

---

## Dove si controlla il costo

Il Builder vale circa l'80% del consumo. Tutte le leve sono in `config.yml`.

Con `provider: subscription` non arriva nessuna fattura, ma il consumo non
sparisce: le run degli agenti attingono agli stessi limiti del piano che usi
per lavorare. Se una mattina Claude ti dice che hai finito i messaggi mentre
tre Builder stanno macinando, e' questo. Tieni `max_runs_per_month_per_repo`
basso all'inizio e alzalo quando sai quanto pesano davvero le run.

| Leva | Dove | Effetto |
|---|---|---|
| `agents.*.model` | config.yml | Scout e Publisher su Haiku non peggiorano di niente il risultato |
| `agents.*.max_turns` | config.yml | il tetto duro su quanto puo' costare una singola run |
| `limits.max_runs_per_month_per_repo` | config.yml | oltre il tetto gli agenti escono al preflight, prima di spendere un token |
| `limits.max_open_prs_per_repo` | config.yml | niente lavoro nuovo se c'e' arretrato da revisionare |
| `limits.paused` | config.yml, o il bottone nella PWA | ferma tutto |

Cose gia' fatte per non sprecare token, che vale la pena non disfare:

- **`ANTHROPIC_DEFAULT_HAIKU_MODEL` e' impostato ovunque.** Su Foundry, senza
  questa variabile, anche i task di contorno girerebbero sul modello grande.
  E' la singola impostazione che spreca di piu' se manca.
- **`--allowedTools` e' stretto.** Ogni strumento concesso occupa spazio nel
  prompt di sistema a *ogni* turno.
- **Lo Scout non naviga il web.** Uno script Python gli prepara
  `state/feed.md`: costa zero token invece di una decina di ricerche.
- **Il preflight e' in Python.** Kill switch, budget e cap sulle PR si
  decidono senza svegliare il modello.
- **`CLAUDE.md` e' corto** e `.claude/settings.json` vieta la lettura di
  `node_modules`, build, lock file e immagini. Ogni riga di quel file viene
  riletta a ogni run di ogni agente.
- **I template delle issue** costringono a scrivere criteri verificabili: un
  compito chiaro si chiude in meno turni.

Se vuoi ridurre ancora, l'ordine giusto e': issue piu' piccole, poi
`max_turns` piu' basso, poi modello piu' piccolo. Cambiare modello per primo
di solito costa di piu', perche' l'agente impiega piu' turni a fare la stessa cosa.

`foundry.prompt_caching_1h` conviene solo se lanci piu' run ravvicinate sullo
stesso repo: la scrittura in cache a un'ora costa piu' di quella a cinque
minuti, quindi con run sporadiche si paga senza mai riusarla.

---

## Note

- I workflow schedulati nei repo pubblici vengono disattivati da GitHub dopo
  60 giorni senza attivita'. L'Officina committa spesso, quindi non dovrebbe
  succedere: se lo Scout smette di partire, e' questa la ragione.
- I segreti non sono disponibili nelle PR provenienti da fork. Irrilevante
  finche' lavori da solo.
- `docs/config.json` e' generato dal workflow `sync-config` a partire da
  `config.yml`. Non modificarlo a mano.
