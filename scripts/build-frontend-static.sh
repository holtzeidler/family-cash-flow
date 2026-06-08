#!/usr/bin/env bash
# Build static frontend/ into OUT_DIR, baking window.API_BASE from the API_BASE env var.
# Used by GitHub Actions (production + staging) and Render (staging static site).
set -euo pipefail

OUT_DIR="${1:-public}"
API_BASE="${API_BASE:-}"

if [ -z "${API_BASE}" ]; then
  echo "API_BASE is required (Render API root, no trailing slash)." >&2
  exit 1
fi

API_BASE="${API_BASE%/}"

rm -rf "${OUT_DIR}"
mkdir -p "${OUT_DIR}"
cp -R frontend/. "${OUT_DIR}/"

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
