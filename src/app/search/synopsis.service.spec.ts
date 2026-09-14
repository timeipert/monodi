import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { ToastrModule, ToastrService } from 'ngx-toastr';
import { SynopsisService, AlignedLineElement, AlignedNode } from './synopsis.service';
import { APIService } from '../api.service';
import { UserService } from '../user.service';
import * as VM from '../types/model';

describe('SynopsisService', () => {
  let service: SynopsisService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [
        HttpClientTestingModule,
        ToastrModule.forRoot()
      ],
      providers: [
        SynopsisService,
        APIService,
        UserService,
        ToastrService
      ]
    });
    service = TestBed.inject(SynopsisService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('alignSequential', () => {
    it('should align empty containers to empty list', () => {
      const result = service.alignSequential([]);
      expect(result).toEqual([]);
    });

    it('should sequential-align multiple documents', () => {
      const doc1: VM.RootContainer = {
        kind: VM.ContainerKind.RootContainer,
        uuid: 'doc1',
        children: [
          {
            kind: 'ZeileContainer',
            uuid: 'line1',
            children: [
              {
                kind: 'Clef',
                uuid: 'clef1',
                shape: 'C',
                line: 3
              } as any
            ]
          } as any
        ],
        comments: [],
        documentType: VM.DocumentType.Level1
      };

      const doc2: VM.RootContainer = {
        kind: VM.ContainerKind.RootContainer,
        uuid: 'doc2',
        children: [
          {
            kind: 'ZeileContainer',
            uuid: 'line2',
            children: [
              {
                kind: 'Syllable',
                uuid: 'syl2',
                text: 'a',
                notes: { spaced: [] }
              } as any
            ]
          } as any
        ],
        comments: [],
        documentType: VM.DocumentType.Level1
      };

      const result = service.alignSequential([doc1, doc2]);
      expect(result.length).toBe(1);
      expect(result[0].kind).toBe('leaf');
      
      // A clef-only line (doc1) and a syllable-only line (doc2) are different
      // element kinds, so the aligner does not force them into one shared column:
      // each gets its own column, with a placeholder in the other document.
      const lineElements = result[0].alignedLineElements;
      expect(lineElements).toBeTruthy();
      expect(lineElements!.length).toBe(2);

      // doc1 (index 0) contributes exactly the clef; doc2 (index 1) the syllable.
      const doc1Kinds = lineElements!.map(col => col[0].kind);
      const doc2Kinds = lineElements!.map(col => col[1].kind);
      expect(doc1Kinds.filter(k => k === 'clef').length).toBe(1);
      expect(doc1Kinds.filter(k => k === 'placeholder').length).toBe(1);
      expect(doc2Kinds.filter(k => k === 'syllable').length).toBe(1);
      expect(doc2Kinds.filter(k => k === 'placeholder').length).toBe(1);

      // In any given column, only one document has a real element.
      lineElements!.forEach(col => {
        const real = col.filter(el => el.kind !== 'placeholder');
        expect(real.length).toBe(1);
      });
    });
  });

  describe('getElementWidth', () => {
    it('should return 35 for clefs', () => {
      const item: AlignedLineElement = {
        kind: 'clef',
        element: { kind: 'Clef', uuid: 'c', shape: 'F', line: 2 } as any
      };
      expect(service.getElementWidth(item)).toBe(35);
    });

    it('should return 0 for placeholder items', () => {
      const item: AlignedLineElement = {
        kind: 'placeholder',
        element: null
      };
      expect(service.getElementWidth(item)).toBe(0);
    });
  });

  describe('hasParatext', () => {
    it('should identify ParatextContainers', () => {
      expect(service.hasParatext([null, { kind: 'ParatextContainer' }])).toBeTrue();
      expect(service.hasParatext([null, { kind: 'ZeileContainer' }])).toBeFalse();
    });
  });
});
