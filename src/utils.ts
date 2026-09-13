import { FocusShiftRequested } from "./app/types/CommonEvent";
import { Focusable, FocusChange, Focus } from "./app/types/Focus";
import { EventEmitter, ChangeDetectorRef, QueryList } from "@angular/core";

export function textWidth(text: string, font: string = "Times", size: string = "16px"): number {
    let canvas = document.getElementById('canvas') as HTMLCanvasElement;
    if (!canvas) {
        canvas = document.createElement('canvas');
    }
    let ctx = canvas.getContext("2d");
    if (!ctx) {
        return text.length * 8; // fallback estimation
    }
    ctx.font = `${size} ${font}`;
    return ctx.measureText(text).width;
}

export function assertNever(x: never): never {
    throw new Error("should never get: " + JSON.stringify(x));
}

export function flatten<T>(tts: T[][]): T[] {
    return flatMap(tts, t => t);
}

export function flatMap<T, R>(ts: T[], f: (t: T) => R[]): R[] {
    let res: R[] = [];

    for (const t of ts) {
        res = res.concat(f(t));
    }

    return res;
}

export function maxOf(numbers: number[]): number | undefined {
    let max: number | undefined = undefined;

    for (const n of numbers) {
        if (max === undefined || n > max) {
            max = n;
        }
    }

    return max;
}

export function focusContentEditable(element: HTMLElement, end: boolean | number = false): void {
    element.focus();
    const range = document.createRange();
    const sel = window.getSelection();
    if (sel !== null) {
        if (typeof(end) === 'number') {
            const length = (element.textContent || '').length;
            range.setStart(element.childNodes[0], Math.min(length, end));
            range.collapse(true);
        } else {
            range.selectNodeContents(element);
            range.collapse(!end);
        }
        sel.removeAllRanges();
        sel.addRange(range);
    }
}

export function getCaret(element: HTMLElement): number {
    const doc = element.ownerDocument;
    const win = doc!.defaultView;
    const sel = win!.getSelection();
    if (sel !== null && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        const preCaretRange = range.cloneRange();
        preCaretRange.selectNodeContents(element);
        preCaretRange.setEnd(range.endContainer, range.endOffset);
        return preCaretRange.toString().length;
    }
    return -1;
}

export function handleFocusShiftFromChild(
    e: FocusShiftRequested,
    children: Focusable[],
    oldIndex: number,
    onEvent: (e: FocusShiftRequested) => void
): void {
    const delta = e.change.focusLast ? -1 : +1;
    const newIndex = oldIndex + delta;
    if (newIndex < 0 || newIndex >= children.length) {
        onEvent(e);
    } else {
        children[newIndex].focus(e.change);
    }
}

export function handleFocusChangeFromParent(e: FocusChange, children: Focusable[]): void {
    if (children.length > 0) {
        const childIndex = e.focusLast ? children.length - 1 : 0;
        children[childIndex].focus(e);
    }
}

/**
 * Reliably move focus into a just-inserted child element.
 *
 * After splicing a new node into a container's `children` model array, the
 * `@ViewChildren` QueryList and the DOM only reflect it after change detection
 * runs. Calling `detectChanges()` first makes the lookup deterministic, so
 * rapid repeated inserts (e.g. clicking "+" four times) always land focus on
 * the new element instead of throwing or silently dropping focus. A single
 * macrotask fallback covers the rare case where the view hasn't settled yet.
 */
export function focusNewChild(
    children: QueryList<Focusable>,
    cdr: ChangeDetectorRef,
    dataRef: any,
    focusLast: boolean = false,
    preferredLevel?: Focus
): void {
    const tryFocus = (): boolean => {
        const target = children.toArray().find(c => c.getData() === dataRef);
        if (target) {
            target.focus({ focusLast, preferredLevel });
            return true;
        }
        return false;
    };
    try { cdr.detectChanges(); } catch { /* detached view — fall through to retry */ }
    if (tryFocus()) return;
    setTimeout(() => tryFocus(), 0);
}
