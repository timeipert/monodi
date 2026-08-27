import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { SharedEditorModule } from '../shared-editor.module';

import { ManualLayoutComponent } from './manual-layout/manual-layout.component';
import { OverviewComponent } from './pages/overview/overview.component';
import { TranscriptionComponent } from './pages/transcription/transcription.component';
import { SearchComponent as ManualSearchComponent } from './pages/search/search.component';
import { ManualHighlightTriggerDirective } from './services/manual-highlight-trigger.directive';
import { IiifComponent } from './pages/iiif/iiif.component';
import { MetadataComponent } from './pages/metadata/metadata.component';
import { UseCasesComponent } from './pages/use-cases/use-cases.component';
import { CommentsComponent } from './pages/comments/comments.component';
import { ManualSettingsComponent } from './pages/settings/settings.component';
import { ManualAnalysisComponent } from './pages/analysis/analysis.component';
import { ManualWorkspaceComponent } from './pages/workspace/workspace.component';
import { ManualImportExportComponent } from './pages/import-export/import-export.component';

const routes: Routes = [
  {
    path: '',
    component: ManualLayoutComponent,
    children: [
      { path: '', redirectTo: 'overview', pathMatch: 'full' },
      { path: 'overview', component: OverviewComponent },
      { path: 'transcription', component: TranscriptionComponent },
      { path: 'search', component: ManualSearchComponent },
      { path: 'analysis', component: ManualAnalysisComponent },
      { path: 'iiif', component: IiifComponent },
      { path: 'metadata', component: MetadataComponent },
      { path: 'comments', component: CommentsComponent },
      { path: 'settings', component: ManualSettingsComponent },
      { path: 'workspace', component: ManualWorkspaceComponent },
      { path: 'import-export', component: ManualImportExportComponent },
      { path: 'use-cases', component: UseCasesComponent },
    ]
  }
];

@NgModule({
  declarations: [
    ManualLayoutComponent,
    OverviewComponent,
    TranscriptionComponent,
    ManualSearchComponent,
    ManualHighlightTriggerDirective,
    IiifComponent,
    MetadataComponent,
    UseCasesComponent,
    CommentsComponent,
    ManualSettingsComponent,
    ManualAnalysisComponent,
    ManualWorkspaceComponent,
    ManualImportExportComponent
  ],
  imports: [
    CommonModule,
    FormsModule,
    SharedEditorModule,
    DragDropModule,
    RouterModule.forChild(routes)
  ]
})
export class ManualModule { }
