# Mascot avatar for the app (top bar, the concern guide): the cat's head cropped from the app icon artwork, in a circle.
# usage (from the repo root): python3 brand/make_mascot.py
#   app/icons/mascot-160.png   160×160 px, transparent outside the circle (shown at 24–64 px, sharp on 2× screens)
from PIL import Image, ImageDraw

src = Image.open("brand/yoonsiljang-icon-1024.png").convert("RGB")
BOX = (290, 40, 830, 580)          # head with both ears, above the paws and the lettering (measured on the 1024 px icon)
S = 160
head = src.crop(BOX).resize((S * 4, S * 4), Image.LANCZOS)
mask = Image.new("L", (S * 4, S * 4), 0)
ImageDraw.Draw(mask).ellipse((0, 0, S * 4 - 1, S * 4 - 1), fill=255)       # drawn 4× then reduced = smooth edge
out = Image.new("RGBA", (S * 4, S * 4)); out.paste(head, (0, 0), mask)
out.resize((S, S), Image.LANCZOS).save("app/icons/mascot-160.png", optimize=True)
print("app/icons/mascot-160.png")
