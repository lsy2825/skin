# Builds the app icon masters from the original artwork (the original has black, not transparent, corners).
# usage: IMG=brand/yoonsiljang-icon-original.webp python3 brand/make_icons.py   (run inside brand/ to write the files there)
#   yoonsiljang-icon-1024.png          full-bleed square; corners filled with blurred pink (iOS/Android round them)
#   yoonsiljang-icon-maskable-1024.png artwork at 80% on pink, for Android maskable icons (safe zone = centre 80%)
#   preview.png                        how they look under the iPhone mask, an Android circle, and at 192/48 px
import os, sys
from PIL import Image, ImageDraw, ImageFilter
src = Image.open(os.environ["IMG"]).convert("RGB")
x0, y0, x1, y1 = 17, 20, 1234, 1222              # pink face measured on the original
S = max(x1 - x0, y1 - y0)
L, T = int((x0 + x1 - S) / 2), int((y0 + y1 - S) / 2)
face = src.crop((L, T, L + S, T + S))
def rmask(size, r, inset=0):
    m = Image.new("L", (size, size), 0); ImageDraw.Draw(m).rounded_rectangle([inset, inset, size - 1 - inset, size - 1 - inset], r, fill=255); return m
inner = rmask(S, int(290 * S / 1217), inset=int(6 * S / 1217)).filter(ImageFilter.GaussianBlur(3))
mean = face.resize((1, 1), Image.LANCZOS).getpixel((0, 0))
fill = Image.composite(face, Image.new("RGB", face.size, mean), inner).filter(ImageFilter.GaussianBlur(40))
full = Image.composite(face, fill, inner).resize((1024, 1024), Image.LANCZOS)
full.save("yoonsiljang-icon-1024.png")
mk = Image.new("RGB", (1024, 1024), (247, 214, 222))
mk.paste(full.resize((820, 820), Image.LANCZOS), (102, 102)); mk.save("yoonsiljang-icon-maskable-1024.png")
def masked(img, size, shape):
    im = img.resize((size, size), Image.LANCZOS).convert("RGBA")
    m = Image.new("L", (size, size), 0); d = ImageDraw.Draw(m)
    if shape == "circle": d.ellipse([0, 0, size - 1, size - 1], fill=255)
    else: d.rounded_rectangle([0, 0, size - 1, size - 1], int(size * 0.2237), fill=255)
    im.putalpha(m); return im
sheet = Image.new("RGBA", (1100, 420), (40, 44, 52, 255))
sheet.alpha_composite(masked(full, 320, "ios"), (30, 50))
sheet.alpha_composite(masked(mk, 320, "circle"), (390, 50))
sheet.alpha_composite(masked(full, 192, "ios"), (750, 50))
sheet.alpha_composite(masked(full, 48, "ios"), (970, 50))
light = Image.new("RGBA", (300, 60), (242, 244, 246, 255)); light.alpha_composite(masked(full, 48, "ios"), (8, 6)); sheet.alpha_composite(light, (750, 300))
ImageDraw.Draw(sheet).text((30, 15), "iPhone mask (full-bleed)          Android circle (maskable)          192 / 48 px", fill=(255, 255, 255, 255))
sheet.save("preview.png"); print("ok", (L, T, S))
