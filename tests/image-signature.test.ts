import {
  MULTIPART_OVERHEAD_BYTES,
  MAX_UPLOAD_BYTES,
  detectImageType,
  isDeclaredUploadTooLarge,
} from '../src/lib/image-signature.ts';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const ascii = (value: string): Uint8Array => new TextEncoder().encode(value);

describe('detectImageType', () => {
  it('accepts a PNG signature', () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    assert.deepEqual(detectImageType(bytes), { mime: 'image/png', extension: 'png' });
  });

  it('accepts a JPEG signature', () => {
    assert.deepEqual(detectImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0])), {
      mime: 'image/jpeg',
      extension: 'jpg',
    });
  });

  it('accepts GIF87a and GIF89a', () => {
    assert.deepEqual(detectImageType(ascii('GIF87a...')), { mime: 'image/gif', extension: 'gif' });
    assert.deepEqual(detectImageType(ascii('GIF89a...')), { mime: 'image/gif', extension: 'gif' });
  });

  it('accepts a WebP RIFF container', () => {
    assert.deepEqual(detectImageType(ascii('RIFFxxxxWEBP...')), { mime: 'image/webp', extension: 'webp' });
  });

  it('rejects SVG, HTML, PDF and truncated inputs', () => {
    assert.equal(detectImageType(ascii('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
    assert.equal(detectImageType(ascii('<!doctype html><html></html>')), null);
    assert.equal(detectImageType(ascii('%PDF-1.7')), null);
    assert.equal(detectImageType(new Uint8Array()), null);
    assert.equal(detectImageType(new Uint8Array([0x89, 0x50])), null);
    assert.equal(detectImageType(ascii('RIFFxxxxNOPE...')), null);
  });
});

describe('isDeclaredUploadTooLarge', () => {
  it('allows a full-size image plus multipart overhead', () => {
    assert.equal(isDeclaredUploadTooLarge(MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES), false);
  });

  it('rejects a body above the limit plus overhead', () => {
    assert.equal(isDeclaredUploadTooLarge(MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES + 1), true);
  });

  it('ignores a non-finite Content-Length and lets the byte check decide', () => {
    assert.equal(isDeclaredUploadTooLarge(Number.NaN), false);
  });
});
