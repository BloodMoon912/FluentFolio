// Image signatures accepted by the admin upload route.
//
// The client-declared `file.type` is never trusted: it is only a hint from the
// browser. The route reads the actual bytes, matches one of these signatures,
// and uses the verified MIME / extension for the R2 object and its public URL.
// SVG/HTML are deliberately absent because they are active content.

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MiB
export const MULTIPART_OVERHEAD_BYTES = 64 * 1024; // boundary/headers allowance

export type AllowedImageMime = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
export type AllowedImageExtension = 'jpg' | 'png' | 'webp' | 'gif';

export interface VerifiedImageType {
  mime: AllowedImageMime;
  extension: AllowedImageExtension;
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.byteLength < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === byte);
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff] as const;
const GIF87A_SIGNATURE = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61] as const; // "GIF87a"
const GIF89A_SIGNATURE = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] as const; // "GIF89a"
const RIFF_SIGNATURE = [0x52, 0x49, 0x46, 0x46] as const; // "RIFF"
const WEBP_SIGNATURE = [0x57, 0x45, 0x42, 0x50] as const; // "WEBP"

/**
 * Detects one of the four allowed raster formats from its leading bytes.
 * Returns `null` for anything else (SVG, HTML, PDF, truncated files, …).
 */
export function detectImageType(bytes: Uint8Array): VerifiedImageType | null {
  if (startsWith(bytes, PNG_SIGNATURE)) {
    return { mime: 'image/png', extension: 'png' };
  }

  if (startsWith(bytes, JPEG_SIGNATURE)) {
    return { mime: 'image/jpeg', extension: 'jpg' };
  }

  if (startsWith(bytes, GIF87A_SIGNATURE) || startsWith(bytes, GIF89A_SIGNATURE)) {
    return { mime: 'image/gif', extension: 'gif' };
  }

  // WebP is a RIFF container: "RIFF" at byte 0, "WEBP" at byte 8.
  if (startsWith(bytes, RIFF_SIGNATURE) && startsWith(bytes.subarray(8), WEBP_SIGNATURE)) {
    return { mime: 'image/webp', extension: 'webp' };
  }

  return null;
}

/** Defence-in-depth check for a request's declared Content-Length. */
export function isDeclaredUploadTooLarge(contentLength: number): boolean {
  return Number.isFinite(contentLength) && contentLength > MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES;
}
