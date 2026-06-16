#!/usr/bin/env python3
"""Regenerate staging favicon PNG/ICO — chart line on brand green (distinct from production Bw)."""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1] / "frontend" / "staging-favicons"
BG = (11, 61, 46, 255)
ACCENT = (184, 235, 201, 255)
GREY = (108, 118, 112, 255)

# Normalized chart points (x, y) in 0..1; y=0 is top.
CHART_POINTS = (
    (0.14, 0.62),
    (0.28, 0.52),
    (0.40, 0.56),
    (0.52, 0.40),
    (0.64, 0.44),
    (0.78, 0.22),
    (0.88, 0.14),
)


def draw_chart_favicon(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    radius = max(2, round(size * 0.22))
    d.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=BG)

    pad = max(2, round(size * 0.12))
    inner_w = size - pad * 2
    inner_h = size - pad * 2

    def px(nx: float) -> int:
        return pad + round(nx * inner_w)

    def py(ny: float) -> int:
        return pad + round(ny * inner_h)

    # Baselines near bottom (mint thick, grey thin above).
    base_y = py(0.88)
    grey_y = py(0.78)
    lw_base = max(2, round(size * 0.09))
    lw_grey = max(1, round(size * 0.05))
    lw_chart = max(2, round(size * 0.09))
    d.line((pad, base_y, size - pad, base_y), fill=ACCENT, width=lw_base)
    d.line((pad, grey_y, size - pad, grey_y), fill=GREY, width=lw_grey)

    pts = [(px(x), py(y)) for x, y in CHART_POINTS]
    d.line(pts, fill=ACCENT, width=lw_chart, joint="curve")
    for x, y in CHART_POINTS[-2:]:
        d.ellipse(
            (px(x) - lw_chart, py(y) - lw_chart, px(x) + lw_chart, py(y) + lw_chart),
            fill=ACCENT,
        )
    return img


def main() -> None:
    ROOT.mkdir(parents=True, exist_ok=True)
    for sz in (16, 32, 48):
        draw_chart_favicon(sz).save(ROOT / f"favicon-{sz}.png")

    draw_chart_favicon(32).save(ROOT / "favicon.png")
    draw_chart_favicon(180).save(ROOT / "apple-touch-icon.png")

    i16 = Image.open(ROOT / "favicon-16.png").convert("RGBA")
    i32 = Image.open(ROOT / "favicon-32.png").convert("RGBA")
    i48 = Image.open(ROOT / "favicon-48.png").convert("RGBA")
    i32.save(
        ROOT / "favicon.ico",
        format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48)],
        append_images=[i16, i48],
    )
    print("Generated staging chart favicon assets in", ROOT)


if __name__ == "__main__":
    main()
