import { Component, Input, Output, EventEmitter, OnInit, OnChanges, SimpleChanges } from '@angular/core';
import { Source } from '../../api.service';

export interface MetaField {
  key: string;
  label: string;
  type: 'source' | 'document' | 'custom_source' | 'custom_doc';
}

export interface MetaFilter {
  field: string;
  operator: 'contains' | 'equals' | 'startsWith' | 'endsWith' | 'empty' | 'notEmpty';
  value: string;
}

const STANDARD_FIELDS: MetaField[] = [
  { key: 'quellensigle', label: 'Source Siglum', type: 'source' },
  { key: 'herkunftsregion', label: 'Region of Origin', type: 'source' },
  { key: 'herkunftsort', label: 'Place of Origin', type: 'source' },
  { key: 'herkunftsinstitution', label: 'Institution', type: 'source' },
  { key: 'ordenstradition', label: 'Order Tradition', type: 'source' },
  { key: 'quellentyp', label: 'Source Type', type: 'source' },
  { key: 'bibliotheksort', label: 'Library Location', type: 'source' },
  { key: 'bibliothek', label: 'Library', type: 'source' },
  { key: 'bibliothekssignatur', label: 'Library Signature', type: 'source' },
  { key: 'kommentar', label: 'Source Comment', type: 'source' },
  { key: 'datierung', label: 'Dating', type: 'source' },
  
  { key: 'dokumenten_id', label: 'Document ID', type: 'document' },
  { key: 'gattung1', label: 'Genre 1', type: 'document' },
  { key: 'gattung2', label: 'Genre 2', type: 'document' },
  { key: 'festtag', label: 'Feast Day', type: 'document' },
  { key: 'feier', label: 'Feast', type: 'document' },
  { key: 'textinitium', label: 'Initium', type: 'document' },
  { key: 'bibliographischerverweis', label: 'Reference', type: 'document' },
  { key: 'druckausgabe', label: 'Print Edition', type: 'document' },
  { key: 'zeilenstart', label: 'Line Start', type: 'document' },
  { key: 'foliostart', label: 'Folio Start', type: 'document' },
  { key: 'kommentar', label: 'Document Comment', type: 'document' },
  { key: 'editionsstatus', label: 'Edition Status', type: 'document' }
];

@Component({
    selector: 'app-subcorpora-selector',
    templateUrl: './subcorpora-selector.component.html',
    styleUrls: ['./subcorpora-selector.component.css'],
    standalone: false
})
export class SubcorporaSelectorComponent implements OnInit, OnChanges {
  @Input() sources: Source[] = [];
  @Input() documents: any[] = [];
  
  @Output() selectionChange = new EventEmitter<{ selectedSources: Source[], selectedDocs: any[] }>();
  
  filters: MetaFilter[] = [];
  searchText = '';
  
  customSourceKeys = new Set<string>();
  customDocKeys = new Set<string>();
  uniqueValuesMap = new Map<string, string[]>();
  
  visibleSelection: {
    source: Source;
    expanded: boolean;
    selected: boolean;
    visible: boolean;
    documents: Array<{
      document: any;
      selected: boolean;
      visible: boolean;
    }>;
  }[] = [];
  
  docCols = [
    { key: 'textinitium', label: 'Text Initium', visible: true },
    { key: 'dokumenten_id', label: 'Document ID', visible: true },
    { key: 'gattung1', label: 'Genre', visible: true },
    { key: 'festtag', label: 'Feast Day', visible: false },
    { key: 'feier', label: 'Feast', visible: false }
  ];
  
  get allFields(): MetaField[] {
    const list = [...STANDARD_FIELDS];
    this.customSourceKeys.forEach(k => {
      list.push({ key: k, label: `${k} (Custom Source)`, type: 'custom_source' });
    });
    this.customDocKeys.forEach(k => {
      if (k !== 'publish') {
        list.push({ key: k, label: `${k} (Custom Doc)`, type: 'custom_doc' });
      }
    });
    return list;
  }
  
  ngOnInit() {
    this.initData();
  }
  
  ngOnChanges(changes: SimpleChanges) {
    if (changes.sources || changes.documents) {
      this.initData();
    }
  }
  
