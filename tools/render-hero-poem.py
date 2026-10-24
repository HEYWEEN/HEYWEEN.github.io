#!/usr/bin/env python3
"""Render the hero title and poem as SVG outlines from a supplied font.

Requires fontTools. The font file stays local and is never copied into the site.
Example:
    python3 tools/render-hero-poem.py --font /path/to/BaoCanMouHuiTing-Regular.ttf
"""

import argparse
import hashlib
from html import escape
from pathlib import Path

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont


FONT_SOURCES = {
    "Kunminghaiouti": "https://www.yegenyou.com/news-read-1554.htm",
    "BaoCanMouHuiTing-Regular": "https://github.com/baocanmou/baocanmou-huiting",
}
DEFAULT_LINES = ("当时只记入山深", "青溪几度到云林")
DEFAULT_TITLE = "HEYWEEN's Blog"


def number(value):
    """Keep path data compact and stable across repeated runs."""
    result = f"{value:.4f}".rstrip("0").rstrip(".")
    return "0" if result in ("", "-0") else result


def comment_text(value):
    return value.replace("--", "- -").rstrip("-")


def layout_line(text, glyph_set, cmap, tracking):
    paths = []
    bounds = []
    cursor = 0
    for character in text:
        glyph = glyph_set[cmap[ord(character)]]
        path_pen = SVGPathPen(glyph_set, ntos=number)
        glyph.draw(path_pen)
        bounds_pen = BoundsPen(glyph_set)
        glyph.draw(bounds_pen)
        if bounds_pen.bounds is not None:
            x_min, y_min, x_max, y_max = bounds_pen.bounds
            bounds.append((x_min + cursor, y_min, x_max + cursor, y_max))
        commands = path_pen.getCommands()
        if commands:
            paths.append((cursor, commands))
        cursor += glyph.width + tracking
    if not bounds:
        raise ValueError("Each poem line must contain a visible glyph outline.")
    return {
        "text": text,
        "paths": paths,
        "bounds": (
            min(item[0] for item in bounds),
            min(item[1] for item in bounds),
            max(item[2] for item in bounds),
            max(item[3] for item in bounds),
        ),
    }


def render_svg(line, y_min, y_max, padding, provenance, css_class="poem-lettering"):
    x_min, _, x_max, _ = line["bounds"]
    width = x_max - x_min + 2 * padding
    height = y_max - y_min + 2 * padding
    svg = [
        f'<!-- {comment_text(provenance)} -->',
        f'<svg xmlns="http://www.w3.org/2000/svg" class="{css_class}" '
        f'viewBox="0 0 {number(width)} {number(height)}" '
        'fill="currentColor" aria-hidden="true" focusable="false">',
        f'  <title>{escape(line["text"])}</title>',
        f'  <g transform="translate({number(padding - x_min)} '
        f'{number(y_max + padding)}) scale(1 -1)">',
    ]
    for x, path in line["paths"]:
        svg.append(f'    <path transform="translate({number(x)} 0)" d="{path}"/>')
    svg.extend(("  </g>", "</svg>", ""))
    return "\n".join(svg)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--font", type=Path, required=True, help="Local approved source font")
    parser.add_argument("--first", default=DEFAULT_LINES[0], help="First poem line")
    parser.add_argument("--second", default=DEFAULT_LINES[1], help="Second poem line")
    parser.add_argument("--title", default=DEFAULT_TITLE, help="Hero title")
    args = parser.parse_args()
    if not args.first or not args.second or not args.title:
        parser.error("The hero title and both poem lines must be nonempty.")
    try:
        font_bytes = args.font.read_bytes()
        with TTFont(args.font, recalcTimestamp=False) as font:
            names = font["name"]
            family_names = sorted({
                record.toUnicode() for record in names.names if record.nameID in (1, 4)
            })
            postscript_name = names.getDebugName(6)
            if postscript_name not in FONT_SOURCES:
                parser.error("Use an approved source font: " + ", ".join(FONT_SOURCES))
            cmap = font.getBestCmap()
            if not cmap:
                parser.error("The font has no usable Unicode character map.")
            missing = sorted({c for c in args.first + args.second + args.title if ord(c) not in cmap})
            if missing:
                parser.error("Missing glyphs: " + ", ".join(
                    f"{character} (U+{ord(character):04X})" for character in missing
                ))
            em = font["head"].unitsPerEm
            glyph_set = font.getGlyphSet()
            lines = [layout_line(text, glyph_set, cmap, em * 0.09)
                     for text in (args.first, args.second)]
            title = layout_line(args.title, glyph_set, cmap, em * 0.035)
            y_min = min(line["bounds"][1] for line in lines)
            y_max = max(line["bounds"][3] for line in lines)
            provenance = (
                f"Font: {' / '.join(family_names)}; "
                f"source SHA256: {hashlib.sha256(font_bytes).hexdigest()}; "
                f"author use statement: {FONT_SOURCES[postscript_name]}"
            )
            # Use actual ink bounds, including overhangs, with equal outer padding.
            documents = [render_svg(line, y_min, y_max, em * 0.064, provenance)
                         for line in lines]
            title_document = render_svg(
                title, title["bounds"][1], title["bounds"][3], em * 0.064,
                provenance, "hero-title-lettering"
            )
        output_dir = Path(__file__).resolve().parents[1] / "_includes" / "blog"
        output_dir.mkdir(parents=True, exist_ok=True)
        for index, document in enumerate(documents, start=1):
            output = output_dir / f"poem-line-{index}.svg"
            output.write_text(document, encoding="utf-8", newline="\n")
            print(f"{output}: {len(document.encode('utf-8'))} bytes")
        output = output_dir / "hero-title.svg"
        output.write_text(title_document, encoding="utf-8", newline="\n")
        print(f"{output}: {len(title_document.encode('utf-8'))} bytes")
    except (OSError, ValueError) as error:
        parser.error(str(error))


if __name__ == "__main__":
    main()
