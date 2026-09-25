// Image sitemap: tells Google which photos belong to which page, so tour photos can show in image search and results.
import type { APIRoute } from 'astro';
import { getTours, getColumns } from '../lib/tours';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const GET: APIRoute = async ({ site }) => {
  const abs = (p: string) => new URL(p, site).toString();
  const tours = await getTours();
  const columns = (await getColumns()).filter((c) => !c.data.draft);
  const pages: { loc: string; images: string[] }[] = [
    { loc: abs('/'), images: ['/images/og.jpg', ...tours.map((t) => t.data.heroImage).filter(Boolean) as string[]] },
    ...tours.map((t) => {
      const d = t.data;
      const imgs = [d.heroImage, d.cardBack, ...d.gallery.map((g) => g.src), ...d.story.map((s) => s.image), d.meetingPoint?.image];
      return { loc: abs(`/tour/${t.id}`), images: [...new Set(imgs.filter(Boolean) as string[])] };
    }),
    ...columns.map((c) => ({ loc: abs(`/column/${c.id}`), images: c.data.heroImage ? [c.data.heroImage] : [] })),
  ];
  const body = pages
    .filter((p) => p.images.length)
    .map((p) => `<url><loc>${esc(p.loc)}</loc>${p.images.slice(0, 50).map((i) => `<image:image><image:loc>${esc(abs(i))}</image:loc></image:image>`).join('')}</url>`)
    .join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">${body}</urlset>`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