  initData() {
    this.customSourceKeys.clear();
    this.customDocKeys.clear();
    
    // Scan for custom properties
    this.sources.forEach(s => {
      if (s.custom) {
        Object.keys(s.custom).forEach(k => {
          if (!STANDARD_FIELDS.some(f => f.key === k && f.type === 'source')) {
            this.customSourceKeys.add(k);
          }
        });
      }
    });
    
    this.documents.forEach(d => {
      if (d.custom) {
        Object.keys(d.custom).forEach(k => {
          if (!STANDARD_FIELDS.some(f => f.key === k && f.type === 'document')) {
            this.customDocKeys.add(k);
          }
        });
      }
    });
    
    // Construct selection nodes
    this.visibleSelection = this.sources.map(s => {
      const docsForSource = this.documents.filter(d => d.quelle_id === s.id);
      return {
        source: s,
        expanded: false,
        selected: true,
        visible: true,
        documents: docsForSource.map(d => ({
          document: d,
          selected: true,
          visible: true
        }))
      };
    });
    
    this.buildUniqueValues();
    this.applyFilters();
  }
  
  buildUniqueValues() {
    this.uniqueValuesMap.clear();
    this.allFields.forEach(fld => {
      const vals = new Set<string>();
      if (fld.type === 'source') {
        this.sources.forEach(s => {
          const v = (s as any)[fld.key];
          if (v) vals.add(String(v).trim());
        });
      } else if (fld.type === 'custom_source') {
        this.sources.forEach(s => {
          const v = s.custom?.[fld.key];
          if (v) vals.add(String(v).trim());
        });
      } else if (fld.type === 'document') {
        this.documents.forEach(d => {
          const v = d[fld.key];
          if (v) vals.add(String(v).trim());
        });
      } else if (fld.type === 'custom_doc') {
        this.documents.forEach(d => {
          const v = d.custom?.[fld.key];
          if (v) vals.add(String(v).trim());
        });
      }
      this.uniqueValuesMap.set(fld.key, Array.from(vals).filter(v => v.length > 0).sort());
    });
  }
  
  getUniqueValues(fieldKey: string): string[] {
    return this.uniqueValuesMap.get(fieldKey) || [];
  }
  
  addFilter() {
    const fields = this.allFields;
    if (fields.length === 0) return;
    this.filters.push({
      field: fields[0].key,
      operator: 'contains',
      value: ''
    });
    this.applyFilters();
  }
  
  removeFilter(idx: number) {
    this.filters.splice(idx, 1);
    this.applyFilters();
  }
  
  onFilterFieldChange(filter: MetaFilter) {
    filter.value = '';
    this.applyFilters();
  }
  
  matchDoc(d: any, s: Source, filter: MetaFilter): boolean {
    const fieldDef = this.allFields.find(f => f.key === filter.field);
    if (!fieldDef) return true;
    
    let val = '';
    if (fieldDef.type === 'source') {
      val = String((s as any)[fieldDef.key] ?? '');
    } else if (fieldDef.type === 'custom_source') {
      val = String(s.custom?.[fieldDef.key] ?? '');
    } else if (fieldDef.type === 'document') {
      val = String(d[fieldDef.key] ?? '');
    } else if (fieldDef.type === 'custom_doc') {
      val = String(d.custom?.[fieldDef.key] ?? '');
    }
    
    const fVal = filter.value.toLowerCase().trim();
    const target = val.toLowerCase().trim();
    
    switch (filter.operator) {
      case 'contains': return target.includes(fVal);
      case 'equals': return target === fVal;
      case 'startsWith': return target.startsWith(fVal);
      case 'endsWith': return target.endsWith(fVal);
      case 'empty': return !val || val.trim() === '';
      case 'notEmpty': return !!val && val.trim() !== '';
      default: return true;
    }
  }
  
  matchSourceOnly(s: Source, filter: MetaFilter): boolean {
    const fieldDef = this.allFields.find(f => f.key === filter.field);
    if (!fieldDef) return true;
    if (fieldDef.type !== 'source' && fieldDef.type !== 'custom_source') return true;
    
    let val = '';
    if (fieldDef.type === 'source') {
      val = String((s as any)[fieldDef.key] ?? '');
    } else if (fieldDef.type === 'custom_source') {
      val = String(s.custom?.[fieldDef.key] ?? '');
    }
    
    const fVal = filter.value.toLowerCase().trim();
    const target = val.toLowerCase().trim();
    
    switch (filter.operator) {
      case 'contains': return target.includes(fVal);
      case 'equals': return target === fVal;
      case 'startsWith': return target.startsWith(fVal);
      case 'endsWith': return target.endsWith(fVal);
      case 'empty': return !val || val.trim() === '';
      case 'notEmpty': return !!val && val.trim() !== '';
      default: return true;
    }
  }
  
