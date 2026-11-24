"""Build the Quran reader's two heavier Old Madina faces (fonttools, brotli, freetype-py)."""
from ctypes import byref
from pathlib import Path

import freetype
from fontTools.pens.t2CharStringPen import T2CharStringPen
from fontTools.ttLib import TTFont


def build(weight, style, strength):
    directory = Path(__file__).resolve().parents[2] / "public/static/fonts"
    source = directory / "DigitalKhattV1.otf"
    font = TTFont(source, recalcTimestamp=False)
    face = freetype.Face(str(source))
    cff = font["CFF2"].cff
    top = cff.topDictIndex[0]
    for index, name in enumerate(font.getGlyphOrder()):
        face.load_glyph(index, freetype.FT_LOAD_NO_SCALE | freetype.FT_LOAD_NO_HINTING)
        outline = face.glyph.outline
        if not outline.n_points:
            continue
        if freetype.FT_Outline_EmboldenXY(byref(outline._FT_Outline), strength, strength):
            raise ValueError(f"Unable to expand {name}")
        pen = T2CharStringPen(None, None, CFF2=True)

        def point(vector):
            return vector.x - strength // 2, vector.y - strength // 2

        def move(vector, _):
            pen.moveTo(point(vector))

        def line(vector, _):
            pen.lineTo(point(vector))

        def curve(a, b, end, _):
            pen.curveTo(point(a), point(b), point(end))

        # FreeType closes the contours; CFF2 closes each path implicitly.
        outline.decompose(move_to=move, line_to=line, cubic_to=curve)
        private = top.CharStrings[name].private
        top.CharStrings[name] = pen.getCharString(private=private, globalSubrs=cff.GlobalSubrs)

    font["OS/2"].usWeightClass = weight
    font["OS/2"].fsSelection &= ~(1 << 6)
    if weight == 700:
        font["OS/2"].fsSelection |= 1 << 5
        font["head"].macStyle |= 1
    family = "HadithDB Hafs"
    full = f"{family} {style}"
    names = {1: full if weight == 500 else family, 2: "Regular" if weight == 500 else style,
             3: full.replace(" ", "-") + "-1", 4: full, 6: "HadithDBHafs-" + style, 16: family, 17: style}
    for record in font["name"].names:
        if record.nameID in names:
            record.string = names[record.nameID].encode(record.getEncoding())
    if "DSIG" in font:
        del font["DSIG"]
    font.flavor = "woff2"
    font.save(directory / f"hafs-{style.lower()}.woff2")


if __name__ == "__main__":
    build(500, "Medium", 12)
    build(700, "Bold", 30)
