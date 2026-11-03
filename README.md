<img width="1440" height="530" alt="grafik" src="https://github.com/user-attachments/assets/4e8d914a-9c46-48de-8f3d-a93c44f88f03" />

**A local-first digital workbench for the transcription, edition, and analysis of medieval monophonic chant.**

[Monodi-Zero](https://monodi.app) runs in the browser, with no server and no account: a keyboard-driven notation editor, a IIIF (manuscript image) viewer, a critical apparatus, corpus search and synopsis, and export to PDF, MEI (Music Encoding Initiative XML), HTML and ZIP.

**The browser owns the storage: clearing its site data deletes the workspace, so make regular backups.**

- **Using it:** open the app and read *Manual* in its navigation bar. All features: [FEATURES.md](FEATURES.md).
- **Developing it:** Angular, no backend. Rules for changes: [CLAUDE.md](CLAUDE.md).

```bash
npm ci
npx ng serve           # development server at http://localhost:4200
npx ng test --watch=false --browsers=ChromeHeadless
```

Desktop packaging (Electron) and related projects: [FEATURES.md](FEATURES.md).

---

> **Where this code is edited.** The source of this app is the folder `apps/monodi` of [timeipert/monodi-platform](https://github.com/timeipert/monodi-platform/tree/main/apps/monodi). The repository [timeipert/monodi](https://github.com/timeipert/monodi) receives a copy of that folder and deploys it; it is not edited directly (a commit there stops the copy). How the copy works: `docs/sync.md` in monodi-platform.
