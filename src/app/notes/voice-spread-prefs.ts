import { Subject } from 'rxjs';

/**
 * Whether the notes of aligned neumes of several voices are spread over the same width (see `VoiceLayoutOptions.spreadVoices` in
 * `Drawables.ts`). The choice is per person and browser (local storage), not part of the document: it changes how the staff is drawn,
 * never what is saved or exported.
 */
const KEY = 'monodi_spread_voices';

/** Emits after the choice changed; the syllable editors redraw on it. */
export const voiceSpreadChanges$ = new Subject<void>();

let current: boolean | undefined;

export function getSpreadVoices(): boolean {
  if (current === undefined) {
    try { current = localStorage.getItem(KEY) === '1'; } catch { current = false; /* storage unavailable: default */ }
  }
  return current;
}

export function setSpreadVoices(value: boolean): void {
  current = value;
  try { localStorage.setItem(KEY, value ? '1' : '0'); } catch { /* the choice then lasts until the page is closed */ }
  voiceSpreadChanges$.next();
}
