# MEI export: structure of the body

State: 2026-11-05. This document is for people who change or check the MEI export of Monodi-Zero (the editor for the Corpus Monodicum transcriptions). It lists which MEI element each part of the Monodi data model becomes, which setting changes it, and how the result is checked. MEI is the Music Encoding Initiative's XML standard for music; "neume notation" is its part for chant notation (`syllable`, `neume`, `nc`). The metadata header is a different topic (see `mei-header.ts`); the attributes that a person adds to single notes are described in `MEI-ANNOTATIONS.md`.

Start with the table, then the settings page: Settings → MEI Mapping → Export format → Structure (the frame around the music) and → Levels (which element each level of the music becomes; see "Levels" below). Each row below is a default of the MEI profile (`defaultMeiProfile()` in `packages/core/src/mei/mapping.model.ts`); a stored profile keeps what a person changed and gets the new default only where it still holds the earlier one (`upgradeMeiProfile`). The structure rules that apply to all rows are in CM-hub, `docs/MEI-BODY-MAPPING.md`, which is not updated by this document.

| Monodi | MEI (default) | Setting |
|---|---|---|
| line of a form part (`ZeileContainer`) | `<sb/>` in the section, then `<staff n="1"><layer n="1">` | Schema-conformant structure |
| staff, clef at the start of a line | `<staffDef n="1" lines="5" clef.shape="G" clef.line="2"/>` in the `scoreDef` (the editor draws five lines and a G clef on the second line from the bottom) | Staff of the score |
| clef in a line (`Clef`) | `<clef shape line/>` in the layer; `line` follows from the position of the clef (bottom line = E of octave 4; a position in a space gets the line below, outside the staff the nearest line) | Elements → clef |
| change of the manuscript's line (`LineChange`) | `<sb type="manuscriptLine"/>` in the layer | Line changes as `sb` |
| change of page (`FolioChange`) | `<pb label n/>` in the layer | – |
| box (`Box`) | `<space/>` in the layer | – |
| syllable | `<syllable><syl/><neume>…` ; a unit without notes writes no `<neume>` | Levels, Elements |
| syllable type `WithoutNotes` | `<syllable type="withoutNotes">` | Syllables that are not normal |
| syllable type `SourceEllipsis`, `EditorialEllipsis` | `<supplied type reason><syllable/></supplied>` (also without notes); alternatives: `@type` on the syllable, `<gap/>` in the syllable, or nothing | Syllables that are not normal |
| second and further voices (`additionalMelodies`) | one `<staff n="2">` and so on per voice, each with `<layer n="1">`, directly after the staff of voice 1 in the section of the line (Verovio lays the staves of one section on top of each other, so the voices stand in score); one `staffDef` per voice in the `scoreDef` (as many as the highest voice number of the document); syllables without `syl` (the text stays in voice 1), `@corresp` to the syllable of voice 1, ids with the prefix `m-v2-`; neumes and `nc` as in voice 1. A neume of voice 2 and above that aligns to a neume of voice 1 (same unit of the same syllable) has `@synch="#m-<syllable uuid>-neume<n>"`, which points to it; the neume of voice 1 gets that `xml:id`. Replaces the earlier form of one `<layer n="2">` in the staff of voice 1 (state 2026-11-05) | Additional melodies |
| notes of a line of adiastematic notation | `<nc intm="u|d|s"/>` without `pname` and `oct`; the staff has `type="adiastematic"` | Lines of adiastematic notation |
| paratext (text written in the manuscript) | `<annot type="paratext" label="<kind>">` in the section, in the order of the form part | Elements → paratext |
| form part: signature, status, incipit, reference | `section/@label`, `section/@type`, `<annot type="initium">`, `<annot type="verweis">` | Elements → form part |
| note head with a stem (note types `Ascending`, `Descending`) | neume notation: `nc/@tilt="n"` or `"s"` (direction of the pen stroke); premensural notation: `<note><plica dir="up"/></note>` or `dir="down"` (see "Note heads with a stem" below; state 2026-11-05) | Levels → Stem of a note (written with the schema-conformant structure only) |
| flat, sharp, natural | `<accid accid ploc oloc/>` in the syllable | Flat, sharp and natural as `accid`; Levels → Accidental |
| comment with a certainty | `annot/@type` has the token `cert:<value>` (the schema has no `@cert` on `annot`) | – |

