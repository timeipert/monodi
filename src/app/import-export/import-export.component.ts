import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription, firstValueFrom } from 'rxjs';
import { ToastrService } from 'ngx-toastr';
import { UserService, User } from '../user.service';
import { APIService, Source, Document } from '../api.service';
import { PageTitleService } from '../page-title.service';
import { VolpianoService } from '../volpiano.service';
import { alignTextToMelody } from '../volpiano/latin-syllabify';
import { CantusIndexService, CantusChant, CantusInfo } from '../cantus-index.service';

type SelectableChant = CantusChant & { selected: boolean };

interface IoAction {
  id: string;
  icon: string;
  color: string;
  title: string;
  /** One short line. */
  hint: string;
  /** File type shown on the right. */
  badge: string;
  /** Action of the Sources page that does the work (`?ws=`); the Cantus import is a dialog here. */
  ws?: string;
}
interface IoGroup { title: string; actions: IoAction[]; }
interface IoSide { title: string; icon: string; groups: IoGroup[]; }

/** Everything the page offers, by what the user wants to do. */
const SIDES: IoSide[] = [
  {
    title: 'Import',
    icon: 'bi-box-arrow-in-down text-primary',
    groups: [
      {
        title: 'From a file',
        actions: [
          { id: 'import-workspace', ws: 'import-workspace', icon: 'bi-archive', color: 'text-secondary', title: 'Backup', hint: 'Restore your workspace', badge: '.monodijson' },
          { id: 'import-zip', ws: 'import-zip', icon: 'bi-file-earmark-zip', color: 'text-secondary', title: 'ZIP', hint: 'monodi+ or OMMR4all', badge: 'ZIP' },
          { id: 'import-csv', ws: 'import-csv', icon: 'bi-filetype-csv', color: 'text-secondary', title: 'Spreadsheet', hint: 'Each row becomes a document', badge: 'CSV' },
          { id: 'import-annotations', ws: 'import-annotations', icon: 'bi-images', color: 'text-secondary', title: 'Annotations', hint: 'From the Neumen-Editor', badge: 'JSON' },
        ],
      },
      {
        title: 'From the web',
        actions: [
          { id: 'cantus', icon: 'bi-cloud-arrow-down', color: 'text-primary', title: 'Cantus Index', hint: 'Fetch a melody by its ID', badge: 'Volpiano' },
        ],
      },
    ],
  },
  {
    title: 'Export',
    icon: 'bi-box-arrow-up text-success',
    groups: [
      {
        title: 'Print & publish',
        actions: [
          { id: 'export-pdf', ws: 'export-pdf', icon: 'bi-file-pdf', color: 'text-danger', title: 'PDF edition', hint: 'Pick documents, then page options', badge: 'PDF' },
          { id: 'export-html', ws: 'export-html', icon: 'bi-globe', color: 'text-warning', title: 'Website', hint: 'Browse offline', badge: 'HTML' },
        ],
      },
      {
        title: 'Share & back up',
        actions: [
          { id: 'export-workspace', ws: 'export-workspace', icon: 'bi-archive', color: 'text-success', title: 'Backup', hint: 'Everything in one file', badge: '.monodijson' },
          { id: 'export-zip', ws: 'export-zip', icon: 'bi-file-earmark-zip', color: 'text-info', title: 'ZIP', hint: 'For monodi+ or OMMR4all', badge: 'ZIP' },
          { id: 'export-csv', ws: 'export-csv', icon: 'bi-filetype-csv', color: 'text-success', title: 'Spreadsheet', hint: 'Metadata, melody and text', badge: 'CSV' },
        ],
      },
    ],
  },
];

@Component({
    selector: 'app-import-export',
    templateUrl: './import-export.component.html',
    styleUrls: ['./import-export.component.css'],
    standalone: false
})
export class ImportExportComponent implements OnInit, OnDestroy {
  user: User | null = null;
  readonly sides = SIDES;
  private subs: Subscription[] = [];

  // Cantus Index import dialog
  showCantusDialog = false;
  cantusId = '';
  cantusLoading = false;
  cantusImporting = false;
  cantusError = '';
  cantusInfo: CantusInfo | null = null;
  cantusChants: SelectableChant[] = [];
  /** Experimental: split the Latin text into syllables and align it to the melody. */
  cantusSyllabify = false;

  constructor(
    private api: APIService,
    private userService: UserService,
    private router: Router,
    private toastr: ToastrService,
    private pageTitle: PageTitleService,
    private volpiano: VolpianoService,
    private cantus: CantusIndexService
  ) {}

  ngOnInit(): void {
    this.pageTitle.set('Import / Export');
    this.subs.push(this.userService.user.subscribe((u) => (this.user = u)));
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
  }

  /** A row was clicked: the Sources page runs the action (file picker or dialog), Cantus Index has its own dialog here. */
  run(a: IoAction): void {
    if (!a.ws) { this.openCantusDialog(); return; }
    this.router.navigate(['/sources'], { queryParams: { ws: a.ws } });
  }

  // ── Cantus Index ───────────────────────────────────────────────────────────

  openCantusDialog(): void {
    this.showCantusDialog = true;
    this.cantusId = '';
    this.cantusError = '';
    this.cantusInfo = null;
    this.cantusChants = [];
  }

  closeCantusDialog(): void {
    this.showCantusDialog = false;
  }

