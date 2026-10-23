import { v5 as uuidv5 } from 'uuid';
import type { Document, Source } from '../api.service';
import {
  BaseNote, ContainerKind, DocumentType, LinePart, LinePartKind, Note, NoteType, RootContainer,
  Syllable, SyllableType,
} from '../types/model';
import { GuidoCell, GuidoNote, decodeCell, stepToPitch } from './guido-decode';
import { DocxCell, DocxContent, readDocx } from './guido-docx-reader';
import { GLYPH_TABLES } from './guido-glyphs';
import { GuidoTemplate, fillPattern, matchPattern } from './guido-template';

/** Namespace of the stable ids: the same file always gives a document the same note ids. */
const ID_NAMESPACE = '7b0f5d0e-6d0e-4f7e-9d57-3a1f4a0c6c11';

export interface GuidoSourceReport {
  siglum: string;
  clef: string;
  /** One line per syllable: text and notes, for the preview. */
  lines: string[];
  syllables: number;
  warnings: string[];
}

export interface GuidoImportResult {
  template: GuidoTemplate;
  title: { id: string; incipit: string; raw: string };
  sources: Source[];
  documents: Document[];
  notes: { [documentId: string]: RootContainer };
  reports: GuidoSourceReport[];
  /** Sources that appear in the file but have nothing attested (only copies in the not-attested colour). */
  skipped: string[];
  warnings: string[];
}

interface Syl { text: string; cell: GuidoCell }
interface SourceDoc { siglum: string; syllables: Syl[]; clef: string; warnings: string[] }
interface Phrase {
  defaultText: Map<number, string>;
  order: string[];
  codes: Map<string, Map<number, string | null>>;
  textOverride: Map<string, Map<number, string>>;
}

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();
const plain = (c: DocxCell | undefined) => collapse((c?.runs ?? []).map(r => r.text).join(''));

/** Documents, sources and notes for the whole file; nothing is stored. */
export function importGuido(content: DocxContent, template: GuidoTemplate, fileName = ''): GuidoImportResult {
  const table = GLYPH_TABLES[template.glyphTable];
  if (!table) throw new Error(`Unknown glyph table "${template.glyphTable}".`);
  const grey = template.notAttestedColor.toUpperCase();
  const font = template.codeFont.toLowerCase();
  const { siglumColumn, firstCodeColumn } = template.layout;

  /** The code of the attested runs of a cell, and whether the cell has any run at all. */
  const attested = (cell: DocxCell | undefined): { code: string; any: boolean } => {
    let any = false;
    let code = '';
    for (const r of cell?.runs ?? []) {
      if (!r.text) continue;
      any = true;
      if (grey && r.color === grey) continue;
      if (font && (r.font ?? '').toLowerCase() !== font) continue;
      code += r.text;
    }
    return { code, any };
  };

  const phrases: Phrase[] = content.tables.map(t => {
    const ph: Phrase = { defaultText: new Map(), order: [], codes: new Map(), textOverride: new Map() };
    const ncols = t.rows[0]?.length ?? 0;
    let firstTextDone = false;
    let last: string | null = null;
    for (const row of t.rows) {
      const siglum = plain(row[siglumColumn]);
      if (siglum) {
        if (!ph.codes.has(siglum)) {
          ph.order.push(siglum);
          ph.codes.set(siglum, new Map());
          ph.textOverride.set(siglum, new Map());
        }
        for (let ci = firstCodeColumn; ci < ncols; ci++) {
          if (ci === siglumColumn) continue;
          const { code, any } = attested(row[ci]);
          if (any) ph.codes.get(siglum)!.set(ci, code ? code : null);
        }
        last = siglum;
      } else {
        const texts = new Map<number, string>();
        for (let ci = firstCodeColumn; ci < ncols; ci++) {
          if (ci === siglumColumn) continue;
          const x = plain(row[ci]);
          if (x) texts.set(ci, x);
        }
        if (!texts.size) continue;
        if (!firstTextDone) {
          texts.forEach((x, ci) => ph.defaultText.set(ci, x));
          firstTextDone = true;
        } else if (last !== null) {
          texts.forEach((x, ci) => ph.textOverride.get(last!)!.set(ci, x));
        }
      }
    }
    return ph;
  });

  const order: string[] = [];
  for (const ph of phrases) for (const s of ph.order) if (!order.includes(s)) order.push(s);
  const docs = new Map<string, SourceDoc>(order.map(s => [s, { siglum: s, syllables: [], clef: '', warnings: [] }]));
  const symbols = { join: template.symbols.join, shortGap: template.symbols.shortGap };

  phrases.forEach((ph, pi) => {
    for (const s of order) {
      const doc = docs.get(s)!;
      const codes = ph.codes.get(s);
      if (!codes) continue;
      for (const ci of Array.from(codes.keys()).sort((a, b) => a - b)) {
        const code = codes.get(ci);
        if (code === null || code === undefined) continue;                  // not attested here
        let text = ph.textOverride.get(s)?.get(ci) || ph.defaultText.get(ci) || '';
        const cell = decodeCell(code, table, symbols);
        if (cell.clef && !doc.clef) doc.clef = cell.clef;
        const where = `phrase ${pi + 1} col ${ci} (${JSON.stringify(text || 'no text')})`;
        if (cell.unhandled.length) {
          doc.warnings.push(`${where}: not decoded ${JSON.stringify(Array.from(new Set(cell.unhandled)).sort())} in ${JSON.stringify(code)}`);
        }
        cell.warnings.forEach(w => doc.warnings.push(`${where}: ${w}`));
        if (!cell.neumes.length) continue;
        if (!text) doc.warnings.push(`${where}: notes without text kept as an empty syllable`);
        if (template.symbols.phrasingMarks === 'text' && cell.punct && !text.endsWith(cell.punct)) text += cell.punct;
        doc.syllables.push({ text, cell });
      }
    }
  });

  const raw = content.paragraphs[template.title.paragraph] ?? '';
  const matched = matchPattern(template.title.pattern, raw);
  const title = { id: matched?.['id'] ?? '', incipit: matched ? (matched['incipit'] ?? '') : collapse(raw), raw };
  // without a number in the title the incipit stands in for it
  const idVars = { id: title.id || title.incipit, incipit: title.incipit };

  const result: GuidoImportResult = {
    template, title, sources: [], documents: [], notes: {}, reports: [], skipped: [], warnings: [],
  };
  if (!content.tables.length) result.warnings.push('The file has no tables.');
  for (const [siglum, doc] of docs) {
    if (!doc.syllables.length) { result.skipped.push(siglum); continue; }
    const docId = safeName(fillPattern(template.document.idPattern, { siglum, ...idVars }));
    const custom: { [k: string]: string } = {};
    for (const [k, pattern] of Object.entries(template.document.custom)) {
      const v = fillPattern(pattern, { siglum, id: title.id, incipit: title.incipit });
      if (v) custom[k] = v;
    }
    if (fileName) custom['import_file'] = fileName;
    result.sources.push({
      id: siglum, quellensigle: siglum, herkunftsregion: '', herkunftsort: '', herkunftsinstitution: '',
      ordenstradition: '', quellentyp: '', bibliotheksort: '', bibliothek: '', bibliothekssignatur: '',
      kommentar: '', datierung: '',
    });
    result.documents.push({
      id: docId, quelle_id: siglum, dokumenten_id: docId, gattung1: '', gattung2: '', festtag: '', feier: '',
      textinitium: fillPattern(template.document.textinitium, { siglum, id: title.id, incipit: title.incipit }),
      bibliographischerverweis: '', druckausgabe: '', zeilenstart: '', foliostart: '', kommentar: '',
      editionsstatus: '', custom,
    });
    result.notes[docId] = rootOf(doc, docId, template);
    result.reports.push({
      siglum, clef: doc.clef, syllables: doc.syllables.length, warnings: doc.warnings,
      lines: doc.syllables.map(s => describe(s)),
    });
  }
  return result;
}