## Presets for two voices (state 2026-11-05)

The two presets (`MEI_PRESETS` in `packages/core/src/mei/mapping.model.ts`) are built-in profiles: they are in the profile list of every project from the start (`withBuiltInProfiles`, added when the settings are loaded), next to the default profile, and need not be created. They are ordinary profiles that can be edited and duplicated; one that is deleted stays deleted (`removedMeiPresets` in the settings). Settings → MEI Mapping → Manage → *New from preset* makes an additional copy. Both write one staff per voice, the text in the last voice, `syl/@sameas` in the other voices, a bracket around the staves, no `<sb>` before the first staff and no `@wordpos`; the names of the voices are entered under Structure → Voices.

| Preset | Body | Built-in structure (tab Levels) |
|---|---|---|
| Neumes, one staff per voice | `syllable` / `neume` / `nc`, `notationtype="neume"`, schema `mei-Neumes.rng` | Neumes |
| Premensural, one staff per voice | `ligature` of `note`s for a neume of several notes, `note` for one note, `verse/syl` for the text, `notationtype="premensural"`, schema `mei-Mensural.rng`; `lig="conjunctura"` is not derived, it is set by hand on the note (editor, MEI attributes tab) | Premensural |

Profile settings added for them (all optional; a missing value keeps the earlier output): `voiceText` (`first` or `last`), `voiceLink` (`corresp` or `sameas`), `voiceLabels`, `voiceBracket`, `firstLineBreak`, `wordPosition`, and the field `notation` (`neume` or `premensural`), which was replaced by `structure` on 2026-11-05 (see "Levels" below).

Checked with `mei-presets.spec.ts`: one Monodi document (five syllables, two voices) written with each preset equals the two trial files of a colleague (`mei-trial-files.ts`) in all staves, apart from the differences listed in the spec. The neume output validates against `mei-Neumes.rng` 5.0 except `nc/@name` (the trial file uses it too; the schema does not allow it on `nc`). The premensural output is not valid against `mei-Mensural.rng` (state 2026-11-05: the text stands in the `ligature`, ornaments stand in the `note`, and `premensural` is not a value of `@notationtype` in MEI 5.0; the tab Levels lists these points; see open item 5 below). `lig` and `name` (`virga`, `punctum`) are attributes set by hand on the notes; the spec sets them in the test document.

## Levels: the structure of the body as data (state 2026-11-05)

Until 2026-11-05 the profile had a fixed switch `notation` (`neume` or `premensural`), and the emitter (`packages/core/src/mei/emitter.ts`, the code that writes the MEI) chose between two forms written into its code. Since 2026-11-05 the structure of the body is data of the profile: `MeiMappingProfileV2.structure`, type `MeiBodyStructure` in `packages/core/src/mei/structure.ts` (the authoritative file for this section). The two notations are the two built-in structures (`BODY_STRUCTURE_PRESETS`: *Neumes* and *Premensural*); what they write did not change, byte for byte (see "How it is checked"). A profile stored with `notation` gets the structure that `notation` named when the settings are loaded (`upgradeMeiProfile`), and so does a profile file imported under Manage → Import.

The levels of a transcription, outermost first: form part (`FormteilContainer`) > line (`ZeileContainer`) > voice (the melody and its `additionalMelodies`) > syllable > neume (notes written without a space) > group (notes written together as one ligature, `[*u]` in the code of a neume; a break inside a neume, `*u`, starts a new group) > note. The order follows the data model and cannot be changed: a note belongs to one group, a group to one neume, a neume to one syllable. What can be set per level:

