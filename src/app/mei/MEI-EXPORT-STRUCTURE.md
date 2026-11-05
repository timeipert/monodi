# MEI export: structure of the body

State: 2026-11-02. This document is for people who change or check the MEI export of Monodi-Zero (the editor for the Corpus Monodicum transcriptions). It lists which MEI element each part of the Monodi data model becomes, which setting changes it, and how the result is checked. MEI is the Music Encoding Initiative's XML standard for music; "neume notation" is its part for chant notation (`syllable`, `neume`, `nc`). The metadata header is a different topic (see `mei-header.ts`); the attributes that a person adds to single notes are described in `MEI-ANNOTATIONS.md`.

Start with the table, then the settings page: Settings → MEI Mapping → Export format → Structure. Each row below is a default of the MEI profile (`defaultMeiProfile()` in `packages/core/src/mei/mapping.model.ts`); a stored profile keeps what a person changed and gets the new default only where it still holds the earlier one (`upgradeMeiProfile`). The structure rules that apply to all rows are in CM-hub, `docs/MEI-BODY-MAPPING.md`, which is not updated by this document.

| Monodi | MEI (default) | Setting |
|---|---|---|
| line of a form part (`ZeileContainer`) | `<sb/>` in the section, then `<staff n="1"><layer n="1">` | Schema-conformant structure |
| staff, clef at the start of a line | `<staffDef n="1" lines="5" clef.shape="G" clef.line="2"/>` in the `scoreDef` (the editor draws five lines and a G clef on the second line from the bottom) | Staff of the score |
| clef in a line (`Clef`) | `<clef shape line/>` in the layer; `line` follows from the position of the clef (bottom line = E of octave 4; a position in a space gets the line below, outside the staff the nearest line) | Elements → clef |
| change of the manuscript's line (`LineChange`) | `<sb type="manuscriptLine"/>` in the layer | Line changes as `sb` |
| change of page (`FolioChange`) | `<pb label n/>` in the layer | – |
| box (`Box`) | `<space/>` in the layer | – |
| syllable | `<syllable><syl/><neume>…` ; a unit without notes writes no `<neume>` | Elements |
| syllable type `WithoutNotes` | `<syllable type="withoutNotes">` | Syllables that are not normal |
| syllable type `SourceEllipsis`, `EditorialEllipsis` | `<supplied type reason><syllable/></supplied>` (also without notes); alternatives: `@type` on the syllable, `<gap/>` in the syllable, or nothing | Syllables that are not normal |
| second and further voices (`additionalMelodies`) | one `<staff n="2">` and so on per voice, each with `<layer n="1">`, directly after the staff of voice 1 in the section of the line (Verovio lays the staves of one section on top of each other, so the voices stand in score); one `staffDef` per voice in the `scoreDef` (as many as the highest voice number of the document); syllables without `syl` (the text stays in voice 1), `@corresp` to the syllable of voice 1, ids with the prefix `m-v2-`; neumes and `nc` as in voice 1. A neume of voice 2 and above that aligns to a neume of voice 1 (same unit of the same syllable) has `@synch="#m-<syllable uuid>-neume<n>"`, which points to it; the neume of voice 1 gets that `xml:id`. Replaces the earlier form of one `<layer n="2">` in the staff of voice 1 (state 2026-11-05) | Additional melodies |
| notes of a line of adiastematic notation | `<nc intm="u|d|s"/>` without `pname` and `oct`; the staff has `type="adiastematic"` | Lines of adiastematic notation |
| paratext (text written in the manuscript) | `<annot type="paratext" label="<kind>">` in the section, in the order of the form part | Elements → paratext |
| form part: signature, status, incipit, reference | `section/@label`, `section/@type`, `<annot type="initium">`, `<annot type="verweis">` | Elements → form part |
| flat, sharp, natural | `<accid accid ploc oloc/>` in the syllable | Flat, sharp and natural as `accid` |
| comment with a certainty | `annot/@type` has the token `cert:<value>` (the schema has no `@cert` on `annot`) | – |

## Presets for two voices (state 2026-11-05)

The two presets (`MEI_PRESETS` in `packages/core/src/mei/mapping.model.ts`) are built-in profiles: they are in the profile list of every project from the start (`withBuiltInProfiles`, added when the settings are loaded), next to the default profile, and need not be created. They are ordinary profiles that can be edited and duplicated; one that is deleted stays deleted (`removedMeiPresets` in the settings). Settings → MEI Mapping → Manage → *New from preset* makes an additional copy. Both write one staff per voice, the text in the last voice, `syl/@sameas` in the other voices, a bracket around the staves, no `<sb>` before the first staff and no `@wordpos`; the names of the voices are entered under Structure → Voices.

| Preset | Body | Setting `notation` |
|---|---|---|
| Neumes, one staff per voice | `syllable` / `neume` / `nc`, `notationtype="neume"`, schema `mei-Neumes.rng` | `neume` |
| Premensural, one staff per voice | `ligature` of `note`s for a neume of several notes, `note` for one note, `verse/syl` for the text, `notationtype="premensural"`, schema `mei-Mensural.rng`; `lig="conjunctura"` is not derived, it is set by hand on the note (editor, MEI attributes tab) | `premensural` |

