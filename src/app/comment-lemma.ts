import { Comment, CommentTree, FormteilDataName, LinePart, RootContainer, getCommentableUUIDsOfLinePart } from './types/model';

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

/**
 * The signature of the section the comment starts in, as the printed apparatus sets it in the margin in front of the
 * first entry of each section. Sections nest (a versicle `3` with the halves `a` and `b`): the signatures of all the
 * sections around the comment are put together, outermost first, a letter directly behind a number (`3a`), anything
 * else with a space. A section without a signature of its own takes that of the one around it, so that an entry in
 * `3 > (nothing)` is `3`. '' where there is none or the start is unknown.
 */
export function commentSignature(root: RootContainer, comment: Pick<Comment, 'startUUID'>): string {
  const visit = (c: any, chain: string[]): string[] | undefined => {
    if (!c || typeof c !== 'object') return undefined;
    if (c.kind === 'FormteilContainer') {
      const sig = ((c.data || []).find((d: any) => d.name === FormteilDataName.Signatur)?.data || '').trim();
      if (sig) chain = [...chain, sig];
    }
    if (c.kind === 'ZeileContainer') {
      for (const lp of c.children || []) if (getCommentableUUIDsOfLinePart(lp as LinePart).includes(comment.startUUID)) return chain;
      return undefined;
    }
    for (const ch of c.children || []) {
      const r = visit(ch, chain);
      if (r !== undefined) return r;
    }
    return undefined;
  };
  return joinSignatures(visit(root, []) || []);
}

/** Signatures of nested sections, outermost first, as one: a letter directly behind a number (`3a`), anything else with a space. */
export function joinSignatures(chain: readonly string[]): string {
  return chain.reduce((out, sig) => (!out ? sig : /^\d+$/.test(out) && /^[a-z]$/i.test(sig) ? out + sig : `${out} ${sig}`), '');
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
 * "reading] reading (note) ] variant". The comparison ignores case, markup, punctuation after the lemma and the
 * u/v and i/j spelling of the manuscript ("Resvrrexi" in the edition, "Resurrexi" in the comment) and a gap
 * ("Eructauit ... regi") that abbreviates a longer reading.
 */
export function treeRepeatsLemma(tree: CommentTree | undefined, lemma: string): boolean {
  const norm = (x: string) => plainMarkup(x).toLowerCase().replace(/v/g, 'u').replace(/j/g, 'i');
  const l = norm(lemma).replace(/[\s.,;:]+$/, '');
  const first = norm(firstTreeText(tree));
  if (!l) return false;
  // a long reading is abbreviated in the comment: "Eructauit <...> regi" stands for "Eructauit cor meum ... regi"
  const gap = first.match(/^(.*?)\s*(?:<\.\.\.>|\.\.\.|\u2026)\s*(.*)$/);
  if (gap && gap[1] && gap[2]) {
    const tail = gap[2].replace(/[\s.,;:]+$/, '');
    return l.length > gap[1].length + tail.length && l.startsWith(gap[1]) && l.endsWith(tail);
  }
  if (!first.startsWith(l)) return false;
  const next = first.charAt(l.length);
  return next === '' || !/[\p{L}\p{N}]/u.test(next);   // a whole word, not the start of a longer one
}

/**
 * Does the tree begin with a line of notes that carries the lyric? Then the notation, with its text
 * underneath, already shows what the entry is about: as in the printed volume no lemma is set in front
 * of it ("[notes] ] korrigiert zu [notes]", not "in] [notes] ] korrigiert zu [notes]").
 */
export function treeStartsWithTextedNotes(tree: CommentTree | undefined): boolean {
  const t = firstTreeLeaf(tree);
  if (!t || t.kind !== 'CommentTreeLeaf' || t.content.kind !== 'Notes') return false;
  const parts: any[] = (t.content.content as any)?.children || [];
  return parts.some((p) => p.kind === 'Syllable' && String(p.text || '').trim() !== '' && !/^(X|\.\.\.|<\.\.\.>)$/.test(String(p.text).trim()));
}

/** What the import leaves as the whole content of an apparatus entry that has none: "#App", "#Lem", "#App 2". */
const PLACEHOLDER = /^#\s*(app|lem)\s*\d*$/i;

/** An entry that consists of such a placeholder only says nothing and is left out of the print. */
export function isPlaceholderComment(c: Partial<Pick<Comment, 'commentType' | 'tree' | 'lines'>> & Pick<Comment, 'text'>): boolean {
  const type = commentType(c);
  if (type === 'lines') return false;
  if (type === 'text') return PLACEHOLDER.test(plainMarkup(c.text));
  const texts: string[] = [];
  let content = true;
  const walk = (t: CommentTree | undefined): void => {
    if (!t) return;
    if (t.kind === 'CommentTreeGrid') t.items.forEach((row) => row.forEach(walk));
    else if (t.kind === 'CommentTreeLeaf') {
      if (t.content.kind === 'Text') texts.push(plainMarkup(t.content.content));
      else if (t.content.kind === 'Notes') content = false;      // a bracket is only a bracket
    }
  };
  walk(c.tree);
  const nonEmpty = texts.filter(Boolean);
  return content && nonEmpty.length > 0 && nonEmpty.every((x) => PLACEHOLDER.test(x));
}

/** The comments of a document that are printed (placeholders left out). */
export function printableComments(root: Pick<RootContainer, 'comments'> | null | undefined): Comment[] {
  return ((root?.comments || []) as Comment[]).filter((c) => !isPlaceholderComment(c));
}
