/**
 * HTML escaping for the places where this site builds markup as strings and
 * assigns the result to `innerHTML`.
 *
 * Any value that did not originate in this repository — a blog frontmatter
 * field, a Steam or Discord display name, a visitor referrer host, a linter
 * message — must pass through here before it is interpolated into markup.
 *
 * The public homepage's update loop runs from `public/scripts/home-dashboard.js`,
 * a plain file served verbatim, which cannot import modules, so it keeps a
 * verbatim one-line copy of this function. Everything else should import this
 * module.
 */
export function escapeHtml(value: unknown): string {
  return String(value).replace(
    /[&<>"']/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] as string,
  );
}
