#!/usr/bin/env python3
"""Regenerate BalanceWhiz favicon PNG/ICO — typography Bw on brand green."""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1] / "frontend"
BG = (11, 61, 46, 255)
WHITE = (255, 255, 255, 255)
ACCENT = (184, 235, 201, 255)  # #B8EBC9 — Whiz accent on dark green

FONT_CANDIDATES = (
    Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf"),
    Path("/Library/Fonts/Arial Bold.ttf"),
    Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
    Path("/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"),
)


def load_bold_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in FONT_CANDIDATES:
        if path.is_file():
            try:
                return ImageFont.truetype(str(path), size)
            except OSError:
                continue
    return ImageFont.load_default()


def draw_typography_favicon(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    radius = max(2, round(size * 0.22))
    d.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=BG)

    font_size = max(9, round(size * 0.54))
    font = load_bold_font(font_size)
    kern = max(0, round(font_size * 0.07))

    b_box = d.textbbox((0, 0), "B", font=font)
    w_box = d.textbbox((0, 0), "w", font=font)
    b_w = b_box[2] - b_box[0]
    w_w = w_box[2] - w_box[0]
    total_w = b_w + w_w - kern
    ascent = max(abs(b_box[1]), abs(w_box[1]))
    descent = max(b_box[3], w_box[3])
    text_h = descent - min(b_box[1], w_box[1])

    x = (size - total_w) // 2
    y = (size - text_h) // 2 - min(b_box[1], w_box[1])

    d.text((x, y), "B", font=font, fill=WHITE)
    d.text((x + b_w - kern, y), "w", font=font, fill=ACCENT)
    return img


def main() -> None:
    for sz in (16, 32, 48):
        draw_typography_favicon(sz).save(ROOT / f"favicon-{sz}.png")

    draw_typography_favicon(32).save(ROOT / "favicon.png")
    draw_typography_favicon(180).save(ROOT / "apple-touch-icon.png")

    i16 = Image.open(ROOT / "favicon-16.png").convert("RGBA")
    i32 = Image.open(ROOT / "favicon-32.png").convert("RGBA")
    i48 = Image.open(ROOT / "favicon-48.png").convert("RGBA")
    i32.save(
        ROOT / "favicon.ico",
        format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48)],
        append_images=[i16, i48],
    )
    print("Generated typography favicon assets in", ROOT)


if __name__ == "__main__":
    main()
