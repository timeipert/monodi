import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

export interface ContextMenuItem {
  label: string;
  icon?: string;
  /** When true, render as a non-clickable section header (groups items without
   *  needing nested submenus). `action` is ignored. */
  header?: boolean;
  /** When true, show a checkmark to mark the currently-active choice. */
  checked?: boolean;
  action: () => void;
  disabled?: boolean;
}

export interface ContextMenuState {
  isOpen: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
  helpTopic?: string;
  helpHash?: string;
}

@Injectable({
  providedIn: 'root'
})
export class ContextMenuService {
  private stateSubject = new Subject<ContextMenuState>();
  state$ = this.stateSubject.asObservable();

  private currentState: ContextMenuState = {
    isOpen: false,
    x: 0,
    y: 0,
    items: []
  };

  open(event: MouseEvent, items: ContextMenuItem[], helpTopic?: string, helpHash?: string) {
    event.preventDefault();
    event.stopPropagation();
    
    this.currentState = {
      isOpen: true,
      x: event.clientX,
      y: event.clientY,
      items,
      helpTopic,
      helpHash
    };
    this.stateSubject.next(this.currentState);
  }

  close() {
    if (this.currentState.isOpen) {
      this.currentState.isOpen = false;
      this.stateSubject.next(this.currentState);
    }
  }
}
