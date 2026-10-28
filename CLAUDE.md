# Monodi-Zero (monodi-light): project rules

- Start with `README.md`. Metadata standards (TEI/MEI/…): the mapping is `config/metadata-mapping.yml` and the explanation `docs/METADATA-STANDARDS.md`, both in the repository CM-hub.
- When several sessions work in the same folder, commit only your own files.
- **Headless MEI export.** `node scripts/export-mei-batch.mjs --zip <monodi.zip> --out <mei.zip> --level 2` writes one MEI file per document of a Monodi ZIP with the same emitter as the export button (headless Chrome; set `CHROME_BIN` if Chrome is not found). CM-hub uses it for its dataset (`cm dataset package --monodi-light <this folder>`). `src/app/mei/metadata-mapping.generated.ts` is generated from CM-hub; regenerate it there after changing the mapping.
- **Deployment of monodi.app.** A push to `master` runs `.github/workflows/ci.yml`; its job `deploy-pages` publishes the site and runs only if every other job passed. GitHub Pages must stay on source "GitHub Actions" (`gh api repos/timeipert/monodi/pages --jq .build_type` must print `workflow`). With branch deployment every push to `master` publishes the nearly empty `docs/` folder (`docs/` is gitignored except `docs/CNAME`) and the site shows a 404 page. Before pushing `master`, check that value; after pushing, watch the CI run (`gh run list --repo timeipert/monodi --limit 3`) and confirm `curl -sI https://monodi.app/` answers 200. If a flaky job skipped the deploy, rerun the failed jobs (`gh run rerun <id> --failed`). Pushing a feature branch does not deploy.

## Writing rule for all texts (project-wide)

Every text that is written (documentation, README files, comments in code and configuration, notes in tables, commit and pull request texts, test names) must be understandable for humans and LLMs who are new to the project and want to continue the work. It must not serve only the person who commissioned it. The audience is English-speaking.

- **Language.** Everything that is newly created is written in English: documentation, code, comments, configuration, tests, commit texts. German column, field and file names that exist in the data (for example `Quellensigle`, `Gattung1`, `dokumenten_id`) stay unchanged, because they cannot simply be renamed. Existing German documents stay German until they are revised.
- **Notes carry a translation.** Every note in a data file (`note`, `reason`, `question`, `description`) is written in English and always comes with its German original in the matching `*_de` field (`note_de`, `reason_de`, `question_de`, `description_de`). The project validators reject a lone half.
- **No time words without a reference point.** Not "today", "now", "currently", "not yet", "new", "so far", "formerly", "later". Use a date (ISO, `2026-10-24`) or a version or commit instead: "baseline: Monodi-Zero 0.9.1", "open, state 2026-10-24". Names of files, fields and levels describe the content, not the moment (`in_baseline`, not `today`; "Standard level", not "new level").
- **No direct address and no names of requesters.** No "you", "I", "we", no "X wants …". Persons appear by name only where they belong to the subject (contributors, responsibilities), and then with their role.
- **No reference to conversations.** Not "as discussed", "see the chat above", "at the request of …". Decisions are recorded in the document itself with date, reason and responsible role.
- **Explain terms.** Every abbreviation and technical term is explained at first use or points to a glossary (for example TEI, MEI, siglum, source, document, emitter, level).
- **Every document answers:** What is it for? Who is it for? Where does one start? What is done, what is open (with a state date)? How is it checked? Which file is authoritative?
- **Open questions** have a number, context, options, and name who can decide (a role).
- **Paths and links** are relative to the repository, never local absolute paths (`/Users/...`). Links to files outside the repository name the repository.
- **Keep it current.** Whoever changes something updates the state date, status tables and references in the affected documents.
- **Final check:** Would a person who does not know the project, and has not talked to whoever commissioned the text, understand it completely?
