import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

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
    meetingPoint: z.object({
      name: z.string(),
      access: z.string().optional(),
      lookFor: z.string().optional(),
      mapUrl: z.string().url().optional(),
    }).optional(),
    highlights: z.array(z.object({ icon: z.string().optional(), title: z.string(), text: z.string() })).default([]),
    itinerary: z.array(z.object({ title: z.string(), text: z.string().optional() })).default([]),
    itineraryNote: z.string().optional(),
    notes: z.array(z.object({ title: z.string(), text: z.string() })).default([]),
    // Extra per-person cost for tours with materials, added on top of the tier price
    materialCostPerPerson: z.number().default(0),
    // Tours outside the group-size tiers (e.g. E-Scooter) use one flat price per person
    fixedPricePerPerson: z.number().optional(),
    // Group-tier tours are private (one group per guide); set false for shared-departure tours
    privateTour: z.boolean().default(true),
    // LINKTIVITY direct booking page for this tour
    bookingUrl: z.string().url().optional(),
    otaLinks: z.array(z.object({ name: z.string(), url: z.string().url() })).default([]),
    seasonal: z.string().optional(),
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
    draft: z.boolean().default(true),
  }),
});

export const collections = { tours, columns };
