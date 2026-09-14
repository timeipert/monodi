import { Input, Output, EventEmitter, Component, OnInit } from '@angular/core';

@Component({
    selector: 'app-sselect',
    templateUrl: './sselect.component.html',
    styleUrls: ['./sselect.component.css'],
    standalone: false
})
export class SselectComponent<Data> implements OnInit {
  @Input()
  dropdown!: DropdownStack<Data>;

  @Input()
  input!: string;

  @Output()
  inputChange = new EventEmitter<string>();

  constructor() { }

  change(newValue: string): void {
    this.input = newValue;
    this.inputChange.emit(newValue);
    this.dropdown.updateModel();
  }

  ngOnInit() {
  }

}

export interface DropdownStack<Data> {
  getPossibleValues(): Data[];
  getValue(): Data | undefined;
  updateModel(): void;
  getId(d: Data): string;
  addCallback: (c: () => void) => void
}

export function makeDropdownHead<Data>(_ds: Data[], idGetter: (d: Data) => string, getter: () => string | undefined): DropdownStack<Data> {
  var ds = _ds;
  const callbacks: (() => void)[] = [];

  return {
    getPossibleValues: (): Data[] => { return ds; },
    getValue: (): Data | undefined => { return ds.find(d => idGetter(d) === getter()); },
    updateModel: (): void => { callbacks.forEach(c => c()); },
    getId: idGetter,
    addCallback: (c: () => void): void => {callbacks.push(c); }
  }
}

export function makeDropdown<Parent, Data>(p: DropdownStack<Parent>, dataGetter: (p: Parent) => Data[], idGetter: (d: Data) => string, getter: () => string | undefined, setter: (s: string) => void): DropdownStack<Data> {
  const callbacks: (() => void)[] = [];

  function getPossibleValues(): Data[] {
    const v = p.getValue();
    if (v) {
      return dataGetter(v);
    } else {
      return [];
    }
  }

  function updateModel(): void {
    const vs = getPossibleValues();
    const v  = getter();

    if (vs.length === 1) {
      setter(idGetter(vs[0]));
    } else if (v && !vs.find(pv => idGetter(pv) === v)) {
      setter("");
    }

    callbacks.forEach(c => c());
  }

  const o = {
    getPossibleValues,
    updateModel,
    getValue: (): Data | undefined => { return getPossibleValues().find(d => idGetter(d) === getter()); },
    getId: idGetter,
    addCallback: (c: () => void): void => {callbacks.push(c); }
  }

  p.addCallback(() => {o.updateModel() });
  return o;
}
