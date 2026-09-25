import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';
import { ICONS } from './components/icons';
import { PATTERNS } from './lib/patterns';
import { KAMON_NAMES } from './lib/kamon';
import { INTEREST_IDS } from './lib/quiz';

const tours = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/tours' }),
  schema: z.object({
    title: z.string(),
    // Short name used on cards and the booking bar
    shortTitle: z.string(),
    summary: z.string(),
    area: z.enum(['Shinjuku', 'Ueno', 'Asakusa', 'Osaka']),
    themes: z.array(z.enum(['Entertainment', 'Culture', 'Food', 'Shopping', 'Nightlife', 'FourSeasons', 'E-Scooter', 'History', 'JapaneseCustoms', 'Walk'])).default([]),
    durationMinutes: z.number().default(60),
    language: z.string().default('English'),
    // Free text, e.g. "5:00 PM – 9:00 PM (every 30 minutes)"
    startTimes: z.string().optional(),
    bookingDeadline: z.string().optional(),
    ageNote: z.string().optional(),
    heroImage: z.string().optional(),
    heroAlt: z.string().optional(),
    // One-line teaser that sells the feeling of the tour (shown big in the hero)
    hook: z.string().optional(),
    // Short catch (max ~6 words) shown on cards and as the big hero line
    tagline: z.string().optional(),
    // Traditional pattern the tour wears like a crest (src/lib/patterns.ts)
    pattern: z.enum(PATTERNS).optional(),
    // Family crest shown on cards and the tour page (src/lib/kamon.ts)
    kamon: z.enum(KAMON_NAMES).optional(),
    // Home page quiz (src/lib/quiz.ts): what this tour is really about, and what it also touches on
    quizFor: z.array(z.enum(INTEREST_IDS)).default([]),
    quizAlso: z.array(z.enum(INTEREST_IDS)).default([]),
    // What you will do, as icon + 2-4 word label (icons: see src/components/icons.ts)
    features: z.array(z.object({ icon: z.enum(Object.keys(ICONS) as [keyof typeof ICONS, ...(keyof typeof ICONS)[]]), label: z.string() })).default([]),
    // Tour-specific questions; general ones (meeting point, times, price, booking) are added automatically
    faq: z.array(z.object({ q: z.string(), a: z.string() })).default([]),
    meetingPoint: z.object({
      name: z.string(),
      access: z.string().optional(),
      lookFor: z.string().optional(),
      image: z.string().optional(),
      imageAlt: z.string().optional(),
      mapUrl: z.string().url().optional(),
      // Google Maps embed URL (Share > Embed a map > src). Shown as a map under the meeting point photo.
      mapEmbed: z.string().url().optional(),
    }).optional(),
    // The tour told as chapters, each with a real photo
    story: z.array(z.object({ title: z.string(), text: z.string(), image: z.string().optional(), imageAlt: z.string().optional() })).default([]),
    gallery: z.array(z.object({ src: z.string(), alt: z.string() })).default([]),
    highlights: z.array(z.object({ icon: z.string().optional(), title: z.string(), text: z.string() })).default([]),
    itinerary: z.array(z.object({ title: z.string(), text: z.string().optional() })).default([]),
    itineraryNote: z.string().optional(),
    notes: z.array(z.object({ title: z.string(), text: z.string() })).default([]),
    // Extra per-person cost for tours with materials, added on top of the tier price
    materialCostPerPerson: z.number().default(0),
    // Tours outside the group-size tiers (e.g. E-Scooter) use one flat price per person
    fixedPricePerPerson: z.number().optional(),
    // Tours are shared: other bookings can join the same departure. Set true only for a tour sold as private.
    privateTour: z.boolean().default(false),
    // LINKTIVITY direct booking page for this tour
    bookingUrl: z.string().url().optional(),
    otaLinks: z.array(z.object({ name: z.string(), url: z.string().url() })).default([]),
    seasonal: z.string().optional(),
    // Guides on some tours (Ueno, Asakusa, Nichome) do not wear the Ninja costume: a notice then shows on the tour page (hero, above the FAQ, booking box)
    noCostume: z.boolean().default(false),
    // What the guide wears instead, e.g. "Your guide wears smart-casual clothing." (optional, added to the notice)
    outfit: z.string().optional(),
    // Shown on the site but not bookable yet (no bookingUrl): the card says "Coming soon" and the page asks guests to get in touch
    comingSoon: z.boolean().default(false),
    // Photo for the back of the tour card (defaults to the second gallery photo)
    cardBack: z.string().optional(),
    order: z.number().default(100),
    // Drafts are shown on preview builds only, never on the production site
    draft: z.boolean().default(true),
  }),
});

const columns = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/columns' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    publishedAt: z.coerce.date(),
    area: z.string().optional(),
    heroImage: z.string().optional(),
    relatedTours: z.array(z.string()).default([]),
    // Shown under the article and output as FAQPage structured data (AI search picks these up well)
    faq: z.array(z.object({ q: z.string(), a: z.string() })).default([]),
    // URLs the facts come from (the daily generator fills these in; listed under the article)
    sources: z.array(z.string().url()).default([]),
    keyword: z.string().optional(),
    // true = written by scripts/generate-column.ts; a person checks the facts before setting draft: false
    generated: z.boolean().default(false),
    draft: z.boolean().default(true),
  }),
});

export const collections = { tours, columns };
