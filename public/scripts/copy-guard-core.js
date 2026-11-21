// Pure helpers for the copy guard. Kept separate from the DOM script so the
// truncation and attribution rules can be unit-tested in Node.
//
// The guard is a deterrence layer, not a lock: a determined reader can still
// use view-source, reader mode or OCR. It only makes casual copying produce a
// short excerpt plus a visible source line.

/** Longest excerpt kept on the clipboard; 0 keeps only the attribution. */
export const COPY_MAX_CHARS = 120;

/**
 * Build the clipboard text for a protected selection.
 *
 * @param {object} input
 * @param {string} input.selection
 * @param {string} input.title
 * @param {string} input.url
 * @param {string} [input.license]
 * @param {number} [input.maxChars]
 * @returns {string} empty string when there is nothing selected
 */
export function buildCopyText({ selection, title, url, license, maxChars = COPY_MAX_CHARS }) {
  const text = String(selection ?? '')
    .replace(/\r\n/g, '\n')
    .trim();
  if (!text) return '';

  const attribution = `—— 摘自《${title || '未命名'}》 ${url || ''} ${license || '© 你的名字 版權所有，轉載請註明出處'}`
    .replace(/\s+/g, ' ')
    .trim();

  if (maxChars <= 0) return attribution;

  // Slice by code point so truncation never splits an emoji surrogate pair.
  const characters = Array.from(text);
  const excerpt = characters.length > maxChars ? `${characters.slice(0, maxChars).join('').trimEnd()}…` : text;

  return `${excerpt}\n\n${attribution}`;
}
