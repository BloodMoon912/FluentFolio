// Build-time-only PNG rendering for the Open Graph cards.
//
// Only the prerendered routes (`/og.png` and `/og/[slug].png`) import this
// module. It must never be imported from an on-demand route: it reads the
// subsetted font from disk and loads `@resvg/resvg-js`, a native addon that
// cannot run inside the Cloudflare Worker. `astro.config.mjs` therefore sets
// the adapter's `prerenderEnvironment: 'node'` (the default prerender runtime
// is workerd) and externalises this package for the prerender build. The
// deployed result is plain static PNG files, so none of this reaches the
// Worker bundle.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
// Explicit `.ts` extensions: this module (and the pure helpers below) is also
// imported directly by `node --test`, which resolves relative specifiers with
// Node's ESM rules and therefore needs the extension. `tsconfig.json` sets
// `allowImportingTsExtensions` for exactly this case.
import { profile } from './data.ts';
import { renderOgSvg, type OgCardInput } from './og.ts';

export const OG_PNG_WIDTH = 1200;
export const OG_PNG_HEIGHT = 630;

const FONT_DIR = path.resolve(process.cwd(), 'src/assets/fonts');

// Explicit files + `loadSystemFonts: false` make the rasterised output depend
// only on this repository, so a developer machine and CI produce the same PNG.
const FONT_FILES = ['NotoSansTC-Regular.subset.ttf', 'NotoSansTC-Bold.subset.ttf'].map((name) =>
  path.join(FONT_DIR, name),
);

/** The fallback card shared by `/og.png` and an unknown `/og/[slug].png`. */
export function defaultOgCard(): OgCardInput {
  return {
    eyebrow: profile.nameEn,
    title: profile.tagline,
    meta: profile.bio,
    brand: profile.nameShort,
  };
}

function fontFiles(): string[] {
  for (const file of FONT_FILES) {
    if (!existsSync(file)) {
      throw new Error(`OG font not found: ${file}. Expected the subsetted Noto Sans TC files under src/assets/fonts.`);
    }
  }
  return FONT_FILES;
}

let coverage: Set<number> | undefined;

/**
 * Codepoints mapped by the subsetted font, read straight from its `cmap`
 * table. Used only to warn when new content needs the font subset regenerated;
 * the PNG render itself is done by resvg. Only formats 4 and 12 are supported,
 * which is everything `pyftsubset` emits for these fonts.
 */
function loadCharacterCoverage(): Set<number> {
  if (coverage) return coverage;
  const buffer = readFileSync(fontFiles()[0]);
  const codepoints = new Set<number>();

  const numTables = buffer.readUInt16BE(4);
  let cmapOffset = -1;
  for (let i = 0; i < numTables; i += 1) {
    const record = 12 + i * 16;
    if (buffer.toString('ascii', record, record + 4) === 'cmap') {
      cmapOffset = buffer.readUInt32BE(record + 8);
      break;
    }
  }
  if (cmapOffset < 0) throw new Error('The subsetted OG font has no cmap table.');

  const subtableCount = buffer.readUInt16BE(cmapOffset + 2);
  for (let i = 0; i < subtableCount; i += 1) {
    const record = cmapOffset + 4 + i * 8;
    const offset = cmapOffset + buffer.readUInt32BE(record + 4);
    const format = buffer.readUInt16BE(offset);
    if (format === 4) collectFormat4(buffer, offset, codepoints);
    else if (format === 12) collectFormat12(buffer, offset, codepoints);
  }

  coverage = codepoints;
  return coverage;
}

function collectFormat4(buffer: Buffer, offset: number, into: Set<number>): void {
  const segCount = buffer.readUInt16BE(offset + 6) / 2;
  const endCodes = offset + 14;
  const startCodes = offset + 16 + segCount * 2;
  const idDeltas = offset + 16 + segCount * 4;
  const idRangeOffsets = offset + 16 + segCount * 6;

  for (let i = 0; i < segCount; i += 1) {
    const end = buffer.readUInt16BE(endCodes + i * 2);
    const start = buffer.readUInt16BE(startCodes + i * 2);
    const delta = buffer.readInt16BE(idDeltas + i * 2);
    const rangeOffset = buffer.readUInt16BE(idRangeOffsets + i * 2);
    // The final segment is the mandatory 0xFFFF sentinel and maps no characters.
    for (let codepoint = start; codepoint <= end && codepoint !== 0xffff; codepoint += 1) {
      let glyphId: number;
      if (rangeOffset === 0) {
        glyphId = (codepoint + delta) & 0xffff;
      } else {
        const address = idRangeOffsets + i * 2 + rangeOffset + (codepoint - start) * 2;
        if (address + 2 > buffer.length) continue;
        glyphId = buffer.readUInt16BE(address);
        if (glyphId !== 0) glyphId = (glyphId + delta) & 0xffff;
      }
      if (glyphId !== 0) into.add(codepoint);
    }
  }
}

function collectFormat12(buffer: Buffer, offset: number, into: Set<number>): void {
  const groupCount = buffer.readUInt32BE(offset + 12);
  const groups = offset + 16;
  for (let i = 0; i < groupCount; i += 1) {
    const group = groups + i * 12;
    const start = buffer.readUInt32BE(group);
    const end = buffer.readUInt32BE(group + 4);
    // A zero starting glyph id means the range is unmapped.
    if (buffer.readUInt32BE(group + 8) === 0) continue;
    for (let codepoint = start; codepoint <= end; codepoint += 1) into.add(codepoint);
  }
}

/** Characters in `text` that the subsetted OG font cannot render. */
export function findUnsupportedCharacters(text: string): string[] {
  const supported = loadCharacterCoverage();
  const missing: string[] = [];
  for (const character of text) {
    if (/\s/.test(character)) continue;
    const codepoint = character.codePointAt(0) ?? 0;
    if (!supported.has(codepoint) && !missing.includes(character)) missing.push(character);
  }
  return missing;
}

/** Rasterises the same card SVG served by `/og.svg` into a 1200x630 PNG. */
export function renderOgPng(input: OgCardInput): Uint8Array<ArrayBuffer> {
  const missing = findUnsupportedCharacters([input.eyebrow, input.title, input.meta, input.brand].join('\n'));
  if (missing.length > 0) {
    // A warning rather than a failure: publishing content must not be blocked by
    // a missing glyph, but the card would show placeholders until the subset is
    // regenerated (see src/assets/fonts/README.md).
    console.warn(
      `[og] The subsetted OG font has no glyph for: ${missing.join(' ')}. ` +
        'Re-run the font subset step documented in src/assets/fonts/README.md.',
    );
  }

  const resvg = new Resvg(renderOgSvg(input), {
    font: { loadSystemFonts: false, fontFiles: fontFiles() },
  });
  const image = resvg.render();
  if (image.width !== OG_PNG_WIDTH || image.height !== OG_PNG_HEIGHT) {
    throw new Error(`OG card rendered at ${image.width}x${image.height}, expected ${OG_PNG_WIDTH}x${OG_PNG_HEIGHT}.`);
  }
  // resvg types its buffer as `Uint8Array<ArrayBufferLike>`; copy into a plain
  // ArrayBuffer-backed view so `Response` accepts it as a body without a cast.
  const png = image.asPng();
  const output = new Uint8Array(new ArrayBuffer(png.byteLength));
  output.set(png);
  return output;
}
