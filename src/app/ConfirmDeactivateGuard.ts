
import { DocumentComponent } from './document/document.component';

export class ConfirmDeactivateGuard  {

  canDeactivate(target: DocumentComponent) {
    if(target.hasChanges()){
        return window.confirm('Are you sure you want to continue?\nYou have unsaved changes.');
    }
    return true;
  }
}