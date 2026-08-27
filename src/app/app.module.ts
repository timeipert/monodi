import { BrowserModule } from '@angular/platform-browser';
import { NgModule, isDevMode, ErrorHandler } from '@angular/core';
import { GlobalErrorHandler } from './global-error-handler';
import { ServiceWorkerModule } from '@angular/service-worker';
import { FormsModule } from '@angular/forms';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { ToastrModule } from 'ngx-toastr';
import { NgbModule } from '@ng-bootstrap/ng-bootstrap';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { ScrollingModule } from '@angular/cdk/scrolling';

import { AppComponent } from './app.component';
import { WelcomeComponent } from './welcome/welcome.component';
// Removed LoginComponent
import { SettingsComponent } from './settings/settings.component';
import { SourcesOverviewComponent } from './sources-overview/sources-overview.component';
import { SourceComponent } from './source/source.component';
import { DocumentComponent } from './document/document.component';
import { SmartTableComponent } from './smart-table/smart-table.component';
import { SselectComponent } from './sselect/sselect.component';
import { ConfirmDeactivateGuard } from './ConfirmDeactivateGuard';
import { ZipUploadComponent } from './zip-upload/zip-upload.component';
import { CommentComponent } from './comment/comment.component';
import { ComplexCommentComponent } from './complex-comment/complex-comment.component';
import { ParatextCommentComponent } from './paratext-comment/paratext-comment.component';

import { SearchComponent } from './search/search.component';
import { DragMapComponent } from './drag-map/drag-map.component';
import { NotationsdokumentationModule } from './notationsdokumentation/notationsdokumentation.module';
import { HelpButtonComponent } from './help-button/help-button.component';
import { ContextMenuComponent } from './context-menu/context-menu.component';
import { SharedEditorModule } from './shared-editor.module';

import { SubcorporaSelectorComponent } from './sources-overview/subcorpora-selector/subcorpora-selector.component';
import { MeiMappingEditorComponent } from './mei/mei-mapping-editor.component';
import { ImportExportComponent } from './import-export/import-export.component';

@NgModule({ declarations: [
        AppComponent,
        WelcomeComponent,
        SourcesOverviewComponent,
        SubcorporaSelectorComponent,
        SourceComponent,
        DocumentComponent,
        SmartTableComponent,
        SselectComponent,
        ZipUploadComponent,
        CommentComponent,
        ParatextCommentComponent,
        ComplexCommentComponent,
        SearchComponent,
        SettingsComponent,
        DragMapComponent,
        HelpButtonComponent,
        ContextMenuComponent,
        MeiMappingEditorComponent,
        ImportExportComponent
    ],
    bootstrap: [AppComponent], imports: [BrowserModule,
        CommonModule,
        BrowserAnimationsModule,
        ToastrModule.forRoot(),
        FormsModule,
        NotationsdokumentationModule,
        NgbModule,
        DragDropModule,
        ScrollingModule,
        SharedEditorModule,
        RouterModule.forRoot([
            {
                path: 'login',
                redirectTo: '/sources',
                pathMatch: 'full'
            }, {
                path: 'sources',
                component: SourcesOverviewComponent,
            }, {
                path: 'source/:id',
                component: SourceComponent,
            }, {
                path: 'source',
                component: SourceComponent,
            }, {
                path: 'document/:source',
                component: DocumentComponent,
            }, {
                path: 'document/:source/:id',
                component: DocumentComponent,
                canDeactivate: [ConfirmDeactivateGuard]
            }, {
                path: 'search',
                component: SearchComponent,
            }, {
                path: 'stats',
                loadChildren: () => import('./stats/stats.module').then(m => m.StatsModule),
            }, {
                path: 'settings',
                component: SettingsComponent,
            }, {
                path: 'import-export',
                component: ImportExportComponent,
            }, {
                path: 'zip-upload',
                component: ZipUploadComponent,
            }, {
                path: 'cc',
                component: ComplexCommentComponent
            }, {
                path: 'manual',
                loadChildren: () => import('./manual/manual.module').then(m => m.ManualModule)
            }, {
                path: '**',
                component: WelcomeComponent
            }
        ], { useHash: true, anchorScrolling: 'enabled' }),
        ServiceWorkerModule.register('ngsw-worker.js', {
          enabled: !isDevMode() && typeof window !== 'undefined' && window.location.protocol !== 'file:',
          registrationStrategy: 'registerWhenStable:30000'
        })
    ], providers: [ConfirmDeactivateGuard, provideHttpClient(withInterceptorsFromDi()), { provide: ErrorHandler, useClass: GlobalErrorHandler }] })
export class AppModule { }
