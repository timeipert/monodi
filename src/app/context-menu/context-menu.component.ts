import { Component, OnInit, OnDestroy, HostListener, ElementRef } from '@angular/core';
import { Subscription } from 'rxjs';
import { Router } from '@angular/router';
import { ContextMenuService, ContextMenuState, ContextMenuItem } from './context-menu.service';

@Component({
    selector: 'app-context-menu',
    templateUrl: './context-menu.component.html',
    styleUrls: ['./context-menu.component.css'],
    standalone: false
})
export class ContextMenuComponent implements OnInit, OnDestroy {
  state: ContextMenuState = { isOpen: false, x: 0, y: 0, items: [] };
  private sub?: Subscription;

  constructor(
    private contextMenuService: ContextMenuService,
    private router: Router,
    private el: ElementRef
  ) {}

  ngOnInit() {
    // Re-parent the host to <body> so the fixed-position menu escapes every
    // ancestor stacking context (e.g. the sticky-top nav, page headers) and can
    // never be painted underneath other chrome, regardless of where it's used.
    try {
      const host = this.el.nativeElement as HTMLElement;
      if (host.parentElement !== document.body) {
        document.body.appendChild(host);
      }
    } catch { /* SSR / detached DOM: ignore */ }
    this.sub = this.contextMenuService.state$.subscribe(state => {
      this.state = state;
      if (state.isOpen) {
        setTimeout(() => {
          const menuEl = document.querySelector('.custom-context-menu') as HTMLElement;
          if (menuEl) {
            const menuWidth = menuEl.clientWidth;
            const menuHeight = menuEl.clientHeight;
            const windowWidth = window.innerWidth;
            const windowHeight = window.innerHeight;

            let x = state.x;
            let y = state.y;

            if (x + menuWidth > windowWidth) {
              x = state.x - menuWidth;
            }
            if (y + menuHeight > windowHeight) {
              y = state.y - menuHeight;
            }

            if (x < 0) x = 0;
            if (y < 0) y = 0;

            menuEl.style.left = `${x}px`;
            menuEl.style.top = `${y}px`;
          }
        }, 0);
      }
    });
  }

  ngOnDestroy() {
    this.sub?.unsubscribe();
    try {
      const host = this.el.nativeElement as HTMLElement;
      if (host.parentElement === document.body) {
        document.body.removeChild(host);
      }
    } catch { /* ignore */ }
  }

  // Close when clicking anywhere outside
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    if (this.state.isOpen) {
      this.contextMenuService.close();
    }
  }

  // Close on scroll or resize
  @HostListener('window:scroll')
  @HostListener('window:resize')
  onWindowEvents() {
    if (this.state.isOpen) {
      this.contextMenuService.close();
    }
  }

  // Prevent closing when clicking inside the menu itself (unless clicking an action)
  onMenuClick(event: MouseEvent) {
    event.stopPropagation();
  }

  executeAction(item: ContextMenuItem, event: MouseEvent) {
    event.stopPropagation();
    if (!item.disabled) {
      item.action();
      this.contextMenuService.close();
    }
  }

  openHelp(event: MouseEvent) {
    event.stopPropagation();
    if (this.state.helpTopic) {
      const urlTree = this.router.createUrlTree(['/manual', this.state.helpTopic], { fragment: this.state.helpHash || undefined });
      const serialized = this.router.serializeUrl(urlTree);
      const url = window.location.origin + window.location.pathname + '#' + serialized;
      window.open(url, '_blank');
      this.contextMenuService.close();
    }
  }
}
