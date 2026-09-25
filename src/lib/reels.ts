import reels from '../data/reels.json';
import type { Tour } from './tours';

export type Reel = { code: string; url: string; title: string; tour: string; cover: string; tourTitle: string | undefined };

/** Instagram posts with their short code and a cover image (the tour's main photo unless one is set). */
export function getReels(tours: Tour[], onlyTour?: string): Reel[] {
  return reels.items
    .map((r): Reel | null => {
      const code = r.url.match(/instagram\.com\/(?:p|reel|reels)\/([\w-]+)/)?.[1];
      const t = tours.find((x) => x.id === r.tour);
      const cover = r.cover || t?.data.heroImage || '/images/hero/secret-torii.webp';
      return code ? { code, url: `https://www.instagram.com/p/${code}/`, title: r.title, tour: r.tour, cover, tourTitle: t?.data.shortTitle } : null;
    })
    .filter((r): r is Reel => !!r && (!onlyTour || r.tour === onlyTour));
}

// Instagram shortcodes encode the media id, whose top bits are milliseconds since Instagram's epoch.
// Gives the upload date for video structured data without calling Instagram.
export function reelUploadDate(code: string): string | undefined {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let id = 0n;
  for (const ch of code) { const i = abc.indexOf(ch); if (i < 0) return undefined; id = id * 64n + BigInt(i); }
  const ms = Number(id >> 23n) + 1314220021721;
  return ms > 1.3e12 && ms < Date.now() + 864e5 ? new Date(ms).toISOString() : undefined;
}
