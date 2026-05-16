#!/usr/bin/env python3
"""Regenerate BalanceWhiz favicon PNG/ICO assets from design constants."""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1] / "frontend"
GREEN = (11, 61, 46, 255)
SAGE = (159, 212, 184, 255)
SAGE_SOFT = (159, 212, 184, 100)
WHITE = (255, 255, 255, 255)
BG_DARK = (11, 61, 46, 255)
PTS = [(0.14, 0.74), (0.36, 0.52), (0.54, 0.58), (0.82, 0.26)]


def to_xy(size: float, pad: float, pt: tuple[float, float]) -> tuple[float, float]:
    m = size * pad
    span = size - 2 * m
    x, y = pt
    return (m + span * x, m + span * y)


def draw_trend(
    size: int,
    *,
    pad: float = 0.14,
    stroke=GREEN,
    accent_outer=SAGE,
    accent_inner=GREEN,
    baseline: bool = False,
    bg=None,
) -> Image.Image:
    img = Image.new("RGBA", (size, size), bg or (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    xy = [to_xy(size, pad, p) for p in PTS]
    sw = max(2, round(size * 0.09))
    if baseline:
        d.line(
            [to_xy(size, pad, (0.12, 0.78)), to_xy(size, pad, (0.88, 0.78))],
            fill=SAGE_SOFT,
            width=max(1, sw // 2),
        )
    d.line(xy, fill=stroke, width=sw, joint="curve")
    ax, ay = xy[-1]
    r = max(2, round(size * 0.115))
    d.ellipse([ax - r, ay - r, ax + r, ay + r], fill=accent_outer)
    ir = max(1, round(r * 0.52))
    d.ellipse([ax - ir, ay - ir, ax + ir, ay + ir], fill=accent_inner)
    return img


def main() -> None:
    for sz in (16, 32):
        draw_trend(sz, baseline=(sz >= 32)).save(ROOT / f"favicon-{sz}.png")
    draw_trend(32, baseline=True).save(ROOT / "favicon.png")

    touch = Image.new("RGBA", (180, 180), BG_DARK)
    mark = draw_trend(
        108,
        pad=0.16,
        stroke=(168, 224, 191, 255),
        accent_outer=(168, 224, 191, 255),
        accent_inner=WHITE,
    )
    touch.paste(mark, (36, 36), mark)
    touch.save(ROOT / "apple-touch-icon.png")

    i16 = Image.open(ROOT / "favicon-16.png").convert("RGBA")
    i32 = Image.open(ROOT / "favicon-32.png").convert("RGBA")
    i32.save(ROOT / "favicon.ico", format="ICO", sizes=[(16, 16), (32, 32)], append_images=[i16])
    print("Generated favicon assets in", ROOT)


if __name__ == "__main__":
    main()
