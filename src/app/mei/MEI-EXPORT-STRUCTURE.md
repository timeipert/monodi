# MEI export: structure of the body

State: 2026-11-02. This document is for people who change or check the MEI export of Monodi-Zero (the editor for the Corpus Monodicum transcriptions). It lists which MEI element each part of the Monodi data model becomes, which setting changes it, and how the result is checked. MEI is the Music Encoding Initiative's XML standard for music; "neume notation" is its part for chant notation (`syllable`, `neume`, `nc`). The metadata header is a different topic (see `mei-header.ts`); the attributes that a person adds to single notes are described in `MEI-ANNOTATIONS.md`.

Start with the table, then the settings page: Settings → MEI Mapping → Export format → Structure. Each row below is a default of the MEI profile (`defaultMeiProfile()` in `mei-mapping.model.ts`); a stored profile keeps what a person changed and gets the new default only where it still holds the earlier one (`upgradeMeiProfile`). The structure rules that apply to all rows are in CM-hub, `docs/MEI-BODY-MAPPING.md`, which is not updated by this document.

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
| second and further voices (`additionalMelodies`) | `<layer n="2">` and so on of the staff; syllables without `syl`, `@corresp` to the syllable of layer 1, ids with the prefix `m-v2-` | Additional melodies |
| notes of a line of adiastematic notation | `<nc intm="u|d|s"/>` without `pname` and `oct`; the staff has `type="adiastematic"` | Lines of adiastematic notation |
| paratext (text written in the manuscript) | `<annot type="paratext" label="<kind>">` in the section, in the order of the form part | Elements → paratext |
| form part: signature, status, incipit, reference | `section/@label`, `section/@type`, `<annot type="initium">`, `<annot type="verweis">` | Elements → form part |
| flat, sharp, natural | `<accid accid ploc oloc/>` in the syllable | Flat, sharp and natural as `accid` |
| comment with a certainty | `annot/@type` has the token `cert:<value>` (the schema has no `@cert` on `annot`) | – |

## Why these forms

- **Syllable types.** MEI neume notation has no element for the type of a syllable and its guidelines say nothing about omitted material (state 2026-11-02, MEI 5.0 and 5.1). `supplied` is allowed around a syllable in both the neume customization (`mei-Neumes.rng`) and the full schema (`mei-all.rng`); `gap` marks a transcription gap and fits a source ellipsis less well. Decision for the edition's editors: whether a source ellipsis is better written as `gap` (open question 1; the form can be changed per type in the profile).
- **Paratext.** `dir` is not allowed in a section by the schema (it needs `@startid` or a time stamp), `annot` is. Open question 2: whether the editors want a stronger element for text that stands in the manuscript.
- **Adiastematic lines.** The notes of such a line are typed as a contour; Monodi stores pitches for them, but these are not read from the manuscript.

## Not covered

- Inline editorial interventions (`inlineInterventions` in the profile is a setting without effect). The neume schema allows `unclear`, `supplied` and `damage` inside a neume, but `add`, `del`, `corr` and `sic` only in the full schema.
- The Schematron rules of the schema need XSLT 2 and are not run as a whole; the rule that every staff needs a `staffDef` is covered by the export.

## How it is checked

- Unit specs: `mei-conformant.spec.ts`, `mei-emitter.spec.ts`, `mei-mapping.model.spec.ts`.
- Schema check: export the fixtures with `node scripts/export-mei-batch.mjs --zip <monodi.zip> --out <mei.zip>` and run `xmllint --noout --relaxng <schema.rng> <file>` with the released `https://music-encoding.org/schema/5.0/mei-Neumes.rng` and with `src/app/mei/mei-all.rng`. State 2026-11-02: the 45 fixtures of `src/app/testdata` plus one document with every special case validate against both.
