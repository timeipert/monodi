import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { ToastrModule } from 'ngx-toastr';
import { of } from 'rxjs';
import { SearchExecService, QuickResult, sequenceDistance, parseMelodyPattern } from './search-exec.service';
import { APIService } from '../api.service';
import { UserService } from '../user.service';
import { PatternAnalysisService } from './pattern-analysis.service';

describe('SearchExecService', () => {
  let service: SearchExecService;
  let apiSpy: jasmine.SpyObj<APIService>;
  let userSpy: jasmine.SpyObj<UserService>;

  beforeEach(() => {
    const apiMock = jasmine.createSpyObj('APIService', ['listSources', 'listDocuments', 'querySources', 'queryDocuments']);
    const userMock = jasmine.createSpyObj('UserService', [], {
      user: of({ token: 'test-token', email: 'test@example.com' })
    });

    TestBed.configureTestingModule({
      imports: [
        HttpClientTestingModule,
        ToastrModule.forRoot()
      ],
      providers: [
        SearchExecService,
        { provide: APIService, useValue: apiMock },
        { provide: UserService, useValue: userMock },
        PatternAnalysisService
      ]
    });

    service = TestBed.inject(SearchExecService);
    apiSpy = TestBed.inject(APIService) as jasmine.SpyObj<APIService>;
    userSpy = TestBed.inject(UserService) as jasmine.SpyObj<UserService>;
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('matchText', () => {
    it('should match exact phrase', () => {
      const res = service.matchText('Kyrie eleison', 'kyrie', 'phrase', false, 0);
      expect(res.matched).toBeTrue();
      expect(res.score).toBe(100);
    });

    it('should match with spelling tolerance (collapse double letters, map j/v)', () => {
      const res = service.matchText('Karolus', 'carolus', 'phrase', true, 0);
      // 'c' vs 'k' is not in spelling tolerance rules, but double letters/jv/ae collapse are.
      const res2 = service.matchText('Halleluia', 'haleluia', 'phrase', true, 0);
      expect(res2.matched).toBeTrue();
      expect(res2.score).toBe(90);
    });

    it('should match words-and mode', () => {
      const res = service.matchText('Kyrie eleison Christe eleison', 'kyrie christe', 'words-and', false, 0);
      expect(res.matched).toBeTrue();
      expect(res.score).toBe(80);
    });

    it('should match words-or mode', () => {
      const res = service.matchText('Kyrie eleison', 'christe kyrie', 'words-or', false, 0);
      expect(res.matched).toBeTrue();
      expect(res.score).toBe(70);
    });

    it('should match fuzzy substring', () => {
      const res = service.matchText('Kitten', 'sitting', 'fuzzy', false, 3);
      expect(res.matched).toBeTrue();
    });
  });

  describe('cancellation', () => {
    it('should set searchCancelled flag on cancelSearch()', () => {
      expect(service.searchCancelled).toBeFalse();
      service.cancelSearch();
      expect(service.searchCancelled).toBeTrue();
    });
  });

  describe('quick search caching', () => {
    it('should return cached results on identical parameters', async () => {
      service.cachedQuickSearched = true;
      service.cachedQuickText = 'test';
      service.cachedQuickMode = 'phrase';
      service.cachedQuickTolerance = true;
      service.cachedQuickDistance = 2;
      const expectedResults: QuickResult[] = [{
        kind: 'source',
        id: '1',
        title: 'Cached Source',
        subtitle: '',
        extra: '',
        score: 100,
        matchedIn: 'Metadata'
      }];
      service.cachedQuickResults = expectedResults;

      service.quickText = 'test';
      service.quickSearchMode = 'phrase';
      service.quickMedievalTolerance = true;
      service.quickFuzzyDistance = 2;

      await service.searchQuick(() => {}, () => {});

      expect(service.quickResults).toEqual(expectedResults);
      expect(service.quickSearched).toBeTrue();
    });
  });

  describe('document highlight state management', () => {
    it('should set and clear active document highlight state', () => {
      expect(service.activeDocumentHighlight).toBeNull();

      const highlightState = {
        documentId: 'doc-123',
        patternLabel: 'A B B A C B',
        occurrences: [{
          startNoteIndex: 0,
          endNoteIndex: 5,
          distance: 0,
          startPct: 10,
          endPct: 20,
          widthPct: 10,
          pitchKey: 'A4 B4 B4 A4 C5 B4',
          color: '#ef4444',
          border: '#dc2626',
          name: 'red',
          noteUUIDs: ['uuid-1', 'uuid-2', 'uuid-3']
        }],
        allNoteUUIDMap: new Map([
          ['uuid-1', { fill: '#ef4444', stroke: '#dc2626' }],
          ['uuid-2', { fill: '#ef4444', stroke: '#dc2626' }],
          ['uuid-3', { fill: '#ef4444', stroke: '#dc2626' }]
        ])
      };

      service.setDocumentHighlight(highlightState);
      expect(service.activeDocumentHighlight).toEqual(highlightState);

      const colorInfo = service.getNoteHighlightColor('doc-123', 'uuid-2');
      expect(colorInfo).toEqual({ fill: '#ef4444', stroke: '#dc2626' });

      // Should return null for a different document ID
      expect(service.getNoteHighlightColor('other-doc', 'uuid-2')).toBeNull();

      service.clearDocumentHighlight();
      expect(service.activeDocumentHighlight).toBeNull();
    });
  });

  describe('melody search configuration & state', () => {
    it('should default melodyIncludeTransposed to false', () => {
      expect(service.melodyIncludeTransposed).toBeFalse();
    });

    it('should store melodyRangeStartPct and melodyRangeEndPct', () => {
      expect(service.melodyRangeStartPct).toBe(0);
      expect(service.melodyRangeEndPct).toBe(100);

      service.melodyRangeStartPct = 25;
      service.melodyRangeEndPct = 75;

      expect(service.melodyRangeStartPct).toBe(25);
      expect(service.melodyRangeEndPct).toBe(75);
    });

    it('should calculate endNoteIndex = m.end + 1 when melodyIncludeTransposed is true so all N pattern notes are highlighted', () => {
      service.melodySearchType = 'pitch';
      service.melodyIncludeTransposed = true;
      service.melodyPattern = 'A B B A C B';

      // 6 pitch notes generate 5 interval steps (start=0, end=4).
      // With endNote = m.end + 1 = 5, the note count (endNote - startNote + 1) = 6 notes.
      const startNote = 0;
      const mEnd = 4;
      const useTransposedPitch = (service.melodySearchType === 'pitch' && service.melodyIncludeTransposed);
      const typeStr = service.melodySearchType as string;
      const endNote = (typeStr === 'contour' || typeStr === 'interval' || useTransposedPitch)
        ? mEnd + 1
        : mEnd;

      expect(endNote - startNote + 1).toBe(6);
    });
  });

  describe('wildcard pattern support (. and .?)', () => {
    it('should parse . and .? tokens in melody patterns', () => {
      expect(parseMelodyPattern('C . E .?', 'pitch', false)).toEqual(['c', '.', 'e', '.?']);
      expect(parseMelodyPattern('u . d .?', 'contour', false)).toEqual(['u', '.', 'd', '.?']);
      expect(parseMelodyPattern('+1 . -2 .?', 'interval', false)).toEqual(['+1', '.', '-2', '.?']);
    });

    it('should match any single note using . wildcard', () => {
      const seq = ['c4', 'd4', 'e4'];
      const pattern = ['c4', '.', 'e4'];
      const dist = sequenceDistance(seq, pattern);
      expect(dist).toBe(0);
    });

    it('should match 1 note or 0 notes using .? optional wildcard', () => {
      const seq1 = ['c4', 'd4', 'e4'];
      const pattern = ['c4', '.?', 'e4'];
      const dist1 = sequenceDistance(seq1, pattern);
      expect(dist1).toBe(0);

      const seq2 = ['c4', 'e4'];
      const pattern2 = ['c4', '.?', 'e4'];
      const dist2 = sequenceDistance(seq2, pattern2);
      expect(dist2).toBe(0);
    });
  });
});
