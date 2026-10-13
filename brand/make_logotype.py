# 윤실장 logotype: the three syllables drawn from Pretendard Variable (SIL OFL 1.1, app/vendor/fonts/pretendard) at weight
# 780, set tighter than the font (TRACK), with two cat ears on the ㅇ of 윤 and a coral dot after 장.
# usage (from the repo root): python3 brand/make_logotype.py
#   brand/logotype.svg   the master (fill = currentColor, dot = class "lt-dot" so the page colours it per theme)
# The same markup is pasted inline into app/index.html (header + PIN screen) so it follows light/dark mode.
# Needs fontTools + brotli (pip install fonttools brotli). Pretendard's licence allows embedding outlines in a logo;
# the Reserved Font Name only restricts naming a modified font "Pretendard".
import glob
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

SRC, WGHT, TRACK, CHARS = "app/vendor/fonts/pretendard/woff2-dynamic-subset", 780, -150, "윤실장"
files = {}
for f in sorted(glob.glob(SRC + "/*.woff2")):
    cmap = TTFont(f).getBestCmap()
    for c in CHARS:
        if ord(c) in cmap and c not in files:
            files[c] = f
x, parts, box = 0, [], {}
for c in CHARS:
    font = instantiateVariableFont(TTFont(files[c]), {"wght": WGHT}, inplace=False)
    gs, name = font.getGlyphSet(), font.getBestCmap()[ord(c)]
    pen = SVGPathPen(gs, ntos=lambda v: f"{v:.0f}")
    gs[name].draw(TransformPen(pen, (1, 0, 0, -1, x, 0)))          # font y points up, SVG y points down
    bp = BoundsPen(gs); gs[name].draw(bp); b = bp.bounds
    box[c] = (b[0] + x, -b[3], b[2] + x, -b[1])
    parts.append(pen.getCommands())
    x += gs[name].width + TRACK
b = box["윤"]; cx, top = (b[0] + b[2]) / 2, b[1]                   # the ㅇ of 윤 is centred at the top of the syllable
ear = lambda s: f"M{cx + s * 150:.0f} {top + 130:.0f}L{cx + s * 300:.0f} {top - 290:.0f}L{cx + s * 440:.0f} {top + 180:.0f}Z"
dot_x, dot_r = box["장"][2] + 230, 140
vb_y = top - 340
vb_h = max(v[3] for v in box.values()) + 40 - vb_y
svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 {vb_y:.0f} {dot_x + dot_r + 30:.0f} {vb_h:.0f}" role="img" aria-label="윤실장">'
       f'<path fill="currentColor" stroke="currentColor" stroke-width="44" stroke-linejoin="round" d="{ear(-1)}{ear(1)}"/>'
       f'<path fill="currentColor" d="{"".join(parts)}"/>'
       f'<circle class="lt-dot" cx="{dot_x:.0f}" cy="-170" r="{dot_r}"/></svg>')
open("brand/logotype.svg", "w").write(svg + "\n")
print("brand/logotype.svg", len(svg), "bytes")
