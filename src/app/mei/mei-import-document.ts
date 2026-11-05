import type { Document, Source } from '../api.service';

/** A new, empty document record of a source (the fields the app lists); the notation comes from the import. */
export function newImportedDocument(sourceId: string, documentId: string): Document {
  return {
    id: '', quelle_id: sourceId, dokumenten_id: documentId,
    gattung1: '', gattung2: '', festtag: '', feier: '', textinitium: '', bibliographischerverweis: '', druckausgabe: '',
    zeilenstart: '', foliostart: '', kommentar: '', editionsstatus: '', custom: {}
  } as Document;
}

/** A new, empty source with the given siglum. */
export function newImportedSource(siglum: string): Source {
  return {
    quellensigle: siglum, herkunftsregion: '', herkunftsort: '', herkunftsinstitution: '', ordenstradition: '', quellentyp: '',
    bibliotheksort: '', bibliothek: '', bibliothekssignatur: '', kommentar: '', datierung: '', custom: {}
  };
}

/** The document ID suggested for a file: its name without the ending. */
export function documentIdFromFileName(name: string): string {
  return name.replace(/\.(mei|xml)$/i, '').trim();
}
