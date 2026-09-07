# Setup

One-time, about forty minutes. Do it in order — later steps assume earlier ones.

---

## 1. The repository

Create `ai-factory` as a **public** repo and push these files.

Public isn't cosmetic: Actions minutes are free and unmetered on public repos,
Pages works without a paid plan, and the control panel can read state without a
token. Nothing secret lives here — secrets go in Secrets, which stay private
even in a public repo.

Then create four labels under **Issues → Labels**:

| Label | Purpose |
| --- | --- |
| `idea` | Scout's proposal, waiting for your call |
| `idea:approved` | You add it — wakes the Architect |
| `agent:build` | A ready task — wakes the Builder |
| `agent:queued` | Queued task, not yet released |

The labels *are* the triggers. Without them nothing ever fires.

---

## 2. Where the models come from

One line in `config.yml`:

```yaml
provider: subscription   # subscription | api-key | foundry
```

| Provider | Secret needed | Billing |
| --- | --- | --- |
| `subscription` | `CLAUDE_CODE_OAUTH_TOKEN` | Draws on your existing Claude plan limits. No new invoice. |
| `api-key` | `ANTHROPIC_API_KEY` | Pay per token on [console.claude.com](https://console.claude.com). |
| `foundry` | `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` | Your Azure subscription. |

### Using your Claude subscription

Install the Claude Code CLI, then:

```bash
claude                # log in through the browser
claude setup-token    # prints the long-lived token
```

Order matters: `setup-token` derives the token from an authenticated session.

Hitting your plan's limit stops the runs with a reset time — **there is no
automatic charge**. Paying API rates on top is a separate opt-in
(`/usage-credits`) with a spending cap you set yourself.

### Using Microsoft Foundry

Requires a **paid** Azure subscription: Claude models are a Marketplace partner
offering, and trial, student, and sponsored subscriptions are rejected with
*"no valid payment method"*.

1. Create the resource at [ai.azure.com](https://ai.azure.com/); note its name
   for `foundry.resource`.
2. Deploy Haiku and Sonnet. Pick a **specific version**, never
   "auto-update to latest". Name each deployment after the model ID so
   `models:` in `config.yml` is already correct.
3. Register a Microsoft Entra app with a
   [federated identity credential](https://learn.microsoft.com/en-us/azure/developer/github/connect-from-azure-openid-connect)
   for your repos, and grant it **Azure AI User** on the resource.
4. Note the client, tenant and subscription IDs. Set a **budget alert**.

Because the Architect creates repos dynamically, a
[flexible federated credential](https://learn.microsoft.com/en-us/entra/workload-id/workload-identities-flexible-federated-identity-credentials)
matching `repo:<owner>/*:ref:refs/heads/main` saves adding one per new repo.

---

## 3. Secrets

Actions secrets **do not exist at personal-account level** — they live on
repositories (or on an organization). Go to
`https://github.com/<user>/ai-factory/settings/secrets/actions`:

| Secret | When |
| --- | --- |
| `CLAUDE_CODE_OAUTH_TOKEN` / `ANTHROPIC_API_KEY` / the three `AZURE_*` | Whichever provider you chose |
| `GH_ADMIN_TOKEN` | Always. Classic PAT with **`repo`** and **`workflow`** scopes |

`GH_ADMIN_TOKEN` needs `workflow` because the Architect commits
`.github/workflows/agent-builder.yml` into each new repo, and GitHub rejects any
push touching `.github/workflows/` without that scope. It's the most powerful
credential here: keep it only in `ai-factory`, and set a 90-day expiry.

Add the model secret to the portfolio repo too (not `GH_ADMIN_TOKEN`).

**New project repos** get their credential automatically: merging the
Architect's PR changes `state/projects.json`, which triggers `sync-secrets`.
The secret's value never passes through an agent.

> Prefer to stop thinking about it? Move the repos into a free **organization** —
> org secrets cover every public repo, present and future, on the free plan.

---

## 4. The GitHub App

Install the [Claude GitHub App](https://github.com/apps/claude) — it's the
identity agents commit and comment as. Without it, workflows start but can't
write.

**Choose "All repositories", not a hand-picked list.** The Architect creates a
new repo per project, and the agent has to write into it immediately: a
selected-repos install wouldn't cover repos that don't exist yet, and every new
project would stall until you added it by hand.

---

## 5. Hosting the control panel

**Quick path — GitHub Pages.** *Settings → Pages* → *Deploy from a branch* →
`main`, folder `/docs`. Live at `https://<user>.github.io/ai-factory/` in a
minute.

The panel is password-gated (see below), but the URL itself is reachable by
anyone. Without a token the app can only read what's already public.

**Truly private.** A Pages site can't authenticate anyone; access control
requires GitHub Enterprise Cloud. For a real login, serve `docs/` from
[Cloudflare Pages](https://developers.cloudflare.com/pages/) and put
[Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/)
in front of it with GitHub as the identity provider and a policy allowing one
email. Free, and the app already reads private repos through the authenticated
API. Turn GitHub Pages **off** afterwards, or the public URL keeps existing in
parallel.

Note that Access protects the *page*. If the repo stays public, anyone can still
read `state/projects.json`, the issues, and `learnings/` straight from GitHub.
Real privacy needs both: Access on the page **and** a private repo. Going private
drops Actions to 2,000 minutes/month — with these caps you'll use a few hundred.

### Password and token storage

`config.yml` holds the SHA-256 of the unlock password — never the password:

```yaml
web:
  password_sha256: "…"
  session_days: 30
```

To change it:

```bash
printf %s 'newpassword' | sha256sum
```

```powershell
$p="newpassword"
[BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash(
  [Text.Encoding]::UTF8.GetBytes($p))).Replace("-","").ToLower()
```

The password also derives an AES-GCM key (PBKDF2, 150k iterations) that
encrypts your GitHub token in `localStorage`. It is not real security — the page
is static and the data lives on GitHub anyway — but it keeps casual visitors out
and means an unlocked phone doesn't hand over your token. *Lock now* in settings
ends the session immediately.

---

## 6. The GitHub token for the panel

The app reads without a token; writing — creating issues, approving ideas,
pausing — needs a
[fine-grained PAT](https://github.com/settings/personal-access-tokens/new):

- **Repository access**: only the Officina repos
- **Permissions**: `Issues`, `Contents`, `Actions` — read and write
- **Expiration**: 90 days

Paste it into the app's settings. On a private repo it's required even to read.

---

## 7. The portfolio repo

1. **First**, protect `main`: *Settings → Branches → Add branch protection rule*,
   pattern `main`, then tick:
   - **Require a pull request before merging**
   - **Require approvals**, set to **1**

   The second one is what actually makes you the gate. The PR author is the
   Claude bot, so your approval counts — and without it the merge button stays
   disabled. A prompt saying "don't merge" is a request to a model; this is
   enforcement.
2. Copy `templates/agent-publisher.yml` into `.github/workflows/`.
3. Add the model secret.

If your portfolio deploys on push to `main`, the same integration builds a
**preview deployment for every branch** — so each agent PR arrives with a URL
where you can see the result before merging.

---

## 8. First run

Dry run first, at zero cost. Set `paused: true`, push, then
**Actions → agent-scout → Run workflow**. It must stop at preflight and say the
system is paused. If it goes further, something isn't reading the config.

Then set `paused: false`, push, and run it again. Three issues labelled `idea`
should appear within a few minutes.

> Pushing `config.yml` also triggers `sync-config`, which regenerates
> `docs/config.json` and commits it. Two workflows is normal.

From there the loop is real: approve an idea with `idea:approved`, and the
Architect takes over.

---

## Notes

- Scheduled workflows in public repos are disabled by GitHub after 60 days of
  inactivity. The Officina commits often, so it shouldn't happen — but if Scout
  goes quiet, that's why.
- Secrets aren't available to pull requests from forks.
- `docs/config.json` is generated from `config.yml`. Don't edit it by hand.
