import { Injectable } from '@angular/core';
import * as VM from '../types/model';
import { spacedToString } from '../notes/notes.component';
import { musicLanguage } from '../notes/language';

export interface SearchReplaceScope {
  syllables: boolean;
  notes: boolean;
  paratext: boolean;
}

export interface SearchReplaceOptions {
  query: string;
  replaceWith: string;
  matchCase: boolean;
  matchWholeWord: boolean;
  scope: SearchReplaceScope;
}

export interface SearchMatch {
  id: string;
  scope: 'syllables' | 'notes' | 'paratext';
  containerUuid: string;
  targetUuid: string;
  voiceIndex?: number;
  startIndex: number;
  endIndex: number;
  matchedText: string;
  fullOriginalText: string;
  fullReplacedText: string;
  contextSnippet: string;
}

@Injectable({
  providedIn: 'root'
})
export class SearchReplaceService {

  buildRegex(query: string, matchCase: boolean, matchWholeWord: boolean): RegExp | null {
    if (!query) return null;
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = matchWholeWord ? `\\b${escaped}\\b` : escaped;
    const flags = matchCase ? 'g' : 'gi';
    try {
      return new RegExp(pattern, flags);
    } catch {
      return null;
    }
  }

  findMatches(root: VM.RootContainer, options: SearchReplaceOptions): SearchMatch[] {
    const matches: SearchMatch[] = [];
    if (!root || !options.query) return matches;

    const regex = this.buildRegex(options.query, options.matchCase, options.matchWholeWord);
    if (!regex) return matches;

    const processText = (
      text: string,
      scope: 'syllables' | 'notes' | 'paratext',
      containerUuid: string,
      targetUuid: string,
      voiceIndex?: number
    ) => {
      if (!text) return;
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(text)) !== null) {
        const start = match.index;
        const end = match.index + match[0].length;
        const matchedText = match[0];
        const snippetStart = Math.max(0, start - 15);
        const snippetEnd = Math.min(text.length, end + 15);
        const snippet = (snippetStart > 0 ? '…' : '') +
          text.substring(snippetStart, snippetEnd) +
          (snippetEnd < text.length ? '…' : '');

        const replaced = text.substring(0, start) + options.replaceWith + text.substring(end);

        matches.push({
          id: `${targetUuid}_${scope}_${voiceIndex ?? 0}_${start}`,
          scope,
          containerUuid,
          targetUuid,
          voiceIndex,
          startIndex: start,
          endIndex: end,
          matchedText,
          fullOriginalText: text,
          fullReplacedText: replaced,
          contextSnippet: snippet
        });

        // Avoid infinite loop on zero-length matches
        if (match.index === regex.lastIndex) {
          regex.lastIndex++;
        }
      }
    };

    const traverse = (node: any, currentContainerUuid: string) => {
      if (!node) return;

      if (node.kind === VM.ContainerKind.ParatextContainer) {
        if (options.scope.paratext) {
          processText(node.text || '', 'paratext', node.uuid, node.uuid);
        }
        return;
      }

      if (node.kind === VM.ContainerKind.FormteilContainer && node.data && Array.isArray(node.data)) {
        if (options.scope.syllables || options.scope.paratext) {
          for (let i = 0; i < node.data.length; i++) {
            const d = node.data[i];
            if (d && typeof d.data === 'string') {
              processText(d.data, options.scope.syllables ? 'syllables' : 'paratext', node.uuid, `${node.uuid}_data_${i}`);
            }
          }
        }
      }

      if (node.kind === VM.LinePartKind.FolioChange && options.scope.syllables && node.text) {
        processText(node.text, 'syllables', currentContainerUuid, node.uuid);
        return;
      }

      if (node.kind === VM.LinePartKind.Syllable) {
        if (options.scope.syllables) {
          processText(node.text || '', 'syllables', currentContainerUuid, node.uuid);
        }
        if (options.scope.notes) {
          if (node.notes) {
            const noteText = spacedToString(node.notes);
            processText(noteText, 'notes', currentContainerUuid, node.uuid, 0);
          }
          if (node.additionalMelodies && Array.isArray(node.additionalMelodies)) {
            node.additionalMelodies.forEach((mel: VM.Spaced, idx: number) => {
              const melText = spacedToString(mel);
              processText(melText, 'notes', currentContainerUuid, node.uuid, idx + 1);
            });
          }
        }
        return;
      }

      const containerUuid = node.uuid || currentContainerUuid;

      if (node.children && Array.isArray(node.children)) {
        for (const child of node.children) {
          traverse(child, containerUuid);
        }
      }
      if (node.parts && Array.isArray(node.parts)) {
        for (const part of node.parts) {
          traverse(part, containerUuid);
        }
      }
    };

    traverse(root, root.uuid);
    return matches;
  }

  replaceSingleMatch(
    root: VM.RootContainer,
    match: SearchMatch,
    replaceWith: string
  ): { success: boolean; error?: string } {
    let replaced = false;
    let errorMsg: string | undefined;

    const traverse = (node: any) => {
      if (replaced || !node) return;

      if (node.kind === VM.ContainerKind.ParatextContainer && node.uuid === match.targetUuid) {
        if (match.scope === 'paratext') {
          const orig = node.text || '';
          node.text = orig.substring(0, match.startIndex) + replaceWith + orig.substring(match.endIndex);
          replaced = true;
        }
        return;
      }

      if (node.kind === VM.ContainerKind.FormteilContainer && node.data && Array.isArray(node.data)) {
        for (let i = 0; i < node.data.length; i++) {
          if (`${node.uuid}_data_${i}` === match.targetUuid) {
            const orig = node.data[i].data || '';
            node.data[i].data = orig.substring(0, match.startIndex) + replaceWith + orig.substring(match.endIndex);
            replaced = true;
            return;
          }
        }
      }

      if (node.kind === VM.LinePartKind.FolioChange && node.uuid === match.targetUuid) {
        const orig = node.text || '';
        node.text = orig.substring(0, match.startIndex) + replaceWith + orig.substring(match.endIndex);
        replaced = true;
        return;
      }

      if (node.kind === VM.LinePartKind.Syllable && node.uuid === match.targetUuid) {
        if (match.scope === 'syllables') {
          const orig = node.text || '';
          node.text = orig.substring(0, match.startIndex) + replaceWith + orig.substring(match.endIndex);
          replaced = true;
          return;
        }

        if (match.scope === 'notes') {
          const voiceIdx = match.voiceIndex ?? 0;
          let targetSpaced: VM.Spaced | undefined;
          if (voiceIdx === 0) {
            targetSpaced = node.notes;
          } else if (node.additionalMelodies && node.additionalMelodies[voiceIdx - 1]) {
            targetSpaced = node.additionalMelodies[voiceIdx - 1];
          }

          if (targetSpaced) {
            const origNoteText = spacedToString(targetSpaced);
            const newNoteText = origNoteText.substring(0, match.startIndex) + replaceWith + origNoteText.substring(match.endIndex);
            
            const parseRes = musicLanguage.Spaced.parse(newNoteText);
            if (parseRes.status) {
              if (voiceIdx === 0) {
                node.notes = parseRes.value;
              } else {
                node.additionalMelodies[voiceIdx - 1] = parseRes.value;
              }
              replaced = true;
            } else {
              errorMsg = `Invalid note syntax in replacement: "${newNoteText}"`;
            }
          }
          return;
        }
      }

      if (node.children && Array.isArray(node.children)) {
        for (const child of node.children) {
          traverse(child);
          if (replaced) return;
        }
      }
      if (node.parts && Array.isArray(node.parts)) {
        for (const part of node.parts) {
          traverse(part);
          if (replaced) return;
        }
      }
    };

    traverse(root);

    if (errorMsg) {
      return { success: false, error: errorMsg };
    }
    return { success: replaced };
  }

  replaceAll(
    root: VM.RootContainer,
    options: SearchReplaceOptions
  ): { replacedCount: number; errors: string[] } {
    let replacedCount = 0;
    const errors: string[] = [];

    const regex = this.buildRegex(options.query, options.matchCase, options.matchWholeWord);
    if (!regex) return { replacedCount, errors };

    const replaceText = (text: string): { newText: string; count: number } => {
      let count = 0;
      regex.lastIndex = 0;
      const newText = text.replace(regex, () => {
        count++;
        return options.replaceWith;
      });
      return { newText, count };
    };

    const traverse = (node: any) => {
      if (!node) return;

      if (node.kind === VM.ContainerKind.ParatextContainer) {
        if (options.scope.paratext && node.text) {
          const res = replaceText(node.text);
          if (res.count > 0) {
            node.text = res.newText;
            replacedCount += res.count;
          }
        }
        return;
      }

      if (node.kind === VM.ContainerKind.FormteilContainer && node.data && Array.isArray(node.data)) {
        if (options.scope.syllables || options.scope.paratext) {
          for (const d of node.data) {
            if (d && d.data) {
              const res = replaceText(d.data);
              if (res.count > 0) {
                d.data = res.newText;
                replacedCount += res.count;
              }
            }
          }
        }
      }

      if (node.kind === VM.LinePartKind.FolioChange && options.scope.syllables && node.text) {
        const res = replaceText(node.text);
        if (res.count > 0) {
          node.text = res.newText;
          replacedCount += res.count;
        }
      }

      if (node.kind === VM.LinePartKind.Syllable) {
        if (options.scope.syllables && node.text) {
          const res = replaceText(node.text);
          if (res.count > 0) {
            node.text = res.newText;
            replacedCount += res.count;
          }
        }

        if (options.scope.notes) {
          if (node.notes) {
            const origNoteText = spacedToString(node.notes);
            const res = replaceText(origNoteText);
            if (res.count > 0) {
              const parsed = musicLanguage.Spaced.parse(res.newText);
              if (parsed.status) {
                node.notes = parsed.value;
                replacedCount += res.count;
              } else {
                errors.push(`Could not parse replacement note string "${res.newText}" in syllable "${node.text}"`);
              }
            }
          }

          if (node.additionalMelodies && Array.isArray(node.additionalMelodies)) {
            for (let i = 0; i < node.additionalMelodies.length; i++) {
              const origNoteText = spacedToString(node.additionalMelodies[i]);
              const res = replaceText(origNoteText);
              if (res.count > 0) {
                const parsed = musicLanguage.Spaced.parse(res.newText);
                if (parsed.status) {
                  node.additionalMelodies[i] = parsed.value;
                  replacedCount += res.count;
                } else {
                  errors.push(`Could not parse replacement in additional melody voice ${i + 1}`);
                }
              }
            }
          }
        }
        return;
      }

      if (node.children && Array.isArray(node.children)) {
        for (const child of node.children) {
          traverse(child);
        }
      }
      if (node.parts && Array.isArray(node.parts)) {
        for (const part of node.parts) {
          traverse(part);
        }
      }
    };

    traverse(root);
    return { replacedCount, errors };
  }
}
