import { Injectable } from '@angular/core';
import { Title } from '@angular/platform-browser';

const APP_NAME = 'monodi';

@Injectable({ providedIn: 'root' })
export class PageTitleService {
  constructor(private title: Title) {}

  /** Build "Part1 — Part2 — Monodi" and set it as the browser tab title.
   *  Pass each non-empty segment as a separate argument; the service adds the app suffix. */
  set(...parts: (string | null | undefined)[]): void {
    const segments = parts.filter((p): p is string => !!p?.trim()).map(p => p!.trim());
    this.title.setTitle(segments.length ? [...segments, APP_NAME].join(' — ') : APP_NAME);
  }

  reset(): void {
    this.title.setTitle(APP_NAME);
  }
}
