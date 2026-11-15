import { ChangeDetectorRef, Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import type { Corpus } from '@monodi/core/analysis';
import { CorpusLoader } from './corpus-loader';
import { CorpusPanelComponent } from './corpus-panel.component';
import { NotationSnippetComponent } from './notation-snippet.component';
import { ResultViewComponent } from './result-view.component';
import type { AnalysisDefinition } from './analysis-types';

const chant = (pitches: number[]) => ({
  pitches, sylStart: pitches.map((_, i) => i), sylLen: pitches.map(() => 1), sylText: pitches.map((_, i) => `s${i}`), words: [], neumeStart: pitches.map((_, i) => i), wordStart: [], wordEnd: [], accidentals: 0,
});
const CORPUS: Corpus = {
  docs: ['d1', 'd2', 'd3'].map((id) => ({ id, sourceId: 's', sigle: 'S', label: `Chant ${id}`, fields: {} })),
  chants: [chant([29, 31, 32, 31, 29]), chant([40, 41]), chant([29, 31, 32])],
};
const DEF: AnalysisDefinition = {
  id: 'a1', name: 'Test', note: '', createdAt: 0, updatedAt: 0, methods: [],
  corpus: { docIds: ['d1', 'd2', 'd3'], origin: 'manual', label: 'three' },
};

describe('CorpusPanelComponent', () => {
  let fixture: ComponentFixture<CorpusPanelComponent>;
  let comp: CorpusPanelComponent;
  let loads = 0;
  const render = () => fixture.debugElement.injector.get(ChangeDetectorRef).detectChanges();

  beforeEach(() => {
    loads = 0;
    TestBed.configureTestingModule({
      declarations: [CorpusPanelComponent, ResultViewComponent, NotationSnippetComponent],
      imports: [FormsModule],
      providers: [{ provide: CorpusLoader, useValue: { load: async () => { loads++; return { corpus: CORPUS, digests: {}, missing: [] }; } } }],
    });
    fixture = TestBed.createComponent(CorpusPanelComponent);
    comp = fixture.componentInstance;
    comp.def = DEF;
    comp.token = 't';
    comp.docs = ['d1', 'd2', 'd3'].map((id) => ({ id, quelle_id: 's', dokumenten_id: `Chant ${id}`, gattung1: 'Antiphon', textinitium: `Inc ${id}` } as any));
    comp.sources = [{ id: 's', quellensigle: 'S' } as any];
    comp.ngOnChanges({ docs: {} as any, def: { firstChange: true } as any });
    render();
  });

  it('lists the documents of the analysis with their source and genre', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Documents of this analysis');
    expect(el.querySelectorAll('app-result-view tbody tr').length).toBe(3);
    expect(el.textContent).toContain('Antiphon');
  });

  it('searches the chants for a pattern and shows the chants with their first passage as notes', async () => {
    comp.unit = 'pitch';
    comp.text = 'd f g';
    await comp.search();
    render();
    expect(comp.summary).toContain('2 of 3 chants');
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Chants with the pattern D F G');
    expect(comp.result!.rows.length).toBe(2);
    expect(el.querySelectorAll('app-result-view')[0].querySelectorAll('app-notation-snippet').length).toBe(2);
  });

  it('reads the notes once for several searches', async () => {
    comp.unit = 'interval';
    comp.text = '+2';
    await comp.search();
    comp.text = '+1';
    await comp.search();
    expect(loads).toBe(1);
  });

  it('says what is wrong with a pattern instead of searching', async () => {
    comp.unit = 'pitch';
    comp.text = 'd x';
    await comp.search();
    expect(comp.error).toContain('not a note');
    expect(comp.result).toBeNull();
    expect(loads).toBe(0);
  });

  it('allows differences and a window', async () => {
    comp.unit = 'pitch';
    comp.text = 'd g';
    await comp.search();
    expect(comp.result!.rows.length).toBe(0);
    comp.window = 3;
    await comp.search();
    expect(comp.result!.rows.length).toBe(2);
    comp.window = 0;
    comp.maxDistance = 1;
    await comp.search();
    expect(comp.result!.rows.length).toBeGreaterThan(0);
  });

  it('a pattern chosen elsewhere fills the form and runs the search', async () => {
    comp.request = { unit: 'interval', text: '+2 +1', nonce: 1 };
    comp.ngOnChanges({ request: {} as any });
    await new Promise((r) => setTimeout(r, 20));
    expect(comp.text).toBe('+2 +1');
    expect(comp.unit).toBe('interval');
    expect(comp.result!.rows.length).toBe(2);
  });
});
