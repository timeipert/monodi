import { TestBed } from '@angular/core/testing';
import { LayoutAnalysisService } from './layout-analysis.service';
import { LayoutBlock } from './layout-analysis.worker';

describe('LayoutAnalysisService', () => {
  let service: LayoutAnalysisService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(LayoutAnalysisService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should convert layout blocks to annotation regions correctly', () => {
    const blocks: LayoutBlock[] = [
      {
        id: '1',
        kind: 'staff',
        label: 'Staff 1',
        rect: { x: 10, y: 20, w: 80, h: 15 },
        points: '10,20 90,20 90,35 10,35'
      },
      {
        id: '2',
        kind: 'text',
        label: 'Text 1',
        rect: { x: 10, y: 38, w: 80, h: 10 },
        points: '10,38 90,38 90,48 10,48'
      }
    ];

    const regions = service.blocksToAnnotationRegions(blocks, 0);
    expect(regions.length).toBe(2);
    expect(regions[0].name).toBe('Staff 1');
    expect(regions[0].folio).toBe('0');
    expect(regions[1].name).toBe('Text 1');
    expect(regions[1].folio).toBe('0');
  });
});
