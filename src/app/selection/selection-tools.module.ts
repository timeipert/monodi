import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SelectionBarComponent } from './selection-bar.component';

/** The selection bar, for every module whose pages let the user pick hits, sources or documents. */
@NgModule({
  declarations: [SelectionBarComponent],
  imports: [CommonModule],
  exports: [SelectionBarComponent],
})
export class SelectionToolsModule {}
