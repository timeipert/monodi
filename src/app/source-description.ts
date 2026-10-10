/** Key under which a source's Markdown description is kept in `Source.custom`. */
export const SOURCE_DESCRIPTION_KEY = 'description';

/** Key of earlier imports (German `meta.json` files); read as a fallback, written back as `description`. */
const LEGACY_KEY = 'beschreibung';

/** The Markdown description of a source, or '' if it has none. */
export function sourceDescription(source: { custom?: { [key: string]: string } } | null | undefined): string {
  const c = source?.custom;
  return (c?.[SOURCE_DESCRIPTION_KEY] ?? c?.[LEGACY_KEY] ?? '').toString();
}

/** Stores the description (and drops the legacy key, so there is one place only). Empty removes it. */
export function setSourceDescription(source: { custom?: { [key: string]: string } }, text: string): void {
  const c = (source.custom ??= {});
  delete c[LEGACY_KEY];
  if (text.trim()) c[SOURCE_DESCRIPTION_KEY] = text;
  else delete c[SOURCE_DESCRIPTION_KEY];
}
