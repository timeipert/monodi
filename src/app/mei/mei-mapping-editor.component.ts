import { Component, Input, Output, EventEmitter, OnInit, OnDestroy } from '@angular/core';
import { Subject, Subscription } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { APIService, ProjectSettings, Document as MonodiDocument } from '../api.service';
import { UserService } from '../user.service';
import { ToastrService } from 'ngx-toastr';
import { v4 as uuidv4 } from 'uuid';
import { MeiMappingProfileV2, defaultMeiProfile, ENTITY_FIELDS, MEI_ELEMENT_SUGGESTIONS, MeiEntityKey, MeiEntityRule } from './mei-mapping.model';
import { emitMei } from './mei-emitter';
import { SAMPLE_DOCUMENT, SAMPLE_META } from './mei-sample';
import { validateMeiProfile, MeiValidationError } from './mei-validation';
import { RootContainer, ContainerKind, LinePartKind } from '../types/model';

/** Above this syllable count the preview is truncated to the first N lines so
 *  a large chant doesn't freeze the debounced live-preview render. */
const PREVIEW_SYLLABLE_LIMIT = 40;
const PREVIEW_MAX_ZEILEN = 2;

@Component({
    selector: 'app-mei-mapping-editor',
    templateUrl: './mei-mapping-editor.component.html',
    styleUrls: ['./mei-mapping-editor.component.css'],
    standalone: false
})
export class MeiMappingEditorComponent implements OnInit, OnDestroy {
  @Input() settings!: ProjectSettings;
  @Output() settingsChange = new EventEmitter<void>();

  selectedNodeId: string = 'skeleton';
  entityFields = ENTITY_FIELDS;
  meiSuggestions = MEI_ELEMENT_SUGGESTIONS;
  commonAttributes = ['pname', 'oct', 'line', 'shape', 'curve', 'con', 'type', 'n', 'xml:id', 'startid', 'endid', 'corresp'];
  
  previewXml: string = '';
  validationErrors: MeiValidationError[] = [];

  // --- Preview source (built-in sample vs. a real workspace document) ---
  /** Selected preview source: 'sample' or a document id. */
  previewSourceId: string = 'sample';
  /** Workspace documents offered in the source selector; loaded lazily. */
  documentList: MonodiDocument[] = [];
  private documentsLoaded = false;
  loadingDocList = false;
  /** True while the chosen document's notes are being fetched. */
  loadingPreviewDoc = false;
  /** True when the preview was shortened for a very large document. */
  previewTruncated = false;

  /** The document currently feeding the preview (defaults to the sample). */
  private previewRoot: RootContainer = SAMPLE_DOCUMENT;
  private previewMeta: MonodiDocument = SAMPLE_META;

  /** Cache of the last fetched document so profile edits never refetch and
   *  re-selecting the same document is instant. */
  private cachedDocId: string | null = null;
  private cachedRoot: RootContainer | null = null;
  private cachedMeta: MonodiDocument | null = null;

  private token: string | null = null;
  private userSub?: Subscription;

  /** Two-click arm state for the per-entity "reset to default" action. */
  armedResetEntity: MeiEntityKey | null = null;
  private resetArmTimeout: any;

  /** Stable reference to the pristine default profile, used to detect and
   *  revert deviations. Never mutated. */
  private readonly defaultProfile: MeiMappingProfileV2 = defaultMeiProfile();

  /** Memoized "differs from default" results. Invalidated on every mutation
   *  via emitChange(), so entries are recomputed lazily on next read. */
  private diffCache: { entities: Partial<Record<MeiEntityKey, boolean>>; skeleton?: boolean } = { entities: {} };

  private settingsChange$ = new Subject<void>();

  constructor(
    private toastr: ToastrService,
    private api: APIService,
    private userService: UserService,
  ) {}

  ngOnInit() {
    this.settingsChange$.pipe(
      debounceTime(300)
    ).subscribe(() => {
      this.updatePreview();
      this.settingsChange.emit();
    });

    this.userSub = this.userService.user.subscribe(u => this.token = u?.token ?? null);

    // Initial preview load
    setTimeout(() => this.updatePreview(), 50);
  }

  ngOnDestroy() {
    this.settingsChange$.complete();
    this.userSub?.unsubscribe();
    clearTimeout(this.resetArmTimeout);
  }

