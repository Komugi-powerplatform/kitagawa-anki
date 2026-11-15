"""アプリのアイコン（PNG）を作る。python3 scripts/make_icons.py"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent.parent / "public"
BG, CARD, ACCENT = (47, 111, 94), (246, 245, 241), (47, 111, 94)
FONT = "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc"


def icon(size: int) -> Image.Image:
    s = size * 4
    img = Image.new("RGB", (s, s), BG)
    d = ImageDraw.Draw(img)
    # 重なった2枚のカード
    d.rounded_rectangle([s * .30, s * .18, s * .82, s * .70], radius=s * .06, fill=(120, 170, 150))
    d.rounded_rectangle([s * .18, s * .30, s * .70, s * .82], radius=s * .06, fill=CARD)
    font = ImageFont.truetype(FONT, int(s * .30))
    d.text((s * .44, s * .56), "K", font=font, fill=ACCENT, anchor="mm")
    return img.resize((size, size), Image.LANCZOS)


for name, size in [("icon-192.png", 192), ("icon-512.png", 512), ("apple-touch-icon.png", 180), ("favicon.png", 64)]:
    icon(size).save(OUT / name)
    print(OUT / name)
