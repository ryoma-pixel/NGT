// Daily Google rating update. Run by .github/workflows/daily-ratings.yml, or locally:
//   GOOGLE_MAPS_API_KEY=... [GOOGLE_PLACE_ID=...] node scripts/update-ratings.ts
//
// Reads the star rating and review count of the NINJA GO TOURS Google Business Profile (Places API, New)
// and writes them into src/data/reviews.json. The review excerpts themselves are chosen by hand and stay as they are.
// If GOOGLE_PLACE_ID is not set, it searches by name and prints the candidates so the right ID can be saved.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const FILE = join(new URL('..', import.meta.url).pathname, 'src/data/reviews.json');
const KEY = process.env.GOOGLE_MAPS_API_KEY;
const SEARCH = process.env.GOOGLE_PLACE_QUERY ?? 'NINJA GO TOURS Kabukicho Shinjuku';

type Rating = { source: string; score: number; count: number; url: string; label?: string; placeId?: string; updatedAt?: string };
type Place = { id: string; displayName?: { text: string }; formattedAddress?: string; rating?: number; userRatingCount?: number };

function summary(line: string) {
  console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);
}

async function places(path: string, fields: string, body?: object): Promise<unknown> {
  const res = await fetch(`https://places.googleapis.com/v1/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'X-Goog-Api-Key': KEY!, 'X-Goog-FieldMask': fields, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Places API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

async function findPlace(): Promise<Place> {
  if (process.env.GOOGLE_PLACE_ID) {
    return (await places(`places/${process.env.GOOGLE_PLACE_ID}`, 'id,displayName,rating,userRatingCount')) as Place;
  }
  const found = ((await places('places:searchText', 'places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount', { textQuery: SEARCH })) as { places?: Place[] }).places ?? [];
  for (const p of found) summary(`Candidate: ${p.displayName?.text} | ${p.formattedAddress} | ${p.rating}★ (${p.userRatingCount}) | id ${p.id}`);
  const match = found.find((p) => /ninja\s*go/i.test(p.displayName?.text ?? ''));
  if (!match) throw new Error('No place named "NINJA GO …" was found. Set GOOGLE_PLACE_ID.');
  summary(`Using ${match.displayName?.text} (${match.id}). Save this as the GOOGLE_PLACE_ID variable to skip the search.`);
  return match;
}

async function main() {
  if (!KEY) {
    summary('Skipped: GOOGLE_MAPS_API_KEY is not set. Add it under Settings > Secrets and variables > Actions.');
    return;
  }
  const place = await findPlace();
  const { rating, userRatingCount } = place;
  // Guard against empty or odd answers: keep the last known numbers rather than publishing nonsense
  if (typeof rating !== 'number' || rating < 1 || rating > 5 || typeof userRatingCount !== 'number' || userRatingCount < 1) {
    throw new Error(`Unexpected rating data: ${JSON.stringify(place)}`);
  }
  const data = JSON.parse(readFileSync(FILE, 'utf8')) as { ratings: Rating[] };
  const google = data.ratings.find((r) => r.source === 'Google');
  if (!google) throw new Error('reviews.json has no Google entry');
  const before = `${google.score} (${google.count})`;
  if (google.score === rating && google.count === userRatingCount && google.placeId === place.id) {
    summary(`No change: Google ${before}.`);
    return;
  }
  if (userRatingCount < google.count) summary(`Note: the review count went down (${google.count} → ${userRatingCount}).`);
  google.score = rating;
  google.count = userRatingCount;
  google.placeId = place.id;
  google.url = `https://www.google.com/maps/place/?q=place_id:${place.id}`;
  google.updatedAt = new Date().toISOString().slice(0, 10);
  writeFileSync(FILE, `${JSON.stringify(data, null, 2)}\n`);
  summary(`Updated Google rating: ${before} → ${rating} (${userRatingCount}).`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, 'changed=true\n');
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
