import { Comment, CommentTree, LinePart, getCommentableUUIDsOfLinePart } from './types/model';

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

/** The text of a comment without its markup: ((roman)), [[SIGLUM]] and {{boxed}} give their content. */
export function plainMarkup(text: string): string {
  return (text || '').replace(/\(\(|\)\)|\[\[|\]\]|\{\{|\}\}/g, '').replace(/\s+/g, ' ').trim();
}

/** The first cell (top left) of a comment tree. */
export function firstTreeLeaf(tree: CommentTree | undefined): CommentTree | undefined {
  let t: CommentTree | undefined = tree;
  while (t && t.kind === 'CommentTreeGrid') t = t.items?.[0]?.[0];
  return t;
}

/** The text of the first cell of a comment tree; '' if that is not a text cell. */
export function firstTreeText(tree: CommentTree | undefined): string {
  const t = firstTreeLeaf(tree);
  return t && t.kind === 'CommentTreeLeaf' && t.content.kind === 'Text' ? t.content.content : '';
}

/** Does the tree begin with its bracket ("lemma ] comment")? Then that bracket closes the lemma. */
export function treeStartsWithBracket(tree: CommentTree | undefined): boolean {
  const t = firstTreeLeaf(tree);
  return !!t && t.kind === 'CommentTreeLeaf' && t.content.kind === 'Bracket';
}

/**
 * Does a comment tree begin with the reading of the edition, which the apparatus already gives as
 * the lemma? Then the printed form is "reading (note) ] variant" — the lemma stands once, not
 * "reading] reading (note) ] variant". The comparison ignores case, markup and punctuation after the lemma.
 */
export function treeRepeatsLemma(tree: CommentTree | undefined, lemma: string): boolean {
  const norm = (x: string) => plainMarkup(x).toLowerCase();
  const l = norm(lemma).replace(/[\s.,;:]+$/, '');
  const first = norm(firstTreeText(tree));
  if (!l || !first.startsWith(l)) return false;
  const next = first.charAt(l.length);
  return next === '' || !/[\p{L}\p{N}]/u.test(next);   // a whole word, not the start of a longer one
}
