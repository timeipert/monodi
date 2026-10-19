import * as JSZip from 'jszip';
import * as localforage from 'localforage';
import { Source } from './api.service';
import { applyPlan, describePlan, planImport } from './annotation-exchange';
import { parseAnnotationFile } from './cm-transkriptionseq-import';
import { buildNotationDoc } from './notation-doc';
import { convertNeumeDocs, isNeumeDocs, parseIiifCrop, readAnnotationFiles } from './neume-docs-import';
import { loadStripImages, saveStripImages } from './notation-strip-images';

const source = (extra: Partial<Source> = {}): Source => ({
  id: 'src-1', quellensigle: 'Fix 1', herkunftsregion: '', herkunftsort: '', herkunftsinstitution: '', ordenstradition: '',
  quellentyp: '', bibliotheksort: '', bibliothek: '', bibliothekssignatur: '', kommentar: '', datierung: '', ...extra
});

const SVG = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=';
const P8 = 'https://iiif.test/img/p8';

/** A documentation in the shape the Neumen-Editor writes: a manuscript on IIIF, one of screenshots, one from a catalogue. */
const iiifData = (): any => ({
  id: 'Fix 1', source: 'Fix 1', name: 'Fixture', notes: 'Notator A: f. 8r.', kind: 'iiif',
  rows: [
    { pattern: '*', refId: '10', notes: '', tier: 'standard' },
    { pattern: '[*du]', refId: '21', notes: 'seldom', tier: 'standard' },
    { pattern: '*', refId: '99', notes: '', tier: 'standard' },   // the same pattern again: the first wins
    { pattern: '*ud', refId: '', notes: '', tier: '' },            // no Reference ID: no row
  ],
  snippets: [
    { id: 's1', pattern: '*', variant: 'a', refId: '10a', folio: '8r', line: 'Line 6', image: '', zoom: '', lineId: 'L1' },
    { id: 's2', pattern: '[*du]', variant: '', refId: '21', folio: '8r', line: 'Line 6', image: '', zoom: '', lineId: 'L1' },
    { id: 's3', pattern: '*V', variant: '', refId: '10·v', folio: '9v', line: 'Line 2', image: '', zoom: '', lineId: 'L2' },
  ],
  lines: [
    { id: 'L1', folio: '8r', name: 'Line 6', image: `${P8}/pct:10,30,70,8/1200,/0/default.jpg`, items: [
      { id: 's1', points: '5,10 15,10 15,90 5,90' }, { id: 's2', points: '50,10 60,10 60,90 50,90' } ] },
    { id: 'L2', folio: '9v', name: 'Line 2', image: 'https://iiif.test/img/p9/pct:12,20,70,8/1200,/0/default.jpg', items: [
      { id: 's3', points: '20,20 30,20 30,80 20,80' } ] },
  ],
});

const screenshotData = (): any => ({
  id: 'Shot', source: 'Shot', name: '', notes: '', kind: 'collection',
  rows: [{ pattern: '*', refId: '', notes: '', tier: 'standard' }, { pattern: '*d', refId: '', notes: '', tier: 'standard' }],
  snippets: [
    { id: 'a', pattern: '*', variant: '', refId: '30', folio: '12r', line: '3', image: 'images/Shot/a.svg', lineId: 'ln' },
    { id: 'b', pattern: '*d', variant: 'b', refId: '-', folio: '12r', line: '3', image: 'images/Shot/b.svg', lineId: 'ln' },
  ],
  lines: [{ id: 'ln', folio: '12r', name: '3', image: 'images/Shot/line-ln.svg', items: [
    { id: 'a', box: { x: 10, y: 20, w: 20, h: 60 } }, { id: 'b', box: { x: 50, y: 20, w: 20, h: 60 } } ] }],
});

const catalogueData = (): any => ({
  id: '030', source: 'A-GÖ 107', name: 'Pauline Missal', notes: 'Catalogue.', kind: 'collection',
  rows: [{ pattern: '*', refId: '', notes: '', tier: '' }],
  snippets: [{ id: '030a-1', pattern: '*', variant: '', refId: '030a-1', folio: '', line: '', image: 'images/030/030a-1.png', lineId: '' }],
  lines: [],
});

const bundle = (manuscripts: any[], files: any = {}): any => ({
  format: 'neume-docs', version: 1, generated: '2026-10-19', info: { title: 'T' }, columns: [], signs: {},
  manuscripts: manuscripts.map(d => ({ id: d.id, source: d.source, name: d.name, kind: d.kind, meta: {}, file: `data/${d.id}.json`, data: d })),
  files,
});

