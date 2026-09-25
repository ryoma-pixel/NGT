import fs from 'node:fs';
import path from 'node:path';

const PUBLIC = path.resolve('public');
const WIDTHS = [640, 1024];

/**
 * Build a srcset for an image in /public, using the smaller copies made by
 * scripts/make-image-variants.py (photo-640.webp, photo-1024.webp) when they exist.
 */
export function srcset(src: string | undefined, fullWidth = 1600): string | undefined {
  if (!src || !src.endsWith('.webp')) return undefined;
  const parts = WIDTHS.filter((w) => fs.existsSync(path.join(PUBLIC, src.replace(/\.webp$/, `-${w}.webp`)))).map(
    (w) => `${src.replace(/\.webp$/, `-${w}.webp`)} ${w}w`,
  );
  if (parts.length === 0) return undefined;
  return [...parts, `${src} ${fullWidth}w`].join(', ');
}
