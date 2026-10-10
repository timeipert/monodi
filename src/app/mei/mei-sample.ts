import { v4 as uuidv4 } from 'uuid';
import { 
  RootContainer, 
  ContainerKind, 
  LinePartKind,
  FormteilContainer,
  ZeileContainer,
  Syllable,
  Note,
  Clef,
  ParatextContainer,
  FormteilData,
  NoteType,
  BaseNote,
  ParatextType,
  DocumentType,
  FormteilDataName,
  SyllableType
} from '../types/model';
import { Document as MonodiDocument } from '../api.service';

export const SAMPLE_META: MonodiDocument = {
  id: 'doc-sample-123',
  quelle_id: 'sample-source',
  dokumenten_id: 'Sample MEI Document',
  gattung1: '',
  gattung2: '',
  festtag: '',
  feier: '',
  textinitium: 'Gloria',
  bibliographischerverweis: '',
  druckausgabe: '',
  zeilenstart: '',
  foliostart: '',
  kommentar: '',
  editionsstatus: ''
};

function createNote(base: BaseNote, octave: number, type: NoteType = NoteType.Normal): Note {
  return {
    uuid: uuidv4(),
    noteType: type,
    base: base,
    octave: octave,
    focus: false,
    liquescent: type === NoteType.Liquescent
  };
}

export const SAMPLE_DOCUMENT: RootContainer = (() => {
  // --- Formteil Data ---
  const formteilData: FormteilData[] = [
    { name: FormteilDataName.Signatur, data: 'A' },
    { name: FormteilDataName.LemmatisiertesTextInitium, data: 'Gloria' }
  ];

  // --- Syllables ---
  // Syllable 1: "Glo" -> 2 notes (Normal, Liquescent) in a single Neume (NonSpaced)
  const syl1: Syllable = {
    kind: LinePartKind.Syllable,
    uuid: uuidv4(),
    text: 'Glo',
    syllableType: SyllableType.Normal,
    notes: {
      spaced: [
        {
          nonSpaced: [
            {
              grouped: [
                createNote(BaseNote.C, 4),
                createNote(BaseNote.D, 4, NoteType.Liquescent)
              ]
            }
          ]
        }
      ]
    }
  };

  // Syllable 2: "ri" -> 1 note (Oriscus)
  const syl2: Syllable = {
    kind: LinePartKind.Syllable,
    uuid: uuidv4(),
    text: 'ri',
    syllableType: SyllableType.Normal,
    notes: {
      spaced: [
        {
          nonSpaced: [
            {
              grouped: [
                createNote(BaseNote.E, 4, NoteType.Oriscus)
              ]
            }
          ]
        }
      ]
    }
  };

  // Syllable 3: "a" -> 3 notes (Normal, connectionGap, Normal).
  // con="g" is set on a note that starts a new `grouped` array within the same `nonSpaced` (a break inside the neume).
  const syl3: Syllable = {
    kind: LinePartKind.Syllable,
    uuid: uuidv4(),
    text: 'a',
    syllableType: SyllableType.Normal,
    notes: {
      spaced: [
        {
          nonSpaced: [
            {
              grouped: [
                createNote(BaseNote.F, 4),
                createNote(BaseNote.G, 4) // End of group 1 -> forces connection gap to next group
              ]
            },
            {
              grouped: [
                createNote(BaseNote.A, 4)
              ]
            }
          ]
        }
      ]
    }
  };

  // --- Clef ---
  const clef: Clef = {
    kind: LinePartKind.Clef,
    uuid: uuidv4(),
    shape: 'C',
    base: BaseNote.C,
    octave: 4,
    focus: false
  };

  // --- Zeile Container ---
  const zeile: ZeileContainer = {
    kind: ContainerKind.ZeileContainer,
    uuid: uuidv4(),
    children: [clef, syl1, syl2, syl3]
  };

  // --- Paratext Container ---
  const paratext: ParatextContainer = {
    kind: ContainerKind.ParatextContainer,
    uuid: uuidv4(),
    text: 'Rubric: ad missam',
    retro: false,
    paratextType: ParatextType.Formteil
  };

  // --- Formteil Container ---
  const formteil: FormteilContainer = {
    kind: ContainerKind.FormteilContainer,
    uuid: uuidv4(),
    data: formteilData,
    children: [paratext, zeile]
  };

  // --- Root Container ---
  return {
    kind: ContainerKind.RootContainer,
    uuid: uuidv4(),
    documentType: DocumentType.Level1,
    comments: [],
    children: [formteil]
  };
})();
