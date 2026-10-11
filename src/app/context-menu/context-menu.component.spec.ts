import { ElementRef, NgZone } from '@angular/core';
import { Router } from '@angular/router';
import { ContextMenuComponent } from './context-menu.component';
import { ContextMenuService } from './context-menu.service';

describe('ContextMenuComponent', () => {
  // Built by hand, without a template: only the open / close behaviour is under test.
  let service: ContextMenuService;
  let host: HTMLElement;
  let menu: HTMLElement;
  let component: ContextMenuComponent;
  let zone: NgZone;

  beforeEach(() => {
    service = new ContextMenuService();
    host = document.createElement('div');
    menu = document.createElement('div');
    menu.className = 'custom-context-menu';
    menu.innerHTML = '<div class="menu-item">Do it</div>';
    host.appendChild(menu);
    document.body.appendChild(host);
    zone = new NgZone({ enableLongStackTrace: false });
    component = new ContextMenuComponent(service, {} as Router, new ElementRef(host), zone);
    component.ngOnInit();
    service.openAt(10, 10, [{ label: 'Do it', action: () => {} }]);
  });

  afterEach(() => {
    component.ngOnDestroy();
    host.remove();
  });

  it('opens at a position', () => {
    expect(component.state.isOpen).toBeTrue();
  });

  it('closes on a click outside, even if the page stops the event from bubbling', () => {
    const target = document.createElement('div');
    target.addEventListener('click', (e) => e.stopPropagation());
    document.body.appendChild(target);
    target.click();
    target.remove();
    expect(component.state.isOpen).toBeFalse();
  });

  it('closes on a press, a right-click elsewhere and on Escape', () => {
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(component.state.isOpen).toBeFalse();
    service.openAt(10, 10, []);
    document.body.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    expect(component.state.isOpen).toBeFalse();
    service.openAt(10, 10, []);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(component.state.isOpen).toBeFalse();
  });

  it('stays open for presses and clicks inside the menu', () => {
    const item = menu.querySelector('.menu-item') as HTMLElement;
    item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    item.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(component.state.isOpen).toBeTrue();
  });

  it('closes on scroll and on resize', () => {
    window.dispatchEvent(new Event('scroll'));
    expect(component.state.isOpen).toBeFalse();
    service.openAt(10, 10, []);
    window.dispatchEvent(new Event('resize'));
    expect(component.state.isOpen).toBeFalse();
  });

  it('does not run change detection for presses while no menu is open', () => {
    service.close();
    let passes = 0;
    const sub = zone.onMicrotaskEmpty.subscribe(() => passes++);
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    document.body.dispatchEvent(new Event('wheel', { bubbles: true }));
    window.dispatchEvent(new Event('scroll'));
    sub.unsubscribe();
    expect(passes).toBe(0);
  });

  it('re-enters the zone to close, so the menu disappears on screen', () => {
    let passes = 0;
    const sub = zone.onMicrotaskEmpty.subscribe(() => passes++);
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    sub.unsubscribe();
    expect(component.state.isOpen).toBeFalse();
    expect(passes).toBeGreaterThan(0);
  });

  it('stops listening once destroyed', () => {
    component.ngOnDestroy();
    service.openAt(10, 10, []);
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(component.state.isOpen).toBeTrue();   // nobody closes it any more
    service.close();
  });
});
