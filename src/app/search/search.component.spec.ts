import { ChangeDetectorRef } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { RouterTestingModule } from '@angular/router/testing';
import { of } from 'rxjs';
import { StatusLineService } from '../status-line.service';
import { SearchComponent, arrayLevenshtein } from './search.component';
import { HelpButtonComponent } from '../help-button/help-button.component';
import { APIService } from '../api.service';
import { UserService } from '../user.service';
import { PageTitleService } from '../page-title.service';
import { Router } from '@angular/router';
import { SelectionToolsModule } from '../selection/selection-tools.module';
import { SelectionService } from '../selection/selection.service';

describe('SearchComponent', () => {
  let component: SearchComponent;
  let fixture: ComponentFixture<SearchComponent>;

  const mockUserService = {
    user: of({ token: 'mock-token', name: 'Mock User' })
  };

  const mockAPIService = {
    getSettings: () => of({ kind: 'SettingsRetrieved', settings: {} }),
    listSources: () => of({ kind: 'SourcesRetrieved', sources: [] }),
    listDocuments: () => of({ kind: 'DocumentsRetrieved', documents: [] }),
    getAllDocumentNotes: () => of({}),
    querySources: () => of({ kind: 'SourcesRetrieved', sources: [] }),
    queryDocuments: () => of({ kind: 'DocumentsRetrieved', documents: [] }),
  };

  const mockPageTitleService = {
    set: () => {}
  };

  const mockStatusLineService = {
    success: () => {},
    error: () => {},
    info: () => {},
    warning: () => {}
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [SearchComponent, HelpButtonComponent],
      imports: [FormsModule, RouterTestingModule, SelectionToolsModule],
      providers: [
        { provide: UserService, useValue: mockUserService },
        { provide: APIService, useValue: mockAPIService },
        { provide: PageTitleService, useValue: mockPageTitleService },
        { provide: StatusLineService, useValue: mockStatusLineService }
      ]
    });
    fixture = TestBed.createComponent(SearchComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('Synopsis Metadata and Staff Scaling', () => {
    it('initialises the synopsis column definitions', () => {
      expect(component.synopsisMetadataCols).toBeDefined();
      expect(component.synopsisMetadataCols.length).toBeGreaterThan(0);
      
      const visibleCols = component.visibleSynopsisCols;
      expect(visibleCols.length).toBeGreaterThan(0);
    });

    it('should correctly retrieve document field values with fallbacks', () => {
      const doc: any = {
        dokumenten_id: 'doc-123',
        textinitium: 'In principio',
        festtag: 'Christmas'
      };
      
      expect(component.getDocFieldValue(doc, 'dokumenten_id')).toBe('doc-123');
      expect(component.getDocFieldValue(doc, 'textinitium')).toBe('In principio');
      expect(component.getDocFieldValue(doc, 'feier')).toBe('—');
    });

    it('should save synopsis columns to local storage', () => {
      spyOn(localStorage, 'setItem');
      component.saveSynopsisCols();
      expect(localStorage.setItem).toHaveBeenCalled();
    });

    it('should calculate scaled column widths properly', () => {
      component.settings = {
        pdfSynopsisScale: 1.2
      } as any;

      const col: any[] = [];
      const width = component.getColumnWidth(col);
      // Min column width is 40. Scaled by 1.2, it should be 48
      expect(width).toBe(48);
    });
  });
});

