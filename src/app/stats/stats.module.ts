import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { NotationsdokumentationModule } from '../notationsdokumentation/notationsdokumentation.module';
import { StatsComponent } from './stats.component';
import { SelectionToolsModule } from '../selection/selection-tools.module';
import { AnalysisTabsComponent } from '../analysis-tabs.component';

@NgModule({
  declarations: [StatsComponent],
  imports: [
    AnalysisTabsComponent,
    CommonModule,
    FormsModule,
    NotationsdokumentationModule,
    SelectionToolsModule,
    RouterModule.forChild([
      { path: '', component: StatsComponent }
    ])
  ]
})
export class StatsModule { }
