// Safe JSON serialization for values embedded in an HTML <script> element.
//
// JSON.stringify() does not escape `<`, `>` or `&`. A string containing
// `</script>` would close the element early even in `type="application/json"`.
// Escaping those characters (and the JS line separators) keeps the payload
// inert until the browser parses it as JSON.

export function serializeForInlineScript(value: unknown): string {
  const json = JSON.stringify(value);
  return (json ?? 'null')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
