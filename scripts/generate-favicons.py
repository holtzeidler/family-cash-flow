#!/usr/bin/env python3
"""Regenerate BalanceWhiz favicon PNG/ICO assets — dark bold glyph for light browser tabs."""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1] / "frontend"
# Primary brand green — high contrast on light Chrome/Safari tabs
STROKE = (11, 61, 46, 255)
NODE = (11, 61, 46, 255)
BG_DARK = (11, 61, 46, 255)
# Bold diagonal: bottom-left → top-right (minimal detail)
PTS = [(0.1, 0.84), (0.88, 0.16)]


def to_xy(size: float, pad: float, pt: tuple[float, float]) -> tuple[float, float]:
    m = size * pad
    span = size - 2 * m
    x, y = pt
    return (m + span * x, m + span * y)


def draw_favicon_mark(
    size: int,
    *,
    pad: float = 0.07,
    stroke=STROKE,
    node=NODE,
    bg=None,
) -> Image.Image:
    img = Image.new("RGBA", (size, size), bg or (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    xy = [to_xy(size, pad, p) for p in PTS]
    sw = max(4, round(size * 0.22))
    d.line(xy, fill=stroke, width=sw, joint="curve")
    ax, ay = xy[-1]
    nr = max(4, round(size * 0.16))
    d.ellipse([ax - nr, ay - nr, ax + nr, ay + nr], fill=node)
    return img


def main() -> None:
    for sz in (16, 32, 48):
        draw_favicon_mark(sz).save(ROOT / f"favicon-{sz}.png")

    draw_favicon_mark(32).save(ROOT / "favicon.png")

    touch = Image.new("RGBA", (180, 180), BG_DARK)
    mark = draw_favicon_mark(
        120,
        pad=0.1,
        stroke=(255, 255, 255, 255),
        node=(255, 255, 255, 255),
    )
    touch.paste(mark, (30, 30), mark)
    touch.save(ROOT / "apple-touch-icon.png")

    i16 = Image.open(ROOT / "favicon-16.png").convert("RGBA")
    i32 = Image.open(ROOT / "favicon-32.png").convert("RGBA")
    i48 = Image.open(ROOT / "favicon-48.png").convert("RGBA")
    i32.save(
        ROOT / "favicon.ico",
        format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48)],
        append_images=[i16, i48],
    )
    print("Generated favicon assets in", ROOT)


if __name__ == "__main__":
    main()
