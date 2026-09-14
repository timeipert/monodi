import { Component, Input, OnInit } from '@angular/core';
import { Router } from '@angular/router';

@Component({
    selector: 'app-help-button',
    templateUrl: './help-button.component.html',
    styleUrls: ['./help-button.component.css'],
    standalone: false
})
export class HelpButtonComponent implements OnInit {
  @Input() topic: string = '';
  @Input() hash: string = '';

  constructor(private router: Router) { }

  ngOnInit(): void {
  }

  openHelp(event: Event) {
    event.stopPropagation();
    event.preventDefault();
    const urlTree = this.router.createUrlTree(['/manual', this.topic], { fragment: this.hash || undefined });
    const serialized = this.router.serializeUrl(urlTree);
    const url = window.location.origin + window.location.pathname + '#' + serialized;
    window.open(url, '_blank');
  }
}