  async fetchCantus(): Promise<void> {
    this.cantusError = '';
    this.cantusInfo = null;
    this.cantusChants = [];
    this.cantusLoading = true;
    try {
      const res = await this.cantus.fetchByCantusId(this.cantusId);
      this.cantusInfo = res.info;
      this.cantusId = res.cantusId;
      this.cantusChants = res.chants.map((c) => ({ ...c, selected: true }));
      if (this.cantusChants.length === 0) {
        this.cantusError = 'No melodies found for this Cantus ID.';
      }
    } catch (e: any) {
      this.cantusError = e?.message || String(e);
    } finally {
      this.cantusLoading = false;
    }
  }

  get selectedCantusCount(): number {
    return this.cantusChants.filter((c) => c.selected).length;
  }

  melodyPreview(melody?: string): string {
    if (!melody) return '';
    return melody.length > 90 ? melody.slice(0, 90) + '…' : melody;
  }

  async importSelectedCantus(): Promise<void> {
    if (!this.user) {
      this.toastr.error('Not logged in.');
      return;
    }
    const selected = this.cantusChants.filter((c) => c.selected && c.melody);
    if (selected.length === 0) {
      this.toastr.error('Select at least one melody to import.');
      return;
    }

    const token = this.user.token;
    this.cantusImporting = true;
    try {
      // Load existing sources once so witnesses of the same manuscript share a source.
      const sourcesRes = await firstValueFrom(this.api.listSources(token));
      const existing: Source[] = sourcesRes.kind === 'SourcesRetrieved' ? sourcesRes.sources : [];
      const bySigle = new Map<string, Source>();
      existing.forEach((s) => {
        if (s.quellensigle) bySigle.set(s.quellensigle, s);
      });

      let created = 0;
      let alignmentIssues = 0;
      let firstRoute: any[] | null = null;

      for (const chant of selected) {
        const siglum = (chant.siglum || 'Cantus Index').trim();

        let source = bySigle.get(siglum);
        if (!source) {
          const newSource: Source = {
            quellensigle: siglum,
            herkunftsregion: '',
            herkunftsort: '',
            herkunftsinstitution: '',
            ordenstradition: '',
            quellentyp: '',
            bibliotheksort: '',
            bibliothek: '',
            bibliothekssignatur: '',
            kommentar: '',
            datierung: '',
            custom: chant.srclink ? { cantus_source: chant.srclink } : {},
          };
          const created2 = await firstValueFrom(this.api.createSource(token, newSource));
          if (created2.kind !== 'SourceCreated') continue;
          newSource.id = created2.id;
          source = newSource;
          bySigle.set(siglum, source);
        }

        const doc = this.buildDocument(source, chant);

        let notes;
        if (this.cantusSyllabify) {
          const fullText = chant.fulltext || (this.cantusInfo && this.cantusInfo.field_full_text) || '';
          const aligned = alignTextToMelody(chant.melody || '', fullText);
          if (aligned.warnings.length > 0) alignmentIssues++;
          notes = this.volpiano.import(chant.melody || '', aligned.text, { textMode: 'syllables' }).root;
        } else {
          notes = this.volpiano.import(chant.melody || '').root;
        }

        const docRes = await firstValueFrom(this.api.createDocument(token, { document: doc, notes }));
        if (docRes.kind === 'DocumentCreated') {
          created++;
          if (!firstRoute) firstRoute = ['/document', source.id, docRes.id];
        }
      }

      this.toastr.success(`${created} chant(s) imported from Cantus Index.`);
      if (alignmentIssues > 0) {
        this.toastr.info(
          `${alignmentIssues} chant(s): the syllabified text didn't line up exactly with the melody — please check the text.`,
          'Experimental syllabification'
        );
      }
      this.showCantusDialog = false;
      // Jump straight into the editor when a single chant was imported.
      if (created === 1 && firstRoute) {
        this.router.navigate(firstRoute);
      }
    } catch (e: any) {
      this.toastr.error('Import failed: ' + (e?.message || e));
    } finally {
      this.cantusImporting = false;
    }
  }

  private buildDocument(source: Source, chant: CantusChant): Document {
    const info = this.cantusInfo || {};
    const fullText = chant.fulltext || info.field_full_text || '';
    const kommentarParts = [
      `Imported from Cantus Index (ID ${this.cantusId}).`,
      chant.mode ? `Mode ${chant.mode}.` : '',
      chant.srclink ? `Source: ${chant.srclink}` : '',
      chant.chantlink ? `Chant: ${chant.chantlink}` : '',
    ].filter((p) => p.length > 0);

    return {
      id: '',
      quelle_id: source.id || '',
      dokumenten_id: [chant.siglum, chant.folio].filter(Boolean).join(' ').trim() || this.cantusId,
      gattung1: chant.genre || info.field_genre || '',
      gattung2: '',
      festtag: chant.feast || info.field_feast || '',
      feier: chant.office || '',
      textinitium: info.field_incipit || this.firstWords(fullText),
      bibliographischerverweis: '',
      druckausgabe: '',
      zeilenstart: '',
      foliostart: chant.folio || '',
      kommentar: kommentarParts.join(' '),
      editionsstatus: '',
      custom: {
        cantus_id: this.cantusId,
        mode: chant.mode || '',
        cantus_chant: chant.chantlink || '',
        full_text: fullText,
      },
    };
  }

  private firstWords(text: string, n = 6): string {
    if (!text) return '';
    const words = text.trim().split(/\s+/);
    return words.slice(0, n).join(' ') + (words.length > n ? '…' : '');
  }
}
