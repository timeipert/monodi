import * as VM from '../types/model';

/**
 * A document in print order, as the edition shows it: section starts (with their signature),
 * paratexts (rubrics) and lines of notation — the same sequence the read-only view renders.
 */
export type PrintBlock =
  | { kind: 'formteil'; depth: number; signature: string }
  | { kind: 'paratext'; depth: number; text: string }
  | { kind: 'zeile'; depth: number; zeile: VM.ZeileContainer };

/** Line parts that are printed (clef and box markers of the editor are not). */
export function printedParts(zeile: VM.ZeileContainer): VM.LinePart[] {
  return (zeile.children || []).filter((p) => p.kind === 'Syllable' || p.kind === 'LineChange' || p.kind === 'FolioChange');
}

export function documentBlocks(root: VM.RootContainer): PrintBlock[] {
  const out: PrintBlock[] = [];
  const visit = (c: VM.RootChildren | VM.FormteilChildren, depth: number) => {
    switch (c.kind) {
      case VM.ContainerKind.FormteilContainer: {
        const sig = (c.data || []).find((d) => d.name === VM.FormteilDataName.Signatur)?.data?.trim() || '';
        out.push({ kind: 'formteil', depth, signature: sig });
        for (const ch of c.children || []) visit(ch, depth + 1);
        break;
      }
      case VM.ContainerKind.ParatextContainer:
        out.push({ kind: 'paratext', depth, text: (c.text || '').trim() });
        break;
      case VM.ContainerKind.ZeileContainer:
        out.push({ kind: 'zeile', depth, zeile: c });
        break;
      case VM.ContainerKind.MiscContainer:
        for (const ch of (c as VM.MiscContainer).children || []) visit(ch, depth + 1);
        break;
    }
  };
  for (const ch of root.children || []) visit(ch, 0);
  return out;
}
