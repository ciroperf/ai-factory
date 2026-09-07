/* Officina Agenti — PWA di controllo.
 *
 * Nessun backend, nessuna dipendenza. Legge e scrive direttamente sull'API
 * di GitHub. Cio' che e' pubblico si legge senza token (raw.githubusercontent);
 * il token serve solo per scrivere.
 */

'use strict';

const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';

const LEGACY_KEY = 'officina.pat';       // vecchio token in chiaro, si migra
const VAULT_KEY = 'officina.vault';      // token cifrato con la password
const SALT_KEY = 'officina.salt';
const SESSION_KEY = 'officina.session';  // chiave derivata + scadenza

let CFG = null;
let TOKEN = '';
let KEY = null;      // chiave AES derivata dalla password, solo in memoria
let PROJECTS = [];
let VIEW = 'stato';
let pollTimer = null;

/* ------------------------------------------------------------------ utils */

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, ms);
}

function store(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key) || '';
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch (_) { /* modalita' privata: si continua senza persistenza */ }
  return value || '';
}

/* ------------------------------------------------------- lucchetto */
/* La password non e' sicurezza vera: la pagina e' statica e i dati stanno
   comunque su GitHub. Fa due cose utili e limitate: tiene fuori chi capita
   sull'indirizzo per caso, e cifra il token nel localStorage, cosi' chi
   prende in mano il telefono sbloccato non se lo porta via. */

const ENC = new TextEncoder();
const DEC = new TextDecoder();
const b64 = (buf) => btoa(String.fromCharCode.apply(null, new Uint8Array(buf)));
const unb64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));

async function sha256hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', ENC.encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0')).join('');
}

function salt() {
  let existing = store(SALT_KEY);
  if (!existing) {
    existing = b64(crypto.getRandomValues(new Uint8Array(16)));
    store(SALT_KEY, existing);
  }
  return unb64(existing);
}

async function deriveKey(password) {
  const base = await crypto.subtle.importKey(
    'raw', ENC.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt(), iterations: 150000, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

async function saveToken(token) {
  TOKEN = token;
  if (!KEY) { store(LEGACY_KEY, token); return; }
  if (!token) { store(VAULT_KEY, null); return; }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, KEY, ENC.encode(token));
  store(VAULT_KEY, JSON.stringify({ iv: b64(iv), ct: b64(ct) }));
  store(LEGACY_KEY, null);
}

async function loadToken() {
  if (!KEY) return store(LEGACY_KEY);
  const raw = store(VAULT_KEY);
  if (!raw) {
    // primo sblocco dopo l'aggiornamento: cifra il vecchio token in chiaro
    const legacy = store(LEGACY_KEY);
    if (legacy) { await saveToken(legacy); return legacy; }
    return '';
  }
  try {
    const v = JSON.parse(raw);
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: unb64(v.iv) }, KEY, unb64(v.ct));
    return DEC.decode(pt);
  } catch (_) {
    return '';   // password cambiata: il vault non si apre piu'
  }
}

async function rememberSession() {
  const days = (CFG.web && CFG.web.sessionDays) || 30;
  const raw = await crypto.subtle.exportKey('raw', KEY);
  store(SESSION_KEY, JSON.stringify({
    k: b64(raw), exp: Date.now() + days * 86400000
  }));
}

async function resumeSession() {
  const raw = store(SESSION_KEY);
  if (!raw) return false;
  try {
    const { k, exp } = JSON.parse(raw);
    if (!k || Date.now() > exp) { store(SESSION_KEY, null); return false; }
    KEY = await crypto.subtle.importKey(
      'raw', unb64(k), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
    return true;
  } catch (_) {
    store(SESSION_KEY, null);
    return false;
  }
}

/* Risolve quando l'app puo' partire. */
function unlock() {
  const hash = (CFG.web && CFG.web.passwordSha256) || '';
  const lock = $('#lock');

  // nessuna password configurata: nessun lucchetto
  if (!hash) { lock.hidden = true; return Promise.resolve(); }

  return resumeSession().then((resumed) => {
    if (resumed) { lock.hidden = true; return; }

    return new Promise((done) => {
      lock.hidden = false;
      $('#lockForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = $('#lockInput');
        const err = $('#lockError');
        if (await sha256hex(input.value) !== hash) {
          err.hidden = false;
          input.value = '';
          input.focus();
          return;
        }
        err.hidden = true;
        KEY = await deriveKey(input.value);
        if ($('#lockRemember').checked) await rememberSession();
        input.value = '';
        lock.hidden = true;
        done();
      });
    });
  });
}

