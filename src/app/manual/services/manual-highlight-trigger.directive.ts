import { Directive, HostListener, Input, HostBinding } from '@angular/core';
import { ManualHighlightService } from './manual-highlight.service';

@Directive({
    selector: '[appManualHighlightTrigger]',
    standalone: false
})
export class ManualHighlightTriggerDirective {
  @Input('appManualHighlightTrigger') targetId!: string;

  constructor(private highlightService: ManualHighlightService) {}

  @HostBinding('class.manual-highlight-trigger') isTrigger = true;

  @HostListener('mouseenter') onMouseEnter() {
    this.highlightService.setHighlight(this.targetId);
  }

  @HostListener('mouseleave') onMouseLeave() {
    this.highlightService.setHighlight(null);
  }
}
