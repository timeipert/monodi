/**
 * A page layout as running text, in German (the wording of the CM source descriptions, so that a print volume can
 * use it next to them) or in English. One paragraph per section; a section of a folio range or a notator starts with
 * it ("F. 1–33v: …", "Notator A: …").
 *
 * Example (Aa 13, German): "37 x 24,5 cm, 15 Notensysteme. Notation auf vier Linien, rote F- (oder f-) und gelbe
 * c-Linie. F- und c-Schlüssel, F-Schlüssel oder c-Schlüssel, der F-Schlüssel punktförmig."
 */
import type { LayoutSection, PageLayout, Range } from './model';
import type { Term } from './vocabulary';
import {
    AREA_SOURCE, ARRANGEMENT, CLEF_CHANGE, CLEF_PLACEMENT, CLEF_SHAPE, COLOUR, CUSTOS, FREQUENCY, INITIAL_KIND, LINE_UNIT,
    RUBRICATION, termOf
} from './vocabulary';

export type Language = 'de' | 'en';

const NUMBER_WORDS: Record<Language, string[]> = {
    de: ['kein', 'ein', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun', 'zehn', 'elf', 'zwölf'],
    en: ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve']
};

const word = (list: readonly Term[], key: string, lang: Language) => termOf(list, key)?.[lang] ?? '';

/** "24,5" or "24.5". */
export function formatNumber(n: number, lang: Language): string {
    const s = String(Math.round(n * 100) / 100);
    return lang === 'de' ? s.replace('.', ',') : s;
}

/** "17–17,5", "24,5" or '' for an empty range. */
export function formatRange(r: Range, lang: Language): string {
    if (r.min === null) return '';
    return r.max === null ? formatNumber(r.min, lang) : `${formatNumber(r.min, lang)}–${formatNumber(r.max, lang)}`;
}

/** A small count as a word (as the source descriptions write "zehn Notensysteme"), a larger one in digits. */
function countWord(n: number, lang: Language, feminineDe = false): string {
    if (lang === 'de' && n === 1) return feminineDe ? 'eine' : 'ein';
    return n < NUMBER_WORDS[lang].length ? NUMBER_WORDS[lang][n] : String(n);
}

const countRangeText = (r: Range, lang: Language) =>
    (r.min === null ? '' : r.max === null ? countWord(r.min, lang) : `${countWord(r.min, lang)} ${lang === 'de' ? 'bis' : 'to'} ${countWord(r.max, lang)}`);

/** German colour adjective with its ending: 'e' (nominative plural or feminine singular), 'en' (dative plural). */
function colourDe(key: string, ending: 'e' | 'en'): string {
    const stem = word(COLOUR, key, 'de');
    if (!stem) return '';
    if (key === 'gold') return `golden${ending === 'e' ? 'e' : 'en'}`;
    if (key === 'violet') return `violett${ending}`;
    return stem + ending;
}

const colourEn = (key: string) => word(COLOUR, key, 'en');

/** "a, b und c" / "a, b and c". */
function join(items: string[], lang: Language, last: 'and' | 'or' = 'and'): string {
    const items2 = items.filter(Boolean);
    if (items2.length <= 1) return items2.join('');
    const conj = last === 'and' ? (lang === 'de' ? 'und' : 'and') : (lang === 'de' ? 'oder' : 'or');
    return `${items2.slice(0, -1).join(', ')} ${conj} ${items2[items2.length - 1]}`;
}

/** "selten " / "rarely " or '' for 'always'. */
const freqPrefix = (key: string, lang: Language) => {
    const w = word(FREQUENCY, key, lang);
    return w ? `${w} ` : '';
};

function writingSpaceText(s: LayoutSection, lang: Language): string {
    const w = s.writingSpace;
    const parts: string[] = [];
    const h = formatRange(w.area.height, lang), wd = formatRange(w.area.width, lang);
    if (h || wd) {
        let dim = `${h || '?'} x ${wd || '?'} cm`;
        if (w.areaSource && w.areaSource !== 'measured') {
            const src = w.areaSource === 'literature' && w.areaReference ? w.areaReference : word(AREA_SOURCE, w.areaSource, lang);
            dim += ` (${src})`;
        }
        parts.push(dim);
    }
    if (w.columns === 2) {
        parts.push(lang === 'de' ? 'zweispaltige Anlage' : 'two columns');
        if (w.columnWidth !== null) parts.push(lang === 'de' ? `Spaltenbreite: ${formatNumber(w.columnWidth, lang)} cm` : `column width: ${formatNumber(w.columnWidth, lang)} cm`);
    }
    // One column is the normal case; the source descriptions name only the two-column layout ("zweispaltige Anlage").
    if (w.sideColumn === 'initials' || w.sideColumn === 'margin') {
        const width = w.sideColumnWidth !== null ? formatNumber(w.sideColumnWidth, lang) : '';
        if (lang === 'de') parts.push(`${width ? `${width} cm breite ` : ''}${w.sideColumn === 'initials' ? 'Versalienspalten' : 'Randspalte'}`);
        else parts.push(`${w.sideColumn === 'initials' ? 'columns for initials' : 'margin column'}${width ? ` ${width} cm wide` : ''}`);
    }
    const unit = word(LINE_UNIT, w.lines.unit || 'systems', lang);
    const perColumn = w.columns === 2 ? (lang === 'de' ? ' pro Spalte' : ' per column') : '';
    if (w.lines.variable) {
        const max = w.lines.count.max ?? w.lines.count.min;
        const maxText = max !== null ? ` (max. ${max} ${unit}${perColumn})` : '';
        const dative = unit === 'Notensysteme' ? 'Notensystemen' : unit;
        parts.push(lang === 'de' ? `wechselnde Anzahl von ${dative}${maxText}` : `varying number of ${unit}${maxText}`);
    } else if (w.lines.count.min !== null) {
        parts.push(`${countRangeText(w.lines.count, lang)} ${unit}${perColumn}`);
    }
    return parts.join(', ');
}

function rulingDe(keys: string[]): string {
    const forms: Record<string, string> = { drypoint: 'blindgeritzten', ink: 'mit Tinte gezogenen', plummet: 'mit Stift gezogenen' };
    return keys.map(k => forms[k]).filter(Boolean).join(' oder ');
}

function rulingEn(keys: string[]): string {
    const forms: Record<string, string> = { drypoint: 'dry-point', ink: 'ink', plummet: 'plummet' };
    return keys.map(k => forms[k]).filter(Boolean).join(' or ');
}

function stavesText(s: LayoutSection, lang: Language): string {
    const st = s.staves;
    const parts: string[] = [];
    if (st.heighting === 'unheighted') parts.push(lang === 'de' ? 'Adiastematische Neumen' : 'Unheighted (adiastematic) neumes');
    if (st.lineCount === 0) {
        parts.push(lang === 'de' ? (parts.length ? 'ohne Linien' : 'Notation ohne Linien') : (parts.length ? 'without lines' : 'Notation without lines'));
    } else if (st.lineCount !== null) {
        const others = st.otherLineCounts.map(o => {
            const f = word(FREQUENCY, o.frequency, lang);
            return `${f ? `(${f}) ` : ''}${countWord(o.count, lang, true)}`;
        });
        const counts = [countWord(st.lineCount, lang, true), ...others].join(lang === 'de' ? ' oder ' : ' or ');
        if (lang === 'de') {
            const adj = [rulingDe(st.ruling), st.lineColour ? colourDe(st.lineColour, 'en') : ''].filter(Boolean).join(' ');
            const noun = st.lineCount === 1 && !others.length ? (st.ruling.includes('drypoint') && !st.lineColour ? 'Blindlinie' : 'Linie') : 'Linien';
            const adjText = noun === 'Blindlinie' ? '' : adj;
            const one = st.lineCount === 1 && !others.length ? 'einer' : counts;
            parts.push(`${parts.length ? 'auf' : 'Notation auf'} ${one}${adjText ? ` ${adjText}` : ''} ${noun}`);
        } else {
            const adj = [rulingEn(st.ruling), st.lineColour ? colourEn(st.lineColour) : ''].filter(Boolean).join(' ');
            parts.push(`${parts.length ? 'on' : 'Notation on'} ${counts}${adj ? ` ${adj}` : ''} ${st.lineCount === 1 && !others.length ? 'line' : 'lines'}`);
        }
    }
    let sentence = parts.join(' ');
    if (st.textLineAsStaffLine) {
        const f = word(FREQUENCY, st.textLineAsStaffLine, lang);
        sentence += lang === 'de'
            ? ` (die für den Text gezogene Linie ${f ? `wird ${f}` : 'wird'} als weitere Notenlinie mitverwendet)`
            : ` (the line ruled for the text is ${f ? `${f} ` : ''}used as a further staff line)`;
    }
    if (st.arrangement && st.arrangement !== 'alternating') {
        const a = word(ARRANGEMENT, st.arrangement, lang);
        sentence = sentence ? `${sentence}; ${a}` : a.charAt(0).toUpperCase() + a.slice(1);
    }
    const lines = colouredLinesText(s, lang);
    return [sentence, lines].filter(Boolean).join(', ');
}

function colouredLinesText(s: LayoutSection, lang: Language): string {
    const lines = s.colourings.lines;
    if (!lines.length) return '';
    const items = lines.map((l, i) => {
        const last = i === lines.length - 1;
        const f = freqPrefix(l.frequency, lang);
        if (lang === 'de') {
            const p = l.pitch ? `${l.pitch}-${l.alternative ? ` (oder ${l.alternative}-)` : ''}` : '';
            return `${f}${l.colour ? `${colourDe(l.colour, 'e')} ` : ''}${p}${last ? 'Linie' : ''}`.trim();
        }
        const p = l.pitch ? `${l.pitch}${l.alternative ? ` (or ${l.alternative})` : ''}` : '';
        return `${f}${l.colour ? `${colourEn(l.colour)} ` : ''}${p}${last ? ' line' : ''}`.trim();
    });
    return join(items, lang);
}

function clefsText(s: LayoutSection, lang: Language): string {
    const c = s.clefs;
    const parts: string[] = [];
    const clef = lang === 'de' ? 'Schlüssel' : 'clef';
    if (c.uses.length) {
        const allSingle = c.uses.every(u => u.letters.length === 1);
        if (allSingle) {
            const items = c.uses.map((u, i) => `${freqPrefix(u.frequency, lang)}${u.letters[0]}${i === c.uses.length - 1 ? (lang === 'de' ? '-Schlüssel' : ' clef') : (lang === 'de' ? '-' : '')}`);
            parts.push(join(items, lang, 'or'));
        } else {
            const items = c.uses.map(u => {
                const letters = u.letters.map((l, i) => (i === u.letters.length - 1 ? `${l}${lang === 'de' ? '-Schlüssel' : ` ${u.letters.length > 1 ? 'clefs' : 'clef'}`}` : (lang === 'de' ? `${l}-` : l)));
                return `${freqPrefix(u.frequency, lang)}${join(letters, lang)}`;
            });
            parts.push(join(items, lang, 'or'));
        }
    }
    for (const sh of c.shapes) {
        if (sh.shape === 'letter') continue;
        parts.push(lang === 'de' ? `der ${sh.letter}-Schlüssel ${word(CLEF_SHAPE, sh.shape, 'de')}` : `the ${sh.letter} clef ${word(CLEF_SHAPE, sh.shape, 'en')}`);
    }
    if (c.placement === 'none' && !c.uses.length) parts.push(word(CLEF_PLACEMENT, 'none', lang));
    else if (c.placement && c.placement !== 'every-system') parts.push(lang === 'de' ? `Schlüssel ${word(CLEF_PLACEMENT, c.placement, lang)}` : `${clef}s ${word(CLEF_PLACEMENT, c.placement, lang)}`);
    if (c.changes && c.changes !== 'none') parts.push(word(CLEF_CHANGE, c.changes, lang));
    if (c.custos) parts.push(word(CUSTOS, c.custos, lang));
    const text = parts.join(', ');
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}

function decorationText(s: LayoutSection, lang: Language): string {
    const c = s.colourings;
    const parts: string[] = [];
    if (c.rubrication) {
        const r = word(RUBRICATION, c.rubrication, lang);
        parts.push(r);
    }
    if (c.melismaBands.length) {
        parts.push(lang === 'de'
            ? `${join(c.melismaBands.map(k => colourDe(k, 'e')), lang)} Melismenbänder`
            : `${join(c.melismaBands.map(colourEn), lang)} melisma bands`);
    }
    const i = c.initials;
    if (i.kinds.length || i.colours.length || i.size.min !== null) {
        const colours = lang === 'de' ? join(i.colours.map(k => colourDe(k, 'e')), lang) : join(i.colours.map(colourEn), lang);
        const kinds = i.kinds.length ? i.kinds.map(k => word(INITIAL_KIND, k, lang)) : [lang === 'de' ? 'Initialen' : 'initials'];
        let text = `${colours ? `${colours} ` : ''}${kinds.join(', ')}`;
        if (i.size.min !== null) {
            if (lang === 'de') {
                const a = i.size.min === 1 ? 'ein' : countWord(i.size.min, 'de');
                text += i.size.max !== null ? `, ${a}- bis ${countWord(i.size.max, 'de')}zeilig` : `, ${a}zeilig`;
            } else {
                text += i.size.max !== null ? `, ${i.size.min} to ${i.size.max} lines high` : `, ${i.size.min} line${i.size.min === 1 ? '' : 's'} high`;
            }
        }
        parts.push(text);
    }
    const text = parts.join(', ');
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}

/** The text of one section: up to four sentences (writing space, staves and coloured lines, clefs, decoration). */
export function describeSection(s: LayoutSection, lang: Language): string {
    const sentences = [writingSpaceText(s, lang), stavesText(s, lang), clefsText(s, lang), decorationText(s, lang)]
        .filter(Boolean)
        .map(t => t.charAt(0).toUpperCase() + t.slice(1))
        .map(t => (/[.!?]$/.test(t) ? t : `${t}.`));
    const head = [
        s.folios ? `${lang === 'de' ? 'F.' : 'Fols.'} ${s.folios}` : '',
        s.hand
    ].filter(Boolean).join(', ');
    const note = lang === 'de' ? s.note_de : s.note;
    const body = [...sentences, note ? (/[.!?]$/.test(note) ? note : `${note}.`) : ''].filter(Boolean).join(' ');
    return head && body ? `${head}: ${body}` : body;
}

/** The text of the whole layout, one paragraph per section that has something recorded. */
export function describePageLayout(layout: PageLayout, lang: Language): string {
    return layout.sections.map(s => describeSection(s, lang)).filter(Boolean).join('\n\n');
}
