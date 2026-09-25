import pricing from '../data/pricing.json';
import { FX_URLS } from './fx-sources';

// Yen → US dollar rate. At build time we ask a free public rate service (ECB reference rates via Frankfurter);
// if it is unreachable we fall back to pricing.json `usdRate` (yen per dollar). In the browser, Base.astro
// refreshes the rate once every 12 hours, so the dollar amounts follow the current exchange rate.

async function fetchRate(): Promise<number | null> {
  for (const url of FX_URLS) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) continue;
      const j = (await res.json()) as { rates?: { USD?: number } };
      const r = j.rates?.USD;
      if (r && r > 0.001 && r < 0.1) return r;
    } catch {
      // try the next source
    }
  }
  return null;
}

/** US dollars per yen, as known at build time. */
export const USD_PER_JPY: number = (await fetchRate()) ?? 1 / pricing.usdRate;

export function usdAmount(jpy: number) {
  return Math.round(jpy * USD_PER_JPY);
}
