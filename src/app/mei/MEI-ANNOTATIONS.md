# MEI annotations and schema catalogs in Monodi-Zero

State: 2026-11-05. Baseline: commit `50b6aa1c` of `main` in the monorepo `monodi-platform` and the branch `feat/mei-review-workflow`, app `apps/monodi`.

**What it is for.** MEI (Music Encoding Initiative, an XML standard for music) has many more attributes than the Monodi data model has fields. This document describes how a person adds MEI attributes to notes, neumes and syllables, either by hand in the editor or automatically by rules, and how those attributes are checked against an MEI schema.

**Who it is for.** People who edit chants and want richer MEI; people who maintain the MEI export; developers who continue the work.

**Where to start.**

| I want to … | Go to |
|---|---|
| set an attribute on one note, neume or syllable | editor: right-click a note → *MEI attributes* (section 2) |
| set an attribute everywhere a condition holds | Settings → MEI Mapping → Annotations → *Rules* (section 3) |
| check a transcription: which notes carry an attribute or a flag, which lack one | editor: sidebar tab *MEI* → *Overview* (section 2, "Reviewing a whole document") |
| make a flag (for example V for virga) write an MEI attribute | Settings → MEI Mapping → Annotations → *Flags* (section 2, "Flags and MEI attributes") |
| choose or load an MEI schema, allow my own attributes | Settings → MEI Mapping → *Schema* (section 4) |
| understand how the pieces fit | section 1 |
| change the code | section 6 |

**The MEI Mapping page.** It has three areas: *Export format* (sections *Structure*, *Levels* (which element each level of the music becomes; state 2026-11-05, see `MEI-EXPORT-STRUCTURE.md`), *Elements*, *Header* with the publication data), *Annotations* (*Flags*, *Patterns*, *Rules*) and *Schema*. The profile (select, "…" menu for new, duplicate, rename, import, export, reset, delete) and the *Result* preview are in the top row; the checks are one line that opens to the list of problems.

**Flat, sharp and natural.** A Monodi note of type Flat, Sharp or Natural is not a note of the melody. The export writes it as `<accid accid="f|s|n" ploc="…" oloc="…"/>` in the syllable, between the neumes, in the default and in the schema-conformant structure (profile option `accidentals`, switch *Flat, sharp and natural as &lt;accid&gt;* in Export format → Structure; the element name and its attributes are set in Export format → Levels → Accidental, state 2026-11-05). Switched off, it is written as a note `<nc>` with pitch, as in Monodi-Zero 0.9.1. Attributes set by hand on the accidental's note are written to its `accid`; the right-click menu, the dialog and the MEI tab of the sidebar then speak of the `accid` (and show no neume), and the tab lists its generated `accid`, `ploc` and `oloc`.

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

**MEI tab of the document sidebar.** The sidebar tab *MEI* shows what the export writes, and where each attribute comes from. It has two views, *Note* and *Overview*, and a legend of the four **sources** of an attribute, each with one colour that the tab and the staff share (`MEI_SOURCE_COLOR` in `mei/mei-view-prefs.ts`, CSS variables `--mei-hand`, `--mei-flag`, `--mei-rule`, `--mei-mapping` in `src/styles.css`):

| Source | Colour | Meaning |
|---|---|---|
| *by hand* | blue | set in the editor (dialog, Note view) |
| *flag* | violet | written by a note flag the note carries (`mei` and `meiTag` of the flag) |
| *rule* | teal | written by an annotation rule of the profile (section 3) |
| *from data* | grey | generated by the entity mapping from the Monodi data: `con="g"` after a gap, the stem of an ascending head, … (pitch and octave are not listed) |

**Note view.** With a note selected, the view lists what the export writes on the note (`<nc>`, or `<accid>` for a flat, sharp or natural), on its neume and on its syllable (`mei/mei-selection.ts`). Each row carries a tag with its source (*hand*, *flag V*, *rule*, *data*), a magnifier that highlights every place with the same value in the staff (see "Reviewing a whole document"), and, for a row set by hand, a × that removes it. The flags of the project are buttons above the rows: a click sets or clears the flag on the note, and the rows the flag writes appear or disappear with it. A row set by hand that a flag writes exactly (the flag writes that one attribute and no element name) offers "The flag V (Virga) writes the same. Use the flag instead." The *Edit* button opens the dialog. Every change is one undo step. The lock switch shows or hides the rows from the data; the dot switch shows or hides the marks in the staff.

