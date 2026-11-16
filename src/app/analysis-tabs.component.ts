import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

/**
 * The two pages behind the "Analysis" link of the menu: the analysis methods (`/analysis`: methods, saved results, figures)
 * and the neume statistics (`/stats`: how often each neume pattern occurs in each manuscript). Both pages show this
 * bar at the top, so one menu entry reaches both.
 */
@Component({
  selector: 'app-analysis-tabs',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  template: `
    <nav class="page-tabs" aria-label="Analysis pages">
      <a routerLink="/analysis" routerLinkActive="active">Methods</a>
      <a routerLink="/stats" routerLinkActive="active">Neume statistics</a>
    </nav>
  `,
})
export class AnalysisTabsComponent {}
