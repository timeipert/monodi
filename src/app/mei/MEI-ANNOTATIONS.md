# MEI annotations and schema catalogs in Monodi-Zero

State: 2026-11-02. Baseline: branch `feature/monodi-mei-annotations` of the monorepo `monodi-platform`, app `apps/monodi`.

**What it is for.** MEI (Music Encoding Initiative, an XML standard for music) has many more attributes than the Monodi data model has fields. This document describes how a person adds MEI attributes to notes, neumes and syllables, either by hand in the editor or automatically by rules, and how those attributes are checked against an MEI schema.

**Who it is for.** People who edit chants and want richer MEI; people who maintain the MEI export; developers who continue the work.

**Where to start.**

| I want to … | Go to |
|---|---|
| set an attribute on one note, neume or syllable | editor: right-click a note → *MEI attributes* (section 2) |
| set an attribute everywhere a condition holds | Settings → MEI Mapping → Annotations → *Rules* (section 3) |
| choose or load an MEI schema, allow my own attributes | Settings → MEI Mapping → *Schema* (section 4) |
| understand how the pieces fit | section 1 |
| change the code | section 6 |

**The MEI Mapping page.** It has three areas: *Export format* (sections *Structure*, *Elements*, *Header* with the publication data), *Annotations* (*Flags*, *Patterns*, *Rules*) and *Schema*. The profile (select, "…" menu for new, duplicate, rename, import, export, reset, delete) and the *Result* preview are in the top row; the checks are one line that opens to the list of problems.

**Flat, sharp and natural.** A Monodi note of type Flat, Sharp or Natural is not a note of the melody. The export writes it as `<accid accid="f|s|n" ploc="…" oloc="…"/>` in the syllable, between the neumes, in the default and in the schema-conformant structure (profile option `accidentals`, switch *Flat, sharp and natural as &lt;accid&gt;* in Export format → Structure). Switched off, it is written as a note `<nc>` with pitch, as in Monodi-Zero 0.9.1. Attributes set by hand on the accidental's note are written to its `accid`; the right-click menu, the dialog and the MEI tab of the sidebar then speak of the `accid` (and show no neume), and the tab lists its generated `accid`, `ploc` and `oloc`.

## 1. Terms and precedence

| Term | Meaning |
|---|---|
| **annotation** | An MEI attribute on `nc`, `neume` or `syllable` that the entity mapping does not write. |
| **nc** | *Neume component*: one note of a neume (a Monodi `Note`). |
| **entity mapping** | The profile's table "Monodi concept → MEI element and attributes" (Settings → MEI Mapping → *Elements*). Unchanged by this feature. |
| **pattern code** | The short code of a neume's shape: `*` first note, `u` up, `d` down, `e` equal, `[ ]` a ligature (for example `[*ud]`). |
| **schema catalog** | A compact JSON description of which attributes and child elements each MEI element allows, built from a RelaxNG schema (section 4). |

Attributes reach an element in this order; a later source overrides an earlier one for the same attribute name:

1. entity mapping (and `con="g"` after a gap between groups of a neume);
2. note flags (`meiTag`, `mei` of a flag);
3. pattern rules (*Patterns* tab, "transcription equivalents");
4. annotation rules (*Rules* tab), in list order;
5. attributes set by hand in the editor.

`xml:id` is written by the export and can never be set by an annotation.

## 2. By hand in the editor

Right-click a note → **MEI attributes** → *On this note (nc)*, *On its neume*, or *On its syllable*. The dialog offers the attributes the active schema allows for that element (name search, description, value suggestions) and checks each value. An attribute the schema does not know can still be added: it is a warning, or an error when *Strict* is on (section 4). The syllable context menu has the same entry for the syllable.

