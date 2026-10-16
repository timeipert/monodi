
/** A page that knows whether leaving it would lose work. */
export interface HasChanges {
  hasChanges(): boolean;
}

export class ConfirmDeactivateGuard  {

  canDeactivate(target: HasChanges) {
    if(target.hasChanges()){
        return window.confirm('Are you sure you want to continue?\nYou have unsaved changes.');
    }
    return true;
  }
}
