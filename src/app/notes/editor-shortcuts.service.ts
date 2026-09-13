import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export interface ShortcutConfig {
  // Building Blocks & Note Insertion
  insertConnectedNote: string;
  insertNearNote: string;
  insertFarNote: string;
  newSegment: string;
  newClef: string;

  // Note Modifications
  setFlat: string;
  setSharp: string;
  setNatural: string;
  toggleLiquescent: string;
  setOriscus: string;
  setAscending: string;
  setDescending: string;
  setStrophicus: string;
  setQuilisma: string;
  addComment: string;

  // Document & Structure Shortcuts
  splitLine: string;
  mergeWithNextLine: string;
  mergeSection: string;
  mergeAllLines: string;
}

export const DEFAULT_SHORTCUTS: ShortcutConfig = {
  insertConnectedNote: 'Shift',
  insertNearNote: 'Space',
  insertFarNote: 'Enter',
  newSegment: '-',
  newClef: 'c',

  setFlat: 'f',
  setSharp: 's',
  setNatural: 'n',
  toggleLiquescent: 'l',
  setOriscus: 'o',
  setAscending: 'a',
  setDescending: 'd',
  setStrophicus: ',',
  setQuilisma: 'q',
  addComment: 'k',

  splitLine: 'Enter',
  mergeWithNextLine: 'm',
  mergeSection: 'Shift+m',
  mergeAllLines: 'Alt+m'
};

@Injectable({
  providedIn: 'root'
})
export class EditorShortcutsService {
  private readonly STORAGE_KEY = 'monodi_editor_shortcuts';
  private shortcutsSubject = new BehaviorSubject<ShortcutConfig>(this.loadShortcuts());
  shortcuts$ = this.shortcutsSubject.asObservable();

  loadShortcuts(): ShortcutConfig {
    if (typeof localStorage === 'undefined') return { ...DEFAULT_SHORTCUTS };
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        return { ...DEFAULT_SHORTCUTS, ...JSON.parse(stored) };
      }
    } catch (e) {}
    return { ...DEFAULT_SHORTCUTS };
  }

  getShortcuts(): ShortcutConfig {
    return this.shortcutsSubject.value;
  }

  saveShortcuts(config: ShortcutConfig): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(config));
    }
    this.shortcutsSubject.next({ ...config });
  }

  resetToDefaults(): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(this.STORAGE_KEY);
    }
    this.shortcutsSubject.next({ ...DEFAULT_SHORTCUTS });
  }
}
