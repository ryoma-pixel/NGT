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