describe('arrayLevenshtein', () => {
  it('should return 0 for identical arrays', () => {
    expect(arrayLevenshtein(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(0);
  });

  it('should compute distance for single replacement', () => {
    expect(arrayLevenshtein(['a', 'b', 'c'], ['a', 'x', 'c'])).toBe(1);
  });

  it('should compute distance for insertions/deletions', () => {
    expect(arrayLevenshtein(['a', 'b', 'c'], ['a', 'c'])).toBe(1);
    expect(arrayLevenshtein(['a', 'c'], ['a', 'b', 'c'])).toBe(1);
  });

  it('should handle completely different arrays', () => {
    expect(arrayLevenshtein(['a', 'b'], ['x', 'y', 'z'])).toBe(3);
  });
});

describe('computePatternGroups', () => {
  it('should extract and group exact pitch patterns', () => {
    const dummyDocs: any[] = [
      {
        doc: { id: 'doc-1', textinitium: 'Chant 1' },
        sourceSigle: 'Sigle-1',
        notes: [
          { uuid: 'n1', base: 'C', octave: 4 },
          { uuid: 'n2', base: 'D', octave: 4 },
          { uuid: 'n3', base: 'E', octave: 4 },
          { uuid: 'n4', base: 'F', octave: 4 },
          { uuid: 'n5', base: 'G', octave: 4 }
        ],
        syllables: [
          { uuid: 's1', text: 'Al-le-lu-ia' }
        ],
        sylIdx: [0, 0, 0, 0, 0],
        sequence: ['c4', 'd4', 'e4', 'f4', 'g4']
      },
      {
        doc: { id: 'doc-2', textinitium: 'Chant 2' },
        sourceSigle: 'Sigle-2',
        notes: [
          { uuid: 'm1', base: 'C', octave: 4 },
          { uuid: 'm2', base: 'D', octave: 4 },
          { uuid: 'm3', base: 'E', octave: 4 },
          { uuid: 'm4', base: 'F', octave: 4 },
          { uuid: 'm5', base: 'G', octave: 4 }
        ],
        syllables: [
          { uuid: 's2', text: 'A-men' }
        ],
        sylIdx: [0, 0, 0, 0, 0],
        sequence: ['c4', 'd4', 'e4', 'f4', 'g4']
      }
    ];

    const groups = SearchComponent.computePatternGroups(dummyDocs, 'pitch', 5, 'exact', true, 1);
    expect(groups.length).toBe(1);
    const g = groups[0];
    expect(g.uniqueDocCount).toBe(2);
    expect(g.occurrences.length).toBe(2);
    expect(g.isCompound).toBeFalse();
    expect(g.occurrences[0].notes.length).toBe(5);
  });

  it('should extract and merge contiguous interval patterns and mark them as compound', () => {
    const dummyDocs: any[] = [
      {
        doc: { id: 'doc-1', textinitium: 'Chant 1' },
        sourceSigle: 'Sigle-1',
        notes: [
          { uuid: 'n1', base: 'C', octave: 4 },
          { uuid: 'n2', base: 'D', octave: 4 },
          { uuid: 'n3', base: 'E', octave: 4 },
          { uuid: 'n4', base: 'F', octave: 4 },
          { uuid: 'n5', base: 'G', octave: 4 },
          { uuid: 'n6', base: 'A', octave: 4 }
        ],
        syllables: [
          { uuid: 's1', text: 'Text 1' }
        ],
        sylIdx: [0, 0, 0, 0, 0, 0],
        sequence: ['+1', '+1', '+1', '+1', '+1']
      },
      {
        doc: { id: 'doc-2', textinitium: 'Chant 2' },
        sourceSigle: 'Sigle-2',
        notes: [
          { uuid: 'm1', base: 'C', octave: 4 },
          { uuid: 'm2', base: 'D', octave: 4 },
          { uuid: 'm3', base: 'E', octave: 4 },
          { uuid: 'm4', base: 'F', octave: 4 },
          { uuid: 'm5', base: 'G', octave: 4 },
          { uuid: 'm6', base: 'A', octave: 4 }
        ],
        syllables: [
          { uuid: 's2', text: 'Text 2' }
        ],
        sylIdx: [0, 0, 0, 0, 0, 0],
        sequence: ['+1', '+1', '+1', '+1', '+1']
      }
    ];

    const groups = SearchComponent.computePatternGroups(dummyDocs, 'interval', 5, 'exact', true, 1);
    expect(groups.length).toBe(1);
    const g = groups[0];
    expect(g.uniqueDocCount).toBe(2);
    expect(g.occurrences.length).toBe(2);
    expect(g.isCompound).toBeTrue();
    // Notes count for 5 merged intervals (6 notes) should be 6
    expect(g.occurrences[0].notes.length).toBe(6);
    // Boundary check: the last note at index 5 ('A') must be included in the notes slice
    expect(g.occurrences[0].notes[5].base).toBe('A');
  });

  it('should extract and not merge pattern occurrences when mergeEnabled is false', () => {
    const dummyDocs: any[] = [
      {
        doc: { id: 'doc-1', textinitium: 'Chant 1' },
        sourceSigle: 'Sigle-1',
        notes: [
          { uuid: 'n1', base: 'C', octave: 4 },
          { uuid: 'n2', base: 'D', octave: 4 },
          { uuid: 'n3', base: 'E', octave: 4 },
          { uuid: 'n4', base: 'F', octave: 4 },
          { uuid: 'n5', base: 'G', octave: 4 },
          { uuid: 'n6', base: 'A', octave: 4 }
        ],
        syllables: [
          { uuid: 's1', text: 'Text 1' }
        ],
        sylIdx: [0, 0, 0, 0, 0, 0],
        sequence: ['+1', '+1', '+1', '+1', '+1']
      },
      {
        doc: { id: 'doc-2', textinitium: 'Chant 2' },
        sourceSigle: 'Sigle-2',
        notes: [
          { uuid: 'm1', base: 'C', octave: 4 },
          { uuid: 'm2', base: 'D', octave: 4 },
          { uuid: 'm3', base: 'E', octave: 4 },
          { uuid: 'm4', base: 'F', octave: 4 },
          { uuid: 'm5', base: 'G', octave: 4 },
          { uuid: 'm6', base: 'A', octave: 4 }
        ],
        syllables: [
          { uuid: 's2', text: 'Text 2' }
        ],
        sylIdx: [0, 0, 0, 0, 0, 0],
        sequence: ['+1', '+1', '+1', '+1', '+1']
      }
    ];

    const groups = SearchComponent.computePatternGroups(dummyDocs, 'interval', 5, 'exact', false, 1);
    expect(groups.length).toBe(1);
    const g = groups[0];
    expect(g.isCompound).toBeFalse();
    expect(g.occurrences[0].notes.length).toBe(5);
  });

  it('should enforce minMergeOverlap when merging contiguous patterns', () => {
    const dummyDocs: any[] = [
      {
        doc: { id: 'doc-1', textinitium: 'Chant 1' },
        sourceSigle: 'Sigle-1',
        notes: [
          { uuid: 'n1', base: 'C', octave: 4 },
          { uuid: 'n2', base: 'D', octave: 4 },
          { uuid: 'n3', base: 'E', octave: 4 },
          { uuid: 'n4', base: 'F', octave: 4 },
          { uuid: 'n5', base: 'G', octave: 4 },
          { uuid: 'n6', base: 'A', octave: 4 }
        ],
        syllables: [
          { uuid: 's1', text: 'Text 1' }
        ],
        sylIdx: [0, 0, 0, 0, 0, 0],
        sequence: ['c4', 'd4', 'e4', 'f4', 'g4', 'a4']
      },
      {
        doc: { id: 'doc-2', textinitium: 'Chant 2' },
        sourceSigle: 'Sigle-2',
        notes: [
          { uuid: 'm1', base: 'C', octave: 4 },
          { uuid: 'm2', base: 'D', octave: 4 },
          { uuid: 'm3', base: 'E', octave: 4 },
          { uuid: 'm4', base: 'F', octave: 4 },
          { uuid: 'm5', base: 'G', octave: 4 },
          { uuid: 'm6', base: 'A', octave: 4 }
        ],
        syllables: [
          { uuid: 's2', text: 'Text 2' }
        ],
        sylIdx: [0, 0, 0, 0, 0, 0],
        sequence: ['c4', 'd4', 'e4', 'f4', 'g4', 'a4']
      }
    ];

    // With minMergeOverlap = 4 notes (which is <= actual overlap of 4 shared notes), they should merge
    const groupsMerge1 = SearchComponent.computePatternGroups(dummyDocs, 'pitch', 5, 'exact', true, 4);
    expect(groupsMerge1.length).toBe(1);
    expect(groupsMerge1[0].isCompound).toBeTrue();
    expect(groupsMerge1[0].occurrences[0].notes.length).toBe(6);

    // With minMergeOverlap = 6 notes (which is > actual overlap of 4 shared notes), they should not merge
    const groupsMerge2 = SearchComponent.computePatternGroups(dummyDocs, 'pitch', 5, 'exact', true, 6);
    expect(groupsMerge2.length).toBe(2);
    expect(groupsMerge2[0].isCompound).toBeFalse();
    expect(groupsMerge2[0].occurrences[0].notes.length).toBe(5);
  });
});


describe('SearchComponent selection (all hits, not only the page)', () => {
  let component: SearchComponent;
  let fixture: ComponentFixture<SearchComponent>;

  /** 60 documents in 3 sources: s0 holds d0, d3, d6 …; more than the 25 shown on one page. */
  const docs: any[] = Array.from({ length: 60 }, (_, i) => ({
    id: `d${i}`, quelle_id: `s${i % 3}`, dokumenten_id: `Doc ${i}`, textinitium: `Incipit ${i}`,
    gattung1: '', gattung2: '', festtag: '', feier: '', bibliographischerverweis: '', druckausgabe: '',
    zeilenstart: '', foliostart: '', kommentar: '', editionsstatus: '',
  }));
  const api = {
    getSettings: () => of({ kind: 'SettingsRetrieved', settings: {} }),
    listSources: () => of({ kind: 'SourcesRetrieved', sources: [] }),
    listDocuments: () => of({ kind: 'DocumentsRetrieved', documents: docs }),
    getAllDocumentNotes: () => of({}),
    querySources: () => of({ kind: 'SourcesRetrieved', sources: [] }),
    queryDocuments: () => of({ kind: 'DocumentsRetrieved', documents: [] }),
  };

  beforeEach(async () => {
    TestBed.configureTestingModule({
      declarations: [SearchComponent, HelpButtonComponent],
      imports: [FormsModule, RouterTestingModule, SelectionToolsModule],
      providers: [
        { provide: UserService, useValue: { user: of({ token: 't', name: 'u' }) } },
        { provide: APIService, useValue: api },
        { provide: PageTitleService, useValue: { set: () => {} } },
        { provide: StatusLineService, useValue: { success: () => {}, error: () => {}, info: () => {}, warning: () => {} } },
      ],
    });
    fixture = TestBed.createComponent(SearchComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await TestBed.inject(SelectionService).ensureIndex('t');
  });

  /** One melody match per document: 60 hits over several pages. */
  const melodyHits = () => docs.map(d => ({ document: d, occurrences: [], matchingSyllables: [] }) as any);

  it('select all on the melody tab selects every hit, also those on other pages', () => {
    component.melodyResults = melodyHits();
    component.activeTab = 'melody';
    expect(component.pagedMelodyResults.length).toBeLessThan(60);
    const ids = component.currentHitDocIds();
    expect(ids.length).toBe(60);
    component.selection.selectAll(ids);
    expect(component.selectedDocs.length).toBe(60);
    expect(component.selectedDocs[0].dokumenten_id).toBe('Doc 0'); // the real document, not a stub
  });

  it('invert keeps the complement of the picks among the hits', () => {
    component.melodyResults = melodyHits();
    component.selection.add(['d0', 'd1', 'd2']);
    component.selection.invert(component.melodyHitDocIds);
    expect(component.selection.size).toBe(57);
    expect(component.isDocSelected('d0')).toBeFalse();
    expect(component.isDocSelected('d59')).toBeTrue();
  });

  it('a melody match list counts each document once however many realisations it has', () => {
    component.melodyResults = [
      { document: docs[0] } as any, { document: docs[0] } as any, { document: docs[1] } as any,
    ];
    expect(component.melodyHitDocIds).toEqual(['d0', 'd1']);
  });

  it('quick results: a source hit stands for all its documents, a document hit for itself, without repeats', () => {
    component.quickResults = [
      { kind: 'source', id: 's0', title: 'S0', subtitle: '', extra: '', score: 1, matchedIn: '' },
      { kind: 'document', id: 'd0', sourceId: 's0', title: 'Doc 0', subtitle: '', extra: '', score: 1, matchedIn: '' },
      { kind: 'document', id: 'd1', sourceId: 's1', title: 'Doc 1', subtitle: '', extra: '', score: 1, matchedIn: '' },
    ];
    const ids = component.quickHitDocIds;
    expect(ids.length).toBe(21); // 20 documents of s0 plus d1
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('d1');
  });

  it('the checkbox of a source selects and deselects all its documents and shows a partial state', () => {
    const ev = { stopPropagation: () => {} } as unknown as Event;
    component.toggleSourceSelection('s1', ev);
    expect(component.selection.size).toBe(20);
    expect(component.sourceSelectState('s1')).toBe('all');
    expect(component.sourceSelectState('s0')).toBe('none');
    component.selection.remove(['d1']);
    expect(component.sourceSelectState('s1')).toBe('some');
    component.toggleSourceSelection('s1', ev);
    expect(component.sourceSelectState('s1')).toBe('all');
    component.toggleSourceSelection('s1', ev);
    expect(component.selection.size).toBe(0);
  });

  it('picks survive the page: a new component sees the selection of the service', () => {
    component.selection.add(['d5']);
    const again = TestBed.createComponent(SearchComponent).componentInstance;
    expect(again.selectedDocs.map(d => d.id)).toEqual(['d5']);
  });

  it('writes the picks to the address only up to 50 documents', () => {
    const router = TestBed.inject(Router);
    const spy = spyOn(router, 'navigate').and.resolveTo(true);
    component.selection.add(['d0', 'd1']);
    component.updateUrl();
    expect((spy.calls.mostRecent().args[1] as any).queryParams.compare).toBe('d0,d1');
    component.selection.selectAll(docs.map(d => d.id));
    component.updateUrl();
    expect((spy.calls.mostRecent().args[1] as any).queryParams.compare).toBeUndefined();
  });

  it('asks before a synopsis of more than 20 witnesses and compares only the first 20 when confirmed', () => {
    const synopsis = (component as any).synopsisSvc;
    const enter = spyOn(synopsis, 'enterSynopsis');
    component.selection.selectAll(docs.map(d => d.id));
    spyOn(window, 'confirm').and.returnValue(false);
    component.enterSynopsis();
    expect(enter).not.toHaveBeenCalled();
    (window.confirm as jasmine.Spy).and.returnValue(true);
    component.enterSynopsis();
    expect(enter).toHaveBeenCalled();
    expect((enter.calls.mostRecent().args[0] as any[]).length).toBe(20);
    expect(component.synopsisDocs.length).toBe(20);
  });

  it('the selection bar renders in the melody tab with the number of all hits', () => {
    component.activeTab = 'melody';
    component.melodySearched = true;
    component.melodyWithNotes = 60;
    component.melodyResults = melodyHits();
    fixture.debugElement.injector.get(ChangeDetectorRef).detectChanges();
    const bar = (fixture.nativeElement as HTMLElement).querySelector('app-selection-bar');
    expect(bar).toBeTruthy();
    expect(bar!.textContent).toContain('0 of 60 documents selected');
    expect(bar!.textContent).toContain('Select all 60');
  });
});
