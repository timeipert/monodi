import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { Source } from './api.service';
import { hasAnnotations, Lookup, lookupInManuscript } from './manuscript-lookup';

/** What the "Show in manuscript" overlay displays. */
export interface ManuscriptViewState {
  open: boolean;
  loading: boolean;
  source: Source | null;
  /** null: the note is not part of a neume of this transcription. */
  lookup: Lookup | null;
  /** The manifest's canvases, when the source has one that could be read. */
  canvases: any[];
  /** Why the manifest could not be read, if it could not. */
  manifestError: string;
}

/** What the document view lends the service: the source being shown and the transcription tree. */
export interface ManuscriptViewContext {
  getSource(): Source | null;
  getRoot(): any;
}

const CLOSED: ManuscriptViewState = {
  open: false, loading: false, source: null, lookup: null, canvases: [], manifestError: ''
};

/**
 * "Show in manuscript": right-click a neume of the transcription and see how that
 * sign looks on the page. The document view registers itself, so the service can
 * see the current source and transcription without every note having to carry them.
 */
@Injectable({ providedIn: 'root' })
export class ManuscriptViewService {
  private context: ManuscriptViewContext | null = null;
  private manifests = new Map<string, any[]>();
  private readonly subject = new BehaviorSubject<ManuscriptViewState>(CLOSED);
  readonly state$ = this.subject.asObservable();

  register(context: ManuscriptViewContext): void { this.context = context; }

  unregister(context: ManuscriptViewContext): void {
    if (this.context === context) this.context = null;
  }

  /** Whether there is anything to show: a document is open and its source has annotations. */
  canShow(): boolean {
    return !!this.context && hasAnnotations(this.context.getSource());
  }

  async show(noteUuid: string): Promise<void> {
    const source = this.context?.getSource() ?? null;
    const root = this.context?.getRoot();
    if (!source || !root) return;

    const lookup = lookupInManuscript(source, root, noteUuid);
    this.subject.next({ ...CLOSED, open: true, loading: !!lookup, source, lookup });
    if (!lookup) return;

    let canvases: any[] = [];
    let manifestError = '';
    if (source.iiifManifestUrl) {
      try {
        canvases = await this.canvasesOf(source.iiifManifestUrl);
      } catch (e: any) {
        manifestError = `The manifest could not be read (${e?.message || 'network error'}).`;
      }
    }
    // The person may have closed it, or asked for another neume, while the manifest loaded.
    const now = this.subject.value;
    if (now.open && now.lookup === lookup) {
      this.subject.next({ ...now, loading: false, canvases, manifestError });
    }
  }

  close(): void {
    if (this.subject.value.open) this.subject.next(CLOSED);
  }

  private async canvasesOf(url: string): Promise<any[]> {
    const cached = this.manifests.get(url);
    if (cached) return cached;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const manifest: any = await response.json();
    const canvases: any[] = manifest?.sequences?.[0]?.canvases ?? manifest?.items ?? [];
    this.manifests.set(url, canvases);
    return canvases;
  }
}
