import { ErrorHandler, Injectable, Injector } from '@angular/core';
import { ToastrService } from 'ngx-toastr';

@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  private lastToastTime = 0;

  constructor(private injector: Injector) {}

  handleError(error: any): void {
    console.error(error);

    // NG0100 (ExpressionChangedAfterItHasBeenCheckedError) is a dev-mode-only
    // change-detection warning — Angular strips the double-check from production
    // builds, so it can never occur for real users. It should not be surfaced
    // as a scary "Unexpected error" toast or recorded in the user-facing error
    // log; log it to the console (above) for developers and stop here.
    const msgText = String(error?.message ?? error);
    if (msgText.includes('NG0100') || msgText.includes('ExpressionChangedAfterItHasBeenChecked')) {
      return;
    }

    try {
      const logStr = localStorage.getItem('monodi_error_log');
      const log = logStr ? JSON.parse(logStr) : [];
      if (Array.isArray(log)) {
        log.push({
          time: new Date().toISOString(),
          message: String(error?.message ?? error),
          stack: String(error?.stack || '').slice(0, 2000)
        });
        if (log.length > 50) {
          log.splice(0, log.length - 50);
        }
        localStorage.setItem('monodi_error_log', JSON.stringify(log));
      }
    } catch (e) {
      // ignore storage error to ensure error handling never throws
    }

    const now = Date.now();
    if (now - this.lastToastTime >= 10000) {
      this.lastToastTime = now;
      try {
        const toastr = this.injector.get(ToastrService);
        const msg = String(error?.message ?? error).slice(0, 120);
        toastr.error(msg, 'Unexpected error');
      } catch (e) {
        // ignore toast resolution/display failures
      }
    }
  }
}
