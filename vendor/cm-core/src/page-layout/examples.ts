/**
 * Worked examples: layouts recorded from CM source descriptions (`olyro/data` content/quellenbeschreibungen, section
 * "Schriftraum – Notation – Textschrift", read on 2026-11-12). They serve the tests and as a template in the editor.
 */
import type { PageLayout } from './model';
import { normalisePageLayout } from './model';

/** Aa 13 (Aachen, Domarchiv, Hs. G 13): "37 x 24,5 cm, 15 Notensysteme. … auf vier Linien …, rote F- (oder f-) und
 * gelbe c-Linie, F- und c-Schlüssel, beide auch einzeln, der F-Schlüssel meist punktförmig." */
export const EXAMPLE_AA_13: PageLayout = normalisePageLayout({
    sections: [{
        writingSpace: {
            leaf: { height: { min: 47 }, width: { min: 32.5 } },
            area: { height: { min: 37 }, width: { min: 24.5 } },
            areaSource: 'measured',
            columns: 1,
            lines: { unit: 'systems', count: { min: 15 } }
        },
        staves: { arrangement: 'alternating', heighting: 'heighted', lineCount: 4 },
        colourings: {
            lines: [
                { pitch: 'F', alternative: 'f', colour: 'red' },
                { pitch: 'c', colour: 'yellow' }
            ],
            rubrication: 'throughout',
            initials: { kinds: ['lombard'], colours: ['red'] }
        },
        clefs: {
            uses: [{ letters: ['F', 'c'] }, { letters: ['F'] }, { letters: ['c'] }],
            shapes: [{ letter: 'F', shape: 'dot' }],
            placement: 'every-system'
        }
    }]
});

/** Pa 1871 (Aquitanian notation): "23–25 x 13–14 cm, in der Regel 13 Notensysteme. Aquitanische Notation, eine
 * Blindlinie und Kustoden." */
export const EXAMPLE_PA_1871: PageLayout = normalisePageLayout({
    sections: [{
        writingSpace: {
            area: { height: { min: 23, max: 25 }, width: { min: 13, max: 14 } },
            lines: { unit: 'systems', count: { min: 13 } }
        },
        staves: { arrangement: 'alternating', heighting: 'heighted', lineCount: 1, ruling: ['drypoint'] },
        clefs: { placement: 'none', custos: 'present' }
    }]
});