| Level | Element (default) | Written | Attributes | Stored in |
|---|---|---|---|---|
| form part, line | `section`, `sb` | always | yes (tab Elements) | `entities.formteil`, `entities.zeile` |
| voice | `staff` with one `layer` (schema-conformant structure only) | always | `@n` | `structure.voice` |
| syllable | `syllable` | always, or not written | yes | `entities.syllable`, `structure.syllable` |
| neume | `neume` | always, only with several children, or not written | yes | `entities.neume`, `structure.neume` |
| group | none | not written, always, or only with several children | yes, from the fields `index` (number of the group in the neume) and `uuid` | `structure.group` |
| note | `nc` | always | yes | `entities.note` |
| accidental | `accid` next to the neume it stands before or after | always (unless accidentals are written as notes) | yes, from the fields `accid`, `base`, `octave`, `uuid` | `structure.accid` |
| text | `syl` | in the syllable, in the first element of the neume level, or in the first note; before or after the music; inside further elements (for example `verse`) | yes | `entities.syllableText`, `structure.text` |
| stem of a note | `nc/@tilt` with `n` (up) or `s` (down) | as an attribute of the note, as an element inside the note (`plica/@dir`), or not written | – | `structure.stem` |
| staff definition | `staffDef/@notationtype="neume"`; the schema named in the `<?xml-model?>` lines | – | – | `structure.notationType`, `structure.schemaUrl` |

"Only with several children": a neume or group with a single child is not written, and the child stands in its place. This is how the premensural structure writes a neume of one note as a `note` and a neume of several notes as a `ligature`. A level that is not written passes its children to the level around it. The element names of the levels that are entity rules (syllable, text, neume, note) are the same names as in the tab Elements.

**Editing.** Settings → MEI Mapping → Export format → Levels (`mei-structure-panel.component.ts`): one button per built-in structure; per level the mode, the element name (free text with suggestions) and the attributes (a fixed value or a field of the transcription), and for syllable, neume and note the elements written around them; for the text its holder (the arrows move it one level out or in), its position and the elements around it; the form of the stem; `@notationtype` and the schema URL. A sketch shows the MEI of a small sample written with the profile.

**Warnings instead of refusal.** Every name is written as given, also one that MEI does not know. The tab Levels and the problem list above the settings show three kinds of warnings (`bodyStructureIssues` in `structure.ts`):

- *The export fails*: a name that is not an XML name (empty, with a space or a colon).
- *Not valid MEI*, checked against the schema of the profile (tab Schema): an element the schema does not know; an element that the schema does not allow inside the element around it (checked level by level from the section to the note, and for the text, the accidental, the stem and the ornaments); a value of `@notationtype` that the schema does not list.
- *Not read back by the import*: no syllable element, no neume element, elements around a syllable, neume or note, two levels with the same element name, a stem that is not written or has no two different values (details under "Open" below).

**Import with a structure of its own.** The import knows the two built-in structures and detects them from the file. For a file written with a structure of its own, the import dialog offers the format *As the export profile "…" writes it* for every profile whose structure is not a built-in one (`importFormatOptions` in `mei-import.ts`); the import then looks for the element names of that profile (`readPlanOf`). A file that is read with a profile is read with all its element names, also for the voices, the accidentals and the stem.

## Import of MEI files (state 2026-11-05)

The reverse direction is `mei-import.ts` (`importMei`). It is offered in two places: the Import / Export page (*MEI*) opens a dialog on the Sources page for several files at once — the source (an existing one or a new siglum), the format (*Detect from each file*, *Neumes* or *Premensural*) and a document ID per file; the page of a source has *Import MEI* for one file in that source. Both show what was found (lines, voices, syllables, notes), the format that was read and the warnings before any document is created. The format menu also lists every export profile with a structure of its own (see "Levels" above).

