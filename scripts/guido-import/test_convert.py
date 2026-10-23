#!/usr/bin/env python3
"""
Tests for convert.py. Run: python3 -m unittest -v test_convert   (from this folder)

The ground truth is the Dobszay/Bali guide: its 15 worked figures name each neume and give the
keys. The guide was written for the English keyboard; the document at hand was typed on the
Hungarian one, so the figures are translated key for key (y->z, shift+4/7/8 = $ & * -> ! = ( ,
and the guide's "/" spacer -> "-") before they go through the decoder.
Set GUIDO_SAMPLE_DOCX to a real document to also check the whole pipeline.
"""
import json
import os
import unittest
import zipfile
import tempfile
from pathlib import Path

import convert
from convert import TABLE, decode_cell, step_to_pitch

EN_TO_HU = str.maketrans({'y': 'z', 'Y': 'Z', '$': '!', '&': '=', '*': '(', '/': '-'})


def shape(cell):
    """neumes -> groups -> [(step, shape letter, plica)]"""
    letter = {'punctum': 'p', 'virga': 'v', 'quilisma': 'q', 'tenor': 't'}
    return [[[(n.step, letter[n.shape], n.plica) for n in g] for g in ne] for ne in cell.neumes]


def steps(code):
    return [[[(s) for (s, _, _) in g] for g in ne] for ne in shape(decode_cell(code))]


class GlyphTable(unittest.TestCase):
    def test_digits_are_the_calibration(self):
        for d in '0123456789':
            self.assertEqual(TABLE[d], {'cls': 'punctum', 'step': int(d)})

    def test_virga_row_is_hungarian(self):
        row = 'qwertzuiop'
        for i, ch in enumerate(row, 1):
            self.assertEqual(TABLE[ch], {'cls': 'virga', 'step': i}, ch)
        self.assertNotEqual(TABLE['y']['cls'], 'virga')      # y is a low punctum here

    def test_pitch_names(self):
        self.assertEqual(step_to_pitch(0), ('C', 4))
        self.assertEqual(step_to_pitch(4), ('G', 4))
        self.assertEqual(step_to_pitch(7), ('C', 5))
        self.assertEqual(step_to_pitch(-1), ('B', 3))
        self.assertEqual(step_to_pitch(10), ('F', 5))

    def test_plica_ladder_is_shift_digit(self):
        for d, ch in zip('1234567890', "'\"+!%/=()§"):
            self.assertEqual(TABLE[ch], {'cls': 'plica', 'step': int(d)})


class GuideFigures(unittest.TestCase):
    """The 15 figures of section I.5."""

    def figure(self, en):
        return decode_cell(en.translate(EN_TO_HU))

    def test_1_punctum(self):
        self.assertEqual(shape(self.figure('4')), [[[(4, 'p', False)]]])

    def test_2_pes(self):
        self.assertEqual(shape(self.figure('4t')), [[[(4, 'p', False), (5, 'v', False)]]])

    def test_3_clivis_second_with_stroke(self):
        self.assertEqual(steps(self.figure_code('tT4')), [[[5, 4]]])

    def figure_code(self, en):
        return en.translate(EN_TO_HU)

    def test_4_clivis_without_stroke(self):
        self.assertEqual(steps(self.figure_code('t4')), [[[5, 4]]])

    def test_5_6_clivis_third_and_fourth(self):
        self.assertEqual(steps(self.figure_code('tg3')), [[[5, 3]]])
        self.assertEqual(steps(self.figure_code('tG2')), [[[5, 2]]])

    def test_7_8_torculus(self):
        self.assertEqual(steps(self.figure_code('5yY5')), [[[5, 6, 5]]])
        self.assertEqual(steps(self.figure_code('4uU6')), [[[4, 7, 6]]])

    def test_9_scale_with_double_start(self):
        self.assertEqual(steps(self.figure_code('7uU6Y5T4')), [[[7, 7, 6, 5, 4]]])

    def test_10_separated_by_plica(self):
        c = self.figure('7&/yY5T4')
        self.assertEqual(shape(c), [
            [[(7, 'p', True)]],
            [[(6, 'v', False), (5, 'p', False), (4, 'p', False)]]])

    def test_11_ascending_scale_1_3_1(self):
        c = self.figure('4$56u8*')
        self.assertEqual(shape(c), [[[(4, 'p', True), (5, 'p', False), (6, 'p', False),
                                      (7, 'v', False), (8, 'p', True)]]])

    def test_12_13_14_15(self):
        self.assertEqual(steps(self.figure_code('456u')), [[[4, 5, 6, 7]]])
        self.assertEqual(steps(self.figure_code('4t6u')), [[[4, 5, 6, 7]]])
        self.assertEqual(steps(self.figure_code('4t6uU6')), [[[4, 5, 6, 7, 6]]])
        self.assertEqual(steps(self.figure_code('4t/6u6')), [[[4, 5]], [[6, 7, 6]]])


