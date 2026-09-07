#!/usr/bin/env python3
"""Officina Agenti — utilita' di supporto ai workflow.

Tutto quello che si puo' decidere senza un modello si decide qui, in
Python: costa zero token e zero secondi di inferenza.

  officina.py outputs <agente>   modello / turni / timeout -> GITHUB_OUTPUT
  officina.py preflight <agente> kill switch, budget, cap PR -> ok=true|false
  officina.py feed               digest delle release per lo Scout
  officina.py sync-web           rigenera docs/config.json per la PWA
"""

import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

try:
    import yaml
except ImportError:  # pragma: no cover - il workflow lo installa prima
    sys.exit("PyYAML mancante: pip install pyyaml")

ROOT = Path(__file__).resolve().parent.parent
API = "https://api.github.com"


# --------------------------------------------------------------------------
# base
# --------------------------------------------------------------------------

def load_config():
    with open(ROOT / "config.yml", encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def emit(**pairs):
    """Scrive coppie chiave=valore su $GITHUB_OUTPUT (o su stdout in locale)."""
    out = os.environ.get("GITHUB_OUTPUT")
    lines = [f"{k}={v}" for k, v in pairs.items()]
    if out:
        with open(out, "a", encoding="utf-8") as fh:
            fh.write("\n".join(lines) + "\n")
    for line in lines:
        print(line)


def summary(text):
    """Aggiunge una riga al riepilogo visibile nella pagina della run."""
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if path:
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(text + "\n")
    print(text, file=sys.stderr)


def gh(path, params=None):
    """GET sull'API di GitHub. Ritorna None invece di esplodere."""
    url = f"{API}{path}"
    if params:
        url += "?" + "&".join(f"{k}={v}" for k, v in params.items())
    req = urllib.request.Request(url)
    req.add_header("Accept", "application/vnd.github+json")
    token = os.environ.get("GITHUB_TOKEN", "")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as exc:
        print(f"[warn] {url} -> {exc}", file=sys.stderr)
        return None


# --------------------------------------------------------------------------
# outputs
# --------------------------------------------------------------------------

PROVIDERS = ("subscription", "api-key", "foundry")


def cmd_outputs(agent):
    cfg = load_config()
    spec = cfg["agents"][agent]
    models = cfg["models"]
    foundry = cfg.get("foundry", {}) or {}
    alias = spec["model"]                      # haiku | sonnet | opus

    provider = cfg.get("provider", "subscription")
    if provider not in PROVIDERS:
        sys.exit(f"provider '{provider}' sconosciuto: usa uno fra {', '.join(PROVIDERS)}")

    emit(
        provider=provider,
        use_foundry="true" if provider == "foundry" else "false",
        model=models[alias],
        model_alias=alias,
        max_turns=spec["max_turns"],
        timeout_min=spec["timeout_min"],
        foundry_resource=foundry.get("resource", ""),
        model_opus=models["opus"],
        model_sonnet=models["sonnet"],
        model_haiku=models["haiku"],
        caching_1h="1" if provider == "foundry" and foundry.get("prompt_caching_1h") else "",
        owner=cfg["github"]["owner"],
        portfolio_repo=cfg["github"]["portfolio_repo"],
    )


# --------------------------------------------------------------------------
# preflight — i controlli che evitano run inutili
# --------------------------------------------------------------------------

def cmd_preflight(agent):
    cfg = load_config()
    limits = cfg.get("limits", {})
    repo = os.environ.get("GITHUB_REPOSITORY", "")

    def stop(reason):
        summary(f"### Preflight: fermato\n\n{reason}")
        emit(ok="false", reason=reason)
        sys.exit(0)

    # 1. kill switch
    if limits.get("paused"):
        stop("`limits.paused: true` in config.yml — il sistema e' in pausa.")

    # 2. budget: quante run di agenti in questo repo, questo mese
    cap = int(limits.get("max_runs_per_month_per_repo", 25))
    since = datetime.now(timezone.utc).replace(
        day=1, hour=0, minute=0, second=0, microsecond=0
    ).strftime("%Y-%m-%d")
    used = 0
    data = gh(f"/repos/{repo}/actions/runs",
              {"created": f">={since}", "per_page": "1"})
    if data:
        used = int(data.get("total_count", 0))
        if used >= cap:
            stop(f"Budget del mese esaurito: {used}/{cap} run in `{repo}`. "
                 "Alza `limits.max_runs_per_month_per_repo` o aspetta il mese prossimo.")

    # 3. cap sulle PR aperte: niente lavoro nuovo se c'e' arretrato
    pr_cap = int(limits.get("max_open_prs_per_repo", 3))
    if agent in ("builder", "architect"):
        prs = gh(f"/repos/{repo}/pulls", {"state": "open", "per_page": "100"})
        if prs is not None and len(prs) >= pr_cap:
            stop(f"Ci sono gia' {len(prs)} PR aperte in `{repo}` (tetto: {pr_cap}). "
                 "Revisionale prima di far ripartire gli agenti.")

    # 4. cap sulle idee aperte: lo Scout non deve riempire la coda
    if agent == "scout":
        idea_cap = int(limits.get("max_open_ideas", 12))
        issues = gh(f"/repos/{repo}/issues",
                    {"labels": "idea", "state": "open", "per_page": "100"})
        if issues is not None and len(issues) >= idea_cap:
            stop(f"Ci sono gia' {len(issues)} idee aperte (tetto: {idea_cap}). "
                 "Approvane o archiviane qualcuna.")

    summary(f"### Preflight: ok\n\nAgente `{agent}` — run usate questo mese in "
            f"`{repo}`: {used}/{cap}.")
    emit(ok="true", reason="", runs_used=used, runs_cap=cap)


# --------------------------------------------------------------------------
# feed — il digest che riceve lo Scout
# --------------------------------------------------------------------------

def cmd_feed():
    """Legge le ultime release dei repo osservati e produce un digest compatto.

    Farlo qui invece che con una ricerca web dell'agente vale circa il 90%
    dei token di una run dello Scout.
    """
    cfg = load_config()
    watch = cfg.get("scout", {}).get("watch", []) or []
    lines = []
    for repo in watch[:12]:
        rel = gh(f"/repos/{repo}/releases/latest")
        if not rel:
            continue
        body = (rel.get("body") or "").strip().replace("\r", "")
        body = " ".join(body.split())[:400]
        lines.append(
            f"- **{repo}** {rel.get('tag_name', '?')} "
            f"({(rel.get('published_at') or '')[:10]}): {body}"
        )
    digest = "\n".join(lines) if lines else "- (nessuna release recuperata)"
    Path(ROOT / "state" / "feed.md").write_text(digest + "\n", encoding="utf-8")
    print(f"[feed] {len(lines)} release nel digest", file=sys.stderr)


# --------------------------------------------------------------------------
# sync-web — config.yml -> docs/config.json (quello che legge la PWA)
# --------------------------------------------------------------------------

def cmd_sync_web():
    cfg = load_config()
    web = {
        "owner": cfg["github"]["owner"],
        "controlRepo": cfg["github"]["control_repo"],
        "portfolioRepo": cfg["github"]["portfolio_repo"],
        "provider": cfg.get("provider", "subscription"),
        "paused": bool(cfg.get("limits", {}).get("paused")),
        "limits": {
            "runsPerMonth": cfg["limits"]["max_runs_per_month_per_repo"],
            "openPrs": cfg["limits"]["max_open_prs_per_repo"],
            "openIdeas": cfg["limits"]["max_open_ideas"],
        },
        "agents": {
            name: {"model": spec["model"], "maxTurns": spec["max_turns"]}
            for name, spec in cfg["agents"].items()
        },
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    target = ROOT / "docs" / "config.json"
    target.write_text(json.dumps(web, indent=2) + "\n", encoding="utf-8")
    print(f"[sync-web] scritto {target}", file=sys.stderr)


# --------------------------------------------------------------------------

def cmd_render():
    """Stampa il prompt con le sostituzioni {{CHIAVE}} applicate.

    PROMPT_FILE = percorso del prompt.
    VARS        = righe "CHIAVE=valore" (le chiavi non trovate restano tali).
    """
    text = Path(ROOT / os.environ["PROMPT_FILE"]).read_text(encoding="utf-8")
    for line in os.environ.get("VARS", "").splitlines():
        line = line.strip()
        if not line or "=" not in line:
            continue
        key, _, value = line.partition("=")
        text = text.replace("{{%s}}" % key.strip(), value.strip())
    sys.stdout.write(text)


COMMANDS = {
    "outputs": lambda a: cmd_outputs(a[0]),
    "render": lambda a: cmd_render(),
    "preflight": lambda a: cmd_preflight(a[0]),
    "feed": lambda a: cmd_feed(),
    "sync-web": lambda a: cmd_sync_web(),
}

if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        sys.exit(__doc__)
    COMMANDS[sys.argv[1]](sys.argv[2:])