**Reviewing a whole document.** The *Overview* lists every attribute the export writes in the document, grouped by element (notes, accidentals, neumes, syllables), with every value, how many places carry it and from which sources (`mei/mei-review.ts`, which exports the whole document with the active profile and reads the result, so the Overview never differs from the export). Above the attributes, the *Flags* section lists each flag of the project with what it writes and how many notes carry it. A search field narrows the list (attribute name, value, flag name); chips switch the sources on and off (*from data* is off at first, so that the list starts with the decisions of the editor).

A click on a value, a flag, or the link *without: n* of an attribute (the elements of that kind that lack it) **highlights** those places in the staff: every place light orange, the place stepped to dark orange. The lens bar on top of the tab names what is highlighted, counts the places (`3 / 41`), steps through them with ‹ › or with F3 and Shift+F3 (the editor scrolls to the note and selects it), lists them (each entry jumps to its place), and ✕ ends the highlighting. When the highlighted value is set by hand at some places, the bar offers two **bulk actions**, each one undo step: *Remove* (removes the value set by hand at every highlighted place) and, when a flag writes exactly that value, *Use flag V Virga* (removes the hand-set value and sets the flag instead; the export writes the same, and the note then carries the flag's marker, digit key and rules). A typical check: click `tilt` → `s` to see every virga stem, step through them with F3, and replace the hand-set ones by the flag V in one step.

**Marks in the staff.** The marks show the attributes as drawings on the note head where they change the shape of a neume component (`mei/mei-attribute-glyphs.ts`, state 2026-11-05). The model is Verovio, the engraver of MEI neumes: Verovio swaps its square chant glyph for a few attributes (`src/calcligatureorneumeposfunctor.cpp` in rism-digital/verovio), and the staff adds the same change to Monodi's oval head, which itself stays as it is. `tilt="s"` is a short stem down at the right (Verovio: virga), `tilt="n"` a short stem up at the right (as Monodi's ascending head; Verovio draws a reversed virga), `tilt="se"` a thin lozenge around the head (Verovio: punctum inclinatum), `curve` a small tail at the right that bends down (`c`, auctum descendens) or up (`a`, auctum ascendens), and two `ligated` components in a row, or a component with `con="e"` and the one before it, are joined by an oblique band from head to head (Verovio: oblique ligature) inside one neume. Verovio draws nothing for the other attributes; they get small marks of their own: the other tilts a short tick outside the head in that direction, `rellen` a bar below the head (long or short), `con="g"` two short bars and `con="l"` a small loop at the left, `angled` a small angle above, `hooked` a hook at the right. An attribute the note head shows already gets no drawing (`tilt="n"` on an ascending head, `tilt="s"` on a descending head). Every other attribute (`name`, `lig`, …) has no shape and is marked with a filled dot on the note or on its neume; an open ring on the first note of a syllable marks attributes of the syllable. A note whose attributes all have a shape gets no dot. Drawings and dots take the colour of their source (blue by hand, violet from a flag, teal from a rule); the tooltip names the source. The read-only staff grows downwards when a drawing reaches below the lowest note. The dialog has a *Shape of the note* section: each button shows the drawing on a note head; click it to set the attribute, click it again to remove it. The choices of the tab are kept per browser (`mei/mei-view-prefs.ts`) and never change the export; a view stored as *All annotated* (the list the Overview replaced on 2026-11-05) opens as the Overview.

**Limit.** When the note text is edited, the editor rebuilds the notes from the code and carries the uuid and the annotations over **by position** (`copyUuids`). Inserting a note before an annotated one therefore shifts the annotation by one position. The same holds for comments, which are also anchored by uuid.

**Flags and MEI attributes.** A note flag (for example *Virga*, key V) is the Monodi side of an MEI neume form: the editor shows its marker, and the export writes what the flag stands for. The path from flag to MEI is the same everywhere:

1. **Define** the flag in Settings → MEI Mapping → Annotations → *Flags*. Each flag has an **MEI form**, chosen from the values the schema lists for `@type` of a note (virga, punctum, apostropha, …); the card shows what the export writes (`<nc type="virga"/>`) and the schema check reports an unknown form or attribute. A flag whose name is an MEI form (Virga, Punctum) is connected when it is created, and the *+ virga*, *+ punctum* buttons add the standard forms with the connection made. Further attributes (for example `tilt="s"`) and a different element are under *More MEI attributes and element*; `@type` and the element `virga` differ: MEI has no `<virga>` element, so the element field is meant for elements the schema knows.
2. **Set** it on notes: digit key or right-click menu in the editor, letter in the note's brackets (`g[V]`), the pattern tool, the flag buttons of the Note view, or the flag section of the dialog *MEI attributes*.
3. **See** what it writes: the Note view tags the rows *flag V*, the Overview lists the flag with what it writes and its notes, and the staff draws its attributes in violet.
4. **Replace** values set by hand by the flag where they mean the same: per row in the Note view or in the dialog, or for every place at once from the lens bar (see "Reviewing a whole document").

