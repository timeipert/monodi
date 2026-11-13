import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    EXAMPLE_AA_13, EXAMPLE_PA_1871, VOCABULARY, describePageLayout, describeSection, emptySection, isEmptyLayout,
    measure, normalisePageLayout, normaliseSection, pageDiagramSvg, sectionProblems, staffLinePitches, staffSampleSvg
} from './index.ts';

describe('page layout: vocabulary', () => {
    it('every term has a unique key and an English and German wording', () => {
        for (const [name, list] of Object.entries(VOCABULARY)) {
            const keys = list.map(t => t.key);
            assert.equal(new Set(keys).size, keys.length, name);
            for (const t of list) if (t.key !== 'always') assert.ok(t.en && t.de, `${name}.${t.key}`);
        }
    });
});

describe('page layout: normalisation', () => {
    it('an empty input gives one empty section', () => {
        const l = normalisePageLayout(undefined);
        assert.equal(l.version, 1);
        assert.equal(l.sections.length, 1);
        assert.ok(isEmptyLayout(l));
    });

    it('drops values outside the vocabulary and unknown keys', () => {
        const s = normaliseSection({
            bogus: 1,
            staves: { lineCount: 9, lineColour: 'pink', ruling: ['ink', 'ink', 'laser'] },
            colourings: { lines: [{ pitch: 'H', colour: 'red' }, { pitch: '', colour: '' }] },
            clefs: { uses: [{ letters: ['F', 'X', 'F'] }, { letters: [] }], custos: 'maybe' }
        });
        assert.equal((s as unknown as Record<string, unknown>).bogus, undefined);
        assert.equal(s.staves.lineCount, null);
        assert.equal(s.staves.lineColour, '');
        assert.deepEqual(s.staves.ruling, ['ink']);
        assert.deepEqual(s.colourings.lines, [{ pitch: '', alternative: '', colour: 'red', frequency: 'always' }]);
        assert.deepEqual(s.clefs.uses, [{ letters: ['F'], frequency: 'always' }]);
        assert.equal(s.clefs.custos, '');
    });

    it('reads measures with a decimal comma and keeps a range only when max is above min', () => {
        assert.equal(measure('24,5'), 24.5);
        assert.equal(measure('-3'), null);
        const s = normaliseSection({ writingSpace: { area: { height: { min: '17', max: '17,5' }, width: { min: 12, max: 11 } } } });
        assert.deepEqual(s.writingSpace.area.height, { min: 17, max: 17.5 });
        assert.deepEqual(s.writingSpace.area.width, { min: 12, max: null });
    });

    it('keeps the column width only for two columns', () => {
        assert.equal(normaliseSection({ writingSpace: { columns: 1, columnWidth: 8 } }).writingSpace.columnWidth, null);
        assert.equal(normaliseSection({ writingSpace: { columns: 2, columnWidth: 8.1 } }).writingSpace.columnWidth, 8.1);
    });

    it('is stable: normalising a normalised layout changes nothing', () => {
        assert.deepEqual(normalisePageLayout(JSON.parse(JSON.stringify(EXAMPLE_AA_13))), EXAMPLE_AA_13);
    });
});

describe('page layout: problems', () => {
    it('asks for the German original of a note', () => {
        assert.deepEqual(sectionProblems(normaliseSection({ note: 'Lines faded.' })), ['The note needs both its English text and its German original.']);
        assert.deepEqual(sectionProblems(normaliseSection({ note: 'Lines faded.', note_de: 'Linien verblasst.' })), []);
    });

    it('finds clefs a step apart, which cannot both stand on lines', () => {
        const s = normaliseSection({ clefs: { uses: [{ letters: ['F', 'G'] }] } });
        assert.equal(sectionProblems(s).length, 1);
        assert.deepEqual(sectionProblems(EXAMPLE_AA_13.sections[0]), []);
    });
});

