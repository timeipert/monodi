import { fakeAsync, tick } from '@angular/core/testing';
import { StatusLineService } from './status-line.service';

describe('StatusLineService', () => {
  it('shows a message with its title and hides it after the default time', fakeAsync(() => {
    const s = new StatusLineService();
    s.success('3 sources', 'Import');
    expect(s.current()?.text).toBe('Import: 3 sources');
    tick(4000);
    expect(s.current()).toBeNull();
  }));

  it('keeps a message with disableTimeOut until it is removed by its id', fakeAsync(() => {
    const s = new StatusLineService();
    const ref = s.info('Loading…', '', { disableTimeOut: true });
    tick(60000);
    expect(s.current()?.text).toBe('Loading…');
    s.remove(ref.toastId);
    expect(s.current()).toBeNull();
  }));

  it('replaces the previous message, and an old id does not hide the new one', () => {
    const s = new StatusLineService();
    const first = s.info('first');
    s.error('second');
    s.remove(first.toastId);
    expect(s.current()?.kind).toBe('error');
    expect(s.current()?.text).toBe('second');
  });
});