  // --- Preview source selection ---

  /** Lazily load the workspace document list the first time the selector is
   *  opened. Notes are NOT fetched here — only the lightweight document list. */
  ensureDocListLoaded() {
    if (this.documentsLoaded || this.loadingDocList) return;
    this.loadingDocList = true;
    this.api.listDocuments(this.token || '').subscribe({
      next: (res) => {
        if (res.kind === 'DocumentsRetrieved') {
          this.documentList = res.documents;
          this.documentsLoaded = true;
        }
        this.loadingDocList = false;
      },
      error: () => { this.loadingDocList = false; }
    });
  }

  /** Label for a document option in the source selector. */
  docLabel(d: MonodiDocument): string {
    return d.dokumenten_id || d.textinitium || d.id;
  }

  onPreviewSourceChange(event: Event) {
    const val = (event.target as HTMLSelectElement).value;
    this.previewSourceId = val;

    if (val === 'sample') {
      this.previewRoot = SAMPLE_DOCUMENT;
      this.previewMeta = SAMPLE_META;
      this.updatePreview();
      return;
    }

    // Serve from cache when re-selecting the same document.
    if (this.cachedDocId === val && this.cachedRoot && this.cachedMeta) {
      this.previewRoot = this.cachedRoot;
      this.previewMeta = this.cachedMeta;
      this.updatePreview();
      return;
    }

    const doc = this.documentList.find(d => d.id === val);
    if (!doc) { this.fallbackToSample('Document not found.'); return; }

    this.loadingPreviewDoc = true;
    this.api.getDocumentNotes(this.token || '', val).subscribe({
      next: (res) => {
        this.loadingPreviewDoc = false;
        if (res.kind === 'NotesRetrieved' && res.data) {
          this.previewRoot = res.data as RootContainer;
          this.previewMeta = doc;
          this.cachedDocId = val;
          this.cachedRoot = res.data as RootContainer;
          this.cachedMeta = doc;
          this.updatePreview();
        } else {
          this.fallbackToSample('This document has no transcription yet.');
        }
      },
      error: () => {
        this.loadingPreviewDoc = false;
        this.fallbackToSample('Failed to load the document transcription.');
      }
    });
  }

  private fallbackToSample(message: string) {
    this.toastr.warning(message);
    this.previewSourceId = 'sample';
    this.previewRoot = SAMPLE_DOCUMENT;
    this.previewMeta = SAMPLE_META;
    this.updatePreview();
  }

  /** Total syllable count across the whole container tree. */
  private countSyllables(node: any): number {
    if (!node) return 0;
    if (node.kind === ContainerKind.ZeileContainer) {
      return (node.children || []).filter((c: any) => c.kind === LinePartKind.Syllable).length;
    }
    if (node.children) {
      return node.children.reduce((sum: number, c: any) => sum + this.countSyllables(c), 0);
    }
    return 0;
  }

  /** Build a shallow-copied RootContainer keeping only the first `maxZeilen`
   *  Zeile containers (in document order). The original is never mutated. */
  private truncateRoot(root: RootContainer, maxZeilen: number): RootContainer {
    const state = { zeilen: 0 };
    const cloneChildren = (children: any[]): any[] => {
      const out: any[] = [];
      for (const child of children) {
        if (state.zeilen >= maxZeilen) break;
        if (child.kind === ContainerKind.ZeileContainer) {
          out.push(child); // by reference; read-only in emitMei
          state.zeilen++;
        } else if (child.children) {
          // structural container (Formteil/Misc) — recurse, keep if non-empty
          const kept = cloneChildren(child.children);
          if (kept.length > 0) out.push({ ...child, children: kept });
        } else {
          // leaf container (e.g. Paratext) appearing before the cutoff
          out.push(child);
        }
      }
      return out;
    };
    return { ...root, children: cloneChildren(root.children) };
  }

  get activeProfile(): MeiMappingProfileV2 | undefined {
    if (!this.settings || !this.settings.meiProfiles) return undefined;
    return this.settings.meiProfiles.find(p => p.id === this.settings.activeMeiProfileId);
  }

  onProfileChange(event: any) {
    const id = event.target.value;
    if (this.settings && id) {
      this.settings.activeMeiProfileId = id;
      this.emitChange(true); // immediate
    }
  }

