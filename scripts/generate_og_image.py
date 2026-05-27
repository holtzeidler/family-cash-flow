#!/usr/bin/env python3
"""Generate BalanceWhiz Open Graph share image (1200x630)."""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1] / "frontend" / "assets"
OUT = ROOT / "og-image.png"
W, H = 1200, 630
BG = (11, 61, 46, 255)
ACCENT = (184, 235, 201, 255)
MUTED = (220, 235, 228, 255)

FONT_CANDIDATES = (
    Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf"),
    Path("/Library/Fonts/Arial Bold.ttf"),
    Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
    Path("/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"),
    Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
)


def load_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    paths = FONT_CANDIDATES if bold else (*FONT_CANDIDATES[2:], *FONT_CANDIDATES[:2])
    for path in paths:
        if path.is_file():
            try:
                return ImageFont.truetype(str(path), size)
            except OSError:
                continue
    return ImageFont.load_default()


def main() -> None:
    img = Image.new("RGBA", (W, H), BG)
    d = ImageDraw.Draw(img)

    title_font = load_font(72, bold=True)
    sub_font = load_font(34, bold=False)
    tag_font = load_font(26, bold=False)

    title = "BalanceWhiz"
    subtitle = "Know your future checking balance."
    tagline = "Cash flow forecasting · No bank connection required"

    tb = d.textbbox((0, 0), title, font=title_font)
    tw = tb[2] - tb[0]
    d.text(((W - tw) / 2, 200), title, fill=ACCENT, font=title_font)

    sb = d.textbbox((0, 0), subtitle, font=sub_font)
    sw = sb[2] - sb[0]
    d.text(((W - sw) / 2, 310), subtitle, fill=(255, 255, 255, 255), font=sub_font)

    gb = d.textbbox((0, 0), tagline, font=tag_font)
    gw = gb[2] - gb[0]
    d.text(((W - gw) / 2, 390), tagline, fill=MUTED, font=tag_font)

    # subtle bottom accent bar
    d.rounded_rectangle((80, H - 48, W - 80, H - 28), radius=10, fill=(255, 255, 255, 18))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    img.convert("RGB").save(OUT, format="PNG", optimize=True)
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
