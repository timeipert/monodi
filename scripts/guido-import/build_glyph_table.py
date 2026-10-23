#!/usr/bin/env python3
"""
Derives glyph_table.json from the guido6+ TrueType file itself.

Why measure instead of trusting the keyboard chart: the font carries a piece of staff
in every note glyph, so a glyph's pitch is *drawn into* it. The table says, for every
character the font maps, what the glyph is (punctum, virga, quilisma, ...) and, for
note-like glyphs, which diatonic step above C4 it sits on. Calibration comes from the
digits 0..9, which the Dobszay/Bali guide defines as consecutive steps of a G clef
(0 = C4 ... 9 = E5).

    python3 build_glyph_table.py "/path/to/guido6+__.TTF" > glyph_table.json
    python3 build_glyph_table.py "/path/to/guido6+__.TTF" --ts GUIDO_GLYPHS_HU > ../../src/app/guido/guido-glyphs.hu.ts

Needs fontTools, Pillow, numpy, scipy (build time only; convert.py only reads the JSON).
"""
import json
import sys

import numpy as np
from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage

SIZE = 200
HOOK_INK = (370, 400)          # small ")" tails: the shift+digit plica signs
CONNECTOR_INK = (300, 700)     # S-shaped strokes joining two notes (2nd..5th)


def render(font, ch):
    img = Image.new('L', (500, 900), 255)
    ImageDraw.Draw(img).text((100, 50), ch, font=font, fill=0)
    return np.array(img) < 128


def analyse(a):
    ink = int(a.sum())
    opened = ndimage.binary_opening(a, structure=np.ones((13, 13)))
    lbl, n = ndimage.label(opened)
    heads = []
    for i in range(1, n + 1):
        ys, xs = np.where(lbl == i)
        heads.append(dict(cy=float(ys.mean()), cx=float(xs.mean()) - 100, area=int(len(ys)),
                          w=int(xs.max() - xs.min() + 1), h=int(ys.max() - ys.min() + 1)))
    stem = 0
    if heads:
        h = heads[0]
        x = int(h['cx'] - h['w'] / 2 + 100)
        col = a[:, max(x - 2, 0):x + 4].any(axis=1)
        for y in range(int(h['cy']), a.shape[0]):
            if col[y]:
                stem += 1
            else:
                break
    lbl2, n2 = ndimage.label(a)
    thin, thin_ink = 0, 0
    for i in range(1, n2 + 1):
        ys, xs = np.where(lbl2 == i)
        if ys.max() - ys.min() + 1 < 9 and xs.max() - xs.min() + 1 > 25:
            thin += 1
            thin_ink += len(ys)
    ys_all = np.where(a)[0]
    return dict(ink=ink, heads=heads, stem=stem, thin=thin, thin_ink=thin_ink,
                mean_y=float(ys_all.mean()) if len(ys_all) else 0.0)


def main(font_path, ts_name=None):
    font = ImageFont.truetype(font_path, SIZE)
    cmap = TTFont(font_path).getBestCmap()

    def head_y(ch):
        return analyse(render(font, ch))['heads'][0]['cy']
    y0, y9 = head_y('0'), head_y('9')
    step_px = (y0 - y9) / 9.0

    def step_of(cy, shift=0.0, tol=0.3):
        s = (y0 - cy) / step_px + shift
        r = round(s)
        return r if abs(s - r) <= tol else None

    table = {}
    for code in sorted(cmap):
        ch = chr(code)
        if ch.isspace():
            continue
        a = render(font, ch)
        if not a.any():
            continue          # empty glyphs (\ and n) are classified in convert.py
        f = analyse(a)
        heads, ink = f['heads'], f['ink']
        entry = None
        if len(heads) >= 1 and heads[0]['area'] > 3000 and heads[0]['w'] > 90:
            entry = dict(cls='clef', clef='G')
        elif len(heads) == 4 and any(h['h'] > 90 and h['w'] < 45 for h in heads):
            entry = dict(cls='clef', clef='F')
        elif len(heads) == 2 and all(h['w'] == 44 for h in heads) and f['stem'] > 40:
            entry = dict(cls='clef', clef='C')
        elif len(heads) == 1 and 1900 <= heads[0]['area'] <= 2500 and 53 <= heads[0]['w'] <= 60:
            st = step_of(heads[0]['cy'])
            if st is not None:
                if f['stem'] >= 100:
                    entry = dict(cls='virga', step=st)
                elif f['stem'] < 40:
                    entry = dict(cls='punctum', step=st)
        elif len(heads) == 2 and abs(heads[0]['cy'] - heads[1]['cy']) < 8 and \
                all(20 <= h['w'] <= 33 for h in heads):
            st = step_of(sum(h['cy'] for h in heads) / 2, tol=0.36)
            if st is not None:
                entry = dict(cls='quilisma' if ink < 5000 else 'tenor', step=st)
        elif len(heads) == 2 and all(h['w'] == 35 for h in heads) and \
                abs(abs(heads[0]['cy'] - heads[1]['cy']) / step_px - 2) < 0.3:
            st = step_of((heads[0]['cy'] + heads[1]['cy']) / 2)
            if st is not None:
                entry = dict(cls='sharp', step=st)
        elif len(heads) == 1 and heads[0]['area'] < 300 and heads[0]['w'] <= 14 and f['stem'] > 0 \
                and ink < 3000:
            st = step_of(heads[0]['cy'], -0.3)
            if st is not None:
                entry = dict(cls='flat', step=st)
        elif not heads and f['thin'] == 0 and HOOK_INK[0] <= ink <= HOOK_INK[1]:
            st = step_of(f['mean_y'], 0.2)
            if st is not None:
                entry = dict(cls='plica', step=st)
        elif not heads and f['thin'] == 0 and CONNECTOR_INK[0] <= ink <= CONNECTOR_INK[1]:
            entry = dict(cls='connector')
        elif not heads and f['thin'] >= 4 and ink - f['thin_ink'] < 30:
            entry = dict(cls='gap')
        if entry:
            table[ch] = entry

    # Not derivable from outlines: barlines are staff + vertical bar, the natural sign has
    # tiny parts. Named after what the guide calls them ("sign for phrasing"); verified by eye.
    for ch in ',.:;':
        if ch in table or ch in cmap.values() or ord(ch) in cmap:
            table[ch] = dict(cls='bar')
    table['<'] = dict(cls='clef', clef='G')
    # The natural sign is built from parts too small for the head detector; it sits on the
    # middle line (B4), like the B-flat 'X' it cancels.
    table['\u2122'] = dict(cls='natural', step=6)

    out = dict(
        font=str(font_path),
        calibration=dict(step0='C4 (digit 0)', step9='E5 (digit 9)', px_per_step=round(step_px, 2)),
        chars=table,
    )
    if ts_name:
        sys.stdout.write(
            '// Generated by scripts/guido-import/build_glyph_table.py from the font; do not edit by hand.\n'
            "import type { GuidoGlyphTable } from './guido-glyphs';\n\n"
            f'export const {ts_name}: GuidoGlyphTable = ')
        json.dump(table, sys.stdout, ensure_ascii=False, indent=1, sort_keys=True)
        sys.stdout.write(';\n')
        return
    json.dump(out, sys.stdout, ensure_ascii=False, indent=1, sort_keys=True)
    sys.stdout.write('\n')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[3] if len(sys.argv) > 3 and sys.argv[2] == '--ts' else None)
