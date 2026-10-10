import { Injectable } from '@angular/core';
import { Subscription, BehaviorSubject } from 'rxjs';
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
        f(se[0], se.length > 1)
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

export interface Tool {
  callback?: () => void;
  icon?: string;
  title: string;
  active?: boolean;
  /** Tools of one group sit together; a thin divider separates neighbouring groups. */
  group?: string;
}

export interface StackEntry {
  source: any;
  tools: Tool[];
}
