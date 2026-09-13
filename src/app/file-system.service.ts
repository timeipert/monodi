import { Injectable } from '@angular/core';
import * as localforage from 'localforage';

export interface FilePickerTypeOption {
  description?: string;
  accept: Record<string, string[]>;
}

export interface SaveFileOptions {
  suggestedName: string;
  types?: FilePickerTypeOption[];
  fallbackMimeType?: string;
}

export interface OpenFileOptions {
  types?: FilePickerTypeOption[];
  multiple?: boolean;
}

export interface OpenFileResult {
  file: File;
  handle?: any;
}

@Injectable({
  providedIn: 'root'
})
export class FileSystemService {

  /**
   * Checks if the Chromium File System Access API is supported in the current environment.
   */
  public isSupported(): boolean {
    return typeof window !== 'undefined' && 'showSaveFilePicker' in window && 'showOpenFilePicker' in window;
  }

  /**
   * Saves a file either using the native OS File System Access API (Chromium)
   * or falling back to the standard <a> download mechanism (Firefox, Safari).
   */
  public async saveFile(
    content: Blob | string,
    options: SaveFileOptions
  ): Promise<{ saved: boolean; handle?: any }> {
    const blob = typeof content === 'string'
      ? new Blob([content], { type: options.fallbackMimeType || 'application/json;charset=utf-8' })
      : content;

    if (this.isSupported()) {
      try {
        const pickerOptions: any = {
          suggestedName: options.suggestedName,
        };
        if (options.types && options.types.length > 0) {
          pickerOptions.types = options.types;
        }

        const handle = await (window as any).showSaveFilePicker(pickerOptions);
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return { saved: true, handle };
      } catch (err: any) {
        if (err.name === 'AbortError') {
          // User clicked "Cancel" in the file picker dialog
          return { saved: false };
        }
        console.warn('showSaveFilePicker failed, falling back to download:', err);
      }
    }

    // Fallback for non-Chromium or if the API failed
    this.downloadBlob(blob, options.suggestedName);
    return { saved: true };
  }

  /**
   * Writes content directly to an existing FileSystemFileHandle.
   */
  public async saveToHandle(handle: any, content: Blob | string): Promise<boolean> {
    try {
      const hasPermission = await this.verifyPermission(handle, true);
      if (!hasPermission) {
        return false;
      }
      const blob = typeof content === 'string'
        ? new Blob([content], { type: 'application/json;charset=utf-8' })
        : content;

      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    } catch (err) {
      console.error('Failed to write directly to file handle:', err);
      return false;
    }
  }

  /**
   * Opens a file either via native OS Open File Dialog (Chromium)
   * or via hidden file input (Firefox, Safari).
   */
  public async openFile(options?: OpenFileOptions): Promise<OpenFileResult | null> {
    if (this.isSupported()) {
      try {
        const pickerOptions: any = {};
        if (options?.types && options.types.length > 0) {
          pickerOptions.types = options.types;
        }
        pickerOptions.multiple = !!options?.multiple;

        const handles = await (window as any).showOpenFilePicker(pickerOptions);
        if (!handles || handles.length === 0) return null;
        const handle = handles[0];
        const file = await handle.getFile();
        return { file, handle };
      } catch (err: any) {
        if (err.name === 'AbortError') {
          return null;
        }
        console.warn('showOpenFilePicker failed, falling back to file input:', err);
      }
    }

    // Fallback for non-Chromium
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      if (options?.types && options.types.length > 0) {
        const extensions = Object.values(options.types[0].accept).flat().join(',');
        if (extensions) input.accept = extensions;
      }

      input.onchange = () => {
        if (input.files && input.files.length > 0) {
          resolve({ file: input.files[0] });
        } else {
          resolve(null);
        }
      };

      input.oncancel = () => {
        resolve(null);
      };

      input.click();
    });
  }

  /**
   * Prompts the user to pick a target save file and stores the handle in IndexedDB for recurring backups.
   */
  public async pickAndStoreBackupHandle(
    key: string,
    suggestedName: string,
    types?: FilePickerTypeOption[]
  ): Promise<any | null> {
    if (!this.isSupported()) return null;
    try {
      const handle = await (window as any).showSaveFilePicker({
        suggestedName,
        types: types || [
          {
            description: 'Monodi Workspace Backup',
            accept: { 'application/json': ['.monodijson', '.json'] }
          }
        ]
      });
      if (handle) {
        await this.storeHandle(key, handle);
        return handle;
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error('Failed to pick and store handle:', err);
      }
    }
    return null;
  }

  /**
   * Persists a FileSystemHandle into localforage (IndexedDB).
   */
  public async storeHandle(key: string, handle: any): Promise<void> {
    await localforage.setItem(key, handle);
  }

  /**
   * Retrieves a persisted FileSystemHandle from localforage (IndexedDB).
   */
  public async getStoredHandle(key: string): Promise<any | null> {
    try {
      return await localforage.getItem<any>(key);
    } catch {
      return null;
    }
  }

  /**
   * Removes a persisted FileSystemHandle.
   */
  public async removeStoredHandle(key: string): Promise<void> {
    await localforage.removeItem(key);
  }

  /**
   * Verifies read or readwrite permissions for a FileSystemHandle, prompting the user if needed.
   */
  public async verifyPermission(handle: any, readWrite = false): Promise<boolean> {
    if (!handle || typeof handle.queryPermission !== 'function') return false;
    const options: any = {};
    if (readWrite) {
      options.mode = 'readwrite';
    }

    try {
      if ((await handle.queryPermission(options)) === 'granted') {
        return true;
      }
      if ((await handle.requestPermission(options)) === 'granted') {
        return true;
      }
    } catch (e) {
      console.warn('Permission query/request failed:', e);
    }
    return false;
  }

  /**
   * Syncs the entire workspace data into the linked OS backup file handle (if one has been linked).
   */
  public async syncWorkspaceToOsFile(): Promise<{ synced: boolean; filename?: string; error?: string }> {
    try {
      const handle = await this.getStoredHandle('monodi_os_backup_handle');
      if (!handle) {
        return { synced: false };
      }
      const sources = await localforage.getItem('monodi_sources');
      const documents = await localforage.getItem('monodi_documents');
      // Dynamic import or direct access to NotesStore & workspace builder
      const NotesStoreModule = await import('./notes-store');
      const notes = await NotesStoreModule.NotesStore.getAll();
      const settings = await localforage.getItem('monodi_settings');
      const WorkspaceIoModule = await import('./workspace-io');
      const data = WorkspaceIoModule.buildWorkspaceExport(sources as any, documents as any, notes, settings as any, 'none');
      const content = JSON.stringify(data, null, 2);

      const success = await this.saveToHandle(handle, content);
      if (success) {
        const now = new Date().toLocaleTimeString();
        localStorage.setItem('monodi_os_backup_time', now);
        const name = localStorage.getItem('monodi_os_backup_name') || handle.name || 'OS file';
        return { synced: true, filename: name };
      } else {
        return { synced: false, error: 'Permission required or write access not granted' };
      }
    } catch (err: any) {
      console.warn('Failed to sync to OS backup file:', err);
      return { synced: false, error: err?.message || String(err) };
    }
  }

  /**
   * Utility to trigger standard browser download for Blobs.
   */
  public downloadBlob(blob: Blob, filename: string): void {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    }, 100);
  }
}
