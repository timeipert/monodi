import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

/**
 * The two pages behind the "Analysis" link of the menu: the corpus analyses (`/analysis`: methods, saved results, figures)
 * and the notation statistics (`/stats`: how often each neume pattern occurs in each manuscript). Both pages show this
 * bar at the top, so one menu entry reaches both.
 */
@Component({
  selector: 'app-analysis-tabs',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  template: `
    <ul class="nav nav-tabs mb-3" aria-label="Analysis pages">
      <li class="nav-item">
        <a class="nav-link" routerLink="/analysis" routerLinkActive="active" title="Choose a corpus and methods, keep the results, make figures">Corpus analyses</a>
      </li>
      <li class="nav-item">
        <a class="nav-link" routerLink="/stats" routerLinkActive="active" title="How often each neume pattern occurs in each manuscript">Notation statistics</a>
      </li>
    </ul>
  `,
})
export class AnalysisTabsComponent {}
