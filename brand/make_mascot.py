# 죠미(Jomi) images for the app, cut from the official artwork only — nothing is redrawn or generated.
# Source of truth: brand/yoonsiljang-icon-original.webp (user-provided, never overwritten) → yoonsiljang-icon-1024.png
# (make_icons.py) → the crops below. The artwork has one pose: a smiling wink with the tongue out, heart collar.
# usage (from the repo root): python3 brand/make_mascot.py
#   app/assets/jomi/jomi-face-96.webp      head in a circle, 96 px (header, chat bubbles, toasts: shown at 20–48 px)
#   app/assets/jomi/jomi-face-160.png      head in a circle, 160 px PNG (PIN screen 76 px; PNG for the widest support)
#   app/assets/jomi/jomi-portrait-360.webp head, paws and heart collar, rounded square, 360 px (intro sheet, empty states)
# The registry that maps expressions to these files is app/jomi.js; what is still missing: docs/JOMI_ASSET_INVENTORY.md
import os
from PIL import Image, ImageDraw

src = Image.open("brand/yoonsiljang-icon-1024.png").convert("RGB")
os.makedirs("app/assets/jomi", exist_ok=True)

def masked(box, size, shape):
    big = size * 4                                            # drawn 4× then reduced = smooth edge
    im = src.crop(box).resize((big, big), Image.LANCZOS)
    m = Image.new("L", (big, big), 0); d = ImageDraw.Draw(m)
    if shape == "circle": d.ellipse((0, 0, big - 1, big - 1), fill=255)
    else: d.rounded_rectangle((0, 0, big - 1, big - 1), int(big * 0.2), fill=255)
    out = Image.new("RGBA", (big, big)); out.paste(im, (0, 0), m)
    return out.resize((size, size), Image.LANCZOS)

FACE = (290, 40, 830, 580)        # head with both ears, above the paws and the lettering (measured on the 1024 px icon)
PORTRAIT = (262, 0, 838, 576)     # head, paws and the heart collar; stops above the '윤실장' lettering
masked(FACE, 96, "circle").save("app/assets/jomi/jomi-face-96.webp", quality=88, method=6)
masked(FACE, 160, "circle").save("app/assets/jomi/jomi-face-160.png", optimize=True)
masked(PORTRAIT, 360, "rounded").save("app/assets/jomi/jomi-portrait-360.webp", quality=86, method=6)
for f in sorted(os.listdir("app/assets/jomi")):
    print(f, os.path.getsize(os.path.join("app/assets/jomi", f)), "bytes")
