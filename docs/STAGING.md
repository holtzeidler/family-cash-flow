# Staging environment

Use staging to try changes with real deploy mechanics (static build, API, cookies, CORS) **before** they reach production users on [balancewhiz.com](https://balancewhiz.com).

## Architecture

| | Production | Staging |
|---|------------|---------|
| **Branch** | `main` | `staging` |
| **Frontend** | GitHub Pages (`balancewhiz.com`) | Render static site `family-cash-flow-web-staging` |
| **API** | Render `family-cash-flow-api` | Render `family-cash-flow-api-staging` |
| **Database** | Neon (production branch) | Neon **staging branch** (separate from production) |
| **Frontend build secret** | `API_BASE` | `API_BASE_STAGING` |

GitHub Pages supports **one** live site per repo, so staging frontend lives on Render. Production stays on GitHub Pages + Render API (unchanged).

## One-time setup

### 1. Create the `staging` branch

```bash
git checkout main
git pull
git checkout -b staging
git push -u origin staging
```

Keep `staging` as a long-lived branch. Merge feature branches into `staging` first, then `staging` → `main` when ready.

### 2. Sync Render blueprint

`render.yaml` defines production API (`main`), staging API + DB (`staging`), and staging static frontend (`staging`).

In [Render Dashboard](https://dashboard.render.com/):

1. **Blueprint** → Sync / apply from this repo (or add services manually from `render.yaml`).
2. Confirm three web services and one staging database exist.
3. **Do not** point staging API at the production `DATABASE_URL`.

### 3. Staging API environment variables

On **`family-cash-flow-api-staging`**, set (in addition to blueprint defaults):

| Variable | Example / notes |
|----------|-----------------|
| `ENV` | `production` (needed for cross-origin auth cookies with static hosting) |
| `CORS_ORIGINS` | Staging frontend origin only, e.g. `https://staging.balancewhiz.com` (no path). Must be **`CORS_ORIGINS`** (plural) — `CORS_ORIGIN` is ignored. |
| `APP_PUBLIC_BASE_URL` | Same as staging frontend URL (invite/reset links) |
| `JWT_SECRET` | Generate a new secret (do not reuse production) |
| `DATABASE_URL` | Neon **staging branch** pooled connection string (not production) |

Copy optional mail/contact vars from production only if you want staging to send real email (usually skip for staging).

**Manual API service:** set **Dockerfile Path** to `backend/Dockerfile` (not repo-root `Dockerfile`).

### 4. Staging static site (`family-cash-flow-web-staging`)

After the staging API is live, set:

| Variable | Value |
|----------|--------|
| `API_BASE` | Staging API root, e.g. `https://family-cash-flow-api-staging.onrender.com` (no trailing slash) |

**Build command:** `chmod +x scripts/build-frontend-static.sh && ./scripts/build-frontend-static.sh public-staging`  
**Publish directory:** `public-staging`  
**Branch:** `staging`

Render runs `scripts/build-frontend-static.sh` on each `staging` push.

### 5. Custom domain: `staging.balancewhiz.com` (GoDaddy DNS)

**DNS registrar:** GoDaddy (same as production `balancewhiz.com`).

#### A. Add domain in Render first

1. [Render Dashboard](https://dashboard.render.com) → **`family-cash-flow-web-staging`**
2. **Settings** → **Custom Domains** → **Add Custom Domain**
3. Enter `staging.balancewhiz.com`
4. Copy the **CNAME target** Render shows (usually `family-cash-flow-web-staging.onrender.com` — use Render’s exact value)

#### B. Add CNAME in GoDaddy

1. Sign in at [godaddy.com](https://www.godaddy.com) → **My Products**
2. Find **balancewhiz.com** → **DNS** (or **Manage DNS**)
3. On the **DNS Records** tab, click **Add** (or **Add New Record**)
4. Fill in:

| Field | Value |
|--------|--------|
| **Type** | CNAME |
| **Name** | `staging` |
| **Value** | Paste Render’s CNAME target (e.g. `family-cash-flow-web-staging.onrender.com`) |
| **TTL** | 1 Hour (default is fine) |

5. **Save**

GoDaddy’s **Name** field is only the subdomain (`staging`), not the full `staging.balancewhiz.com`.

**Do not** use GoDaddy **Forwarding** for this — use a **DNS CNAME record** only.

#### C. Update staging API after DNS

On **`family-cash-flow-api-staging`** → **Environment**, set:

| Variable | Value |
|----------|--------|
| `CORS_ORIGINS` | `https://staging.balancewhiz.com` |
| `APP_PUBLIC_BASE_URL` | `https://staging.balancewhiz.com` |

Save and wait for redeploy. DNS + Render SSL often take **5–30 minutes**.

Verify DNS:

```bash
dig staging.balancewhiz.com CNAME +short
```

Verify CORS on the staging API (should show `cors_middleware_enabled: true`):

```bash
curl -s https://family-cash-flow-api-staging.onrender.com/api/debug/public-config
```

Then open `https://staging.balancewhiz.com/calendar/` and sign in with a **staging test account**.

### 6. GitHub Actions secrets

Create a GitHub **environment** named `staging` (Settings → Environments → New environment).

Add secrets (environment or repository level):

| Secret | Purpose |
|--------|---------|
| `API_BASE_STAGING` | Staging Render API URL — used by `.github/workflows/pages-staging.yml` to verify builds |
| `RENDER_DEPLOY_HOOK_STAGING_WEB` | Optional — Render deploy hook URL to re-deploy static site after CI build |

Production secret `API_BASE` is unchanged and still used only by `.github/workflows/pages.yml` on `main`.

### 7. Production API CORS (unchanged)

Production `CORS_ORIGINS` should list **production** frontend origins only (e.g. `https://balancewhiz.com`, `https://www.balancewhiz.com`). Do not add staging URLs to production API.

## Day-to-day workflow

```
feature/my-change  →  PR into staging  →  test on staging URLs  →  PR staging → main  →  production deploy
```

1. Develop on a feature branch; open PR to **`staging`**.
2. Merge to `staging` → Render deploys staging API + static site; GitHub runs **Staging — build and verify frontend**.
3. Smoke-test staging (login, calendar balances, reconcile, Cash Outlook).
4. Open PR **`staging` → `main`**; merge when satisfied.
5. `main` push deploys production frontend (GitHub Pages) and production API (Render `main` branch).

### Hotfixes

For urgent production fixes: branch from `main`, fix, merge to `staging` for a quick check (optional but recommended), then merge to `main`.

## URLs (defaults after blueprint)

Replace with your Render service names if different:

- Staging app: `https://staging.balancewhiz.com` (Render default: `https://family-cash-flow-web-staging.onrender.com`)
- Staging API: `https://family-cash-flow-api-staging.onrender.com`
- Staging API docs: `https://family-cash-flow-api-staging.onrender.com/docs`
- Staging API config check: `https://family-cash-flow-api-staging.onrender.com/api/debug/public-config`

## Local development

Staging does not replace local dev:

```bash
cd backend && uvicorn app.main:app --reload --port 8000
# Open frontend with API pointing at localhost (or use existing local flow)
```

Use staging when you need to validate **deployed** behavior, not every edit.

## Troubleshooting

| Symptom | Check |
|---------|--------|
| “We're having trouble connecting” on account setup | Staging API `/api/debug/public-config`: `cors_middleware_enabled` must be `true`. Fix `CORS_ORIGINS` (plural), not `CORS_ORIGIN`; redeploy and recheck. |
| Login works on prod, not staging | `CORS_ORIGINS` on staging API matches staging frontend origin exactly; `ENV=production` on staging API |
| `API_BASE` / `__API_BASE__` in browser | Re-deploy staging static site after setting `API_BASE` on Render |
| Staging shows production data | Staging API `DATABASE_URL` must use **staging** DB only |
| CI fails on `staging` push | GitHub secret `API_BASE_STAGING` set in `staging` environment |
| Login/signup sends you to production | Signup links must be relative (`/account-setup/`), not `https://balancewhiz.com/...` |
| Production broke after staging merge | Re-test on staging before `staging` → `main`; consider branch protection on `main` |

## Files

- `render.yaml` — production + staging Render services
- `.github/workflows/pages.yml` — production frontend (`main`)
- `.github/workflows/pages-staging.yml` — staging build verification + optional deploy hook
- `scripts/build-frontend-static.sh` — shared static frontend build (bakes `API_BASE`)