- **Neumes**: `syllable` with `syl` and `neume` of `nc`. **Premensural**: a `ligature` of `note`s or a single `note`; a syllable starts at the element that has a `verse` with a `syl`, elements without one continue it.
- **Voices**: the staves of a section with increasing `@n` are the voices of one line; the first is the first voice, the others are `additionalMelodies`. Alignment follows `neume/@synch`, `syl/@sameas` and `syllable/@corresp` where the file has them, otherwise the position. The text is taken from whichever voice has it (`syl/@sameas` resolves to the `syl` it names).
- **Attributes without a field in Monodi** (`name`, `lig`, ...) become hand-set MEI attributes of the notes (`meiAttrs`), on a `ligature` or `neume` of the neume's first note (`meiNeumeAttrs`); the export writes them again.
- **Also read**: line changes (`sb`) and folio changes (`pb`) of the first voice, clefs, accidentals (`accid`), a note head with a stroke (`tilt="n"` / `tilt="s"`, or `<plica dir="up"/>` / `dir="down"` in premensural notation → ascending / descending), ornaments inside an `nc`, the type of a syllable (`@type`, `<supplied>`), the label of a section (signature), lines of adiastematic notation (`staff/@type="adiastematic"`: the contour `@intm` becomes pitches one step apart, starting at G4), and every further `layer` of a staff as a voice of its own.
- **Not read**: elements other than those above, notes without pitch outside an adiastematic line (for example the empty `<note/>` in the premensural trial file; reported as a warning). An accidental stands in the neume that follows it.
- Checked with `mei-import.spec.ts`: both trial files, the stem notes in both notations, a round trip (import, export with the preset, import) for both presets, and a round trip of a document with a clef, line and folio changes, an accidental, strokes, an ornament, an ellipsis, an adiastematic line and a second voice (export, import, export gives the same MEI apart from the ids).

## Why these forms

