import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { debounceTime } from 'rxjs/operators';

@Injectable({
  providedIn: 'root'
})
export class ToolsService {
  private stack: StackEntry[] = [];
  private stackChange: BehaviorSubject<StackEntry[]> = new BehaviorSubject<StackEntry[]>(this.stack);

  constructor() { }

  public subscribe(f: (tools: StackEntry, hasParent: boolean) => void) {
    return this.stackChange.pipe(debounceTime(100)).subscribe(se => {
      if (se.length > 0) {
        // A tool set pushed on top (the tools of a selected note, say) stays in the same editor bar.
        f({...se[0], breadcrumb: se.find(e => e.breadcrumb)?.breadcrumb}, se.length > 1)
      } else {
        f({source: 'a', tools: []}, false);
      }
    });
  }

  public addStack(s: StackEntry): void {
    this.stack.unshift(s);
    this.stackChange.next(this.stack);
  }

  public pop() {
    if (this.stack.length > 0) {
      this.stack.splice(0, 1);
    }
    this.stackChange.next(this.stack);
  }

  public remove(source: any): void {
    const lastHead = this.stack[0];
    this.stack = this.stack.filter(se => se.source !== source);
    if (lastHead !== this.stack[0]) {
      this.stackChange.next(this.stack);
    }
  }
}

/** One entry of a tool's drop-down menu (text, optional icon); `header` makes a non-clickable section title. */
export interface ToolMenuItem {
  label: string;
  icon?: string;
  header?: boolean;
  disabled?: boolean;
  action: () => void;
}

export interface Tool {
  callback?: () => void;
  /** A tool with `menu` opens a text menu instead of running `callback`; `label` is shown next to the icon. */
  menu?: ToolMenuItem[];
  label?: string;
  icon?: string;
  title: string;
  active?: boolean;
  /** Tools of one group sit together; a thin divider separates neighbouring groups. */
  group?: string;
}

export interface StackEntry {
  source: any;
  tools: Tool[];
  /** Places shown in the single editor bar, which replaces the navbar while this entry is on top. Read on every render, so an edited title shows at once. */
  breadcrumb?: () => { source: string; document: string; openSource: () => void };
}
