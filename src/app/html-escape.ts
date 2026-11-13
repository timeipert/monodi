/** Escapes text for use inside HTML element content and double-quoted attribute values. */
export function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * JSON for the body of a `<script type="application/json">` element. `JSON.stringify` leaves `<` untouched, so a value
 * containing `</script>` would end the element and let the rest run as markup. The escape `\u003c` is read back as `<` by
 * `JSON.parse`, so the data is unchanged. U+2028/U+2029 are escaped for older parsers.
 */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