/** Reads the .docx and converts it. */
export async function parseGuidoDocx(
  data: ArrayBuffer | Uint8Array | Blob, template: GuidoTemplate, fileName = ''
): Promise<GuidoImportResult> {
  return importGuido(await readDocx(data), template, fileName);
}

function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '-').trim();
}

function describe(s: Syl): string {
  const name = (n: GuidoNote) => {
    const p = stepToPitch(n.step);
    return `${p.base}${p.octave}${n.shape === 'quilisma' ? '~' : ''}${n.plica ? '^' : ''}`;
  };
  const neumes = s.cell.neumes.map(ne => ne.map(g => g.map(name).join(' ')).join(' / ')).join(' | ');
  return `${s.text || '-'}  ${neumes}${s.cell.punct ? `  [${s.cell.punct}]` : ''}`;
}

// ---------------------------------------------------------------------------------------------
// Monodi model

class Ids {
  private n = 0;
  constructor(private seed: string) {}
  next(): string { return uuidv5(`${this.seed}/${++this.n}`, ID_NAMESPACE); }
}

const ACC_TYPE = { flat: NoteType.Flat, sharp: NoteType.Sharp, natural: NoteType.Natural } as const;

function noteOf(n: GuidoNote, ids: Ids, t: GuidoTemplate): Note {
  const flags: string[] = [];
  const shape = t.mapping.shapes[n.shape];
  let noteType = shape.noteType ?? NoteType.Normal;
  if (shape.flag) flags.push(shape.flag);
  if (n.plica && t.mapping.plicaFlag) flags.push(t.mapping.plicaFlag);
  if (n.accidental) {
    if (n.shape === 'punctum') noteType = ACC_TYPE[n.accidental];
    else if (t.mapping.accidentalFlags[n.accidental]) flags.push(t.mapping.accidentalFlags[n.accidental]);
  }
  const { base, octave } = stepToPitch(n.step);
  const note: Note = { uuid: ids.next(), noteType, base: base as BaseNote, liquescent: false, octave, focus: false };
  if (flags.length) note.flags = flags;
  return note;
}

function syllableOf(s: Syl, ids: Ids, t: GuidoTemplate): Syllable {
  const uuid = ids.next();
  return {
    uuid, kind: LinePartKind.Syllable, text: s.text, syllableType: SyllableType.Normal,
    notes: {
      spaced: s.cell.neumes.map(neume => ({
        nonSpaced: neume.map(group => ({ grouped: group.map(n => noteOf(n, ids, t)) })),
      })),
    },
  };
}

function rootOf(doc: SourceDoc, docId: string, t: GuidoTemplate): RootContainer {
  const ids = new Ids(docId);
  const parts: LinePart[] = [];
  if (doc.clef === 'G' && t.mapping.clef === 'source') {
    parts.push({ kind: LinePartKind.Clef, uuid: ids.next(), focus: false, base: BaseNote.G, octave: 4, shape: 'G' });
  }
  for (const s of doc.syllables) parts.push(syllableOf(s, ids, t));
  const uuid = ids.next();
  const miscUuid = ids.next();
  const zeileUuid = ids.next();
  return {
    kind: ContainerKind.RootContainer, uuid, comments: [], documentType: DocumentType.Level1,
    children: [{
      kind: ContainerKind.MiscContainer, uuid: miscUuid,
      children: [{ kind: ContainerKind.ZeileContainer, uuid: zeileUuid, children: parts }],
    }],
  };
}