class Semantics(unittest.TestCase):
    def test_n_is_a_short_gap_inside_the_neume_not_liquescence(self):
        # regression: n was once read as a liquescence sign. Its glyph is empty (no outline,
        # 28/1000 em advance), so it can only be a gap; the guide's liquescence tail has an outline.
        c = decode_cell('4\\tT3ne21\\---')
        self.assertEqual(steps('4\\tT3ne21\\---'), [[[4, 5, 3], [3, 2, 1]]])
        self.assertEqual(c.unhandled, [])

    def test_backslash_keeps_one_ligature(self):
        self.assertEqual(steps('3\\4\\t4\\t-------'), [[[3, 4, 5, 4, 5]]])

    def test_trailing_hyphens_are_padding(self):
        self.assertEqual(steps('1----'), [[[1]]])
        self.assertEqual(steps('------'), [])

    def test_phrasing_marks_become_text_not_notes(self):
        c = decode_cell('5---:-')
        self.assertEqual(c.punct, ':')
        self.assertEqual(steps('5---:-'), [[[5]]])

    def test_quilisma_tenor_and_accidentals(self):
        q = decode_cell('4' + '¬')                              # ¬ = quilisma step 3
        self.assertEqual(shape(q), [[[(4, 'p', False), (3, 'q', False)]]])
        self.assertEqual(shape(decode_cell('½'))[0][0][0][1], 't')
        flat = decode_cell('X6')                               # B-flat sign, then B4
        self.assertEqual(flat.neumes[0][0][0].accidental, 'flat')
        orphan = decode_cell('X3')                              # no note on its step
        self.assertTrue(orphan.warnings)

    def test_plica_must_sit_on_its_note(self):
        self.assertTrue(decode_cell('4+').warnings)            # + is the plica of step 3

    def test_unknown_characters_are_reported(self):
        self.assertEqual(decode_cell('4#').unhandled, [])     # # is a C clef: known, ignored
        self.assertEqual(decode_cell('4À').unhandled, ['À'])


class Output(unittest.TestCase):
    def test_note_json(self):
        ids = convert.Ids('x')
        note = convert.note_json(convert.Note(5, 'virga', plica=True), ids, 'descending')
        self.assertEqual((note['base'], note['octave'], note['noteType'], note['flags']),
                         ('A', 4, 'Descending', ['P']))
        self.assertFalse(note['liquescent'])
        q = convert.note_json(convert.Note(2, 'quilisma'), ids, 'descending')
        self.assertEqual(q['noteType'], 'Quilisma')
        n = convert.note_json(convert.Note(5, 'virga'), ids, 'normal')
        self.assertEqual(n['noteType'], 'Normal')

    def test_deterministic_ids(self):
        a = convert.note_json(convert.Note(1, 'punctum'), convert.Ids('doc'), 'normal')
        b = convert.note_json(convert.Note(1, 'punctum'), convert.Ids('doc'), 'normal')
        self.assertEqual(a, b)


SAMPLE = os.environ.get('GUIDO_SAMPLE_DOCX')


@unittest.skipUnless(SAMPLE and Path(SAMPLE).exists(), 'set GUIDO_SAMPLE_DOCX to run')
class Sample(unittest.TestCase):
    def test_pipeline(self):
        with tempfile.TemporaryDirectory() as tmp:
            convert.main([SAMPLE, '--out-dir', tmp])
            z = zipfile.ZipFile(next(Path(tmp).glob('*.monodi.zip')))
            names = z.namelist()
            data = [n for n in names if n.endswith('data.json')]
            self.assertTrue(data)
            by_source = {n.split('/')[0]: json.loads(z.read(n)) for n in data}
            self.assertNotIn('Str-I. 3d', by_source)           # only grey placeholders
            self.assertNotIn('Str-42', by_source)
            notes = {}
            for sig, root in by_source.items():
                line = root['children'][0]['children'][0]['children']
                syl = [p for p in line if p['kind'] == 'Syllable']
                notes[sig] = syl
                for s in syl:
                    for ne in s['notes']['spaced']:
                        for g in ne['nonSpaced']:
                            for n in g['grouped']:
                                self.assertFalse(n['liquescent'])
            first = notes['Str-1'][:3]
            self.assertEqual([s['text'] for s in first], ['Dum', 'sta-', 'ret'])
            texts = [s['text'] for s in notes['Str-1']]
            self.assertIn('ham', texts)                          # the ':' after it is not lyrics
            self.assertFalse([t for t in texts if t[-1:] in ':,;'])
            ret = [n['base'] for ne in first[2]['notes']['spaced'] for g in ne['nonSpaced'] for n in g['grouped']]
            self.assertEqual(ret, ['D', 'F', 'D', 'C'])        # 1 \ e E 1 0
            # BNS-I: its own spelling of Abraham, only where black
            self.assertEqual([s['text'] for s in notes['BNS-I']][:2], ['A-', 'braam'])


if __name__ == '__main__':
    unittest.main()
