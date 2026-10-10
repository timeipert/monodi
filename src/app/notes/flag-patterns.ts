/**
 * Find neumes by pattern code (`*u`, `[*ud]`, `ud`, `*??`) and set or clear a note flag on them.
 * Angular-free; the dialog and the tests use it directly.
 *
 * Query syntax (the codes of the Pattern overview):
 *   `*`  start of the neume      `u` `d` `e`  step up / down / level      `?`  any step
 *   `[ ]`  a ligature            `V` (uppercase)  a note shape or flag suffix
 *
 * "whole" matches the code of a whole neume; "contains" finds the steps anywhere inside a neume
 * (a leading `*` anchors it at the neume's start, ligature brackets are then ignored).
 */
import * as VM from '../types/model';
import { NeumeNote, describeNeume, extractPattern } from '../transcription-analyzer-core';

export type FlagTarget = 'first' | 'last' | 'all' | 'nth';

export interface FlagQuery {
  text: string;
  mode: 'whole' | 'contains';
  /** Compare only the steps: leave out note shapes (O, Q, ...) and flags (V, ...) on both sides. */
  ignoreShapes: boolean;
  target: FlagTarget;
  /** 1-based, for target 'nth'. */
  nth: number;
}

export interface FlagMatch {
  /** Stable within one search: syllable uuid, voice, neume index and start. */
  id: string;
  syllableUuid: string;
  syllableText: string;
  /** The neume's code as written, e.g. `[*u]dd`. */
  pattern: string;
  /** The notes the pattern covers. */
  notes: VM.Note[];
  /** The notes that get (or lose) the flag. */
  targets: VM.Note[];
}

export function normalizeQuery(text: string): string {
  return text.replace(/\s+/g, '').replace(/\{/g, '[').replace(/\}/g, ']');
}

/** Why the query cannot be used (null = fine or empty). */
export function queryProblem(text: string): string | null {
  const q = normalizeQuery(text);
  if (!q) return null;
  if (!/^[*udeA-Z?[\]]*$/.test(q)) return 'Use * for the start, u d e for up/down/level, ? for any step, [ ] for a ligature.';
  let depth = 0;
  for (const c of q) {
    if (c === '[') depth++;
    if (c === ']') depth--;
    if (depth < 0 || depth > 1) return 'Brackets must be paired and not nested.';
  }
  return depth === 0 ? null : 'Brackets must be paired and not nested.';
}

const stripShapes = (s: string) => s.replace(/[A-Z]/g, '');

function toRegexSource(q: string): string {
  let out = '';
  for (const c of q) {
    if (c === '?') out += '[ude]';
    else if (c === '*' || c === '[' || c === ']') out += '\\' + c;
    else out += c;
  }
  return out;
}

function pickTargets(notes: VM.Note[], target: FlagTarget, nth: number): VM.Note[] {
  switch (target) {
    case 'first': return notes.slice(0, 1);
    case 'last': return notes.slice(-1);
    case 'nth': return notes[nth - 1] ? [notes[nth - 1]] : [];
    default: return notes;
  }
}

/** All neumes of one syllable, with their pattern, over every voice. */
function neumesOf(s: VM.Syllable): VM.NonSpaced[] {
  const voices = [s.notes, ...(s.additionalMelodies ?? [])];
  return voices.flatMap(v => v?.spaced ?? []);
}

export function findFlagMatches(root: VM.RootContainer, query: FlagQuery): FlagMatch[] {
  const raw = normalizeQuery(query.text);
  if (!raw || queryProblem(query.text)) return [];
  const out: FlagMatch[] = [];

  let q = query.ignoreShapes ? stripShapes(raw) : raw;
  const whole = query.mode === 'whole';
  const anchored = !whole && q.startsWith('*');
  if (!whole) q = q.replace(/[[\]]/g, '').replace(/^\*/, '');
  if (!whole && !q) return [];
  const re = new RegExp(whole ? `^${toRegexSource(q)}$` : toRegexSource(q), whole ? '' : 'y');

  for (const syl of VM.getSyllables(root)) {
    neumesOf(syl).forEach((neume, ni) => {
      const steps = describeNeume(neume);
      if (steps.length === 0) return;
      const code = extractPattern(neume);
      const add = (notes: VM.Note[], start: number) => {
        const targets = pickTargets(notes, query.target, query.nth);
        if (targets.length === 0) return;
        out.push({
          id: `${syl.uuid}:${ni}:${start}`,
          syllableUuid: syl.uuid,
          syllableText: syl.text,
          pattern: code,
          notes,
          targets
        });
      };

      if (whole) {
        if (re.test(query.ignoreShapes ? stripShapes(code) : code)) add(steps.map(s => s.note), 0);
        return;
      }

      // contains: step tokens of notes 1..n joined, remembering where each token starts
      const tokens: string[] = steps.slice(1).map((s: NeumeNote) => s.step + (query.ignoreShapes ? '' : s.suffix));
      const starts: number[] = [];
      let text = '';
      for (const t of tokens) { starts.push(text.length); text += t; }
      const boundaries = new Set([...starts, text.length]);
      for (let ti = 0; ti < tokens.length; ti++) {
        if (anchored && ti > 0) break;
        re.lastIndex = starts[ti];
        const m = re.exec(text);
        if (!m || m[0].length === 0) continue;
        const end = starts[ti] + m[0].length;
        if (!boundaries.has(end)) continue;
        const endToken = end === text.length ? tokens.length : starts.indexOf(end);
        const firstNote = anchored ? 0 : ti;       // token i leads to note i+1, so note i starts the match
        const notes = steps.slice(firstNote, endToken + 1).map(s => s.note);
        add(notes, firstNote);
        ti = endToken - 1; // continue after the match
      }
    });
  }
  return out;
}

/** Adds or removes the flag on every target note; returns how many notes and neumes changed. */
export function applyFlag(matches: FlagMatch[], flagKey: string, action: 'add' | 'remove'): { notes: number; matches: number } {
  const changed = new Set<string>();
  let matchesChanged = 0;
  for (const m of matches) {
    let any = false;
    for (const n of m.targets) {
      const has = (n.flags ?? []).includes(flagKey);
      if (action === 'add' && !has) {
        n.flags = [...(n.flags ?? []), flagKey];
      } else if (action === 'remove' && has) {
        const rest = n.flags!.filter(k => k !== flagKey);
        if (rest.length > 0) n.flags = rest; else delete n.flags;
      } else {
        continue;
      }
      changed.add(n.uuid);
      any = true;
    }
    if (any) matchesChanged++;
  }
  return { notes: changed.size, matches: matchesChanged };
}