A value set by hand wins over the flag for the same attribute (section 1); the Note view then shows the hand-set row, and the flag's row no longer appears.

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
| unit tests: MEI tab (sources, Overview, highlighting, bulk actions, flags in the dialog) | `npm run test:ci` (specs `mei/mei-review.spec.ts`, `mei/mei-selection.spec.ts`, `mei/mei-annotation-dialog.component.spec.ts`) |
| end to end: Rules tab, Schema tab, right-click dialog | build, serve, then `node scripts/mei-annotations-e2e.mjs --url http://localhost:4299` |

## 6. Files

| File | Role |
|---|---|
| `packages/core/src/mei/schema-catalog.ts` | catalog types, `checkAttribute`, `attributesOf`, `subsetCatalog`, `withExtensions` (authoritative for what "valid" means) |
| `mei/schema/rng-to-catalog.ts` | RelaxNG → catalog (browser, Node and tests) |
| `mei/schema/mei-schema-registry.service.ts` | the available catalogs, loading, persistence |
| `packages/core/src/mei/annotations.ts` | rule engine, merging, helpers for hand-set attributes |
| `mei/mei-annotation-check.ts` | report of rule and annotation problems against a catalog |
| `mei/mei-annotation-dialog.component.*` | the right-click dialog (attributes, shapes, flags of the note) |
| `mei/mei-selection.ts` | Note view of the MEI tab: what the export writes on the selected note, its neume and its syllable |
| `mei/mei-review.ts` | Overview of the MEI tab: every place with its attributes and their sources, counts, lenses, bulk actions (authoritative for the sources) |
| `mei/mei-view-prefs.ts` | display choices, marks of rules, highlighted notes, colours of the sources |
| `document/document.component.*` | the MEI tab (search for `mei`) |
| `mei/mei-rules-panel.component.*`, `mei/mei-schema-panel.component.*` | the settings tabs |
| `packages/core/src/mei/emitter.ts` | applies the annotations (search for `annotations`) |
| `packages/core/src/document/flag-patterns.ts` | `compileNeumeQuery`: pattern matching shared with the flag tool |

## 7. Open, state 2026-11-05

| # | Open item | Context and options | Who decides |
|---|---|---|---|
| 1 | Exact neume schema | The *neumes view* is derived from the full schema. The MEI project publishes the real customization `mei-Neumes.rng`; loading it in the *Schema* tab replaces the approximation. Bundling it needs the file to be added to the repository. | maintainer of the MEI export |
| 2 | Removing what the mapping writes | An annotation can override an attribute of the mapping (for example `con`), but an empty value is skipped, so `con="g"` cannot be suppressed on one note. Option: a marker value that removes the attribute. | maintainer of the MEI export |
| 3 | Gap between groups of a neume | `con="g"` still follows from a single space in the pitch string. Option: a per-group connection field with the current behaviour as default. Per note, `meiAttrs.con` can already override it. | maintainer of the MEI export; people who know the notation |
| 4 | Full schema validation in the browser | The checks cover attribute names and values per element, not the nesting of the whole file, and not the Schematron rules. The offline check (`xmllint --relaxng`, CM-hub `meicheck`) remains the full check. | maintainer of the MEI export |
| 5 | Annotations by position | See the limit in section 2. Option: anchor annotations by a marker in the note code. | maintainer of the editor |
| 6 | Body mapping table of CM-hub | `config/mei-body-mapping.yml` in CM-hub does not describe annotations; the dataset check reports extra attributes only through the schema check. | maintainer of CM-hub |
| 7 | Rule marks, state 2026-11-02 | The marks of rules are evaluated every 600 ms while marks are on and rules exist; covered by a unit test of the mark store, not by an e2e test with a rule in the profile (state 2026-11-05). | maintainer of the editor |
| 8 | Cost of the Overview, state 2026-11-05 | The Overview exports the whole document at most every 600 ms while the MEI tab is open and the document changed. Measured on test documents of a few hundred notes only; for very long documents an option is to rebuild on demand (a refresh button). | maintainer of the editor |
| 9 | Bulk actions for rules and flags, state 2026-11-05 | The lens bar removes or replaces values set by hand. Values from a rule or from the mapping are changed in the rule or the profile; a bulk "set this value on every highlighted place" is not offered. Options: add it, or keep the hand-set values as deliberate exceptions. | editors of the edition |
