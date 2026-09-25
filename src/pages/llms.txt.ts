// /llms.txt: a plain-text guide to the site for AI assistants and AI search (the llms.txt convention).
// Built from the same tour, FAQ and pricing data as the pages, so it never drifts from them.
import type { APIRoute } from 'astro';
import site from '../data/site.json';
import faq from '../data/faq.json';
import pricing from '../data/pricing.json';
import { getTours, getColumns, priceLabel } from '../lib/tours';

export const GET: APIRoute = async ({ site: base }) => {
  const url = (p: string) => new URL(p, base).toString();
  const tours = await getTours();
  const columns = await getColumns();
  const tiers = pricing.tiers.map((t) => `${t.label} ¥${t.pricePerPerson.toLocaleString('en-US')}${t.minGuests > 1 ? ' each' : ''}`).join(', ');
  const lines = [
    `# ${site.name}`,
    '',
    `> ${site.description} Operated by ${site.legalName}; produced by Ninja + Kabuki Tokyo.`,
    '',
    '## Key facts',
    `- Guided walking tours in Tokyo (Shinjuku, Ueno, Asakusa), most about 60 minutes, in English.`,
    `- Price per adult by the number of adults in one booking: ${tiers}. ${pricing.childPolicy} The E-Scooter tour is ¥5,000 per person, ages 16+.`,
    `- Tours are not private: other guests can occasionally join the same time slot.`,
    `- Free cancellation up to 24 hours before the start. Tours run rain or shine; if we cancel for stormy weather, you get a full refund.`,
    `- Book on each tour page (button "Check availability"), which opens the official booking page.`,
    '',
    '## Tours',
    ...tours.map((t) => {
      const d = t.data;
      const pl = priceLabel(t);
      const facts = [
        `${d.area}`,
        `${d.durationMinutes} min`,
        d.startTimes ? `starts ${d.startTimes}` : '',
        d.comingSoon ? 'coming soon (not bookable yet)' : `${pl.amount} ${pl.note}`,
        d.seasonal ? d.seasonal : '',
        d.noCostume ? 'guide does not wear a Ninja costume' : '',
        d.meetingPoint ? `meet: ${d.meetingPoint.name}` : '',
      ].filter(Boolean);
      return `- [${d.title}](${url(`/tour/${t.id}`)}): ${d.summary} (${facts.join('; ')})`;
    }),
    '',
    '## Frequently asked questions',
    ...faq.map((f) => `- ${f.q} ${f.a}`),
    '',
    '## Column (Tokyo travel guides)',
    ...columns.filter((c) => !c.data.draft).map((c) => `- [${c.data.title}](${url(`/column/${c.id}`)}): ${c.data.description}`),
    '',
    '## Other pages',
    `- [All tours](${url('/tours')})`,
    `- [Contact](${url('/contact')})`,
    `- [Terms of Use](${url('/term')})`,
    `- [Privacy Policy](${url('/privacy')})`,
    '',
  ];
  return new Response(lines.join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
