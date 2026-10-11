import { Comment, LinePart, getCommentableUUIDsOfLinePart } from './types/model';

/**
 * The text a comment's brackets frame: the lyrics from the start to the end syllable,
 * words joined by dropping the hyphen of a syllable break. The critical apparatus cites
 * this text instead of a running number, as in the printed edition.
 */
/** Position (index among the line parts) where a comment starts; Infinity if its start is unknown. */
export function commentStartIndex(parts: LinePart[], comment: Pick<Comment, 'startUUID'>): number {
  const i = parts.findIndex((lp) => getCommentableUUIDsOfLinePart(lp).includes(comment.startUUID));
  return i < 0 ? Infinity : i;
}

export function commentLemma(parts: LinePart[], comment: Pick<Comment, 'startUUID' | 'endUUID'>): string {
  let a = -1, b = -1;
  parts.forEach((lp, i) => {
    const ids = getCommentableUUIDsOfLinePart(lp);
    if (a < 0 && ids.includes(comment.startUUID)) a = i;
    if (ids.includes(comment.endUUID)) b = i;
  });
  if (a < 0) return '';
  if (b < a) b = a;
  let out = '';
  for (let i = a; i <= b; i++) {
    const lp: any = parts[i];
    if (lp.kind !== 'Syllable') continue;
    const t = String(lp.text || '').trim();
    if (!t || t === 'X' || t === '...' || t === '<...>') continue;
    out += /[-–]$/.test(t) ? t.slice(0, -1) : t + ' ';
  }
  return out.trim();
}

/** 'text', 'tree' or 'lines': how a comment's body is stored. */
export function commentType(c: Pick<Comment, 'commentType' | 'tree' | 'lines'>): 'text' | 'tree' | 'lines' {
  if (c.commentType) return c.commentType;
  if (c.tree) return 'tree';
  if (c.lines) return 'lines';
  return 'text';
}