function ago(iso) {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'ora';
  if (s < 3600) return Math.floor(s / 60) + ' min fa';
  if (s < 86400) return Math.floor(s / 3600) + ' h fa';
  const d = Math.floor(s / 86400);
  return d === 1 ? 'ieri' : d + ' giorni fa';
}

function dur(a, b) {
  if (!a) return '';
  const end = b ? new Date(b) : new Date();
  const m = Math.round((end - new Date(a)) / 60000);
  return m < 1 ? '<1 min' : m + ' min';
}

/* -------------------------------------------------------------------- api */

async function api(path, opts = {}) {
  const headers = Object.assign(
    { Accept: 'application/vnd.github+json' },
    opts.headers || {}
  );
  if (TOKEN) headers.Authorization = 'Bearer ' + TOKEN;
  if (opts.body) headers['Content-Type'] = 'application/json';

  const res = await fetch(API + path, {
    method: opts.method || 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });

  if (res.status === 401 || res.status === 403) {
    throw new Error(TOKEN
      ? 'Token rifiutato o senza i permessi necessari.'
      : 'Serve un token: aprilo dalle impostazioni.');
  }
  if (!res.ok) throw new Error('GitHub ha risposto ' + res.status);
  return res.status === 204 ? null : res.json();
}

const ctl = () => `${CFG.owner}/${CFG.controlRepo}`;

/* Legge un file di testo dal repo.
 *
 * Con un token passa dall'API autenticata, cosi' funziona anche sui repo
 * privati. Senza token ripiega su raw.githubusercontent, che vale solo per
 * i repo pubblici e non consuma il rate limit autenticato. */
async function raw(repo, path) {
  const bust = 't=' + Date.now();

  if (TOKEN) {
    const res = await fetch(`${API}/repos/${repo}/contents/${path}?ref=main&${bust}`, {
      headers: {
        Authorization: 'Bearer ' + TOKEN,
        Accept: 'application/vnd.github.raw'
      }
    });
    if (!res.ok) throw new Error('File non leggibile: ' + path);
    return res.text();
  }

  const res = await fetch(`${RAW}/${repo}/main/${path}?${bust}`);
  if (!res.ok) throw new Error('File non trovato: ' + path);
  return res.text();
}

/* ------------------------------------------------------------- markdown */
/* Renderer minimo: prima si scappa tutto l'HTML, poi si applicano i pattern.
   Niente librerie esterne, cosi' la pagina resta senza dipendenze. */

function md(src) {
  const MARK = String.fromCharCode(1);   // sentinella: nessun testo la contiene
  const blocks = [];

  let s = esc(src).replace(/```([\s\S]*?)```/g, function (_, code) {
    blocks.push(code.replace(/^\w*\n/, ''));
    return MARK + (blocks.length - 1) + MARK;
  });

  s = s
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g,
             '<a href="$2" target="_blank" rel="noopener">$1</a>');

  const holder = new RegExp('^' + MARK + '\\d+' + MARK + '$');
  const out = [];
  let list = null;

  for (const raw of s.split('\n')) {
    const line = raw.trimEnd();
    const li = line.match(/^\s*[-*]\s+(.*)$/);
    const oli = line.match(/^\s*\d+\.\s+(.*)$/);

    if (li || oli) {
      const tag = li ? 'ul' : 'ol';
      if (list !== tag) {
        if (list) out.push('</' + list + '>');
        out.push('<' + tag + '>');
        list = tag;
      }
      out.push('<li>' + (li ? li[1] : oli[1]) + '</li>');
      continue;
    }
    if (list) { out.push('</' + list + '>'); list = null; }
    if (!line.trim()) continue;
    if (holder.test(line.trim())) { out.push(line.trim()); continue; }
    if (/^<h[123]>/.test(line)) out.push(line);
    else out.push('<p>' + line + '</p>');
  }
  if (list) out.push('</' + list + '>');

  const restore = new RegExp(MARK + '(\\d+)' + MARK, 'g');
  return out.join('\n').replace(restore, function (_, i) {
    return '<pre><code>' + blocks[+i] + '</code></pre>';
  });
}

