/**
 * Product media rules: which files are accepted, how big they may be, and how they are recognised.
 * Files are identified by their first bytes (magic numbers), never by the name or the browser-declared type.
 */

export type MediaKind = 'image' | 'model3d';

export const MEDIA_LIMITS: Record<MediaKind, number> = {
  image: 5 * 1024 * 1024,
  model3d: 50 * 1024 * 1024,
};

/** Multer's hard cap for any upload; the per-kind limit above is checked after this. */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

const EXT_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  glb: 'model/gltf-binary',
};

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function parseKind(value: string): MediaKind | null {
  return value === 'image' || value === 'model3d' ? value : null;
}

export function mimeForExt(ext: string): string {
  return EXT_TO_MIME[ext] ?? 'application/octet-stream';
}

/** Returns the detected type, or null when the bytes are not an accepted format. */
export function detectMedia(buf: Buffer): { mime: string; ext: string } | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { mime: 'image/png', ext: 'png' };
  }
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return { mime: 'image/webp', ext: 'webp' };
  }
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'glTF') {
    return { mime: 'model/gltf-binary', ext: 'glb' };
  }
  return null;
}

/** Images may be JPEG, PNG or WebP; 3D models must be single-file GLB. */
export function allowedFor(kind: MediaKind, mime: string): boolean {
  return kind === 'image' ? mime.startsWith('image/') : mime === 'model/gltf-binary';
}
