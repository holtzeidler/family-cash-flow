#!/usr/bin/env bash
# Build static frontend/ into OUT_DIR, baking window.API_BASE from the API_BASE env var.
# Used by GitHub Actions (production + staging) and Render (staging static site).
# Staging builds (OUT_DIR=public-staging) swap in chart-line favicons so tabs differ from production.
set -euo pipefail

OUT_DIR="${1:-public}"
API_BASE="${API_BASE:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [ -z "${API_BASE}" ]; then
  echo "API_BASE is required (Render API root, no trailing slash)." >&2
  exit 1
fi

API_BASE="${API_BASE%/}"

rm -rf "${OUT_DIR}"
mkdir -p "${OUT_DIR}"
cp -R "${REPO_ROOT}/frontend/." "${OUT_DIR}/"

# Staging: chart-line favicon (production keeps typography Bw in frontend/).
if [ "${OUT_DIR}" = "public-staging" ]; then
  STAGING_FAV="${REPO_ROOT}/frontend/staging-favicons"
  if [ -d "${STAGING_FAV}" ]; then
    for f in favicon.ico favicon.png favicon-16.png favicon-32.png favicon-48.png apple-touch-icon.png; do
      if [ -f "${STAGING_FAV}/${f}" ]; then
        cp "${STAGING_FAV}/${f}" "${OUT_DIR}/${f}"
      fi
    done
    echo "Applied staging chart favicons"
  else
    echo "::warning::${STAGING_FAV} missing — run: python3 scripts/generate-staging-favicons.py" >&2
  fi
fi

export API_BASE OUT_DIR
python3 - <<'PY'
import os
import pathlib

api_base = (os.environ.get("API_BASE") or "").strip().rstrip("/")
root = pathlib.Path(os.environ["OUT_DIR"])
for path in root.rglob("*.html"):
    try:
        txt = path.read_text(encoding="utf-8")
    except OSError:
        continue
    if "__API_BASE__" not in txt:
        continue
    path.write_text(txt.replace("__API_BASE__", api_base), encoding="utf-8")
PY

test -f "${OUT_DIR}/index.html" || (echo "::error::${OUT_DIR}/index.html missing — check frontend/ is committed" >&2 && exit 1)

touch "${OUT_DIR}/.nojekyll"
echo "Built ${OUT_DIR} with API_BASE=${API_BASE}"
