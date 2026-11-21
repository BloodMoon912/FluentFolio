/**
 * Markdown word counting for the `/about` statistics panel.
 *
 * A naive `body.split(/\s+/)` undercounts Chinese prose by roughly an order of
 * magnitude, because CJK text has no whitespace between words. This module
 * strips the markdown scaffolding first, then counts every `[\u4e00-\u9fa5]`
 * character plus every Latin/number token.
 *
 * Removed by default: frontmatter, HTML tags and comments, fenced code blocks,
 * inline code, bare URLs, and markdown structure (heading / list / quote
 * markers, table pipes and delimiter rows, image and link syntax). Link text
 * and image alt text survive, because they are prose rather than markup.
 *
 * This is deliberately a line/regex scanner instead of a CommonMark parse: it
 * has to stay cheap enough to run over every post on each SSR request of
 * `/about`, and it must not pull a markdown parser into the Worker bundle.
 *
 * Known limits, all acceptable for a word counter: a link destination
 * containing an unescaped `)` is only partly recognised, and a `<…>` span in
 * ordinary prose (or in retained code) is removed as if it were an HTML tag.
 */

export interface WordCountOptions {
  /** Count the contents of fenced code blocks. The fence lines themselves never count. */
  includeCode?: boolean;
  /** Count the contents of `inline code` spans. */
  includeInlineCode?: boolean;
  /** Keep image alt text (`![alt](src)`). Defaults to `true`. */
  includeImageAlt?: boolean;
}

interface Fence {
  marker: string;
  length: number;
}

/** One Chinese character is one word. */
const CJK_CHARACTER = /[\u4e00-\u9fa5]/g;
/** One run of Latin letters, digits, underscores or hyphens is one word. */
const LATIN_TOKEN = /[a-zA-Z0-9_-]+/g;

const HTML_COMMENT = /<!--[\s\S]*?-->/g;
const HTML_TAG = /<[^>]*>/g;
const INLINE_CODE = /(`+)([\s\S]*?)\1/g;
const INLINE_IMAGE = /!\[([^\]]*)\]\([^)]*\)/g;
const REFERENCE_IMAGE = /!\[([^\]]*)\]\[[^\]]*\]/g;
const REFERENCE_DEFINITION = /^[ \t]{0,3}\[[^\]]+\]:[^\n]*$/gm;
const INLINE_LINK = /\[([^\]]*)\]\([^)]*\)/g;
const REFERENCE_LINK = /\[([^\]]*)\]\[[^\]]*\]/g;
const BARE_URL = /\b(?:https?:\/\/|www\.)[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+/gi;

const OPENING_FENCE = /^[ \t]{0,3}(`{3,}|~{3,})/;
const CLOSING_FENCE = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/;
const THEMATIC_BREAK = /^[ \t]{0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const SETEXT_UNDERLINE = /^[ \t]{0,3}(?:=+|-+)[ \t]*$/;
const TABLE_DELIMITER_ROW = /^[ \t]{0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

const BLOCKQUOTE_MARKER = /^[ \t]{0,3}(?:>[ \t]?)+/;
const HEADING_MARKER = /^[ \t]{0,3}#{1,6}(?:[ \t]+|$)/;
const TRAILING_HEADING_HASHES = /[ \t]+#+[ \t]*$/;
const LIST_MARKER = /^[ \t]{0,3}(?:[-*+]|\d{1,9}[.)])[ \t]+/;
const TASK_CHECKBOX = /^[ \t]*\[[ xX]\][ \t]+/;
const TABLE_PIPE = /\|/g;

/**
 * Count the words in a markdown body: Chinese characters plus Latin tokens,
 * after removing markup that is not prose.
 *
 * @example
 * getWordCount('---\ntitle: 題\n---\nHello 世界'); // 3
 */
export function getWordCount(markdown: string, options: WordCountOptions = {}): number {
  const text = stripMarkup(markdown, options);
  const chinese = text.match(CJK_CHARACTER)?.length ?? 0;
  const tokens = text.match(LATIN_TOKEN)?.length ?? 0;
  return chinese + tokens;
}

function stripMarkup(markdown: string, options: WordCountOptions): string {
  let text = markdown.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');

  text = stripFrontmatter(text);
  text = stripFencedCodeBlocks(text, options.includeCode ?? false);
  if (!(options.includeInlineCode ?? false)) text = text.replace(INLINE_CODE, ' ');

  text = text.replace(HTML_COMMENT, ' ');
  text = text.replace(HTML_TAG, ' ');
  text = stripImages(text, options.includeImageAlt ?? true);

  // Reference definitions (`[id]: https://…`) are link destinations, not prose,
  // and have to go before the reference-link rewrite below.
  text = text.replace(REFERENCE_DEFINITION, '');
  text = text.replace(INLINE_LINK, '$1').replace(REFERENCE_LINK, '$1');
  text = text.replace(BARE_URL, ' ');

  return stripLineMarkup(text);
}

/** Drop a leading YAML frontmatter block, delimited by `---` lines. */
function stripFrontmatter(markdown: string): string {
  const match = /^---[ \t]*\n[\s\S]*?\n---[ \t]*(?:\n|$)/.exec(markdown);
  return match ? markdown.slice(match[0].length) : markdown;
}

/**
 * Remove fenced code blocks, keeping or dropping their contents. Fence lines
 * and their info string (```` ```ts ````) never count either way. An
 * unterminated fence runs to the end of the document, as in CommonMark.
 */
function stripFencedCodeBlocks(markdown: string, keepContent: boolean): string {
  const output: string[] = [];
  let fence: Fence | null = null;

  for (const line of markdown.split('\n')) {
    if (fence) {
      const closing = CLOSING_FENCE.exec(line);
      if (closing && closing[1].charAt(0) === fence.marker && closing[1].length >= fence.length) {
        fence = null;
      } else if (keepContent) {
        output.push(line);
      }
      continue;
    }

    const opening = OPENING_FENCE.exec(line);
    if (opening) {
      fence = { marker: opening[1].charAt(0), length: opening[1].length };
      continue;
    }

    output.push(line);
  }

  return output.join('\n');
}

/** Replace images with their alt text (or nothing), before links are rewritten. */
function stripImages(markdown: string, keepAlt: boolean): string {
  return markdown
    .replace(INLINE_IMAGE, (_match: string, alt: string) => (keepAlt ? alt : ' '))
    .replace(REFERENCE_IMAGE, (_match: string, alt: string) => (keepAlt ? alt : ' '));
}

/** Remove heading, list, quote and table scaffolding, keeping the text inside. */
function stripLineMarkup(markdown: string): string {
  const kept: string[] = [];

  for (const line of markdown.split('\n')) {
    if (THEMATIC_BREAK.test(line) || SETEXT_UNDERLINE.test(line) || TABLE_DELIMITER_ROW.test(line)) continue;

    kept.push(
      line
        .replace(BLOCKQUOTE_MARKER, '')
        .replace(HEADING_MARKER, '')
        .replace(LIST_MARKER, '')
        .replace(TASK_CHECKBOX, '')
        .replace(TRAILING_HEADING_HASHES, '')
        .replace(TABLE_PIPE, ' '),
    );
  }

  return kept.join('\n');
}