/* ------------------------------------------------------------------ stato */

function runBadge(run) {
  if (run.status !== 'completed') {
    const b = el('span', 'badge badge-run');
    b.innerHTML = '<span class="dotlive"></span>' + (run.status === 'queued' ? 'in coda' : 'in corso');
    return b;
  }
  if (run.conclusion === 'success') return el('span', 'badge badge-ok', 'ok');
  const neutre = { cancelled: 'annullata', skipped: 'saltata' };
  if (neutre[run.conclusion]) return el('span', 'badge', neutre[run.conclusion]);
  const rotte = {
    failure: 'fallita', timed_out: 'scaduta',
    action_required: 'da sbloccare', startup_failure: 'non partita'
  };
  return el('span', 'badge badge-fail', rotte[run.conclusion] || 'fallita');
}

function runCard(run, repo) {
  const card = el('div', 'card');
  const head = el('div', 'card-head');
  const title = el('div', 'card-title');
  const a = el('a', null, run.name || 'run');
  a.href = run.html_url; a.target = '_blank'; a.rel = 'noopener';
  title.appendChild(a);
  head.append(title, runBadge(run));
  const meta = el('div', 'card-meta',
    `${repo} · ${ago(run.run_started_at || run.created_at)} · ${dur(run.run_started_at || run.created_at, run.updated_at)}`);
  card.append(head, meta);
  return card;
}

async function loadStato() {
  const runsBox = $('#runs');
  const projBox = $('#projects');
  runsBox.innerHTML = '';
  projBox.innerHTML = '';

  // progetti: file pubblico, nessun token necessario
  try {
    const data = JSON.parse(await raw(ctl(), 'state/projects.json'));
    PROJECTS = data.projects || [];
  } catch (_) { PROJECTS = []; }

  // run: control repo + fino a 4 repo di progetto attivi
  const repos = [ctl()].concat(
    PROJECTS.filter((p) => p.repo && p.stage !== 'published')
            .slice(0, 4).map((p) => p.repo)
  );

  const all = [];
  for (const repo of repos) {
    try {
      const data = await api(`/repos/${repo}/actions/runs?per_page=5`);
      (data.workflow_runs || []).forEach((r) => all.push({ run: r, repo }));
    } catch (err) {
      if (repo === ctl()) runsBox.appendChild(el('div', 'empty', err.message));
    }
  }

  all.sort((a, b) => new Date(b.run.created_at) - new Date(a.run.created_at));
  const shown = all.slice(0, 8);
  if (!shown.length) runsBox.appendChild(el('div', 'empty', 'Nessuna run finora.'));
  shown.forEach(({ run, repo }) => runsBox.appendChild(runCard(run, repo)));

  // riepilogo
  const active = all.filter((x) => x.run.status !== 'completed').length;
  const month = new Date(); month.setDate(1); month.setHours(0, 0, 0, 0);
  const thisMonth = all.filter((x) => new Date(x.run.created_at) >= month).length;
  $('#statoSummary').innerHTML = `
    <div><b>${active}</b><span>in corso</span></div>
    <div><b>${PROJECTS.filter((p) => p.stage === 'building').length}</b><span>in sviluppo</span></div>
    <div><b>${thisMonth}</b><span>run nel mese</span></div>`;

  if (!PROJECTS.length) {
    projBox.appendChild(el('div', 'empty', TOKEN
      ? 'Ancora nessun progetto. Approva un\'idea per cominciare.'
      : 'Nessun progetto leggibile. Su un repo privato serve il token: aprilo dalle impostazioni.'));
  }
  PROJECTS.forEach((p) => {
    const card = el('div', 'card');
    const head = el('div', 'card-head');
    const title = el('div', 'card-title');
    if (p.repo) {
      const a = el('a', null, p.title || p.slug);
      a.href = 'https://github.com/' + p.repo; a.target = '_blank'; a.rel = 'noopener';
      title.appendChild(a);
    } else {
      title.textContent = p.title || p.slug;
    }
    head.append(title, el('span', 'badge', p.stage || '—'));
    card.append(head);
    if (p.skills && p.skills.length) {
      card.appendChild(el('div', 'card-meta', p.skills.join(' · ')));
    }
    projBox.appendChild(card);
  });
}

