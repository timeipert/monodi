import { ChangeDetectionStrategy, Component, ViewEncapsulation, ElementRef, EventEmitter, Input, Output, ViewChild } from '@angular/core';
import { joinImageDefs, markdownToHtml, nextImageId, splitImageDefs, usedImageIds } from '../print/markdown';
import { rasterize } from '../print/image-loader';

type Mode = 'edit' | 'split' | 'preview';

/**
 * A plain text editor for Markdown with a toolbar, keyboard shortcuts and a live preview.
 * `valueChange` fires on every keystroke; `commit` when the text should be saved (leaving the
 * field, Ctrl/Cmd+S, switching to the preview).
 */
@Component({
  selector: 'app-markdown-editor',
  standalone: false,
  encapsulation: ViewEncapsulation.None,   // the preview's markup comes from innerHTML, so scoped styles would miss it
  changeDetection: ChangeDetectionStrategy.Default,
  template: `
  <div class="md-editor border rounded-3 bg-white">
    <div class="md-toolbar d-flex align-items-center flex-wrap gap-1 border-bottom px-2 py-1 bg-light">
      <div class="btn-group btn-group-sm" role="group" aria-label="Format">
        <button type="button" class="btn btn-outline-secondary" (click)="heading()" [disabled]="mode === 'preview'" title="Heading"><i class="bi bi-type-h2"></i></button>
        <button type="button" class="btn btn-outline-secondary" (click)="wrap('**')" [disabled]="mode === 'preview'" title="Bold (Ctrl+B)"><i class="bi bi-type-bold"></i></button>
        <button type="button" class="btn btn-outline-secondary" (click)="wrap('*')" [disabled]="mode === 'preview'" title="Italic (Ctrl+I)"><i class="bi bi-type-italic"></i></button>
        <button type="button" class="btn btn-outline-secondary" (click)="wrap('\`')" [disabled]="mode === 'preview'" title="Code"><i class="bi bi-code"></i></button>
      </div>
      <div class="btn-group btn-group-sm" role="group" aria-label="Blocks">
        <button type="button" class="btn btn-outline-secondary" (click)="prefixLines('- ')" [disabled]="mode === 'preview'" title="Bullet list"><i class="bi bi-list-ul"></i></button>
        <button type="button" class="btn btn-outline-secondary" (click)="prefixLines('1. ')" [disabled]="mode === 'preview'" title="Numbered list"><i class="bi bi-list-ol"></i></button>
        <button type="button" class="btn btn-outline-secondary" (click)="prefixLines('> ')" [disabled]="mode === 'preview'" title="Quote"><i class="bi bi-quote"></i></button>
        <button type="button" class="btn btn-outline-secondary" (click)="link()" [disabled]="mode === 'preview'" title="Link (Ctrl+K)"><i class="bi bi-link-45deg"></i></button>
      </div>
      <div class="btn-group btn-group-sm" role="group" aria-label="Insert">
        <button type="button" class="btn btn-outline-secondary" (click)="table()" [disabled]="mode === 'preview'" title="Insert a table"><i class="bi bi-table"></i></button>
        <button type="button" class="btn btn-outline-secondary" (click)="fileInput.click()" [disabled]="mode === 'preview' || busy" title="Insert an image (or paste / drop one into the text)"><i class="bi bi-image"></i></button>
      </div>
      <input #fileInput type="file" accept="image/*" multiple class="d-none" (change)="onFiles(fileInput.files); fileInput.value = ''">
      <div class="btn-group btn-group-sm ms-auto" role="group" aria-label="View">
        <button type="button" class="btn" [class.btn-secondary]="mode === 'edit'" [class.btn-outline-secondary]="mode !== 'edit'" (click)="setMode('edit')">Write</button>
        <button type="button" class="btn" [class.btn-secondary]="mode === 'split'" [class.btn-outline-secondary]="mode !== 'split'" (click)="setMode('split')">Side by side</button>
        <button type="button" class="btn" [class.btn-secondary]="mode === 'preview'" [class.btn-outline-secondary]="mode !== 'preview'" (click)="setMode('preview')">Preview</button>
      </div>
    </div>
    <div class="md-panes" [class.md-split]="mode === 'split'">
      @if (mode !== 'preview') {
        <textarea #ta class="md-input form-control border-0 rounded-0 shadow-none" spellcheck="true"
          [ngModel]="body" (ngModelChange)="onInput($event)" (blur)="commit.emit()" (keydown)="onKey($event)"
          (paste)="onPaste($event)" (dragover)="$event.preventDefault()" (drop)="onDrop($event)"
          [attr.aria-label]="label" [placeholder]="placeholder"></textarea>
      }
      @if (mode !== 'edit') {
        <div class="md-preview p-3" [innerHTML]="html">
        </div>
      }
    </div>
    @if (images.length || error) {
      <div class="border-top px-2 py-2 bg-light d-flex flex-wrap align-items-center gap-2">
        @for (im of images; track im.id) {
          <div class="md-thumb position-relative border rounded bg-white" [title]="im.id">
            <img [src]="im.src" [alt]="im.id">
            <button type="button" class="btn btn-sm btn-light border position-absolute top-0 end-0 py-0 px-1 lh-1" (click)="removeImage(im.id)" title="Remove this image" aria-label="Remove image"><i class="bi bi-x"></i></button>
          </div>
        }
        @if (error) { <span class="small text-danger">{{error}}</span> }
      </div>
    }
  </div>`,
  styles: [`
    .md-input { min-height: 22rem; height: 100%; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .88rem; line-height: 1.5; }
    .md-panes { display: block; }
    .md-panes.md-split { display: grid; grid-template-columns: 1fr 1fr; }
    .md-split .md-preview { border-left: 1px solid #dee2e6; }
    .md-preview { min-height: 22rem; max-height: 60vh; overflow: auto; }
    .md-preview:empty::before { content: 'Nothing to preview yet.'; color: #9ca3af; }
    .md-preview h2 { font-size: 1.35rem; margin-top: 1.1rem; }
    .md-preview h3 { font-size: 1.15rem; margin-top: 1rem; }
    .md-preview h4, .md-preview h5, .md-preview h6 { font-size: 1rem; margin-top: .9rem; }
    .md-thumb { width: 72px; height: 54px; display: flex; align-items: center; justify-content: center; overflow: hidden; }
    .md-thumb img { max-width: 100%; max-height: 100%; }
    .md-preview img { max-width: 100%; height: auto; }
    .md-preview figure { text-align: center; margin: 1rem 0; }
    .md-preview figcaption { font-size: .85rem; color: #6b7280; font-style: italic; }
    .md-preview .md-table-wrap { overflow-x: auto; margin: .75rem 0; }
    .md-preview table { border-collapse: collapse; font-size: .92rem; }
    .md-preview th, .md-preview td { border: 1px solid #e5e7eb; padding: .25rem .6rem; vertical-align: top; }
    .md-preview th { background: #f9fafb; }
    .md-preview blockquote { border-left: 3px solid #d1d5db; margin-left: 0; padding-left: .9rem; color: #4b5563; }
    .md-preview pre { background: #f3f4f6; padding: .6rem .8rem; border-radius: .4rem; }
    .md-preview code { background: #f3f4f6; padding: 0 .25rem; border-radius: .25rem; }
    .md-preview pre code { background: none; padding: 0; }
    @media (max-width: 800px) { .md-panes.md-split { grid-template-columns: 1fr; } .md-split .md-preview { border-left: 0; border-top: 1px solid #dee2e6; } }
  `],
})
export class MarkdownEditorComponent {
  /** The whole text: what the user writes plus the hidden definitions of embedded images. */
  @Input() set value(v: string | null | undefined) {
    if ((v ?? '') === this._value) return;
    this._value = v ?? '';
    const sp = splitImageDefs(this._value);
    this.body = sp.body;
    this.defs = sp.defs;
    this.refresh();
  }
  get value(): string { return this._value; }
  @Input() placeholder = 'Write in Markdown …';
  @Input() label = 'Markdown text';
  @Output() valueChange = new EventEmitter<string>();
  @Output() commit = new EventEmitter<void>();
  @ViewChild('ta') ta?: ElementRef<HTMLTextAreaElement>;

