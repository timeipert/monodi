// Shared helpers for the headless-Chrome e2e scripts. They always run in a fresh
// browser profile (indexedDB of the page origin), never against real user data.

/** Writes sources/documents/notes/settings straight into the app's localforage DB. */
export async function seedWorkspace(page, docs, settings = {}) {
  await page.evaluate(async ({ docs, settings }) => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('monodi-light');
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('monodi_data')) r.result.createObjectStore('monodi_data'); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    const put = (k, v) => new Promise((res, rej) => {
      const tx = db.transaction('monodi_data', 'readwrite');
      tx.objectStore('monodi_data').put(v, k); tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
    // one source per distinct `d.source` (default src1 = "Test 1"); `d.sigle` names it
    const sourceIds = [...new Set(docs.map((d) => d.source || 'src1'))];
    await put('monodi_sources', sourceIds.map((sid) => ({ id: sid, quellensigle: docs.find((d) => (d.source || 'src1') === sid && d.sigle)?.sigle || (sid === 'src1' ? 'Test 1' : sid), herkunftsregion: '', herkunftsort: '', herkunftsinstitution: '', ordenstradition: '', quellentyp: '', bibliotheksort: '', bibliothek: '', bibliothekssignatur: '', kommentar: '', datierung: '', ...(docs.find((d) => (d.source || 'src1') === sid && d.sourceDescription) ? { custom: { description: docs.find((d) => (d.source || 'src1') === sid && d.sourceDescription).sourceDescription } } : {}) })));
    await put('monodi_documents', docs.map((d) => ({ id: d.id, quelle_id: d.source || 'src1', dokumenten_id: d.label, gattung1: d.genre1 || '', gattung2: d.genre2 || '', festtag: '', feier: '', textinitium: d.incipit || d.label, bibliographischerverweis: '', druckausgabe: d.edition || '', zeilenstart: '', foliostart: '', kommentar: '', editionsstatus: '' })));
    for (const d of docs) await put('monodi_notes_doc_' + d.id, d.root);
    await put('monodi_notes_index', docs.map((d) => d.id));
    await put('monodi_notes_migrated_v1', true);
    await put('monodi_settings', settings);
    db.close();
  }, { docs, settings });
}

/** Makes the next generated PDF (blob download) arrive in Node via `onPdf(buffer)`. */
export async function capturePdfDownloads(page, onPdf) {
  await page.exposeFunction('__savePdf', async (b64) => onPdf(Buffer.from(b64, 'base64')));
  await page.evaluateOnNewDocument(() => {
    const orig = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (obj) => {
      if (obj instanceof Blob && /pdf/.test(obj.type)) {
        const fr = new FileReader();
        fr.onload = () => window.__savePdf(String(fr.result).split(',')[1]);
        fr.readAsDataURL(obj);
      }
      return orig(obj);
    };
  });
}