describe('Neumen-Editor documentations', () => {
  describe('recognising', () => {
    it('knows the index of a documentation, and nothing else', () => {
      expect(isNeumeDocs({ format: 'neume-docs', version: 1 })).toBeTrue();
      expect(isNeumeDocs({ format: 'cm-annotation-exchange' })).toBeFalse();
      expect(isNeumeDocs([])).toBeFalse();
      expect(isNeumeDocs(null)).toBeFalse();
    });

    it('is read by parseAnnotationFile, as text or as data', () => {
      expect(parseAnnotationFile(bundle([iiifData()])).sources.length).toBe(1);
      expect(parseAnnotationFile(JSON.stringify(bundle([iiifData()]))).sources.length).toBe(1);
    });

    it('refuses the index alone, a missing version and a newer format, saying why', () => {
      const index = { ...bundle([iiifData()]) };
      index.manuscripts = index.manuscripts.map((m: any) => ({ ...m, data: undefined }));
      expect(() => convertNeumeDocs(index)).toThrowError(/index of a documentation.*data\/.*ZIP/);
      expect(() => convertNeumeDocs({ ...bundle([iiifData()]), version: undefined })).toThrowError(/version/);
      expect(() => convertNeumeDocs({ ...bundle([iiifData()]), version: 2 })).toThrowError(/newer version/);
    });
  });

  describe('a manuscript on IIIF', () => {
    const file = () => convertNeumeDocs(bundle([iiifData()]));

    it('reads the IIIF address of a line as its page and place', () => {
      expect(parseIiifCrop(`${P8}/pct:10,30,70,8/1200,/0/default.jpg`)).toEqual({ imageId: P8, rect: { x: 10, y: 30, w: 70, h: 8 } });
      expect(parseIiifCrop(`${P8}/full/1200,/0/default.jpg`)).toBeNull();
      expect(parseIiifCrop('images/a.png')).toBeNull();
      expect(parseIiifCrop('javascript:alert(1)')).toBeNull();
    });

    it('makes the line a region on its page, and puts the snippets back on the page', () => {
      const s = file().sources[0];
      expect(s.quellensigle).toBe('Fix 1');
      expect(s.annotationRegions![0]).toEqual({ id: 'L1', name: 'Line 6', folio: '', folioLabel: '8r', imageId: P8, points: '10,30 80,30 80,38 10,38' });
      // 5 % of a line 70 wide that starts at 10 is 13.5 of the page; 10 % of a line 8 high that starts at 30 is 30.8
      expect(s.annotationItems![0]).toEqual({ id: 's1', regionId: 'L1', pattern: '*', variant: 'a', points: '13.5,30.8 20.5,30.8 20.5,37.2 13.5,37.2' });
      expect(s.regionImages).toBeUndefined();
    });

    it('takes the table with Reference IDs, the first row of a pattern, and the notes of the table', () => {
      const s = file().sources[0];
      expect(s.equivalents).toEqual([{ pattern: '*', refId: '10' }, { pattern: '[*du]', refId: '21', notes: 'seldom' }]);
      expect(s.notationNotes).toBe('Notator A: f. 8r.');
    });

    it('calls a code with a special sign (`*V`, a virga) by the row of the code without it', () => {
      const s = file().sources[0];
      expect(s.annotationItems!.find(i => i.id === 's3')!.pattern).toBe('*');
    });

    it('prints: the strips are cut from the page by the address the file named, with no manifest', () => {
      const out = applyPlan(source(), planImport(file(), [source()]).plans[0]);
      const doc = buildNotationDoc(out);
      const row = (pattern: string) => doc.rows.find(r => r.pattern === pattern)!;
      expect(row('*').refId).toBe('10');
      expect(row('[*du]').refId).toBe('21');
      expect(row('*').variants.map(v => v.variant)).toEqual(['', 'a']);   // s3 (`*V`) has no variant, s1 has "a"
      expect(doc.strips.map(s => s.place.text)).toEqual(['8 / 6', '9v / 2']);
      expect(doc.strips[0].rect).toEqual({ x: 10, y: 30, w: 70, h: 8 });
      expect(doc.strips[0].boxes.map(b => b.label)).toEqual(['10a', '21']);
      expect(doc.strips[0].region.imageId).toBe(P8);
      expect(doc.excluded).toBe(0);
    });

    it('is merged by id like the Neume Viewer, and a second import adds nothing', () => {
      const once = applyPlan(source(), planImport(file(), [source()]).plans[0]);
      const again = planImport(file(), [once]).plans[0];
      expect(again.counts).toEqual(jasmine.objectContaining({ regionsNew: 0, itemsNew: 0, equivalentsNew: 0, notesSet: false, picturesNew: 0 }));
    });
  });

  describe('a line without an address', () => {
    it('is left out with its snippets, and the preview says so', () => {
      const d = iiifData();
      d.lines[1].image = '';
      const f = convertNeumeDocs(bundle([d]));
      expect(f.sources[0].annotationRegions!.map(r => r.id)).toEqual(['L1']);
      expect(f.warnings).toEqual(['Fix 1: 1 line left out (no IIIF address and no picture among the files).']);
      expect(planImport(f, [source()]).warnings).toEqual(f.warnings!);
    });

    it('a picture that is a web address but no IIIF crop cannot be printed either', () => {
      const d = iiifData();
      d.lines[1].image = 'https://example.org/line.jpg';
      expect(convertNeumeDocs(bundle([d])).sources[0].annotationRegions!.length).toBe(1);
    });
  });

  describe('screenshots (pictures that are files of the documentation)', () => {
    const files = { 'images/Shot/line-ln.svg': SVG };
    const file = () => convertNeumeDocs(bundle([screenshotData()], files));

    it('makes the whole picture the line, the boxes its snippets, and sends the picture with the file', () => {
      const s = file().sources[0];
      expect(s.annotationRegions![0]).toEqual({ id: 'ln', name: '3', folio: '', folioLabel: '12r', points: '0,0 100,0 100,100 0,100' });
      expect(s.annotationItems![1]).toEqual({ id: 'b', regionId: 'ln', pattern: '*d', variant: 'b', points: '50,20 70,20 70,80 50,80' });
      expect(s.regionImages).toEqual({ ln: SVG });
    });

    it('takes the Reference ID from the snippet, since the table of a collection has none; "-" says there is none', () => {
      const s = file().sources[0];
      expect(s.equivalents).toEqual([{ pattern: '*', refId: '30' }]);
      const doc = buildNotationDoc(applyPlan(source({ quellensigle: 'Shot' }), planImport(file(), [source({ quellensigle: 'Shot' })]).plans[0]));
      expect(doc.rows.find(r => r.pattern === '*')!.refId).toBe('30');
      expect(doc.rows.find(r => r.pattern === '*d')!.refId).not.toBe('-');   // "-" is no Reference ID
      expect(doc.strips[0].place.text).toBe('12 / 3');
    });

    it('leaves the line out if its picture is not among the files, or is no picture', () => {
      expect(convertNeumeDocs(bundle([screenshotData()])).warnings![0]).toMatch(/1 line left out/);
      expect(convertNeumeDocs(bundle([screenshotData()], { 'images/Shot/line-ln.svg': 'data:text/html;base64,AAAA' })).warnings![0]).toMatch(/1 line left out/);
    });

    it('keeps the pictures only for lines that are here after the merge, and counts the new ones', () => {
      const plan = planImport(file(), [source({ quellensigle: 'Shot' })]).plans[0];
      expect(plan.images).toEqual({ ln: SVG });
      expect(plan.counts.picturesNew).toBe(1);
      expect(describePlan(plan)).toContain('1 line picture kept on this computer');
      const once = applyPlan(source({ quellensigle: 'Shot' }), plan);
      const again = planImport(file(), [once]).plans[0];
      expect(again.counts.picturesNew).toBe(0);
    });
  });

  describe('a catalogue without lines', () => {
    it('has nothing to import, and says it once for all of them', () => {
      const f = convertNeumeDocs(bundle([catalogueData(), { ...catalogueData(), id: '031', source: 'B 1' }]));
      expect(f.sources).toEqual([]);
      expect(f.warnings).toEqual(['2 manuscripts have neither Reference IDs nor marked lines, so there is nothing to import: A-GÖ 107, B 1.']);
    });
  });

  describe('a manuscript file that was not chosen', () => {
    it('is reported, and the others are still read', () => {
      const b = bundle([iiifData(), screenshotData()], { 'images/Shot/line-ln.svg': SVG });
      delete b.manuscripts[1].data;
      const f = convertNeumeDocs(b);
      expect(f.sources.length).toBe(1);
      expect(f.warnings).toEqual(['1 manuscript file is not among the files chosen: data/Shot.json.']);
    });
  });

  describe('untrusted content', () => {
    it('drops unreadable outlines and repeated ids, and clamps what lies outside the line', () => {
      const d = iiifData();
      d.lines[0].items = [
        { id: 's1', points: '5,10 15,10 x,90' },                // not a polygon: no box either
        { id: 's2', box: { x: 90, y: 0, w: 40, h: 100 } },        // reaches beyond the line
        { id: 's2', points: '1,1 2,1 2,2' },                      // the id again
        { id: 'nobody', points: '1,1 2,1 2,2' },                  // no such snippet
      ];
      const items = convertNeumeDocs(bundle([d])).sources[0].annotationItems!.filter(i => i.regionId === 'L1');
      expect(items.map(i => i.id)).toEqual(['s2']);
      expect(items[0].points).toBe('73,30 80,30 80,38 73,38');
    });
  });

  describe('reading what a person chose', () => {
    const index = () => { const b = bundle([iiifData(), screenshotData()]); delete b.files; b.manuscripts.forEach((m: any) => delete m.data); return b; };
    const asFile = (name: string, body: any, type = 'application/json') => new File([body], name, { type });
    const svgBytes = new Uint8Array([60, 115, 118, 103, 47, 62]);   // "<svg/>"

    it('reads one JSON file as it is', async () => {
      const data = await readAnnotationFiles([asFile('x.json', JSON.stringify({ hello: 1 }))]);
      expect(data).toEqual({ hello: 1 });
    });

    it('reads a ZIP of the documentation, also when it lies in a folder, with the pictures of screenshots', async () => {
      const zip = new JSZip();
      zip.file('repo-main/neume-docs.json', JSON.stringify(index()));
      zip.file('repo-main/data/Fix 1.json', JSON.stringify(iiifData()));
      zip.file('repo-main/data/Shot.json', JSON.stringify(screenshotData()));
      zip.file('repo-main/images/Shot/line-ln.svg', svgBytes);
      zip.file('__MACOSX/repo-main/neume-docs.json', 'junk');
      const data = await readAnnotationFiles([asFile('docs.zip', await zip.generateAsync({ type: 'uint8array' }), 'application/zip')]);
      const f = parseAnnotationFile(data);
      expect(f.sources.map(s => s.quellensigle)).toEqual(['Fix 1', 'Shot']);
      expect(f.sources[1].regionImages!['ln']).toBe('data:image/svg+xml;base64,' + btoa('<svg/>'));
      expect(f.warnings).toBeUndefined();
    });

    it('reads neume-docs.json with the files of data/ and images/ chosen together, in any order', async () => {
      const files = [
        asFile('line-ln.svg', svgBytes, 'image/svg+xml'),
        asFile('Shot.json', JSON.stringify(screenshotData())),
        asFile('neume-docs.json', JSON.stringify(index())),
        asFile('Fix 1.json', JSON.stringify(iiifData())),
      ];
      const f = parseAnnotationFile(await readAnnotationFiles(files));
      expect(f.sources.map(s => s.quellensigle)).toEqual(['Fix 1', 'Shot']);
      expect(Object.keys(f.sources[1].regionImages!)).toEqual(['ln']);
    });

    it('says what is wrong when the ZIP has no index, or several files have none', async () => {
      const zip = new JSZip();
      zip.file('other.json', '{}');
      await expectAsync(readAnnotationFiles([asFile('a.zip', await zip.generateAsync({ type: 'uint8array' }))])).toBeRejectedWithError(/no neume-docs\.json in this ZIP/);
      await expectAsync(readAnnotationFiles([asFile('a.json', '{}'), asFile('b.json', '{}')])).toBeRejectedWithError(/none of them is a neume-docs\.json/);
    });

    it('does not follow a path that leads out of the documentation', async () => {
      const b = index();
      b.manuscripts[0].file = '../secret.json';
      const f = [asFile('neume-docs.json', JSON.stringify(b)), asFile('secret.json', JSON.stringify(iiifData())), asFile('Shot.json', JSON.stringify(screenshotData()))];
      const data = await readAnnotationFiles(f);
      expect(data.manuscripts[0].data).toBeUndefined();
    });
  });

  describe('the pictures kept on this computer', () => {
    const id = 'spec-strip-images';
    afterEach(() => localforage.removeItem('monodi_notation_strip_images_' + id));

    it('are kept per source, added to, and read back', async () => {
      expect(await loadStripImages(id)).toEqual({});
      await saveStripImages(id, { a: SVG });
      await saveStripImages(id, { b: SVG + 'x' });
      expect(Object.keys(await loadStripImages(id)).sort()).toEqual(['a', 'b']);
      expect(await loadStripImages(undefined)).toEqual({});
    });
  });
});
