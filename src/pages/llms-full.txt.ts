// /llms-full.txt: every tour in full (route, meeting point, times, rules, questions) for AI assistants.
// /llms.txt is the short index; this is the detailed companion. Built from the same data as the pages.
import type { APIRoute } from 'astro';
import site from '../data/site.json';
import faq from '../data/faq.json';
import pricing from '../data/pricing.json';
import { getTours, priceLabel } from '../lib/tours';

export const GET: APIRoute = async ({ site: base }) => {
  const url = (p: string) => new URL(p, base).toString();
  const tours = await getTours();
  const out: string[] = [
    `# ${site.name}: full tour details`,
    '',
    `> ${site.description} Operated by ${site.legalName}; produced by Ninja + Kabuki Tokyo. Short index: ${url('/llms.txt')}`,
    '',
    '## How pricing works',
    `- ${pricing.note}`,
    ...pricing.tiers.map((t) => `- ${t.label}: ¥${t.pricePerPerson.toLocaleString('en-US')} per adult`),
    `- ${pricing.childPolicy}`,
    '- The E-Scooter tour has a fixed price of ¥5,000 per person and is for ages 16 and over.',
    '- Anything bought during a tour (a hanko seal, a knife, food, drinks, entry fees) is paid separately.',
    '',
    '## Policies',
    '- Free cancellation up to 24 hours before the start. Later cancellations, no-shows and late arrivals who miss the tour are not refunded.',
    '- Tours start on time and cannot wait for late guests.',
    '- Tours run rain or shine. If the company cancels (for example for stormy weather), the full fee is refunded.',
    '- Tours are not private; other guests can occasionally join the same time slot.',
    `- Terms: ${url('/term')}`,
    '',
  ];
  for (const t of tours) {
    const d = t.data;
    const pl = priceLabel(t);
    out.push(`## ${d.title}`, '', `URL: ${url(`/tour/${t.id}`)}`, '', d.summary, '');
    out.push(`- Area: ${d.area}, Tokyo`);
    out.push(`- Duration: about ${d.durationMinutes} minutes`);
    if (d.startTimes) out.push(`- Start times (last start included): ${d.startTimes}`);
    if (d.bookingDeadline) out.push(`- Booking deadline: ${d.bookingDeadline}`);
    out.push(`- Price: ${d.comingSoon ? 'coming soon, not bookable yet' : `${pl.amount} ${pl.note}`}`);
    out.push(`- Language: ${d.language}`);
    if (d.ageNote) out.push(`- Age: ${d.ageNote}`);
    if (d.seasonal) out.push(`- Season: ${d.seasonal}`);
    if (d.noCostume) out.push(`- Note: the guide does not wear a Ninja costume on this tour.${d.outfit ? ` ${d.outfit}` : ''}`);
    if (d.meetingPoint) out.push(`- Meeting point: ${[d.meetingPoint.name, d.meetingPoint.access].filter(Boolean).join('. ')}`);
    if (!d.comingSoon && d.bookingUrl) out.push(`- Book: ${d.bookingUrl}`);
    if (d.itinerary.length) {
      out.push('', 'Route:');
      d.itinerary.forEach((s, i) => out.push(`${i + 1}. ${s.title}${s.text ? `: ${s.text}` : ''}`));
    }
    if (d.story.length) {
      out.push('', 'Highlights:');
      d.story.forEach((s) => out.push(`- ${s.title}: ${s.text}`));
    }
    if (d.faq.length) {
      out.push('', 'Questions:');
      d.faq.forEach((f) => out.push(`- ${f.q} ${f.a}`));
    }
    out.push('');
  }
  out.push('## General questions', ...faq.map((f) => `- ${f.q} ${f.a}`), '');
  return new Response(out.join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
