import type { CantusChant } from '@monodi/core/datasets';
import {
  ContainerKind, DocumentType, emptySyllable, SyllableType,
} from './types/model';
import type { MiscContainer, RootContainer, Syllable, ZeileContainer } from './types/model';
import { v4 as UUID } from 'uuid';
import { alignTextToMelody, syllabifyLatin } from './volpiano/latin-syllabify';
import { volpianoToRoot } from './volpiano/volpiano';

/**
 * The notation of a chant that comes from a repository as a catalogue record (Cantus Corpus): a melody in Volpiano
 * becomes notes, and a record without melody becomes a document that holds only the text, split into syllables, so a
 * person can transcribe the melody under it.
 */

export interface CantusNotesOptions {
  /**
   * Distribute the full text over the syllables of the melody (heuristic, see `alignTextToMelody`). Off: the melody
   * comes without text; the full text is kept in the metadata of the document in both cases.
   */
  alignText: boolean;
}

export interface CantusNotes {
  root: RootContainer;
  warnings: string[];
  /** True if the root holds notes (the record has a melody). */
  hasMelody: boolean;
}

/** A document without notes whose first line holds the text, one syllable at a time (`WithoutNotes`). */
export function textOnlyRoot(text: string): RootContainer {
  const words = text.split(/\s+/).map((w) => w.replace(/[^\p{L}\p{M}]/gu, '')).filter((w) => w.length > 0);
  const syllables: Syllable[] = [];
  for (const word of words) {
    const parts = syllabifyLatin(word);
    parts.forEach((part, i) => {
      const syllable = emptySyllable();
      syllable.syllableType = SyllableType.WithoutNotes;
      // Monodi convention: every syllable but the last of a word keeps a trailing hyphen
      syllable.text = i < parts.length - 1 ? part + '-' : part;
      syllables.push(syllable);
    });
  }
  if (syllables.length === 0) {
    const empty = emptySyllable();
    empty.syllableType = SyllableType.WithoutNotes;
    syllables.push(empty);
  }
  const line: ZeileContainer = {
    kind: ContainerKind.ZeileContainer,
    uuid: UUID(),
    children: syllables as ZeileContainer['children'],
  };
  const misc: MiscContainer = {
    kind: ContainerKind.MiscContainer, uuid: UUID(), children: [line] as MiscContainer['children'],
  };
  return {
    kind: ContainerKind.RootContainer, uuid: UUID(), children: [misc], comments: [], documentType: DocumentType.Level1,
  };
}

/** The notation of one record of the Cantus Corpus. */
export function cantusNotes(chant: CantusChant, options: CantusNotesOptions): CantusNotes {
  const text = chant.full_text || chant.incipit;
  if (chant.volpiano === '') {
    return { root: textOnlyRoot(text), warnings: [], hasMelody: false };
  }
  if (options.alignText && chant.full_text) {
    const aligned = alignTextToMelody(chant.volpiano, chant.full_text);
    const result = volpianoToRoot(chant.volpiano, aligned.text, { textMode: 'syllables' });
    return { root: result.root, warnings: [...aligned.warnings, ...result.warnings], hasMelody: true };
  }
  const result = volpianoToRoot(chant.volpiano);
  return { root: result.root, warnings: result.warnings, hasMelody: true };
}
