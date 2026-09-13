import { TestBed } from '@angular/core/testing';
import { EditorShortcutsService, DEFAULT_SHORTCUTS } from './editor-shortcuts.service';

describe('EditorShortcutsService', () => {
  let service: EditorShortcutsService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    service = TestBed.inject(EditorShortcutsService);
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('should be created and have default shortcuts including building blocks', () => {
    expect(service).toBeTruthy();
    const shortcuts = service.getShortcuts();
    expect(shortcuts.setFlat).toBe('f');
    expect(shortcuts.setSharp).toBe('s');
    expect(shortcuts.insertConnectedNote).toBe('Shift');
    expect(shortcuts.insertNearNote).toBe('Space');
    expect(shortcuts.insertFarNote).toBe('Enter');
  });

  it('should save and retrieve custom shortcuts', () => {
    const custom = {
      ...DEFAULT_SHORTCUTS,
      insertConnectedNote: 'Alt',
      insertNearNote: 'Tab',
      setFlat: 'b'
    };
    service.saveShortcuts(custom);
    expect(service.getShortcuts().insertConnectedNote).toBe('Alt');
    expect(service.getShortcuts().insertNearNote).toBe('Tab');
    expect(service.getShortcuts().setFlat).toBe('b');
  });

  it('should reset shortcuts to defaults', () => {
    service.saveShortcuts({ ...DEFAULT_SHORTCUTS, insertConnectedNote: 'Control' });
    expect(service.getShortcuts().insertConnectedNote).toBe('Control');
    service.resetToDefaults();
    expect(service.getShortcuts().insertConnectedNote).toBe('Shift');
  });
});
