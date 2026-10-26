import { Document as MonodiDocument, PublicationContributor, Source } from '../api.service';
import { appendCommentAnnots } from './mei-comment-tree';
import type { MeiHeaderContext } from './mei-header';
import { HeaderWriter } from './mei-header-writer';
import { METADATA_MAPPING } from './metadata-mapping.generated';
import { HeaderLevel, MappingEntry, MappingTarget } from './metadata-mapping.model';

/**
 * Header levels 2 (Standard) and 3 (Extended). Which entries are written, and where, comes from the shared mapping
 * (metadata-mapping.generated.ts). Entries whose value is a plain field are written by one generic rule; entries that need
 * structure (comments, witnesses, credits, publication block, encoding, revision) have a dedicated handler. An entry is
 * written only if its level (or its target's level) is at most the chosen level.
 *
 * Every entry of the mapping that has an MEI target must be listed in HANDLED or NOT_YET_AVAILABLE; a test enforces it,
 * so a new entry in the specification cannot be silently ignored.
 */

/** Value of a generic entry: text values, an attribute value, or text values that carry attributes. */
interface Value {
  texts?: string[];
  attr?: string;
  items?: { text: string; attrs: Record<string, string> }[];
}

type Handler = (h: Builder, entry: MappingEntry, targets: MappingTarget[]) => void;

/** Entries that cannot be written inside Monodi-Zero because the value exists only in the CM tables or needs data Monodi-Zero lacks, with the reason. */
export const NOT_YET_AVAILABLE: Record<string, string> = {
  'doc.incipit_addition': 'value only in the CM column "Zusatz zu Textinitium"',
  'doc.vocabularies': 'needs a vocabulary list in the project settings',
  'doc.text_reference': 'value only in the CM column "Nachweis_Editionseinheit"',
  'doc.relations': 'needs relation targets as document references',
  'doc.subcorpus': 'value only in the CM column "subcorpus"',
  'doc.cantus': 'values only in the CM columns "Cantus_ID", "Cantus_Melody_ID", "Cantus_Genre"',
  'doc.hub_extra': 'values only in CM columns',
  'doc.iiif': 'value only in the CM column "IIIFs"; the target path is invalid in the bundled MEI 5.0 schema (item has no ptr child)',
  'doc.facsimile': 'content, not header',
  'doc.editor': 'the person per document is known only in the CM sheets (column "Editor")',
  'doc.source_link': 'needs the file name of the TEI file of the source',
  'src.date_normalized': 'values only in the CM columns "Datierung", "Jahrhundert", "cantus_century"'
};

