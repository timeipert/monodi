import { Component, EventEmitter, Input, Output } from '@angular/core';
import type { AnalysisMethod, FieldOption, ParamValues } from '@monodi/core/analysis';

/** The inputs for the parameters of one method, built from its `ParamSpec` list. */
@Component({
  selector: 'app-param-form',
  standalone: false,
  template: `
    <div class="row g-2">
      @for (p of method.params; track p.key) {
        <div class="col-sm-6 col-lg-4">
          <label class="form-label small mb-0 fw-semibold" [for]="idFor(p.key)" [title]="p.help">{{ p.label }}</label>
          @switch (p.type) {
            @case ('number') {
              <input type="number" class="form-control form-control-sm" [id]="idFor(p.key)" [min]="p.min" [max]="p.max" [step]="p.step ?? 1"
                [ngModel]="values[p.key]" (ngModelChange)="set(p.key, $event)" />
            }
            @case ('boolean') {
              <div class="form-check form-switch">
                <input type="checkbox" class="form-check-input" [id]="idFor(p.key)" [ngModel]="values[p.key]" (ngModelChange)="set(p.key, $event)" />
              </div>
            }
            @case ('select') {
              <select class="form-select form-select-sm" [id]="idFor(p.key)" [ngModel]="values[p.key]" (ngModelChange)="set(p.key, $event)">
                @for (o of p.options; track o.value) { <option [value]="o.value">{{ o.label }}</option> }
              </select>
            }
            @case ('field') {
              <select class="form-select form-select-sm" [id]="idFor(p.key)" [ngModel]="values[p.key]" (ngModelChange)="set(p.key, $event)">
                @if (p.optional) { <option value="">(no grouping)</option> }
                @for (f of fields; track f.key) { <option [value]="f.key">{{ f.label }}</option> }
                @if (!hasField(values[p.key])) { <option [value]="values[p.key]">{{ values[p.key] }}</option> }
              </select>
            }
            @default {
              <input type="text" class="form-control form-control-sm" [id]="idFor(p.key)" [placeholder]="textPlaceholder(p)"
                [ngModel]="values[p.key]" (ngModelChange)="set(p.key, $event)" />
            }
          }
          <div class="form-text small mt-0">{{ p.help }}</div>
        </div>
      }
    </div>
  `,
})
export class ParamFormComponent {
  @Input() method!: AnalysisMethod;
  @Input() values: ParamValues = {};
  /** Grouping fields available in the corpus. */
  @Input() fields: FieldOption[] = [];
  @Output() changed = new EventEmitter<ParamValues>();

  idFor(key: string): string { return `param-${this.method.id}-${key}`; }

  hasField(key: unknown): boolean {
    return key === '' || this.fields.some((f) => f.key === key);
  }

  textPlaceholder(p: { type: string; placeholder?: string }): string { return p.placeholder ?? ''; }

  set(key: string, value: number | boolean | string): void {
    this.changed.emit({ ...this.values, [key]: value });
  }
}
