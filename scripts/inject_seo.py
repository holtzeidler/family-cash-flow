#!/usr/bin/env python3
"""Inject shared SEO meta blocks into frontend HTML from frontend/seo/pages.json."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
CONFIG_PATH = FRONTEND / "seo" / "pages.json"
MARKER_START = "<!-- bw:seo-head -->"
MARKER_END = "<!-- /bw:seo-head -->"


def asset_prefix(rel_path: str) -> str:
    depth = rel_path.count("/")
    return "./" if depth == 0 else "../" * depth


def render_seo_block(cfg: dict, page: dict, prefix: str) -> str:
    site = cfg["siteUrl"].rstrip("/")
    canonical = site + page["canonicalPath"]
    title = page["title"]
    desc = page["description"]
    indexable = page.get("index", False)
    robots = "index, follow" if indexable else "noindex, nofollow"
    og_type = page.get("ogType", "website")
    og_image = site + cfg["ogImage"]
    theme = cfg.get("themeColor", "#0B3D2E")
    site_name = cfg.get("siteName", "BalanceWhiz")
    twitter_site = cfg.get("twitterSite", "")

    lines = [
        f"    {MARKER_START}",
        f'    <meta name="description" content="{_esc(desc)}" />',
        f'    <link rel="canonical" href="{canonical}" />',
        f'    <meta name="robots" content="{robots}" />',
        f'    <meta name="theme-color" content="{theme}" />',
        f'    <meta property="og:site_name" content="{_esc(site_name)}" />',
        f'    <meta property="og:title" content="{_esc(title)}" />',
        f'    <meta property="og:description" content="{_esc(desc)}" />',
        f'    <meta property="og:url" content="{canonical}" />',
        f'    <meta property="og:type" content="{og_type}" />',
        f'    <meta property="og:image" content="{og_image}" />',
        '    <meta property="og:image:width" content="1200" />',
        '    <meta property="og:image:height" content="630" />',
        '    <meta property="og:locale" content="en_US" />',
        '    <meta name="twitter:card" content="summary_large_image" />',
        f'    <meta name="twitter:title" content="{_esc(title)}" />',
        f'    <meta name="twitter:description" content="{_esc(desc)}" />',
        f'    <meta name="twitter:image" content="{og_image}" />',
    ]
    if twitter_site:
        lines.append(f'    <meta name="twitter:site" content="{_esc(twitter_site)}" />')
    lines.extend(
        [
            f'    <link rel="icon" href="{prefix}favicon.ico" sizes="any" />',
            f'    <link rel="icon" href="{prefix}favicon-32.png" type="image/png" sizes="32x32" />',
            f'    <link rel="icon" href="{prefix}favicon-16.png" type="image/png" sizes="16x16" />',
            f'    <link rel="apple-touch-icon" href="{prefix}apple-touch-icon.png" />',
            f'    <link rel="manifest" href="{prefix}site.webmanifest" />',
            f"    {MARKER_END}",
        ]
    )
    return "\n".join(lines)


def _esc(value: str) -> str:
    return (
        value.replace("&", "&amp;")
        .replace('"', "&quot;")
        .replace("<", "&lt;")
    )


def strip_legacy_icon_links(text: str) -> str:
    for pat in (
        r'\s*<link rel="icon"[^>]+>\s*',
        r'\s*<link rel="apple-touch-icon"[^>]+>\s*',
        r'\s*<link rel="manifest"[^>]+>\s*',
    ):
        text = re.sub(pat, "\n", text)
    return text


def upsert_file(path: Path, cfg: dict, page: dict) -> bool:
    rel = str(path.relative_to(FRONTEND)).replace("\\", "/")
    prefix = asset_prefix(rel)
    text = path.read_text(encoding="utf-8")
    title = page["title"]
    title_tag = f"    <title>{title}</title>"

    if not re.search(r'<meta charset="utf-8"\s*/>', text):
        print(f"skip (no charset): {rel}", file=sys.stderr)
        return False

    block = render_seo_block(cfg, page, prefix)

    text = strip_legacy_icon_links(text)
    text = re.sub(r"\s*<title>[^<]*</title>\s*", "\n", text)
    text = re.sub(
        re.escape(MARKER_START) + r"[\s\S]*?" + re.escape(MARKER_END),
        "",
        text,
    )
    text = re.sub(r'\s*<meta charset="utf-8"\s*/>\s*', "", text)
    text = re.sub(r'<meta name="viewport"[^>]*/>\s*', "", text)

    block = "\n".join(
        line if line.startswith("<!--") else f"    {line.lstrip()}" if line.strip() else line
        for line in block.splitlines()
    )
    head_prefix = (
        "    <meta charset=\"utf-8\" />\n"
        "    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />\n"
        f"{title_tag}\n"
        f"{block}\n"
    )
    text = re.sub(r"<head>\s*", "<head>\n", text, count=1)
    text = re.sub(r"<head>\n", "<head>\n" + head_prefix, text, count=1)

    path.write_text(text, encoding="utf-8")
    return True


def main() -> int:
    cfg = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    pages: dict = cfg["pages"]
    updated = 0
    for rel, page in pages.items():
        path = FRONTEND / rel
        if not path.is_file():
            print(f"missing: {rel}", file=sys.stderr)
            continue
        if upsert_file(path, cfg, page):
            updated += 1
            print(f"updated: {rel}")
    print(f"Done. {updated} file(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
