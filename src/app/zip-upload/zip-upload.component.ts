import { Component, OnInit } from '@angular/core';
import { UserService, User } from '../user.service';
import { Subscription } from 'rxjs';
import { ToastrService } from 'ngx-toastr';
import { APIService, UserInfo, Source, LoginRequired, UploadFinished, InsufficientPermissions } from '../api.service'
import { assertNever } from "../../utils";
import { Observable, of } from 'rxjs';

type Name = "zip" | "documents" | "sources" | "delSources" | "delDocuments";

@Component({
  selector: 'app-zip-upload',
  templateUrl: './zip-upload.component.html',
  styleUrls: ['./zip-upload.component.scss']
})
export class ZipUploadComponent implements OnInit {

  subs: Subscription[] = [];
  states: {
    [name in Name]: State
  };
  user: User | null = null;
  names: Name[] = ["zip", "documents", "sources", "delSources", "delDocuments"];

  constructor(private userService: UserService, private api: APIService, private toastr: ToastrService) {
    this.states = {
      "zip": {
        data: null,
        errors: [],
        state: "initial",
        uploader: (t, d) => api.importZip(t, d)
      },
      "documents": {
        data: null,
        errors: [],
        state: "initial",
        uploader: (t, d) => api.importDocuments(t, d)
      },
      "sources": {
        data: null,
        errors: [],
        state: "initial",
        uploader: (t, d) => api.importSources(t, d)
      },
      "delDocuments": {
        data: null,
        errors: [],
        state: "initial",
        uploader: (t, d) => api.deleteDocuments(t, d),
        warning: "Warning: all documents in the Excel list of the uploaded file will be permanently deleted."
      }
      ,
      "delSources": {
        data: null,
        errors: [],
        state: "initial",
        uploader: (t, d) => api.deleteSources(t, d),
        warning: "Warning: all sources in the Excel list of the uploaded file will be permanently deleted — along with all documents belonging to those sources. If in doubt, check in the viewer whether the source still has documents.",
      }
    };
  }

  ngOnInit() {
    this.subs.push(this.userService.user.subscribe(u => {
      this.user = u;
    }));
  }

  fileSelected(name: Name, event: Event): void {
    this.states[name].state = "browser-uploading";
    const file = (event.target as any).files[0];
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const result = reader.result as string;
      this.states[name].data = result.substring(result.indexOf(",") + 1);
      this.states[name].state = "browser-uploaded"
    });
    if (file) {
      reader.readAsDataURL(file);
    }
  }

  upload(name: Name): void {
    const data = this.states[name].data;
    if (this.user !== null && data) {
      this.states[name].state = "uploading";
      this.states[name].uploader(this.user.token, data).subscribe(res => {
        switch (res.kind) {
          case 'LoginRequired': this.userService.logout(); break;
          case 'InsufficientPermissions': this.userService.logout(); break;
          case 'UploadFinished': this.states[name].state = "uploaded"; this.states[name].errors = res.errors; break;
          default: assertNever(res);
        }
      });
    }
  }
}

export interface State {
  state: "initial" | "browser-uploaded" | "browser-uploading" | "uploading" | "uploaded";
  data: string | null;
  errors: string[];
  uploader: (token: string, data: string) => Observable<LoginRequired | UploadFinished | InsufficientPermissions>;
  warning?: string;
}