  mode: Mode = 'edit';
  html = '';
  /** The text as shown in the editor: without the (very long) lines that carry the pictures. */
  body = '';
  images: { id: string; src: string }[] = [];
  busy = false;
  error = '';
  private defs: { [id: string]: string } = {};
  private _value = '';

  setMode(m: Mode): void {
    if (m === 'preview' && this.mode !== 'preview') this.commit.emit();
    this.mode = m;
  }

  onInput(text: string): void {
    this.body = text ?? '';
    this._value = joinImageDefs(this.body, this.defs);
    this.refresh();
    this.valueChange.emit(this._value);
  }

  private refresh(): void {
    this.html = markdownToHtml(this._value);
    this.images = usedImageIds(this.body, this.defs).map((id) => ({ id, src: this.defs[id].replace(/^\[[^\]]+\]:\s*/, '') }));
  }

  onKey(e: KeyboardEvent): void {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'b') { e.preventDefault(); this.wrap('**'); }
    else if (k === 'i') { e.preventDefault(); this.wrap('*'); }
    else if (k === 'k') { e.preventDefault(); this.link(); }
    else if (k === 's') { e.preventDefault(); this.commit.emit(); }
  }

  // ── editing helpers (all work on the textarea's selection) ──
  private edit(fn: (text: string, a: number, b: number) => { text: string; a: number; b: number }): void {
    const el = this.ta?.nativeElement;
    if (!el) return;
    const r = fn(el.value, el.selectionStart, el.selectionEnd);
    el.value = r.text;
    el.setSelectionRange(r.a, r.b);
    el.focus();
    this.onInput(r.text);
  }

  wrap(mark: string): void {
    this.edit((t, a, b) => {
      const sel = t.slice(a, b);
      if (sel.startsWith(mark) && sel.endsWith(mark) && sel.length >= 2 * mark.length) {
        return { text: t.slice(0, a) + sel.slice(mark.length, -mark.length) + t.slice(b), a, b: b - 2 * mark.length };
      }
      if (t.slice(a - mark.length, a) === mark && t.slice(b, b + mark.length) === mark) {
        return { text: t.slice(0, a - mark.length) + sel + t.slice(b + mark.length), a: a - mark.length, b: b - mark.length };
      }
      return { text: t.slice(0, a) + mark + sel + mark + t.slice(b), a: a + mark.length, b: b + mark.length };
    });
  }

  /** Whole lines of the selection. */
  private lineRange(t: string, a: number, b: number): [number, number] {
    const from = t.lastIndexOf('\n', a - 1) + 1;
    const nl = t.indexOf('\n', b);
    return [from, nl < 0 ? t.length : nl];
  }

  prefixLines(prefix: string): void {
    this.edit((t, a, b) => {
      const [from, to] = this.lineRange(t, a, b);
      const lines = t.slice(from, to).split('\n');
      const numbered = /^\d+\. $/.test(prefix);
      const markRe = numbered ? /^\d+\. / : new RegExp('^' + prefix.replace(/[-*+>]/g, '\\$&'));
      const allMarked = lines.every((l) => !l.trim() || markRe.test(l));
      let n = 0;
      const out = lines.map((l) => {
        if (!l.trim()) return l;
        if (allMarked) return l.replace(markRe, '');
        n++;
        return (numbered ? n + '. ' : prefix) + l.replace(/^(\d+\. |[-*+] |> )/, '');
      }).join('\n');
      return { text: t.slice(0, from) + out + t.slice(to), a: from, b: from + out.length };
    });
  }

  heading(): void {
    this.edit((t, a, b) => {
      const [from, to] = this.lineRange(t, a, b);
      const line = t.slice(from, to);
      const m = /^(#{1,5}) /.exec(line);
      const out = m ? '#'.repeat(m[1].length + 1) + ' ' + line.slice(m[0].length) : /^#{6} /.test(line) ? line.replace(/^#{6} /, '') : '# ' + line;
      return { text: t.slice(0, from) + out + t.slice(to), a: from, b: from + out.length };
    });
  }

  table(): void {
    this.edit((t, a, b) => {
      const tpl = (a > 0 && t[a - 1] !== '\n' ? '\n\n' : '') + '| Column 1 | Column 2 |\n| --- | --- |\n| Cell | Cell |\n';
      const sel = tpl.indexOf('Column 1');
      return { text: t.slice(0, a) + tpl + t.slice(b), a: a + sel, b: a + sel + 8 };
    });
  }

  // ── pictures: shrunk, embedded below the text as reference definitions, referenced where they stand ──
  onFiles(files: FileList | File[] | null): void {
    const list = Array.from(files ?? []).filter((f) => f.type.startsWith('image/'));
    if (list.length) void this.addImages(list);
  }

  onPaste(e: ClipboardEvent): void {
    const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    e.preventDefault();
    void this.addImages(files);
  }

  onDrop(e: DragEvent): void {
    const files = Array.from(e.dataTransfer?.files ?? []).filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    e.preventDefault();
    void this.addImages(files);
  }

  private async addImages(files: File[]): Promise<void> {
    this.busy = true;
    this.error = '';
    try {
      const refs: string[] = [];
      for (const f of files) {
        const img = await rasterize(f, 1400);
        const id = nextImageId(this.defs);
        this.defs[id] = `[${id}]: ${img.data}`;
        const alt = (f.name || 'Image').replace(/\.[^.]+$/, '').replace(/[\[\]]/g, '') || 'Image';
        refs.push(`![${alt}][${id}]`);
      }
      // on a blank line where the cursor stands, else after the paragraph or table it is in (never inside)
      this.edit((t, _a, sel) => {
        const lineStart = t.lastIndexOf('\n', sel - 1) + 1;
        const lineEnd = t.indexOf('\n', sel) < 0 ? t.length : t.indexOf('\n', sel);
        let at = sel;
        if (t.slice(lineStart, lineEnd).trim()) {
          const gap = t.indexOf('\n\n', sel);
          at = gap < 0 ? t.length : gap;
        }
        const before = t.slice(0, at).replace(/[ \t]+$/, '');
        const after = t.slice(at).replace(/^\n+/, '');
        const ins = (before && !before.endsWith('\n\n') ? (before.endsWith('\n') ? '\n' : '\n\n') : '') + refs.join('\n\n') + '\n' + (after ? '\n' : '');
        const text = before + ins + after;
        return { text, a: before.length + ins.length, b: before.length + ins.length };
      });
    } catch (err: any) {
      this.error = err?.message || 'The image could not be added.';
    } finally {
      this.busy = false;
    }
  }

  removeImage(id: string): void {
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const text = this.body.replace(new RegExp('!?\\[[^\\]]*\\]\\[' + esc + '\\]\\n?', 'gi'), '');
    delete this.defs[id];
    this.onInput(text);
    this.commit.emit();
  }

  link(): void {
    this.edit((t, a, b) => {
      const sel = t.slice(a, b) || 'text';
      const ins = '[' + sel + '](https://)';
      const urlStart = a + sel.length + 3;
      return { text: t.slice(0, a) + ins + t.slice(b), a: urlStart, b: urlStart + 8 };
    });
  }
}
