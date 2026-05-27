# BalanceWhiz SEO

Page titles, meta descriptions, Open Graph, Twitter cards, and favicon links are defined in `pages.json` and injected into HTML with:

```bash
python3 scripts/inject_seo.py
```

After editing `pages.json`, re-run the script and commit the updated HTML.

- **Public indexable pages:** landing, about, help, pricing, contact, privacy, terms (`robots: index, follow`)
- **App / auth pages:** `noindex, nofollow` (see `robots.txt`)
- **OG image:** `python3 scripts/generate_og_image.py` (requires Pillow in `.venv-seo`)
- **Sitemap / robots:** `frontend/sitemap.xml`, `frontend/robots.txt`

Canonical base URL: `https://balancewhiz.com`