  emitChange(immediate: boolean = false) {
    // Any mutation invalidates the diff cache so the "modified" indicators
    // recompute on their next read (synchronously, before the debounce).
    this.diffCache = { entities: {} };
    if (immediate) {
      this.settingsChange.emit();
    } else {
      this.settingsChange$.next();
    }
  }

  selectNode(id: string) {
    this.selectedNodeId = id;
    this.armedResetEntity = null; // never carry an armed reset across nodes
  }

  // --- Deviation detection (memoized) ---

  /** Deterministic stringify with sorted object keys, so two structurally
   *  equal rules compare equal regardless of property order. */
  private stableStringify(obj: any): string {
    if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
    if (Array.isArray(obj)) return '[' + obj.map(x => this.stableStringify(x)).join(',') + ']';
    const keys = Object.keys(obj).sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + this.stableStringify(obj[k])).join(',') + '}';
  }

  /** True if the active profile's rule for `key` differs from the default. */
  entityDiffers(key: MeiEntityKey): boolean {
    const profile = this.activeProfile;
    if (!profile) return false;
    if (this.diffCache.entities[key] === undefined) {
      this.diffCache.entities[key] =
        this.stableStringify(profile.entities[key]) !== this.stableStringify(this.defaultProfile.entities[key]);
    }
    return this.diffCache.entities[key]!;
  }

  /** True if the skeleton chain or the header toggle differs from the default. */
  skeletonDiffers(): boolean {
    const profile = this.activeProfile;
    if (!profile) return false;
      this.diffCache.skeleton =
        this.stableStringify(profile.skeleton) !== this.stableStringify(this.defaultProfile.skeleton) ||
        profile.emitHeader !== this.defaultProfile.emitHeader ||
        profile.inlineInterventions !== this.defaultProfile.inlineInterventions;
    return this.diffCache.skeleton;
  }

  /** Convenience for the rule editor: does the currently selected entity differ? */
  get selectedEntityDiffers(): boolean {
    if (this.selectedNodeId === 'skeleton') return false;
    return this.entityDiffers(this.selectedNodeId as MeiEntityKey);
  }

  /** Two-click revert of only the selected entity's rule to the default. */
  resetEntityToDefault() {
    if (!this.activeProfile || this.selectedNodeId === 'skeleton') return;
    const key = this.selectedNodeId as MeiEntityKey;

    if (this.armedResetEntity !== key) {
      // First click — arm, auto-disarm after a few seconds.
      this.armedResetEntity = key;
      clearTimeout(this.resetArmTimeout);
      this.resetArmTimeout = setTimeout(() => { this.armedResetEntity = null; }, 4000);
      return;
    }

    // Second click — execute.
    clearTimeout(this.resetArmTimeout);
    this.armedResetEntity = null;
    this.activeProfile.entities[key] = JSON.parse(JSON.stringify(this.defaultProfile.entities[key]));
    this.emitChange(true);
    this.toastr.success(`"${key}" reset to default.`);
  }

  get activeRule(): MeiEntityRule | undefined {
    if (!this.activeProfile || this.selectedNodeId === 'skeleton') return undefined;
    return this.activeProfile.entities[this.selectedNodeId as MeiEntityKey];
  }

  // --- Live Preview & Validation ---

  private formatXml(node: Node, indentStr: string = '  ', currentIndent: string = ''): string {
    if (node.nodeType === Node.TEXT_NODE) {
      return (node.nodeValue || '').trim();
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    let result = currentIndent + `<${node.nodeName}`;
    const el = node as Element;
    
    for (let i = 0; i < el.attributes.length; i++) {
      const attr = el.attributes[i];
      result += ` ${attr.name}="${attr.value}"`;
    }

    if (node.childNodes.length === 0) {
      return result + '/>';
    }

    let hasElementChildren = false;
    let childrenContent = '';

    for (let i = 0; i < node.childNodes.length; i++) {
      const child = node.childNodes[i];
      if (child.nodeType === Node.ELEMENT_NODE) {
        hasElementChildren = true;
        childrenContent += '\n' + this.formatXml(child, indentStr, currentIndent + indentStr);
      } else if (child.nodeType === Node.TEXT_NODE) {
        childrenContent += (child.nodeValue || '').trim();
      }
    }

    if (hasElementChildren) {
      result += `>${childrenContent}\n${currentIndent}</${node.nodeName}>`;
    } else {
      result += `>${childrenContent}</${node.nodeName}>`;
    }

    return result;
  }

  updatePreview() {
    this.validationErrors = [];
    if (!this.activeProfile) return;

    // 1. Model Validation
    this.validationErrors.push(...validateMeiProfile(this.activeProfile));

    // Guard very large documents so the debounced render stays snappy.
    let root = this.previewRoot;
    this.previewTruncated = false;
    if (this.countSyllables(root) > PREVIEW_SYLLABLE_LIMIT) {
      root = this.truncateRoot(root, PREVIEW_MAX_ZEILEN);
      this.previewTruncated = true;
    }

    // 2. Execution Validation
    let rawXml = '';
    try {
      rawXml = emitMei(root, this.activeProfile, this.previewMeta);
    } catch (e: any) {
      this.validationErrors.push({ message: `Emitter crashed: ${e.message}`, isError: true });
      this.previewXml = '<!-- Output suppressed due to emitter crash -->';
      return;
    }

    // 3. XML Parser Validation
    const parser = new DOMParser();
    const doc = parser.parseFromString(rawXml, 'application/xml');
    const parserError = doc.querySelector('parsererror');
    if (parserError) {
      this.validationErrors.push({ message: 'Generated MEI contains invalid XML structure.', isError: true });
      this.previewXml = '<!-- Output suppressed due to malformed XML structure -->\n\n' + rawXml;
      return;
    }

    // Success -> format and display
    this.previewXml = this.formatXml(doc.documentElement);
  }

  copyXml() {
    if (this.previewXml) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(this.previewXml).then(() => {
          this.toastr.success('XML copied to clipboard!');
        }).catch(() => {
          this.toastr.error('Failed to copy XML.');
        });
      } else {
        this.toastr.error('Clipboard API not supported on this origin (requires HTTPS or secure context).');
      }
    }
  }

  // --- Rule Editor Helpers ---

  addWrapper(value: string) {
    const val = value.trim();
    if (!val) return;
    
    if (this.selectedNodeId === 'skeleton' && this.activeProfile) {
      this.activeProfile.skeleton.push(val);
      this.emitChange();
    } else if (this.activeRule) {
      this.activeRule.wrappers.push(val);
      this.emitChange();
    }
  }

  removeWrapper(index: number) {
    if (this.selectedNodeId === 'skeleton' && this.activeProfile) {
      this.activeProfile.skeleton.splice(index, 1);
      this.emitChange();
    } else if (this.activeRule) {
      this.activeRule.wrappers.splice(index, 1);
      this.emitChange();
    }
  }

  moveWrapper(index: number, direction: -1 | 1) {
    const arr = this.selectedNodeId === 'skeleton' && this.activeProfile 
      ? this.activeProfile.skeleton 
      : this.activeRule?.wrappers;
      
    if (arr && index >= 0 && index < arr.length && index + direction >= 0 && index + direction < arr.length) {
      const temp = arr[index];
      arr[index] = arr[index + direction];
      arr[index + direction] = temp;
      this.emitChange();
    }
  }

  addAttribute() {
    if (this.activeRule) {
      this.activeRule.attributes.push({ name: '', source: 'static', value: '' });
      this.emitChange();
    }
  }

  removeAttribute(index: number) {
    if (this.activeRule) {
      this.activeRule.attributes.splice(index, 1);
      this.emitChange();
    }
  }

  // --- Profile Actions ---

  onNewProfile() {
    const name = window.prompt('Enter name for the new profile:');
    if (name && name.trim().length > 0) {
      const newProfile = defaultMeiProfile();
      newProfile.id = uuidv4();
      newProfile.name = name.trim();
      
      this.settings.meiProfiles = this.settings.meiProfiles || [];
      this.settings.meiProfiles.push(newProfile);
      this.settings.activeMeiProfileId = newProfile.id;
      this.emitChange(true);
      this.toastr.success(`Profile "${newProfile.name}" created.`);
    }
  }

  onDuplicateProfile() {
    if (!this.activeProfile) return;
    
    const name = window.prompt('Enter name for the duplicated profile:', `${this.activeProfile.name} (Copy)`);
    if (name && name.trim().length > 0) {
      // Deep copy the active profile
      const duplicatedProfile: MeiMappingProfileV2 = JSON.parse(JSON.stringify(this.activeProfile));
      duplicatedProfile.id = uuidv4();
      duplicatedProfile.name = name.trim();
      
      this.settings.meiProfiles?.push(duplicatedProfile);
      this.settings.activeMeiProfileId = duplicatedProfile.id;
      this.emitChange(true);
      this.toastr.success(`Profile duplicated as "${duplicatedProfile.name}".`);
    }
  }

  onRenameProfile() {
    if (!this.activeProfile) return;
    
    const name = window.prompt('Rename profile:', this.activeProfile.name);
    if (name && name.trim().length > 0 && name !== this.activeProfile.name) {
      this.activeProfile.name = name.trim();
      this.emitChange(true);
    }
  }

  onDeleteProfile() {
    if (!this.activeProfile || !this.settings.meiProfiles) return;
    
    if (window.confirm(`Are you sure you want to delete the profile "${this.activeProfile.name}"?`)) {
      const idx = this.settings.meiProfiles.findIndex(p => p.id === this.settings.activeMeiProfileId);
      if (idx !== -1) {
        this.settings.meiProfiles.splice(idx, 1);
        
        if (this.settings.meiProfiles.length === 0) {
          // Recreate default
          const def = defaultMeiProfile();
          this.settings.meiProfiles.push(def);
          this.settings.activeMeiProfileId = def.id;
        } else {
          // Switch to first available
          this.settings.activeMeiProfileId = this.settings.meiProfiles[0].id;
        }
        this.emitChange(true);
        this.toastr.success('Profile deleted.');
      }
    }
  }

  onResetProfile() {
    if (!this.activeProfile) return;
    
    if (window.confirm(`Are you sure you want to reset "${this.activeProfile.name}" to defaults? This cannot be undone.`)) {
      const def = defaultMeiProfile();
      this.activeProfile.entities = JSON.parse(JSON.stringify(def.entities));
      this.activeProfile.skeleton = JSON.parse(JSON.stringify(def.skeleton));
      this.activeProfile.emitHeader = def.emitHeader;
      this.activeProfile.inlineInterventions = def.inlineInterventions;
      this.emitChange(true);
      this.toastr.success('Profile reset to defaults.');
    }
  }

  onExportProfile() {
    if (!this.activeProfile) return;
    
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(this.activeProfile, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", `mei-profile-${this.activeProfile.name.replace(/\\s+/g, '-').toLowerCase()}.json`);
    document.body.appendChild(downloadAnchorNode); // required for firefox
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  }

  onImportProfile(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    
    const file = input.files[0];
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const parsed = JSON.parse(content);
        
        if (parsed.version !== 2 || !parsed.entities || !parsed.skeleton) {
          throw new Error("Invalid profile format: Missing 'version: 2', 'entities', or 'skeleton'.");
        }
        
        const requiredEntities = ['syllable', 'neume', 'note', 'clef', 'liquescentElement', 'oriscus', 'quilisma', 'strophicus', 'sb', 'paratextContainer', 'commentTree'];
        for (const req of requiredEntities) {
          if (!parsed.entities[req]) {
            throw new Error(`Invalid profile format: Missing entity configuration for "${req}".`);
          }
        }
        
        const newProfile: MeiMappingProfileV2 = parsed;
        newProfile.id = uuidv4();
        
        const promptName = window.prompt("Enter name for the imported profile:", newProfile.name || "Imported Profile");
        if (promptName && promptName.trim().length > 0) {
          newProfile.name = promptName.trim();
        } else {
          input.value = ''; 
          return;
        }

        this.settings.meiProfiles = this.settings.meiProfiles || [];
        this.settings.meiProfiles.push(newProfile);
        this.settings.activeMeiProfileId = newProfile.id;
        
        this.emitChange(true);
        this.toastr.success(`Profile imported as "${newProfile.name}".`);
      } catch (err: any) {
        this.toastr.error(err.message || 'Error parsing imported profile file.');
      }
      
      input.value = '';
    };
    
    reader.readAsText(file);
  }
}
