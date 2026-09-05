import { v4 as UUID } from 'uuid';
import * as M from '../types/model';

/**
 * A one-click starting structure for a comment's content tree. `build` returns
 * a fresh CommentTree (with fresh UUIDs) each time it is called.
 */
export interface CommentTemplate {
  key: 'text' | 'lemma';
  label: string;
  icon: string;
  build(originalCreator: () => M.ZeileContainer): M.CommentTree;
}

function textLeaf(text = ''): M.CommentTreeLeaf {
  return { kind: 'CommentTreeLeaf', id: UUID(), content: { kind: 'Text', content: text } };
}

function notesLeaf(zeile: M.ZeileContainer): M.CommentTreeLeaf {
  return { kind: 'CommentTreeLeaf', id: UUID(), content: { kind: 'Notes', content: zeile } };
}

function undecided(): M.CommentTreeUndecided {
  return { kind: 'CommentTreeUndecided', id: UUID() };
}

export const COMMENT_TEMPLATES: CommentTemplate[] = [
  {
    key: 'text',
    label: 'Only text',
    icon: 'bi-fonts',
    build: () => textLeaf(''),
  },
  {
    key: 'lemma',
    label: 'Lemma | Reading',
    icon: 'bi-distribute-vertical',
    build: (originalCreator) => ({
      kind: 'CommentTreeGrid',
      id: UUID(),
      // One row, three columns: lemma ] reading
      items: [
        [
          notesLeaf(originalCreator()),      // col 0 — the lemma (chant)
          textLeaf(']'),                     // col 1 — the bracket
          notesLeaf(M.emptyZeileContainer()) // col 2 — the reading (chant)
        ],
      ],
    }),
  },
];

/** A user-saved reusable template. `tree` is stored ID-stripped; ids/uuids are
 *  regenerated on apply (see instantiateTemplateTree). */
export interface SavedCommentTemplate {
  id: string;
  name: string;
  tree: M.CommentTree;
}

/** Deep-clone a tree and blank out every node id for storage. */
export function stripTemplateTree(tree: M.CommentTree): M.CommentTree {
  const clone = JSON.parse(JSON.stringify(tree)) as M.CommentTree;
  const strip = (n: M.CommentTree) => {
    n.id = '';
    if (n.kind === 'CommentTreeGrid') n.items.forEach(row => row.forEach(strip));
  };
  strip(clone);
  return clone;
}

/** Deep-clone a saved template tree, assigning fresh ids to every node and
 *  fresh uuids to any notation inside, ready to insert into a comment. */
export function instantiateTemplateTree(tree: M.CommentTree): M.CommentTree {
  const clone = JSON.parse(JSON.stringify(tree)) as M.CommentTree;
  const regen = (n: M.CommentTree) => {
    n.id = UUID();
    if (n.kind === 'CommentTreeGrid') {
      n.items.forEach(row => row.forEach(regen));
    } else if (n.kind === 'CommentTreeLeaf' && n.content.kind === 'Notes') {
      M.unsafeGenerateNewUUIDs(n.content.content);
    }
  };
  regen(clone);
  return clone;
}

/**
 * True when a tree already holds meaningful content (so replacing it with a
 * template should be confirmed). Empty/Undecided cells and grids made only of
 * empty cells count as "no content".
 */
export function treeHasContent(tree: M.CommentTree | undefined): boolean {
  if (!tree) return false;
  switch (tree.kind) {
    case 'CommentTreeUndecided':
      return false;
    case 'CommentTreeLeaf':
      if (tree.content.kind === 'Text') return tree.content.content.trim().length > 0;
      return true; // Notes or Bracket is a deliberate structure
    case 'CommentTreeGrid':
      return tree.items.some(row => row.some(cell => treeHasContent(cell)));
  }
}