Profile settings added for them (all optional; a missing value keeps the earlier output): `notation`, `voiceText` (`first` or `last`), `voiceLink` (`corresp` or `sameas`), `voiceLabels`, `voiceBracket`, `firstLineBreak`, `wordPosition`.

Checked with `mei-presets.spec.ts`: one Monodi document (five syllables, two voices) written with each preset equals the two trial files of a colleague (`mei-trial-files.ts`) in all staves, apart from the differences listed in the spec. The neume output validates against `mei-Neumes.rng` 5.0 except `nc/@name` (the trial file uses it too; the schema does not allow it on `nc`). The premensural output is not validated against `mei-Mensural.rng` (open, state 2026-11-05). `lig` and `name` (`virga`, `punctum`) are attributes set by hand on the notes; the spec sets them in the test document.

## Import of MEI files (state 2026-11-05)

The reverse direction is `mei-import.ts` (`importMei`). It is offered in two places: the Import / Export page (*MEI*) opens a dialog on the Sources page for several files at once — the source (an existing one or a new siglum), the format (*Detect from each file*, *Neumes* or *Premensural*) and a document ID per file; the page of a source has *Import MEI* for one file in that source. Both show what was found (lines, voices, syllables, notes) and the warnings before any document is created.

- **Neumes**: `syllable` with `syl` and `neume` of `nc`. **Premensural**: a `ligature` of `note`s or a single `note`; a syllable starts at the element that has a `verse` with a `syl`, elements without one continue it.
- **Voices**: the staves of a section with increasing `@n` are the voices of one line; the first is the first voice, the others are `additionalMelodies`. Alignment follows `neume/@synch`, `syl/@sameas` and `syllable/@corresp` where the file has them, otherwise the position. The text is taken from whichever voice has it (`syl/@sameas` resolves to the `syl` it names).
- **Attributes without a field in Monodi** (`name`, `lig`, ...) become hand-set MEI attributes of the notes (`meiAttrs`), on a `ligature` or `neume` of the neume's first note (`meiNeumeAttrs`); the export writes them again.
- **Also read**: line changes (`sb`) and folio changes (`pb`) of the first voice, clefs, accidentals (`accid`), a note head with a stroke (`tilt="n"` / `tilt="s"` → ascending / descending), ornaments inside an `nc`, the type of a syllable (`@type`, `<supplied>`), the label of a section (signature), lines of adiastematic notation (`staff/@type="adiastematic"`: the contour `@intm` becomes pitches one step apart, starting at G4), and every further `layer` of a staff as a voice of its own.
- **Not read**: elements other than those above, notes without pitch outside an adiastematic line (for example the empty `<note/>` in the premensural trial file; reported as a warning). An accidental stands in the neume that follows it.
- Checked with `mei-import.spec.ts`: both trial files, a round trip (import, export with the preset, import) for both presets, and a round trip of a document with a clef, line and folio changes, an accidental, strokes, an ornament, an ellipsis, an adiastematic line and a second voice (export, import, export gives the same MEI apart from the ids).

## Why these forms

- **Syllable types.** MEI neume notation has no element for the type of a syllable and its guidelines say nothing about omitted material (state 2026-11-02, MEI 5.0 and 5.1). `supplied` is allowed around a syllable in both the neume customization (`mei-Neumes.rng`) and the full schema (`mei-all.rng`); `gap` marks a transcription gap and fits a source ellipsis less well. Decision for the edition's editors: whether a source ellipsis is better written as `gap` (open question 1; the form can be changed per type in the profile).
- **Paratext.** `dir` is not allowed in a section by the schema (it needs `@startid` or a time stamp), `annot` is. Open question 2: whether the editors want a stronger element for text that stands in the manuscript.
- **Adiastematic lines.** The notes of such a line are typed as a contour; Monodi stores pitches for them, but these are not read from the manuscript.

## Not covered

- Inline editorial interventions (`inlineInterventions` in the profile is a setting without effect). The neume schema allows `unclear`, `supplied` and `damage` inside a neume, but `add`, `del`, `corr` and `sic` only in the full schema.
- The Schematron rules of the schema need XSLT 2 and are not run as a whole; the rule that every staff needs a `staffDef` is covered by the export.

## How it is checked

- Unit specs: `mei-conformant.spec.ts`, `mei-emitter.spec.ts` (in this folder, run by Karma because the emitter needs a browser DOM) and `packages/core/src/mei/mapping.model.test.ts` (run by `npm test` in `packages/core`). The emitter itself is in `packages/core/src/mei/emitter.ts`.
- Schema check: export the fixtures with `node scripts/export-mei-batch.mjs --zip <monodi.zip> --out <mei.zip>` and run `xmllint --noout --relaxng <schema.rng> <file>` with the released `https://music-encoding.org/schema/5.0/mei-Neumes.rng` and with `src/app/mei/mei-all.rng`. State 2026-11-02: the 45 fixtures of `src/app/testdata` plus one document with every special case validate against both.
