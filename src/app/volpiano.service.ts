import { Injectable } from '@angular/core';
import { RootContainer } from './types/model';
import {
  rootToVolpiano,
  volpianoToRoot,
  VolpianoExportResult,
  VolpianoImportResult,
  VolpianoTextMode,
} from './volpiano/volpiano';

/**
 * Thin Angular wrapper around the pure Volpiano core (see `./volpiano/volpiano.ts`).
 * Mirrors the shape of `MeiExportService`.
 */
@Injectable({
  providedIn: 'root',
})
export class VolpianoService {
  /** Serialise a document's notation to a Volpiano string. */
  export(root: RootContainer): VolpianoExportResult {
    return rootToVolpiano(root);
  }

  /** Parse a Volpiano string (with optional aligned text) into a new document. */
  import(volpiano: string, text?: string, opts?: { textMode?: VolpianoTextMode }): VolpianoImportResult {
    return volpianoToRoot(volpiano, text, opts);
  }

  /** Export and trigger a browser download of a `.txt` file. */
  exportAndDownload(root: RootContainer, filename = 'export.volpiano.txt'): VolpianoExportResult {
    const result = this.export(root);
    const blob = new Blob([result.volpiano], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    window.URL.revokeObjectURL(url);
    return result;
  }
}
