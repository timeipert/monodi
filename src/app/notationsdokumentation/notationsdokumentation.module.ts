import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { NotationsdokumentationRoutingModule } from './notationsdokumentation-routing.module';
import { IiifViewerComponent } from './iiif-viewer/iiif-viewer.component';
import { SvgPatternComponent } from './svg-pattern/svg-pattern.component';
import { ManuscriptViewComponent } from './manuscript-view/manuscript-view.component';
import { StandardSetComponent } from './standard-set/standard-set.component';
import { NotationDocsViewComponent } from './notation-docs-view/notation-docs-view.component';
import { NdCropComponent } from './nd-crop/nd-crop.component';
import { NdTreeComponent } from './nd-tree/nd-tree.component';


@NgModule({
  declarations: [
    IiifViewerComponent,
    SvgPatternComponent,
    ManuscriptViewComponent,
    StandardSetComponent,
    NotationDocsViewComponent,
    NdCropComponent,
    NdTreeComponent,
  ],
  imports: [
    CommonModule,
    FormsModule,
    NotationsdokumentationRoutingModule
  ],
  exports: [
    IiifViewerComponent,
    SvgPatternComponent,
    ManuscriptViewComponent,
    StandardSetComponent,
    NotationDocsViewComponent,
  ]
})
export class NotationsdokumentationModule { }
