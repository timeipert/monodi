import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { NgbModule } from '@ng-bootstrap/ng-bootstrap';
import { SelectionToolsModule } from '../selection/selection-tools.module';
import { AnalysisTabsComponent } from '../analysis-tabs.component';
import { AnalysisPageComponent } from './analysis-page.component';
import { ParamFormComponent } from './param-form.component';
import { CorpusPanelComponent } from './corpus-panel.component';
import { NotationSnippetComponent } from './notation-snippet.component';
import { ResultViewComponent } from './result-view.component';

/** The Analysis page (lazy loaded at `#/analysis` and `#/analysis/<id>`). */
@NgModule({
  declarations: [AnalysisPageComponent, ParamFormComponent, ResultViewComponent, NotationSnippetComponent, CorpusPanelComponent],
  imports: [
    AnalysisTabsComponent,
    CommonModule,
    FormsModule,
    NgbModule,
    SelectionToolsModule,
    RouterModule.forChild([
      { path: '', component: AnalysisPageComponent },
      { path: ':id', component: AnalysisPageComponent },
    ]),
  ],
})
export class AnalysisModule {}
