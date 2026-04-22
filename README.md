# BalanceWhiz

A small multi-user cash flow management app (web-first, mobile-friendly) with a Python/FastAPI backend and an SQLite database.

## Local setup

1. Create a virtual environment and install dependencies:

```bash
cd family-cash-flow
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
```

2. Copy env template:

```bash
cp backend/.env.example backend/.env
```

3. Run the server:

```bash
uvicorn app.main:app --reload --port 8000
```

4. Open in your browser:

```text
http://localhost:8000
```

## What’s included in this starter

- User registration/login (cookie-based JWT auth)
- Multi-family support (admin/member)
- Account buckets (checking/savings/credit card/cash/other) with starting balances
- Transaction categories and month-based transaction CRUD + totals
- Expected recurring transactions (monthly / twice yearly / yearly / once)
- Per-occurrence editing/canceling of expected transactions
- Monthly calendar view (actual + expected toggles)
- Daily projected balance chart with zoom controls
- 5-year daily projection API (for further charting/reporting)

API is documented at `/docs` (FastAPI Swagger UI).

## Deployment (GitHub Pages frontend + backend host)

GitHub Pages can only host static frontend files; the API/backend must be hosted separately (Render/Fly/Railway/etc).

### 1) Deploy the backend (FastAPI + Postgres)

Set environment variables on your backend host:

`ENV=production`

`DATABASE_URL=postgresql+psycopg://USER:PASSWORD@HOST:5432/DBNAME`

`JWT_SECRET=...`

`JWT_ALGORITHM=HS256`

`ACCESS_TOKEN_MINUTES=1440`

If your Pages origin is different from your backend origin, also set:

`CORS_ORIGINS=https://YOUR_GITHUB_USER.github.io`

(Use the **origin only** — no `/repo-name` path. You can also paste a full Pages URL; the backend normalizes it.)

### 2) Deploy the frontend (GitHub Pages)

This repo includes a GitHub Actions workflow at:

`/.github/workflows/pages.yml`

It publishes the contents of `frontend/` to GitHub Pages and replaces the `__API_BASE__` placeholder using the required GitHub secret:

`API_BASE` = the public backend URL (example: `https://your-backend.com`)

After you push to `main` and set the secret, Pages will update automatically.