- **Syllable types.** MEI neume notation has no element for the type of a syllable and its guidelines say nothing about omitted material (state 2026-11-02, MEI 5.0 and 5.1). `supplied` is allowed around a syllable in both the neume customization (`mei-Neumes.rng`) and the full schema (`mei-all.rng`); `gap` marks a transcription gap and fits a source ellipsis less well. Decision for the edition's editors: whether a source ellipsis is better written as `gap` (open question 1; the form can be changed per type in the profile).
- **Paratext.** `dir` is not allowed in a section by the schema (it needs `@startid` or a time stamp), `annot` is. Open question 2: whether the editors want a stronger element for text that stands in the manuscript.
- **Note heads with a stem.** Monodi draws the note types `Ascending` and `Descending` as an oval head with a stem up or down at the right (`notes/glyph-paths.ts`). In neume notation they are written as `nc/@tilt` (`n`, `s`), the direction of the pen stroke. Mensural notation has no `tilt` on a `note`; its nearest element is the plica (`<plica dir="up|down"/>` inside the note; MEI 5.0, mensural module, checked in `mei-all.rng`), a stroke at the side of a square note that marks an added ornamental note. Verovio draws a plica as two stems at the sides of the note head, a long one and a short one (rism-digital/verovio, `src/view_mensural.cpp`, `DrawPlica`). The premensural preset therefore writes the plica (decision 2026-11-05 by the maintainer of the MEI export; reason: the only schema-valid form for a stroke on a mensural note). Open question 3: whether the stemmed note heads of the Corpus Monodicum transcriptions stand for a plica in every source, or only in sources in square notation (context: the transcription rules of the edition; options: plica always, plica only for premensural sources, a setting per profile; decided by the edition's editors). The import reads both forms back as the note type.
- **Adiastematic lines.** The notes of such a line are typed as a contour; Monodi stores pitches for them, but these are not read from the manuscript.

## Open (state 2026-11-05)

These points concern structures of the tab Levels; items 1, 2 and 8 are reported there as warnings.

1. **Without a syllable element** (the premensural structure), a syllable without notes and an ellipsis without notes have no element to stand in: they are not written, and the type of a syllable is not written either. The import cannot restore them. A text that stands in the syllable is not written at all.
2. **Without a neume element**, the import reads all groups and notes of a syllable as one neume: the boundaries between the neumes of a syllable are lost; a break inside a neume (`con="g"`) and a group element are kept as groups.
3. **Attributes of the group level** are written but not read back (the attributes of a neume element go to `meiNeumeAttrs` of the first note of the neume; there is no field for a group).
4. **An accidental without `ploc`** (when the rule is removed from its attributes) is written, but the import cannot place it and leaves it out.
5. **The premensural structure is not valid MEI** (checked against the catalog of `mei-all.rng` 5.0, `src/assets/mei/mei-5.0-all.catalog.json`; the Mensural customization allows no more): the text (`verse`) stands in the `ligature`, ornaments stand in the `note`, and `notationtype="premensural"` is not a value of the schema (allowed: `cmn`, `mensural`, `mensural.black`, `mensural.white`, `neume`, `tab`). The preset writes what the trial files of a colleague (`mei-trial-files.ts`) contain. Open question 4: whether the premensural preset should change to a schema-valid form (context: validity against MEI 5.0 versus agreement with the trial files; options: keep the form of the trial files, write `notationtype="mensural.black"` and the text in the first `note`, or offer both as built-in structures; decided by the maintainer of the MEI export with the edition's editors). Any change alters the output of the preset and needs a new golden entry (see "How it is checked").
6. **`voiceLink` `corresp` with the premensural structure** points `@corresp` of the voices 2 and above to the id of a syllable element that is not written. Both presets use `sameas`, which is not affected.
7. **Detection** (format *Detect from the file*) knows only the two built-in structures; a structure of its own must be chosen as the format.
8. **Elements around a syllable, neume or note** (the wrappers of those entity rules; one shared element per parent element) are written, but the import does not look inside them; what stands in them is skipped with a warning.

## Not covered

- Inline editorial interventions (`inlineInterventions` in the profile is a setting without effect). The neume schema allows `unclear`, `supplied` and `damage` inside a neume, but `add`, `del`, `corr` and `sic` only in the full schema.
- The Schematron rules of the schema need XSLT 2 and are not run as a whole; the rule that every staff needs a `staffDef` is covered by the export.

## How it is checked

- Unit specs: `mei-conformant.spec.ts`, `mei-emitter.spec.ts` (in this folder, run by Karma because the emitter needs a browser DOM) and `packages/core/src/mei/mapping.model.test.ts` (run by `npm test` in `packages/core`). The emitter itself is in `packages/core/src/mei/emitter.ts`.
- Structure of the body: `mei-structure-golden.spec.ts` compares the output of the two presets and of profiles stored before 2026-11-05 (with the field `notation`, with syllable or neume switched off, and the same profiles after `upgradeMeiProfile`) for 46 documents (the fixtures of `src/app/testdata` and the two documents of `mei-structure-testdoc.ts`) byte for byte with the output of commit 50b6aa1c, the last commit with the switch `notation` (SHA-256 sums and the full text for both presets in `mei-structure.golden.ts`; the spec explains how to renew an entry when the output changes on purpose). `mei-structure.spec.ts` writes structures of their own (a group element, unknown element names, the text after the music or in the first note, the stem as an attribute of its own or not written, no `@notationtype`, a schema URL of its own) and reads them back with the profile. `packages/core/src/mei/structure.test.ts` checks the upgrade of stored profiles, the built-in structures and the warnings.
- Schema check: export the fixtures with `node scripts/export-mei-batch.mjs --zip <monodi.zip> --out <mei.zip>` and run `xmllint --noout --relaxng <schema.rng> <file>` with the released `https://music-encoding.org/schema/5.0/mei-Neumes.rng` and with `src/app/mei/mei-all.rng`. State 2026-11-02: the 45 fixtures of `src/app/testdata` plus one document with every special case validate against both.
