import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { NotationsdokumentationRoutingModule } from './notationsdokumentation-routing.module';
import { OverviewComponent } from './overview/overview.component';
import { IiifViewerComponent } from './iiif-viewer/iiif-viewer.component';
import { SvgPatternComponent } from './svg-pattern/svg-pattern.component';
import { NotationViewerComponent } from './notation-viewer/notation-viewer.component';
import { AnnotationCutoutComponent } from './annotation-cutout/annotation-cutout.component';
import { ManuscriptViewComponent } from './manuscript-view/manuscript-view.component';
import { StandardSetComponent } from './standard-set/standard-set.component';
import { NotationDocsViewComponent } from './notation-docs-view/notation-docs-view.component';


@NgModule({
  declarations: [
    OverviewComponent,
    IiifViewerComponent,
    SvgPatternComponent,
    NotationViewerComponent,
    AnnotationCutoutComponent,
    ManuscriptViewComponent,
    StandardSetComponent,
    NotationDocsViewComponent,
  ],
  imports: [
    CommonModule,
    FormsModule,
    NotationsdokumentationRoutingModule
  ],
  exports: [
    OverviewComponent,
    IiifViewerComponent,
    NotationViewerComponent,
    SvgPatternComponent,
    ManuscriptViewComponent,
    StandardSetComponent,
    NotationDocsViewComponent,
  ]
})
export class NotationsdokumentationModule { }
