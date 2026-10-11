/**
 * `localStorage` that never throws. Reading or writing it can fail for reasons the app cannot influence: blocked
 * site data (Safari, strict privacy settings), a full quota, a private window. A failed preference must not turn
 * into an error toast or break the page, so every access goes through here and the caller gets a plain "no" back.
 */
export const safeStorage = {
  get(key: string): string | null {
    try { return localStorage.getItem(key); } catch { return null; }
  },

  /** `false` when the value could not be stored. */
  set(key: string, value: string): boolean {
    try { localStorage.setItem(key, value); return true; } catch { return false; }
  },

  remove(key: string): void {
    try { localStorage.removeItem(key); } catch { /* nothing to remove, or nothing we may touch */ }
  },

  /** The stored JSON, or `fallback` when it is missing, unreadable or not valid JSON. */
  getJson<T>(key: string, fallback: T): T {
    const raw = this.get(key);
    if (raw === null) return fallback;
    try { return JSON.parse(raw) as T; } catch { return fallback; }
  },

  setJson(key: string, value: unknown): boolean {
    try { return this.set(key, JSON.stringify(value)); } catch { return false; }
  },
};