describe('page layout: text', () => {
    it('writes Aa 13 in the wording of the source description', () => {
        assert.equal(describeSection(EXAMPLE_AA_13.sections[0], 'de'),
            '37 x 24,5 cm, 15 Notensysteme. Notation auf vier Linien, rote F- (oder f-) und gelbe c-Linie. '
            + 'F- und c-Schlüssel, F-Schlüssel oder c-Schlüssel, der F-Schlüssel punktförmig. Durchgehend rubriziert, rote Lombarden.');
        assert.equal(describeSection(EXAMPLE_AA_13.sections[0], 'en'),
            '37 x 24.5 cm, 15 staves. Notation on four lines, red F (or f) and yellow c line. '
            + 'F and c clefs, F clef or c clef, the F clef dot-shaped. Rubricated throughout, red Lombardic initials.');
    });

    it('writes an Aquitanian page with one dry-point line and custodes', () => {
        assert.equal(describeSection(EXAMPLE_PA_1871.sections[0], 'de'),
            '23–25 x 13–14 cm, 13 Notensysteme. Notation auf einer Blindlinie. Keine Schlüssel, Kustoden.');
    });

    it('writes single clefs as alternatives and other line counts with their frequency', () => {
        const s = normaliseSection({
            staves: { lineCount: 4, otherLineCounts: [{ count: 5, frequency: 'rarely' }], lineColour: 'red' },
            clefs: { uses: [{ letters: ['F'] }, { letters: ['c'] }, { letters: ['g'], frequency: 'rarely' }] }
        });
        assert.equal(describeSection(s, 'de'), 'Notation auf vier oder (selten) fünf roten Linien. F-, c- oder selten g-Schlüssel.');
    });

    it('starts a section of a folio range or a notator with it, and adds the note in the language', () => {
        const l = normalisePageLayout({ sections: [
            { folios: '1–33v', writingSpace: { lines: { unit: 'systems', count: { min: 13 } } } },
            { hand: 'Notator B', note: 'Lines faded.', note_de: 'Linien verblasst.' }
        ] });
        assert.equal(describePageLayout(l, 'de'), 'F. 1–33v: 13 Notensysteme.\n\nNotator B: Linien verblasst.');
        assert.equal(describePageLayout(l, 'en'), 'Fols. 1–33v: 13 staves.\n\nNotator B: Lines faded.');
    });

    it('writes a varying number of staves per column', () => {
        const s = normaliseSection({ writingSpace: { columns: 2, columnWidth: 8.1, lines: { unit: 'systems', variable: true, count: { min: 15 } } } });
        assert.equal(describeSection(s, 'de'), 'Zweispaltige Anlage, Spaltenbreite: 8,1 cm, wechselnde Anzahl von Notensystemen (max. 15 Notensysteme pro Spalte).');
    });

    it('says nothing for an empty section', () => {
        assert.equal(describeSection(emptySection(), 'de'), '');
    });
});

describe('page layout: drawings', () => {
    it('puts F and c of a four-line staff on D F a c', () => {
        assert.deepEqual(staffLinePitches(EXAMPLE_AA_13.sections[0]), ['D', 'F', 'a', 'c']);
    });

    it('leaves the pitches unknown when nothing is coloured or clefed', () => {
        assert.deepEqual(staffLinePitches(normaliseSection({ staves: { lineCount: 2 } })), [null, null]);
    });

    it('draws the coloured lines in their colours', () => {
        const svg = pageDiagramSvg(EXAMPLE_AA_13.sections[0]);
        assert.ok(svg.startsWith('<svg'));
        assert.ok(svg.includes('#c0392b') && svg.includes('#e0b40a'));
        assert.ok(svg.includes('37 × 24.5 cm · 15 staves'));
        // 15 rows of four staff lines, plus the spine
        assert.equal((svg.match(/<line /g) ?? []).length, 15 * 4 + 1);
    });

    it('says in its title what it had to assume', () => {
        assert.match(pageDiagramSvg(emptySection()), /assumed: size of the written area, size of the leaf, number of lines/);
    });

    it('draws the clef letters and the custos on the staff sample', () => {
        const svg = staffSampleSvg(EXAMPLE_AA_13.sections[0]);
        assert.ok(svg.includes('<circle'), 'dot-shaped F clef');
        assert.ok(svg.includes('>c</text>'), 'c clef letter');
        assert.ok(staffSampleSvg(EXAMPLE_PA_1871.sections[0]).includes('<path'), 'custos');
    });
});
