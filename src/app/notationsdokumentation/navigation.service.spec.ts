import { Router } from '@angular/router';
import { NavigationService } from './navigation.service';

describe('NavigationService', () => {
  let router: jasmine.SpyObj<Router>;
  let nav: NavigationService;

  beforeEach(() => {
    router = jasmine.createSpyObj<Router>('Router', ['navigate']);
    nav = new NavigationService(router);
  });

  it('opens the scans on the source page, in a route that exists', () => {
    nav.openIiifViewerForFolio('src1', '12r');
    expect(router.navigate).toHaveBeenCalledWith(['/source', 'src1'], { queryParams: { tab: 'notation', ntab: 'annotate' } });
  });

  it('tells a viewer that is already open to jump right away', () => {
    const folios: string[] = [];
    nav.focusFolio$.subscribe(f => folios.push(f));
    nav.openIiifViewerForFolio('src1', '12r');
    expect(folios).toEqual(['12r']);
  });

  it('hands the folio to the viewer of that source once, however late it asks', () => {
    nav.openIiifViewerForFolio('src1', '12r');
    expect(nav.takePendingFolio('src1')).toBe('12r');
    expect(nav.takePendingFolio('src1')).toBeNull();
  });

  it('does not hand it to the viewer of another source', () => {
    nav.openIiifViewerForFolio('src1', '12r');
    expect(nav.takePendingFolio('src2')).toBeNull();
    expect(nav.takePendingFolio('src1')).toBe('12r');
  });

  it('lets a request that nobody picked up expire', () => {
    const now = Date.now();
    const clock = spyOn(Date, 'now').and.returnValue(now);
    nav.openIiifViewerForFolio('src1', '12r');
    clock.and.returnValue(now + 60_000);
    expect(nav.takePendingFolio('src1')).toBeNull();
  });

  it('opens the editor on a pattern', () => {
    nav.openEditorForPattern('src1', 'doc1', 'uuid1');
    expect(router.navigate).toHaveBeenCalledWith(['/document', 'src1', 'doc1'], { queryParams: { focus: 'uuid1' } });
  });
});