function slug(sig: string): string {
  return sig.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function nonEmpty(...values: (string | undefined | null)[]): string[] {
  return values.map(v => (v ?? '').trim()).filter(v => v.length > 0);
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

class Builder {
  readonly w: HeaderWriter;
  readonly doc: MonodiDocument | undefined;
  readonly source: Source | undefined;
  readonly siglum: string;
  readonly now: Date;

  constructor(readonly dom: Document, readonly ctx: MeiHeaderContext) {
    this.w = new HeaderWriter(dom, 'meiHead', METADATA_MAPPING.aliases);
    this.doc = ctx.documentMeta;
    this.source = ctx.sourceMeta;
    this.siglum = (ctx.sourceSiglum || ctx.sourceMeta?.quellensigle || '').trim();
    this.now = ctx.now ?? new Date();
  }

  get level(): HeaderLevel { return this.ctx.level; }

  /** Targets of the entry that are active at the chosen level. */
  active(entry: MappingEntry): MappingTarget[] {
    return entry.targets.filter(t => t.level <= this.level);
  }

  /** Writes a generic value to every active target of the entry. */
  write(targets: MappingTarget[], value: Value | undefined): void {
    if (!value) return;
    for (const t of targets) {
      const isAttr = /(^|\/)@[A-Za-z:.]+$/.test(t.path);
      if (isAttr) {
        if (value.attr) this.w.put(t.path, value.attr);
      } else {
        (value.texts ?? []).forEach(text => this.w.put(t.path, text));
        (value.items ?? []).forEach(it => {
          const path = t.path.replace('[@type]', `[@type='${it.attrs['type'] ?? ''}']`);
          this.w.put(path, it.text);
        });
      }
    }
  }
}

/** Generic entries: one function from the Monodi data to a value; the spec decides where it goes. */
const GENERIC: Record<string, (b: Builder) => Value | undefined> = {
  'doc.id': b => ({ texts: nonEmpty(b.doc?.dokumenten_id) }),
  'doc.uuid': b => {
    const base = (b.ctx.publication?.documentBaseUri ?? '').trim();
    const id = (b.doc?.id ?? '').trim();
    return base && id ? { texts: [base + id] } : undefined;
  },
  'doc.incipit': b => ({ texts: nonEmpty(b.doc?.textinitium) }),
  'doc.genre': b => ({ texts: nonEmpty(b.doc?.gattung1, b.doc?.gattung2) }),
  'doc.feast': b => ({ texts: nonEmpty(b.doc?.festtag, b.doc?.feier) }),
  'doc.folio': b => {
    const folio = (b.doc?.foliostart ?? '').trim();
    const line = (b.doc?.zeilenstart ?? '').trim();
    if (!folio && !line) return undefined;
    const text = [folio ? `f. ${folio}` : '', line ? `l. ${line}` : ''].filter(x => x).join(', ');
    // @from is a single token: a folio with a column ("7v a") stays in the text only
    return { texts: [text], attr: /^\S+$/.test(folio) ? folio : undefined };
  },
  'doc.bibl_ref': b => ({ texts: nonEmpty(b.doc?.bibliographischerverweis) }),
  'doc.print_edition': b => ({ texts: nonEmpty(b.doc?.druckausgabe) }),
  'doc.comment': b => ({ texts: nonEmpty(b.doc?.kommentar) }),
  'doc.edition_status': b => ({ texts: nonEmpty(b.doc?.editionsstatus) }),
  'doc.source_ref': b => (b.siglum ? { attr: 'wit-' + slug(b.siglum) } : undefined),
  'doc.lang': b => {
    const lang = (b.ctx.publication?.language ?? '').trim();
    return lang ? { attr: lang } : undefined;
  },
  'doc.custom': b => ({
    items: Object.entries(b.doc?.custom ?? {})
      // a value with an e-mail address never goes into an export header (rule 2 of CM-hub/docs/METADATA-STANDARDS.md)
      .filter(([k, v]) => k.trim() && (v ?? '').trim() && !(v ?? '').includes('@'))
      .map(([k, v]) => ({ text: v.trim(), attrs: { type: k.replace(/'/g, '') } }))
  }),
  'src.siglum': b => ({ texts: nonEmpty(b.siglum) }),
  'src.library': b => ({ texts: [nonEmpty(b.source?.bibliothek, b.source?.bibliotheksort).join(', ')].filter(x => x) }),
  'src.shelfmark': b => ({ texts: nonEmpty(b.source?.bibliothekssignatur) }),
  'src.date_text': b => ({ texts: nonEmpty(b.source?.datierung) })
};

/** Entries with their own handler. */
const SPECIAL: Record<string, Handler> = {
  'doc.critical_comments': (b, _e, targets) => {
    if (!targets.length || !b.ctx.root.comments?.length) return;
    const notesStmt = b.w.ensure('fileDesc/notesStmt', false);
    appendCommentAnnots(b.dom, notesStmt, b.ctx.root);
  },
  'doc.witnesses': (b, _e, targets) => {
    if (!targets.length) return;
    const own = b.siglum;
    const sigla = new Set<string>();
    b.ctx.root.comments?.forEach(c => c?.readingWitnesses?.forEach(sig => { if (sig && sig !== own) sigla.add(sig); }));
    Array.from(sigla).sort().forEach(sig => {
      const source = b.w.ensure('fileDesc/sourceDesc/source', true);
      source.setAttribute('xml:id', 'wit-' + slug(sig));
      const bibl = b.w.el('bibl');
      bibl.appendChild(b.w.el('identifier', sig, { type: 'siglum' }));
      source.appendChild(bibl);
    });
  },
  'doc.project_credits': (b, _e, targets) => {
    if (!targets.length) return;
    (b.ctx.publication?.contributors ?? []).forEach((c: PublicationContributor) => {
      const name = (c.name ?? '').trim();
      const role = (c.role ?? '').trim();
      if (!name) return;
      const stmt = b.w.ensure('fileDesc/seriesStmt/respStmt', true);
      if (role) stmt.appendChild(b.w.el('resp', role));
      const attrs: Record<string, string> = {};
      if (b.level >= 3 && c.orcid) Object.assign(attrs, { auth: 'ORCID', 'auth.uri': 'https://orcid.org/', codedval: c.orcid.trim() });
      else if (b.level >= 3 && c.gnd) Object.assign(attrs, { auth: 'GND', 'auth.uri': 'http://d-nb.info/gnd/', codedval: c.gnd.trim() });
      stmt.appendChild(b.w.el('persName', name, attrs));
    });
  },
  'doc.publication': (b, _e, targets) => {
    if (!targets.length) return;
    const pub = b.ctx.publication ?? {};
    const publisher = (pub.publisher ?? '').trim();
    if (publisher) {
      b.w.ensure('fileDesc/pubStmt/respStmt', true).appendChild(b.w.el('corpName', publisher, { role: 'publisher' }));
    }
    const lines = nonEmpty(...(pub.address ?? []));
    if (lines.length) {
      const address = b.w.ensure('fileDesc/pubStmt/address', true);
      lines.forEach(l => address.appendChild(b.w.el('addrLine', l)));
    }
    const licenceUri = (pub.licenseUri ?? '').trim();
    const licenceLabel = (pub.licenseLabel ?? '').trim();
    if (licenceUri || licenceLabel) {
      const el = b.w.ensure('fileDesc/pubStmt/availability/useRestrict', true);
      el.textContent = licenceLabel || licenceUri;
      if (licenceUri) el.setAttribute('auth.uri', licenceUri);
    }
    b.w.put('fileDesc/pubStmt/date/@isodate', isoDate(b.now));
    const series = (pub.seriesTitle ?? '').trim() || publisher;
    if (series) {
      b.w.put('fileDesc/seriesStmt/title', series);
      const funder = (pub.funderName ?? '').trim();
      if (funder) b.w.put('fileDesc/seriesStmt/funder', funder);
    }
    if (!licenceUri) {
      // Rule 3 of CM-hub/docs/METADATA-STANDARDS.md: without a licence the export is a draft.
      b.w.put("fileDesc/notesStmt/annot[@type='status']", 'Draft: not for publication (no licence is set in the project settings).');
    }
  },
  'doc.encoding': (b, _e, targets) => {
    if (!targets.length) return;
    const app = b.w.ensure('encodingDesc/appInfo/application', true);
    app.appendChild(b.w.el('name', 'Monodi-Zero'));
    const version = (b.ctx.appVersion ?? '').trim();
    if (version) app.setAttribute('version', version);
  },
  'doc.revision': (b, _e, targets) => {
    if (!targets.length) return;
    const change = b.w.ensure('revisionDesc/change', true);
    change.setAttribute('isodate', isoDate(b.now));
    const version = (b.ctx.appVersion ?? '').trim();
    const desc = b.w.el('changeDesc');
    desc.appendChild(b.w.el('p', 'Exported with Monodi-Zero' + (version ? ' ' + version : '') + '.'));
    change.appendChild(desc);
  }
};

/** Entry ids the mapped header knows how to write. */
export const HANDLED: string[] = [...Object.keys(GENERIC), ...Object.keys(SPECIAL)];

export function buildMappedHead(dom: Document, ctx: MeiHeaderContext): Element {
  const b = new Builder(dom, ctx);
  for (const entry of METADATA_MAPPING.entries) {
    const targets = b.active(entry);
    if (!targets.length) continue;
    const special = SPECIAL[entry.id];
    if (special) {
      special(b, entry, targets);
      continue;
    }
    const generic = GENERIC[entry.id];
    if (generic) b.write(targets, generic(b));
  }
  b.w.finish(ctx.documentMeta?.dokumenten_id || 'Exported from Monodi+');
  return b.w.root;
}
