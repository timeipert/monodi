import { TestBed } from '@angular/core/testing';

import { FocusService } from './focus.service';

describe('FocusService', () => {
  beforeEach(() => TestBed.configureTestingModule({}));

  it('should be created', () => {
    const service: FocusService = TestBed.inject(FocusService);
    expect(service).toBeTruthy();
  });

  describe('shiftFocus', () => {
    let service: FocusService;
    beforeEach(() => { service = TestBed.inject(FocusService); });

    it('reports a request that something answered as moved', () => {
      expect(service.shiftFocus(() => { /* a neighbour took the focus */ })).toBeTrue();
    });

    it('reports a request that ran off the end of the document as not moved, so the caller keeps its focus', () => {
      expect(service.shiftFocus(() => service.rejectFocusShift())).toBeFalse();
    });

    it('forgets a rejection when the next request starts', () => {
      service.shiftFocus(() => service.rejectFocusShift());
      expect(service.shiftFocus(() => { /* answered */ })).toBeTrue();
    });

    it('lets a rejection in a nested request (an empty syllable passing it on) reject the outer one', () => {
      const moved = service.shiftFocus(() => {
        service.shiftFocus(() => service.rejectFocusShift());
      });
      expect(moved).toBeFalse();
    });
  });
});
