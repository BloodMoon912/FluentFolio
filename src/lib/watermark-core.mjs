// Zero-width watermark primitives. Build-time only: HMAC-SHA256 over
// `collection/id`, encoded as U+200B (0) / U+200C (1) so a copied paragraph
// carries a signature that is invisible on screen and in the DOM text.
//
// This is evidence, not protection. The characters are easy to strip; the point
// is that an unedited copy can be traced back to the entry it came from.

import { createHmac } from 'node:crypto';

export const ZERO_WIDTH_ZERO = '\u200B';
export const ZERO_WIDTH_ONE = '\u200C';
export const SIGNATURE_BITS = 32;

/**
 * Signing key for one entry, e.g. `novel/chapter-4`.
 * @param {string} collection
 * @param {string} id
 * @returns {string}
 */
export function signatureKey(collection, id) {
  return `${collection}/${id}`;
}

/**
 * Deterministic 32-bit signature rendered as invisible characters.
 * @param {string} secret
 * @param {string} key
 * @param {number} [bits]
 * @returns {string}
 */
export function encodeSignature(secret, key, bits = SIGNATURE_BITS) {
  if (!secret) throw new Error('encodeSignature requires a secret');
  const digest = createHmac('sha256', secret).update(key).digest();
  let out = '';
  for (let index = 0; index < bits; index += 1) {
    const byte = digest[index >> 3];
    const bit = (byte >> (7 - (index & 7))) & 1;
    out += bit ? ZERO_WIDTH_ONE : ZERO_WIDTH_ZERO;
  }
  return out;
}

/**
 * Runs of zero-width characters, in document order.
 * @param {string} text
 * @returns {string[]}
 */
export function extractZeroWidthRuns(text) {
  return text.match(/[\u200B\u200C]+/g) ?? [];
}

/**
 * Every 32-bit chunk decoded from a run, most-significant bit first.
 * @param {string} text
 * @param {number} [bits]
 * @returns {string[]}
 */
export function decodeRuns(text, bits = SIGNATURE_BITS) {
  const chunks = [];
  for (const run of extractZeroWidthRuns(text)) {
    for (let offset = 0; offset + bits <= run.length; offset += bits) {
      let value = '';
      for (let index = 0; index < bits; index += 1) {
        value += run[offset + index] === ZERO_WIDTH_ONE ? '1' : '0';
      }
      chunks.push(value);
    }
  }
  return chunks;
}

/**
 * Which of the supplied keys have their full signature present in the text.
 * @param {string} secret
 * @param {readonly string[]} keys
 * @param {string} text
 * @param {number} [bits]
 * @returns {string[]}
 */
export function findMatches(secret, keys, text, bits = SIGNATURE_BITS) {
  if (!secret || !text) return [];
  const decoded = new Set(decodeRuns(text, bits));
  if (decoded.size === 0) return [];
  const matches = [];
  for (const key of keys) {
    const digest = createHmac('sha256', secret).update(key).digest();
    let value = '';
    for (let index = 0; index < bits; index += 1) {
      const byte = digest[index >> 3];
      value += (byte >> (7 - (index & 7))) & 1 ? '1' : '0';
    }
    if (decoded.has(value)) matches.push(key);
  }
  return matches;
}