  applyFilters() {
    this.visibleSelection.forEach(srcNode => {
      let sourceMatchesFilters = true;
      
      // Evaluate source filters first
      for (const f of this.filters) {
        if (!f.field) continue;
        const fieldDef = this.allFields.find(fld => fld.key === f.field);
        if (fieldDef && (fieldDef.type === 'source' || fieldDef.type === 'custom_source')) {
          if (!this.matchSourceOnly(srcNode.source, f)) {
            sourceMatchesFilters = false;
            break;
          }
        }
      }
      
      srcNode.documents.forEach(docNode => {
        let docMatches = sourceMatchesFilters;
        
        if (docMatches) {
          for (const f of this.filters) {
            if (!f.field) continue;
            // Document filters
            const fieldDef = this.allFields.find(fld => fld.key === f.field);
            if (fieldDef && (fieldDef.type === 'document' || fieldDef.type === 'custom_doc')) {
              if (!this.matchDoc(docNode.document, srcNode.source, f)) {
                docMatches = false;
                break;
              }
            }
          }
        }
        
        if (docMatches && this.searchText) {
          const q = this.searchText.toLowerCase().trim();
          const docText = Object.values(docNode.document).filter(v => typeof v === 'string').join(' ').toLowerCase();
          const srcText = Object.values(srcNode.source).filter(v => typeof v === 'string').join(' ').toLowerCase();
          docMatches = docText.includes(q) || srcText.includes(q);
        }
        
        docNode.visible = docMatches;
      });
      
      const hasVisibleDocs = srcNode.documents.some(d => d.visible);
      srcNode.visible = sourceMatchesFilters && hasVisibleDocs;
    });
    
    this.emitSelection();
  }
  
  selectAllFiltered() {
    this.visibleSelection.forEach(srcNode => {
      if (srcNode.visible) {
        srcNode.selected = true;
        srcNode.documents.forEach(docNode => {
          if (docNode.visible) {
            docNode.selected = true;
          }
        });
      }
    });
    this.emitSelection();
  }
  
  selectNoneFiltered() {
    this.visibleSelection.forEach(srcNode => {
      if (srcNode.visible) {
        srcNode.selected = false;
        srcNode.documents.forEach(docNode => {
          if (docNode.visible) {
            docNode.selected = false;
          }
        });
      }
    });
    this.emitSelection();
  }
  
  toggleSourceSelection(srcNode: any) {
    srcNode.documents.forEach((d: any) => {
      if (d.visible) d.selected = srcNode.selected;
    });
    this.emitSelection();
  }
  
  checkSourceSelection(srcNode: any) {
    const visibleDocs = srcNode.documents.filter((d: any) => d.visible);
    if (visibleDocs.length === 0) return;
    
    const allSelected = visibleDocs.every((d: any) => d.selected);
    srcNode.selected = allSelected;
    this.emitSelection();
  }
  
  emitSelection() {
    const selectedSources: Source[] = [];
    const selectedDocs: any[] = [];
    
    this.visibleSelection.forEach(srcNode => {
      const selectedDocsInSrc = srcNode.documents.filter(d => d.selected && d.visible).map(d => d.document);
      if (selectedDocsInSrc.length > 0) {
        selectedSources.push(srcNode.source);
        selectedDocs.push(...selectedDocsInSrc);
      }
    });
    
    this.selectionChange.emit({
      selectedSources,
      selectedDocs
    });
  }
  
  get countSelectedFiltered(): number {
    let count = 0;
    this.visibleSelection.forEach(src => {
      if (src.visible) {
        count += src.documents.filter(d => d.visible && d.selected).length;
      }
    });
    return count;
  }
  
  get countTotalFiltered(): number {
    let count = 0;
    this.visibleSelection.forEach(src => {
      if (src.visible) {
        count += src.documents.filter(d => d.visible).length;
      }
    });
    return count;
  }
}
