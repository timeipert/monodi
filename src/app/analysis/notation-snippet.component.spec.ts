import { ChangeDetectorRef } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { intervalNotation, pitchNotation } from '@monodi/core/analysis';
import { G_CLEF_PATH } from '../clef-glyph';
import { NotationSnippetComponent } from './notation-snippet.component';

describe('NotationSnippetComponent', () => {
  let fixture: ComponentFixture<NotationSnippetComponent>;
  const show = (n: NotationSnippetComponent['notation']): HTMLElement => {
    const comp = fixture.componentInstance;
    comp.notation = n;
    comp.ngOnChanges();
    fixture.debugElement.injector.get(ChangeDetectorRef).detectChanges();
    return fixture.nativeElement as HTMLElement;
  };

  beforeEach(() => {
    TestBed.configureTestingModule({ declarations: [NotationSnippetComponent] });
    fixture = TestBed.createComponent(NotationSnippetComponent);
  });

  it('draws five staff lines, the G clef and one head per pitch', () => {
    const el = show(pitchNotation([29, 31, 32]).notation);
    expect(el.querySelectorAll('line.ns-line').length).toBe(5);
    expect(el.querySelector('path.ns-clef')!.getAttribute('d')).toBe(G_CLEF_PATH);
    expect(el.querySelectorAll('path.ns-head').length).toBe(3);
  });

  it('puts the same pitch at the same height in every drawing (fixed clef)', () => {
    const y = (el: HTMLElement) => (el.querySelector('path.ns-head') as SVGPathElement).getAttribute('transform');
    const a = y(show(pitchNotation([32, 33]).notation));
    const b = y(show(pitchNotation([32, 20, 40]).notation));
    expect(a).toBe(b);
  });

  it('draws intervals without a clef, one more head than steps', () => {
    const el = show(intervalNotation([2, -1]).notation);
    expect(el.querySelector('path.ns-clef')).toBeNull();
    expect(el.querySelectorAll('path.ns-head').length).toBe(3);
  });

  it('draws ledger lines for notes outside the staff and marks a cut sequence', () => {
    const el = show(intervalNotation([15], 3).notation);
    expect(el.querySelectorAll('line.ns-ledger').length).toBeGreaterThan(0);
    const cut = show(pitchNotation(Array.from({ length: 30 }, (_, i) => 20 + (i % 4))).notation);
    expect(cut.querySelector('text.ns-more')).toBeTruthy();
  });

  it('sizes the drawing by the scale', () => {
    const el = show(pitchNotation([29]).notation);
    const svg = el.querySelector('svg')!;
    const full = Number(svg.getAttribute('width'));
    fixture.componentInstance.scale = 0.3;
    fixture.componentInstance.ngOnChanges();
    fixture.debugElement.injector.get(ChangeDetectorRef).detectChanges();
    expect(Number(svg.getAttribute('width'))).toBeCloseTo(full / 2, 3);
  });
});
