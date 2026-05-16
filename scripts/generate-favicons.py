#!/usr/bin/env python3
"""Regenerate BalanceWhiz favicon PNG/ICO assets from design constants."""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1] / "frontend"
# Bright mint / off-white for tab readability on dark browser chrome
STROKE = (232, 247, 238, 255)
NODE = (200, 240, 216, 255)
BG_DARK = (11, 61, 46, 255)
# Simplified 3-point trend (fewer bends, bolder at small sizes)
PTS = [(0.17, 0.76), (0.42, 0.56), (0.8, 0.24)]


def to_xy(size: float, pad: float, pt: tuple[float, float]) -> tuple[float, float]:
    m = size * pad
    span = size - 2 * m
    x, y = pt
    return (m + span * x, m + span * y)


def draw_favicon_mark(
    size: int,
    *,
    pad: float = 0.1,
    stroke=STROKE,
    node=NODE,
    bg=None,
) -> Image.Image:
    img = Image.new("RGBA", (size, size), bg or (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    xy = [to_xy(size, pad, p) for p in PTS]
    # Thick stroke scales with canvas — stays legible at 16px
    sw = max(3, round(size * 0.16))
    d.line(xy, fill=stroke, width=sw, joint="curve")
    ax, ay = xy[-1]
    nr = max(3, round(size * 0.14))
    d.ellipse([ax - nr, ay - nr, ax + nr, ay + nr], fill=node)
    return img


def main() -> None:
    for sz in (16, 32):
        draw_favicon_mark(sz).save(ROOT / f"favicon-{sz}.png")
    draw_favicon_mark(32).save(ROOT / "favicon.png")

    touch = Image.new("RGBA", (180, 180), BG_DARK)
    mark = draw_favicon_mark(108, pad=0.14)
    touch.paste(mark, (36, 36), mark)
    touch.save(ROOT / "apple-touch-icon.png")

    i16 = Image.open(ROOT / "favicon-16.png").convert("RGBA")
    i32 = Image.open(ROOT / "favicon-32.png").convert("RGBA")
    i32.save(ROOT / "favicon.ico", format="ICO", sizes=[(16, 16), (32, 32)], append_images=[i16])
    print("Generated favicon assets in", ROOT)


if __name__ == "__main__":
    main()
