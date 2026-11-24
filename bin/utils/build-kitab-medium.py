"""Build the local Medium from tafsir.app's kitab-base.woff2.

Requires fonttools, brotli and freetype-py. The upstream OFL accompanies the
fonts in public/static/fonts. Regular and Bold are the publisher's originals.
"""
from ctypes import byref
from io import BytesIO
from pathlib import Path

import freetype
from fontTools.ttLib import TTFont
from fontTools.ttLib.tables._g_l_y_f import GlyphCoordinates


def build_medium():
    directory = Path(__file__).resolve().parents[2] / "public/static/fonts"
    font = TTFont(directory / "kitab-base.woff2", recalcTimestamp=False)
    font.flavor = None
    stream = BytesIO()
    font.save(stream)
    stream.seek(0)
    face = freetype.Face(stream)

    # Widen strokes symmetrically. Keep joining advances, mark anchors,
    # component transforms and OpenType substitution/positioning tables.
    strength = round(font["head"].unitsPerEm * 24 / 2048)
    offset = strength // 2
    for index, name in enumerate(font.getGlyphOrder()):
        glyph = font["glyf"][name]
        if glyph.numberOfContours <= 0:
            continue
        face.load_glyph(index, freetype.FT_LOAD_NO_SCALE | freetype.FT_LOAD_NO_HINTING)
        outline = face.glyph.outline
        before = outline.points
        if len(before) != len(glyph.coordinates):
            raise ValueError(f"Unexpected point count for {name}")
        if freetype.FT_Outline_EmboldenXY(byref(outline._FT_Outline), strength, strength):
            raise ValueError(f"Unable to expand {name}")
        glyph.coordinates = GlyphCoordinates([
            (x + new_x - old_x - offset, y + new_y - old_y - offset)
            for (x, y), (new_x, new_y), (old_x, old_y)
            in zip(glyph.coordinates, outline.points, before)
        ])

    font["OS/2"].usWeightClass = 500
    font["OS/2"].fsSelection &= ~(1 << 6)  # Clear the Regular flag.
    names = {
        1: "HadithDB Kitab Medium", 2: "Regular", 3: "HadithDB-Kitab-Medium-1",
        4: "HadithDB Kitab Medium", 6: "HadithDBKitab-Medium",
        16: "HadithDB Kitab", 17: "Medium",
    }
    for record in font["name"].names:
        if record.nameID in names:
            record.string = names[record.nameID].encode(record.getEncoding())
    font.flavor = "woff2"
    font.save(directory / "kitab-medium.woff2")


if __name__ == "__main__":
    build_medium()
