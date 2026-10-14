# 죠미 표정 그림 — cut from the user-provided expression sheet only; nothing is redrawn or generated.
# Source of truth: brand/jomi-expressions-original.webp (user-provided 2026-10-14, 1536×1024, transparent background,
# never overwritten). 8 expressions in a 4×2 grid, each with a printed name label underneath (the labels are not used).
# usage (from the repo root): python3 brand/make_expressions.py
#   app/assets/jomi/expr-<id>-96.webp    head, circle-masked, transparent (header, chat, toasts: shown at 20–48 px)
#   app/assets/jomi/expr-<id>-360.webp   whole figure with her sign (?, …, zzz), transparent (intro sheet, empty states)
#   app/assets/jomi/expr-default-160.png head, PNG (PIN screen 76 px; PNG for the widest support)
# The registry that maps expressions to these files is app/jomi.js (docs/JOMI_ASSET_INVENTORY.md).
import os
from PIL import Image, ImageDraw

src = Image.open("brand/jomi-expressions-original.webp").convert("RGBA")
assert src.size == (1536, 1024), src.size
# the printed name labels and captions sit at y 403–520 (top row) and y 884–1024 (bottom row): cleared, never shown
clean = src.copy(); blank = Image.new("RGBA", (1536, 1024), (0, 0, 0, 0))
for y0, y1 in ((403, 520), (884, 1024)): clean.paste(blank.crop((0, y0, 1536, y1)), (0, y0))

# id: (cell box = where the figure is, head box = square around her head; measured on the 1536×1024 sheet)
SHEET = {
    "default":  ((0, 0, 394, 403),        (48, 30, 348, 330)),      # 기본 미소 조미 — 홈 화면, 기본 상태
    "welcome":  ((394, 0, 777, 403),      (440, 15, 750, 325)),     # 자기소개 조미 — 캐릭터 프로필, 첫 인사
    "curious":  ((777, 0, 1135, 403),     (790, 30, 1100, 340)),    # 궁금한 조미 — 피부고민 검색
    "thinking": ((1135, 0, 1536, 403),    (1175, 40, 1475, 340)),   # 생각하는 조미 — 정보 탐색, 고민 중
    "happy":    ((0, 520, 394, 884),      (75, 515, 385, 825)),     # 신나는 조미 — 성공 상황 (윤실장: 담기·저장 완료만)
    "wink":     ((394, 520, 777, 884),    (465, 515, 765, 815)),    # 윙크하는 조미 — 알림 설정 완료, 긍정 피드백
    "empty":    ((777, 520, 1135, 884),   (820, 620, 1110, 910)),   # 시무룩한 조미 — 검색 결과 없음
    "sleeping": ((1135, 520, 1536, 884),  (1145, 605, 1435, 895)),  # 졸린 조미 — 앱 로딩, 대기 상태
}
OUT = "app/assets/jomi"; os.makedirs(OUT, exist_ok=True)

def face(box, size):
    big = size * 4                                            # drawn 4× then reduced = smooth circle edge
    im = clean.crop(box).resize((big, big), Image.LANCZOS)
    m = Image.new("L", (big, big), 0); ImageDraw.Draw(m).ellipse((0, 0, big - 1, big - 1), fill=255)
    a = Image.composite(im, Image.new("RGBA", (big, big), (0, 0, 0, 0)), m)
    return a.resize((size, size), Image.LANCZOS)

def portrait(cell, size, side=400):
    # one scale for every expression (400 sheet px → size) so she is the same size everywhere; the figure is centred
    # left–right and stands on the same floor line, 8 sheet px above the bottom
    fig = clean.crop(cell); bb = fig.getchannel("A").point(lambda v: 255 if v > 16 else 0).getbbox()   # ignore the faint halo
    fig = fig.crop(bb); w, h = fig.size
    assert w <= side and h <= side - 8, (cell, w, h)
    can = Image.new("RGBA", (side, side), (0, 0, 0, 0)); can.paste(fig, ((side - w) // 2, side - 8 - h), fig)
    return can.resize((size, size), Image.LANCZOS)

for k, (cell, head) in SHEET.items():
    face(head, 96).save(f"{OUT}/expr-{k}-96.webp", quality=88, method=6)
    portrait(cell, 360).save(f"{OUT}/expr-{k}-360.webp", quality=86, method=6)
face(SHEET["default"][1], 160).save(f"{OUT}/expr-default-160.png", optimize=True)
for f in sorted(os.listdir(OUT)):
    if f.startswith("expr-"): print(f, os.path.getsize(os.path.join(OUT, f)), "bytes")
