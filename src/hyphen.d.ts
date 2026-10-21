declare module 'hyphen/de-1996' {
  /** Puts soft hyphens (U+00AD) into the words of a text (German, new spelling). */
  export function hyphenateSync(text: string): string;
}