/* ------------------------------------------------------------------- idee */

async function loadIdee() {
  const box = $('#ideas');
  box.innerHTML = '';
  let issues;
  try {
    issues = await api(`/repos/${ctl()}/issues?labels=idea&state=open&per_page=30`);
  } catch (err) {
    box.appendChild(el('div', 'empty', err.message));
    return;
  }
  issues = issues.filter((i) => !i.pull_request);
  if (!issues.length) {
    box.appendChild(el('div', 'empty', 'Nessuna idea in attesa. Lo Scout gira il lunedi\' mattina.'));
    return;
  }

  issues.forEach((issue) => {
    const approved = issue.labels.some((l) => l.name === 'idea:approved');
    const card = el('div', 'card');
    const head = el('div', 'card-head');
    const title = el('div', 'card-title');
    const a = el('a', null, issue.title);
    a.href = issue.html_url; a.target = '_blank'; a.rel = 'noopener';
    title.appendChild(a);
    head.append(title, el('span', 'card-meta', '#' + issue.number));
    card.append(head);

    const body = el('div', 'card-body');
    body.innerHTML = md((issue.body || '').split('\n').slice(0, 8).join('\n'));
    card.appendChild(body);

    const actions = el('div', 'card-actions');
    if (approved) {
      actions.appendChild(el('span', 'badge badge-ok', 'approvata'));
    } else {
      const ok = el('button', 'btn btn-primary btn-sm', 'Approva');
      ok.onclick = async () => {
        ok.disabled = true;
        try {
          await api(`/repos/${ctl()}/issues/${issue.number}/labels`,
                    { method: 'POST', body: { labels: ['idea:approved'] } });
          toast('Approvata. L\'Architect parte fra poco.');
          loadIdee();
        } catch (err) { toast(err.message); ok.disabled = false; }
      };
      const no = el('button', 'btn btn-sm', 'Archivia');
      no.onclick = async () => {
        no.disabled = true;
        try {
          await api(`/repos/${ctl()}/issues/${issue.number}`,
                    { method: 'PATCH', body: { state: 'closed' } });
          toast('Archiviata.');
          loadIdee();
        } catch (err) { toast(err.message); no.disabled = false; }
      };
      actions.append(ok, no);
    }
    card.appendChild(actions);
    box.appendChild(card);
  });
}

/* ------------------------------------------------------------------ nuovo */

