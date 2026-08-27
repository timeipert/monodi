import { Injectable } from '@angular/core';

/** One manuscript witness of a chant, as returned by Cantus Index. */
export interface CantusChant {
  siglum?: string;
  srclink?: string;
  chantlink?: string;
  folio?: string;
  feast?: string;
  office?: string;
  genre?: string;
  mode?: string;
  fulltext?: string;
  /** Volpiano melody string. */
  melody?: string;
  db?: string;
}

/** Aggregate info for a Cantus ID. */
export interface CantusInfo {
  field_feast?: string;
  field_full_text?: string;
  field_fulltext_source?: string;
  field_genre?: string;
  field_incipit?: string;
  field_language?: string;
}

export interface CantusIdResult {
  cantusId: string;
  info: CantusInfo;
  chants: CantusChant[];
}

/**
 * Reads chant melodies from the Cantus Index open JSON API
 * (https://cantusindex.org). The `json-cid-mel/{id}` endpoint returns every
 * database record for a Cantus ID that carries a Volpiano melody. The endpoint
 * sends permissive CORS headers, so it can be called directly from the browser.
 */
@Injectable({
  providedIn: 'root',
})
export class CantusIndexService {
  private readonly base = 'https://cantusindex.org';

  /** Strip a pasted URL or stray characters down to the bare Cantus ID. */
  normalizeId(input: string): string {
    return (input || '')
      .trim()
      .replace(/^.*\/id\//i, '')
      .replace(/[?#].*$/, '')
      .replace(/[^0-9A-Za-z._-]/g, '');
  }

  async fetchByCantusId(input: string): Promise<CantusIdResult> {
    const cantusId = this.normalizeId(input);
    if (!cantusId) {
      throw new Error('Please enter a Cantus ID (e.g. 501001).');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let response: Response;
    try {
      response = await fetch(`${this.base}/json-cid-mel/${encodeURIComponent(cantusId)}`, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
    } catch (e: any) {
      if (e && e.name === 'AbortError') {
        throw new Error('Cantus Index took too long to respond (timed out).');
      }
      throw new Error('Could not reach cantusindex.org (offline or blocked).');
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      throw new Error(`Cantus Index returned HTTP ${response.status} for ID "${cantusId}".`);
    }

    let data: any;
    try {
      data = await response.json();
    } catch (e) {
      throw new Error('Cantus Index returned an unexpected (non-JSON) response.');
    }

    const info: CantusInfo = (data && data.info) || {};
    const rawChants: any[] = Array.isArray(data) ? data : Array.isArray(data?.chants) ? data.chants : [];
    const chants: CantusChant[] = rawChants
      .filter((c) => c && typeof c.melody === 'string' && c.melody.trim().length > 0)
      .map((c) => ({
        siglum: c.siglum || '',
        srclink: c.srclink || '',
        chantlink: c.chantlink || '',
        folio: c.folio || '',
        feast: c.feast || '',
        office: c.office || '',
        genre: c.genre || '',
        mode: c.mode || '',
        fulltext: c.fulltext || '',
        melody: c.melody || '',
        db: c.db || '',
      }));

    return { cantusId, info, chants };
  }
}
