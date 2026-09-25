// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Keep the same URL shape as the old STUDIO site (/tour/slug, no trailing slash)
// so existing search rankings and ad/GBP links keep working without redirects.
export default defineConfig({
  site: 'https://ninjagotours.com',
  trailingSlash: 'never',
  build: { format: 'file' },
  // utility pages (404, thank-you) stay out of the sitemap
  integrations: [sitemap({ filter: (page) => !/\/(404|contact-thanks)$/.test(page) })],
});