function setupNuovo() {
  const kind = $('#promptKind');
  const repoField = $('#repoField');
  const repoSel = $('#promptRepo');
  const hint = $('#promptHint');

  const refresh = () => {
    const isBuild = kind.value === 'build';
    repoField.hidden = !isBuild;
    hint.textContent = isBuild
      ? 'Diventa una issue "agent:build" nel repo scelto: il Builder parte subito. Un compito solo, con criteri verificabili.'
      : 'Diventa una issue "idea" qui nel control plane. La approvi dalla scheda Idee quando sei convinto.';
    if (isBuild) {
      repoSel.innerHTML = '';
      PROJECTS.filter((p) => p.repo).forEach((p) => {
        const o = el('option', null, p.title || p.slug);
        o.value = p.repo;
        repoSel.appendChild(o);
      });
      if (!repoSel.options.length) {
        repoSel.appendChild(el('option', null, 'Nessun progetto ancora'));
      }
    }
  };
  kind.onchange = refresh;
  refresh();

  $('#sendPrompt').onclick = async () => {
    const btn = $('#sendPrompt');
    const title = $('#promptTitle').value.trim();
    const body = $('#promptBody').value.trim();
    if (!title || !body) { toast('Servono titolo e descrizione.'); return; }
    if (!TOKEN) { toast('Serve un token: aprilo dalle impostazioni.'); return; }

    const isBuild = kind.value === 'build';
    const repo = isBuild ? repoSel.value : ctl();
    if (isBuild && !repo.includes('/')) { toast('Nessun repo di progetto disponibile.'); return; }

    btn.disabled = true;
    try {
      const issue = await api(`/repos/${repo}/issues`, {
        method: 'POST',
        body: { title, body, labels: [isBuild ? 'agent:build' : 'idea'] }
      });
      $('#promptTitle').value = '';
      $('#promptBody').value = '';
      toast('Creata: #' + issue.number);
      go(isBuild ? 'stato' : 'idee');
    } catch (err) {
      toast(err.message);
    } finally {
      btn.disabled = false;
    }
  };
}

/* --------------------------------------------------------------- imparato */

async function loadImparato() {
  const list = $('#learnList');
  const doc = $('#learnDoc');
  doc.hidden = true;
  list.hidden = false;
  list.innerHTML = '';

  let files;
  try {
    files = await api(`/repos/${ctl()}/contents/learnings`);
  } catch (_) {
    list.appendChild(el('div', 'empty', 'Ancora niente. Il Mentor scrive qui dopo la prima pubblicazione.'));
    return;
  }
  files = (files || []).filter((f) => f.name.endsWith('.md'));
  if (!files.length) {
    list.appendChild(el('div', 'empty', 'Ancora niente. Il Mentor scrive qui dopo la prima pubblicazione.'));
    return;
  }

  files.forEach((f) => {
    const card = el('div', 'card');
    const head = el('div', 'card-head');
    head.append(el('div', 'card-title', f.name.replace(/\.md$/, '').replace(/-/g, ' ')));
    card.append(head);
    const open = el('button', 'btn btn-sm', 'Apri');
    open.onclick = async () => {
      open.disabled = true;
      try {
        const text = await raw(ctl(), 'learnings/' + f.name);
        list.hidden = true;
        doc.hidden = false;
        doc.innerHTML = '';
        const back = el('button', 'btn btn-sm back', '← Tutti');
        back.onclick = loadImparato;
        doc.appendChild(back);
        const body = el('div');
        body.innerHTML = md(text);
        doc.appendChild(body);
        window.scrollTo(0, 0);
      } catch (err) { toast(err.message); }
      open.disabled = false;
    };
    const actions = el('div', 'card-actions');
    actions.appendChild(open);
    card.appendChild(actions);
    list.appendChild(card);
  });
}

/* --------------------------------------------------------- kill switch */

async function togglePause(pause) {
  if (!TOKEN) { toast('Serve un token per cambiare config.yml.'); return; }
  const path = `/repos/${ctl()}/contents/config.yml`;
  const file = await api(path);
  const bytes = Uint8Array.from(atob(file.content.replace(/\n/g, '')), (c) => c.charCodeAt(0));
  const text = new TextDecoder().decode(bytes);
  const next = text.replace(/^(\s*paused:\s*)(true|false)/m, `$1${pause}`);
  if (next === text) throw new Error('Non trovo la riga "paused:" in config.yml.');
  await api(path, {
    method: 'PUT',
    body: {
      message: pause ? 'Metti in pausa gli agenti' : 'Riattiva gli agenti',
      content: btoa(String.fromCharCode.apply(null, new TextEncoder().encode(next))),
      sha: file.sha
    }
  });
  CFG.paused = pause;
  renderPaused();
  toast(pause ? 'Agenti in pausa.' : 'Agenti riattivati.');
}

