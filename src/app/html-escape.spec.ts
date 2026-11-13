import { escapeHtml, jsonForScript } from './html-escape';

describe('escapeHtml', () => {
  it('turns markup into text', () => {
    expect(escapeHtml('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;');
    expect(escapeHtml(`a & "b" 'c'`)).toBe('a &amp; &quot;b&quot; &#39;c&#39;');
  });

  it('treats null, undefined and numbers as text', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(7)).toBe('7');
  });
});

describe('jsonForScript', () => {
  const hostile = { text: '</script><script>alert(1)</script>', note: 'a\u2028b' };

  it('contains no closing script tag or raw "<"', () => {
    const out = jsonForScript(hostile);
    expect(out).not.toContain('<');
    expect(out.toLowerCase()).not.toContain('</script');
  });

  it('is read back unchanged by JSON.parse', () => {
    expect(JSON.parse(jsonForScript(hostile))).toEqual(hostile);
  });
});
