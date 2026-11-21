// Sätteri mdast plugin that appends an invisible per-entry signature to the end
// of each paragraph in protected collections.
//
// Astro's Markdown entry renderer passes the entry's absolute `filePath` as the
// compile `fileURL`, so the factory can derive `collection/id` without touching
// stored Markdown or the CMS. The plugin runs before the hast sanitizer: that
// sanitizer filters tags and attributes, never text, so the zero-width
// characters survive.
//
// If WATERMARK_SECRET is unset the build must still succeed: the plugin is
// skipped once, with a single warning.

import { fileURLToPath } from 'node:url';
import { encodeSignature, signatureKey } from './watermark-core.mjs';

const CONTENT_FILE = /[\\/]src[\\/]content[\\/](novel|dictionary|world)[\\/](.+)\.md$/;
const TERMINAL_PUNCTUATION = /[。！？!?…」』”’"'.]$/;

/** @typedef {{ children: Array<{ type: string }> }} RootLike */

let warnedMissingSecret = false;

/**
 * @param {{ secret?: string }} [options]
 * @returns {(context: import('satteri').PluginFactoryContext) => import('satteri').MdastPluginEntry}
 */
export function createWatermarkPlugin(options = {}) {
  const secret = options.secret ?? process.env.WATERMARK_SECRET;

  return function watermarkFactory(context) {
    if (!secret) {
      if (!warnedMissingSecret) {
        warnedMissingSecret = true;
        console.warn('[watermark] WATERMARK_SECRET is not set; skipping invisible watermarks.');
      }
      return false;
    }
    if (!context.fileURL) return false;

    let filePath;
    try {
      filePath = fileURLToPath(context.fileURL);
    } catch {
      return false;
    }

    const match = CONTENT_FILE.exec(filePath);
    if (!match) return false;

    const collection = match[1];
    const id = match[2].replace(/\\/g, '/');
    const signature = encodeSignature(secret, signatureKey(collection, id));

    let paragraphCount = 0;
    let inserted = 0;

    return {
      name: 'bm-watermark',
      /** @param {RootLike} root */
      before(root) {
        paragraphCount = root.children.filter((node) => node.type === 'paragraph').length;
      },
      /**
       * @param {import('satteri').MdastNode} node
       * @param {import('satteri').MdastVisitorContext} visitor
       */
      paragraph(node, visitor) {
        if (!visitor.textContent(node).trim()) return;
        if (paragraphCount >= 3) {
          // Long documents only sign paragraphs that end in sentence punctuation.
          if (!TERMINAL_PUNCTUATION.test(visitor.textContent(node).trimEnd())) return;
        } else if (inserted > 0) {
          return;
        }
        visitor.appendChild(node, { type: 'text', value: signature });
        inserted += 1;
      },
      /**
       * @param {RootLike} root
       * @param {import('satteri').MdastVisitorContext} visitor
       */
      after(root, visitor) {
        // A short document whose paragraphs never end in punctuation still gets
        // one signature, so the "fewer than 3 paragraphs" rule always holds.
        if (inserted > 0) return;
        const first = root.children.find((node) => node.type === 'paragraph');
        if (first && visitor.textContent(first).trim()) {
          visitor.appendChild(first, { type: 'text', value: signature });
        }
      },
    };
  };
}
