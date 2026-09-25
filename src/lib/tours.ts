import { getCollection, type CollectionEntry } from 'astro:content';
import pricing from '../data/pricing.json';

// Netlify sets CONTEXT=production only for the live site; previews and local builds show drafts.
export const showDrafts = process.env.CONTEXT !== 'production';

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

export function yen(n: number) {
  return `¥${n.toLocaleString('en-US')}`;
}

export function usd(n: number) {
  return `US$${Math.round(n / pricing.usdRate)}`;
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