Storage: `Note.meiAttrs` (on `nc`), `Note.meiNeumeAttrs` (on the `neume`; held by the neume's first note, because the editor splits and joins ligature groups), `Syllable.meiAttrs` (see `types/model.ts`). The fields are optional; files without them are unchanged. They travel through the Monodi JSON export and import like the other note fields.

**Choosing the attribute.** The dialog and the rules panel share one picker (`mei-attr-picker`): typing searches the attribute names and their descriptions (all words must occur; a name match ranks first), *Browse* lists every attribute the schema allows on the element, and the chips narrow the list to attributes with fixed values, numbers or text. Each entry shows its value type, the first allowed values and the description. A name that is not in the list can be added as a custom attribute.

**MEI tab of the document sidebar.** With a note selected, the sidebar tab *MEI* lists the annotations of the note, its neume and its syllable, each marked *by hand* or *rule*, with an *Edit* button that opens the dialog (`mei/mei-selection.ts`). The layout adapts to the width of the sidebar.

**What the tab shows, and how much.** The tab has two views: *Selected* (the note, its neume and its syllable in one card) and *All annotated* (every annotated place of the document, from the hand and from rules, filterable; a row jumps to the note). Two switches control the amount of detail: the lock shows or hides the generated rows, the dot shows or hides the marks in the staff. Generated rows are the attributes the export mapping writes from the Monodi data (`pname`, `oct`, `con` after a gap, …); they are computed by exporting the selected syllable alone, are locked, and are overridden by setting the same attribute by hand (the row then says "overrides generated value"). The marks in the staff are a filled dot on a note with attributes of its own or on its neume, and an open ring on the first note of a syllable with attributes of its own. In the staff, red marks come from attributes set by hand and amber marks from annotation rules. The list *All annotated* is grouped, so that it stays readable in a long document: by annotation (places with the same element and the same attribute values together, most frequent first; the default), by syllable, or by element; groups open and close, and a row jumps to the note. The choices are kept per browser (`mei/mei-view-prefs.ts`) and never change the export. The dialog lists the generated attributes of the element as well.

**Limit.** When the note text is edited, the editor rebuilds the notes from the code and carries the uuid and the annotations over **by position** (`copyUuids`). Inserting a note before an annotated one therefore shifts the annotation by one position. The same holds for comments, which are also anchored by uuid.

**Flags and the MEI vocabulary.** A note flag (for example *Virga*) is the Monodi side of an MEI neume form. In Settings → MEI Mapping → Annotations → *Flags* each flag has an **MEI form**, chosen from the values the schema lists for `@type` of a note (virga, punctum, apostropha, …); the card shows what the export writes (`<nc type="virga"/>`) and the schema check reports an unknown form or attribute. A flag whose name is an MEI form (Virga, Punctum) is connected when it is created, and the *+ virga*, *+ punctum* buttons add the standard forms with the connection made. Further attributes and a different element are under *More MEI attributes and element*; `@type` and the element `virga` differ: MEI has no `<virga>` element, so the element field is meant for elements the schema knows. The same attributes appear as locked *generated* rows in the sidebar tab.

## 3. Rules

A rule has conditions and attributes to set. All conditions that are filled in must hold.

| Condition | Meaning |
|---|---|
| neume pattern, whole or inside | pattern code of the neume, same syntax as the pattern tool (`*u`, `[*ud]`, `*??`, `ud`) |
| notes of the pattern | all, the first, the last, or the n-th note of the match |
| syllable text | JavaScript regular expression, case-insensitive |
| pitch | regular expression tested on letter and octave, for example `^[CD]4$` |
| note type, liquescent, note flag | the note's type (Oriscus, Quilisma, …), liquescent state, or a flag it carries |
| manuscript siglum | the rule applies to that manuscript only (the export is given the siglum) |

The rule's **target** is the element that receives the attributes: each matching note (`nc`), the neume of a matching note, or its syllable. Values may use `{pname}` (pitch letter), `{oct}`, `{syllable}` and `{index}` (position in the neume, 1-based). The panel shows how many places a rule matches in the preview document. A rule with an invalid regular expression or pattern, or with no attribute, is skipped at export and shown with a warning.

Rules are evaluated once per document by `buildAnnotationIndex` (`packages/core/src/mei/annotations.ts`) and merged by the emitter. They work in the headless export (`scripts/export-mei-batch.mjs`) because they are part of the profile.

## 4. Schemas

The editor never evaluates a RelaxNG schema at edit time. It reads a **schema catalog** (`packages/core/src/mei/schema-catalog.ts`), produced from a RelaxNG file by `schema/rng-to-catalog.ts`. The parser follows attribute classes (`att.*`), content models (`model.*`) and data types, including unions such as `oct` (an integer 0–9 or the word `unknown`).

| Catalog | Origin |
|---|---|
| `mei-5.0-all` | bundled: `src/assets/mei/mei-5.0-all.catalog.json`, built from `src/app/mei/mei-all.rng` |
| `mei-5.0-neumes-view` | derived at load time: the neume elements, the score structure around them and the editorial elements of `mei-5.0-all`. An approximation of the MEI neume customization, not the customization itself. |
| any other | loaded by a person: a `.rng` file (for example `mei-Neumes.rng` or a later MEI release) or a catalog `.json`; kept in the browser's local storage |

Settings → MEI Mapping → *Schema* also holds:

- **Strict**: an attribute the schema does not allow on its element is an error instead of a warning. Nothing blocks the export either way.
- **Your own attributes**: attributes the schema does not contain (element or `*`, name, optional allowed values). They are offered and checked like schema attributes. This is the way to use an attribute before a schema has it.
- **Favourite attributes**: shown as buttons in the dialog.

The preview in the MEI settings lists schema problems of rules and of annotations in the preview document.

Rebuild the bundled catalog after replacing `mei-all.rng`:

```bash
node scripts/build-mei-catalog.mjs src/app/mei/mei-all.rng src/assets/mei/mei-5.0-all.catalog.json
```

## 5. How it is checked

| Check | Command |
|---|---|
| unit tests: catalog, RelaxNG parser, rules, emitter, carry-over of annotations | `npm run test:ci` (specs `mei/schema/rng-to-catalog.spec.ts`, `mei/mei-annotations.spec.ts`) |
| end to end: Rules tab, Schema tab, right-click dialog | build, serve, then `node scripts/mei-annotations-e2e.mjs --url http://localhost:4299` |

## 6. Files

| File | Role |
|---|---|
| `packages/core/src/mei/schema-catalog.ts` | catalog types, `checkAttribute`, `attributesOf`, `subsetCatalog`, `withExtensions` (authoritative for what "valid" means) |
| `mei/schema/rng-to-catalog.ts` | RelaxNG → catalog (browser, Node and tests) |
| `mei/schema/mei-schema-registry.service.ts` | the available catalogs, loading, persistence |
| `packages/core/src/mei/annotations.ts` | rule engine, merging, helpers for hand-set attributes |
| `mei/mei-annotation-check.ts` | report of rule and annotation problems against a catalog |
| `mei/mei-annotation-dialog.component.*` | the right-click dialog |
| `mei/mei-rules-panel.component.*`, `mei/mei-schema-panel.component.*` | the settings tabs |
| `packages/core/src/mei/emitter.ts` | applies the annotations (search for `annotations`) |
| `packages/core/src/document/flag-patterns.ts` | `compileNeumeQuery`: pattern matching shared with the flag tool |

## 7. Open, state 2026-11-02

| # | Open item | Context and options | Who decides |
|---|---|---|---|
| 1 | Exact neume schema | The *neumes view* is derived from the full schema. The MEI project publishes the real customization `mei-Neumes.rng`; loading it in the *Schema* tab replaces the approximation. Bundling it needs the file to be added to the repository. | maintainer of the MEI export |
| 2 | Removing what the mapping writes | An annotation can override an attribute of the mapping (for example `con`), but an empty value is skipped, so `con="g"` cannot be suppressed on one note. Option: a marker value that removes the attribute. | maintainer of the MEI export |
| 3 | Gap between groups of a neume | `con="g"` still follows from a single space in the pitch string. Option: a per-group connection field with the current behaviour as default. Per note, `meiAttrs.con` can already override it. | maintainer of the MEI export; people who know the notation |
| 4 | Full schema validation in the browser | The checks cover attribute names and values per element, not the nesting of the whole file, and not the Schematron rules. The offline check (`xmllint --relaxng`, CM-hub `meicheck`) remains the full check. | maintainer of the MEI export |
| 5 | Annotations by position | See the limit in section 2. Option: anchor annotations by a marker in the note code. | maintainer of the editor |
| 6 | Body mapping table of CM-hub | `config/mei-body-mapping.yml` in CM-hub does not describe annotations; the dataset check reports extra attributes only through the schema check. | maintainer of CM-hub |
| 7 | Rule marks, state 2026-11-02 | The amber marks of rules are evaluated every 600 ms while marks are on and rules exist; covered by a unit test of the mark store, not yet by an e2e test with a rule in the profile. | maintainer of the editor |