function renderPaused() {
  $('#pausedBadge').hidden = !CFG.paused;
  const btn = $('#pauseBtn');
  btn.textContent = CFG.paused ? 'Riattiva gli agenti' : 'Metti in pausa';
  btn.className = CFG.paused ? 'btn btn-primary' : 'btn btn-danger';
}

/* ---------------------------------------------------------- navigazione */

function go(view) {
  VIEW = view;
  document.querySelectorAll('.view').forEach((v) => {
    v.hidden = v.id !== 'view-' + view;
  });
  document.querySelectorAll('.tab').forEach((t) => {
    t.classList.toggle('is-active', t.dataset.view === view);
  });
  window.scrollTo(0, 0);
  refreshView();
}

function refreshView() {
  const icon = $('#refreshBtn');
  icon.classList.add('spin');
  const done = () => icon.classList.remove('spin');
  const job = { stato: loadStato, idee: loadIdee, imparato: loadImparato }[VIEW];
  (job ? job() : Promise.resolve()).catch((e) => toast(e.message)).finally(done);
}

/* Polling solo mentre la scheda Stato e' visibile e la pagina e' in primo
   piano: nessun lavoro in background, nessuna batteria sprecata. */
function setupPolling() {
  const tick = () => {
    if (VIEW === 'stato' && document.visibilityState === 'visible') loadStato();
  };
  pollTimer = setInterval(tick, 20000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && VIEW === 'stato') loadStato();
  });
}

/* -------------------------------------------------------------- avvio */

async function main() {
  CFG = await (await fetch('config.json?t=' + Date.now())).json();

  await unlock();               // si ferma qui finche' la password non e' giusta
  TOKEN = await loadToken();

  $('#cfgInfo').innerHTML =
    `Control plane: <code>${esc(ctl())}</code><br>` +
    `Portfolio: <code>${esc(CFG.owner + '/' + CFG.portfolioRepo)}</code><br>` +
    `Tetti: ${CFG.limits.runsPerMonth} run/mese per repo, ` +
    `${CFG.limits.openPrs} PR aperte, ${CFG.limits.openIdeas} idee.`;

  renderPaused();
  setupNuovo();

  document.querySelectorAll('.tab').forEach((t) => {
    t.onclick = () => go(t.dataset.view);
  });
  $('#refreshBtn').onclick = refreshView;
  $('#settingsBtn').onclick = () => {
    $('#tokenInput').value = TOKEN;
    $('#sheet').hidden = false;
  };
  $('#sheetClose').onclick = () => { $('#sheet').hidden = true; };
  $('#sheet').onclick = (e) => { if (e.target.id === 'sheet') $('#sheet').hidden = true; };

  $('#tokenSave').onclick = async () => {
    await saveToken($('#tokenInput').value.trim());
    toast(TOKEN
      ? 'Token salvato e cifrato su questo dispositivo.'
      : 'Token vuoto.');
    refreshView();
  };
  $('#tokenClear').onclick = async () => {
    await saveToken('');
    $('#tokenInput').value = '';
    toast('Token rimosso.');
  };
  $('#lockNowBtn').onclick = () => {
    store(SESSION_KEY, null);
    location.reload();
  };
  $('#pauseBtn').onclick = () => {
    const btn = $('#pauseBtn');
    btn.disabled = true;
    togglePause(!CFG.paused).catch((e) => toast(e.message)).finally(() => { btn.disabled = false; });
  };

  go('stato');
  setupPolling();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

main().catch((err) => {
  document.getElementById('main').innerHTML =
    '<div class="empty">Non riesco a leggere config.json.<br>' + esc(err.message) + '</div>';
});
