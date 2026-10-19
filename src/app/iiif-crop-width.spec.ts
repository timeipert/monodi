import { imageCropUrlByWidth } from './iiif-crop';

describe('imageCropUrlByWidth', () => {
  const r = { x: 10, y: 20, w: 50, h: 5 };
  it('asks for the width alone, which every IIIF server understands', () => {
    expect(imageCropUrlByWidth('https://img/p1/', r, 1800)).toBe('https://img/p1/pct:10,20,50,5/1800,/0/default.jpg');
  });
  it('does not ask for more than the page has: 50 % of a 1000 px page is 500 px', () => {
    expect(imageCropUrlByWidth('https://img/p1', r, 1800, 1000)).toBe('https://img/p1/pct:10,20,50,5/500,/0/default.jpg');
  });
  it('keeps a sane minimum', () => {
    expect(imageCropUrlByWidth('https://img/p1', { x: 0, y: 0, w: 0.5, h: 1 }, 1800, 100)).toContain('/16,/0/');
  });
});
