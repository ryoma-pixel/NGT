import { getCollection, type CollectionEntry } from 'astro:content';
import pricing from '../data/pricing.json';
import { usdAmount } from './fx';

// Drafts are hidden only on the live site (Netlify production on ninjagotours.com). The review URL
// (stellar-bavarois-8bc38e.netlify.app) is also a production deploy, so it is told apart by URL, like noindex in Base.astro.
const live = process.env.CONTEXT === 'production' && /(^|\/\/)(www\.)?ninjagotours\.com/.test(process.env.URL ?? '');
export const showDrafts = !live;

export type Tour = CollectionEntry<'tours'>;

export async function getTours(): Promise<Tour[]> {
  const all = await getCollection('tours', ({ data }) => showDrafts || !data.draft);
  return all.sort((a, b) => a.data.order - b.data.order);
}

export async function getColumns() {
  const all = await getCollection('columns', ({ data }) => showDrafts || !data.draft);
  return all.sort((a, b) => b.data.publishedAt.getTime() - a.data.publishedAt.getTime());
}

export function priceTiers(tour: Tour) {
  const { fixedPricePerPerson, materialCostPerPerson } = tour.data;
  if (fixedPricePerPerson) {
    return [{ label: 'Per person', minGuests: 1, maxGuests: 99, pricePerPerson: fixedPricePerPerson }];
  }
  return pricing.tiers.map((t) => ({ ...t, pricePerPerson: t.pricePerPerson + materialCostPerPerson }));
}

// Lowest per-person price, shown as "from" on cards
export function fromPrice(tour: Tour) {
  return Math.min(...priceTiers(tour).map((t) => t.pricePerPerson));
}

/**
 * Price as guests should read it. Showing only "¥2,500 (4+ guests)" made people think
 * the tour needs 4 people, so tiered tours show the full range: "¥2,500–8,000", "per person, by party size".
 */
export function priceLabel(tour: Tour): { amount: string; note: string; jpy: [number, number] } {
  if (tour.data.fixedPricePerPerson) {
    const p = tour.data.fixedPricePerPerson;
    return { amount: yen(p), note: 'per person', jpy: [p, p] };
  }
  const prices = priceTiers(tour).map((t) => t.pricePerPerson);
  const lo = Math.min(...prices), hi = Math.max(...prices);
  return { amount: `${yen(lo)}–${hi.toLocaleString('en-US')}`, note: 'per person, by party size', jpy: [lo, hi] };
}

export function yen(n: number) {
  return `¥${n.toLocaleString('en-US')}`;
}

export function usd(n: number) {
  return `US$${usdAmount(n)}`;
}

// Areas with their own listing page (Osaka is reserved in the schema but redirects to /tours for now)
export const AREAS = ['Shinjuku', 'Ueno', 'Asakusa'] as const;
export const THEMES = ['Entertainment', 'Culture', 'Food', 'Shopping', 'Nightlife', 'FourSeasons', 'E-Scooter', 'History', 'JapaneseCustoms', 'Walk'] as const;

export const THEME_LABELS: Record<string, string> = {
  Entertainment: 'Entertainment',
  Culture: 'Culture & Shrines',
  Food: 'Food & Drink',
  Shopping: 'Shopping & Souvenirs',
  Nightlife: 'Nightlife',
  FourSeasons: 'Seasonal',
  'E-Scooter': 'E-Scooter Rides',
  History: 'History & Culture',
  JapaneseCustoms: 'Japanese Customs',
  Walk: 'Walking Tours',
};

export const AREA_JP: Record<string, string> = {
  Shinjuku: '新宿',
  Ueno: '上野',
  Asakusa: '浅草',
  Osaka: '大阪',
};
