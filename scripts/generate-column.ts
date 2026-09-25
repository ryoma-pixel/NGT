// Daily column generator (SEO / AI-search). Run by .github/workflows/daily-column.yml, or locally:
//   ANTHROPIC_API_KEY=... node scripts/generate-column.ts            (writes one draft column)
//   node scripts/generate-column.ts --dry-run                         (prints the next topic and prompt, no API call)
//
// 1. Takes the next topic from src/data/column-topics.json (or lets Claude pick one when the queue is empty).
// 2. Research: Claude searches the web and writes fact notes with source URLs.
// 3. Writing: Claude writes the article as JSON (structured output) from those notes only.
// 4. Saves src/content/columns/<slug>.md with draft: true. A person reviews it in Pages CMS and sets draft: false.
import Anthropic from '@anthropic-ai/sdk';
import type { BetaMessage, BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const TOURS_DIR = join(ROOT, 'src/content/tours');
const COLUMNS_DIR = join(ROOT, 'src/content/columns');
const TOPICS_FILE = join(ROOT, 'src/data/column-topics.json');

const MODEL = 'claude-opus-5';
// Server-side fallback: if the model declines a request, the API retries it on Anthropic's recommended fallback model.
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
// Stop generating while this many drafts are waiting for review, so unchecked articles don't pile up.
const MAX_PENDING = Number(process.env.COLUMN_MAX_PENDING ?? 7);
const DRY_RUN = process.argv.includes('--dry-run');

type Topic = { keyword: string; angle: string; area: string; relatedTours: string[] };
type TopicFile = { _note?: string; queue: Topic[]; done: (Topic & { slug: string; date: string })[] };
type TourInfo = { id: string; title: string; area: string; summary: string; notes: string[]; heroImage: string | undefined };
type Article = {
  slug: string;
  title: string;
  description: string;
  body: string;
  faq: { q: string; a: string }[];
  relatedTours: string[];
  sourcesUsed: string[];
};

// --- read the site content (tiny frontmatter reader: top-level "key: value" lines are enough here) ---
function frontmatter(file: string) {
  const text = readFileSync(file, 'utf8');
  const fm = text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
  const get = (key: string) => {
    const m = fm.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'));
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : undefined;
  };
  const nested = (key: string) => fm.match(new RegExp(`^\\s+${key}:\\s*(.*)$`, 'm'))?.[1].trim();
  return { get, nested };
}

function readTours(): TourInfo[] {
  return readdirSync(TOURS_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f): TourInfo | null => {
      const { get, nested } = frontmatter(join(TOURS_DIR, f));
      if (get('draft') === 'true') return null;
      const notes: string[] = [];
      if (get('comingSoon') === 'true') notes.push('Coming soon: not bookable yet.');
      if (get('seasonal')) notes.push(`Seasonal: ${get('seasonal')}.`);
      const lookFor = nested('lookFor');
      if (lookFor) notes.push(`Meeting: ${lookFor}`);
      return {
        id: f.replace(/\.md$/, ''),
        title: get('shortTitle') ?? get('title') ?? f,
        area: get('area') ?? '',
        summary: get('summary') ?? '',
        notes,
        heroImage: get('heroImage'),
      };
    })
    .filter((t): t is TourInfo => t !== null);
}

function readColumns() {
  return readdirSync(COLUMNS_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const { get } = frontmatter(join(COLUMNS_DIR, f));
      return { slug: f.replace(/\.md$/, ''), title: get('title') ?? '', draft: get('draft') === 'true' };
    });
}

// --- Claude calls ---
// Created in main() after the API key check, so a dry run needs no key.
let client: Anthropic;

function textOf(message: BetaMessage) {
  return message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
}

function checkStop(message: BetaMessage, step: string) {
  if (message.stop_reason === 'refusal') throw new Error(`${step}: the request was declined (${message.stop_details?.category ?? 'no category'}).`);
  if (message.stop_reason === 'max_tokens') throw new Error(`${step}: the answer was cut off (max_tokens).`);
}

async function callJson<T>(system: string, prompt: string, schema: Record<string, unknown>, maxTokens: number): Promise<T> {
  const message = await client.beta.messages
    .stream({
      model: MODEL,
      max_tokens: maxTokens,
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      system,
      messages: [{ role: 'user', content: prompt }],
      output_config: { format: { type: 'json_schema', schema } },
    })
    .finalMessage();
  checkStop(message, 'writing');
  logUsage('writing', message);
  return JSON.parse(textOf(message)) as T;
}

async function research(topic: Topic, tours: TourInfo[]) {
  const related = tours.filter((t) => topic.relatedTours.includes(t.id));
  const messages: BetaMessageParam[] = [
    {
      role: 'user',
      content: `You are researching an article for international travellers planning a trip to Tokyo.

Search query the article must answer: "${topic.keyword}"
Angle: ${topic.angle}
Area: ${topic.area}
Our related tours (for context only, do not research them): ${related.map((t) => `${t.title} (${t.area})`).join('; ') || 'none'}

Search the web and collect the facts a careful travel writer would need: history, what to see, practical details (access, opening hours, rules, typical costs), etiquette, and seasonal notes. Prefer official sources (city, shrine or temple, park, station, government tourism sites) and well-known travel publications. Today is ${today()}.

Write your result as plain research notes: short bullet points, each ending with the source URL in brackets. Mark anything that changes often (hours, prices, dates) with "(check before publishing)". If sources disagree, say so. Do not write the article itself.`,
    },
  ];
  const sources = new Set<string>();
  let notes = '';
  for (let turn = 0; turn < 5; turn++) {
    const message = await client.beta.messages
      .stream({
        model: MODEL,
        max_tokens: 16000,
        betas: [FALLBACK_BETA],
        fallbacks: 'default',
        thinking: { type: 'adaptive' },
        tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 8 }],
        messages,
      })
      .finalMessage();
    checkStop(message, 'research');
    logUsage('research', message);
    for (const block of message.content) {
      if (block.type === 'text') {
        notes += block.text;
        for (const c of block.citations ?? []) if ('url' in c && c.url) sources.add(c.url);
      }
    }
    // A long search turn can pause; send it back to let Claude continue.
    if (message.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: message.content });
      continue;
    }
    break;
  }
  for (const url of notes.match(/https?:\/\/[^\s\])>"]+/g) ?? []) sources.add(url.replace(/[.,;]+$/, ''));
  if (notes.trim().length < 400) throw new Error('research: the notes are too short to write from.');
  return { notes, sources: [...sources] };
}

const HOUSE_RULES = `You write the "Column" section of NINJA GO TOURS (ninjagotours.com), a Tokyo company that runs 60-minute walking tours with a local guide (a "Ninja") in Shinjuku, Ueno and Asakusa.

Readers: international travellers (mostly English speakers) planning a Tokyo trip, often reading on a phone or getting this article summarised by an AI search engine.

Voice: warm, curious, concrete, a friendly local. Plain English, short paragraphs. No hype words ("hidden gem", "must-see", "ultimate"), no clickbait, no emoji.

Accuracy rules (most important):
- Use only facts from the research notes, plus basic, stable facts any Tokyo guidebook agrees on. Never invent numbers, opening hours, prices, dates, quotes, statistics, reviews, customer stories or guide names.
- If a practical detail is marked "(check before publishing)" or is not in the notes, describe it without the exact figure and tell readers to check the official site.
- Be respectful with safety, religion and LGBTQ+ topics. No stereotypes.

Structure (built for search and AI answers):
- Begin with a 2-3 sentence paragraph that directly answers the search query. No heading above it.
- Then 4-7 sections with "##" headings phrased the way people search (questions or clear topics). "###" is allowed inside sections. Use bullet lists or one small table where they help.
- 1,100-1,600 words in the body. No "#" (H1) heading, no images, no HTML.
- Mention NINJA GO TOURS at most twice and only where it genuinely helps. Link 1-2 of the related tours with Markdown links in the form [text](/tour/<id>). Do not mention tour prices, discounts or availability. Respect the tour notes (for example, some guides do not wear a Ninja costume; coming-soon tours cannot be booked yet, so say "coming soon").
- End with a short "## Explore it with a local" section (2-3 sentences) that links one related tour.
- Also write 3-5 FAQ items: real questions travellers ask, each answer 1-3 self-contained sentences that make sense when quoted alone.`;

function articleSchema(tourIds: string[], sources: string[]) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['slug', 'title', 'description', 'body', 'faq', 'relatedTours', 'sourcesUsed'],
    properties: {
      slug: { type: 'string', description: 'URL slug: lowercase words joined by hyphens, 3-6 words, contains the main keyword' },
      title: { type: 'string', description: 'Article title, 45-70 characters, contains the main keyword, no clickbait' },
      description: { type: 'string', description: 'Meta description, 120-155 characters, answers the query' },
      body: { type: 'string', description: 'Article body in Markdown, following the structure rules' },
      faq: {
        type: 'array',
        items: { type: 'object', additionalProperties: false, required: ['q', 'a'], properties: { q: { type: 'string' }, a: { type: 'string' } } },
      },
      relatedTours: { type: 'array', items: { type: 'string', enum: tourIds } },
      sourcesUsed: { type: 'array', items: sources.length ? { type: 'string', enum: sources } : { type: 'string' } },
    },
  };
}

// --- helpers ---
function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date());
}

function logUsage(step: string, m: BetaMessage) {
  const u = m.usage;
  const search = u.server_tool_use?.web_search_requests ?? 0;
  console.log(`[${step}] model=${m.model} input=${u.input_tokens} output=${u.output_tokens}${search ? ` searches=${search}` : ''}`);
}

function summary(line: string) {
  console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);
}

function uniqueSlug(raw: string, taken: Set<string>) {
  const base = raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || `tokyo-column-${today()}`;
  let slug = base;
  for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
  return slug;
}

function validate(a: Article) {
  const problems: string[] = [];
  const words = a.body.split(/\s+/).filter(Boolean).length;
  if (words < 700) problems.push(`body is only ${words} words`);
  if (/^#\s/m.test(a.body)) problems.push('body has an H1 heading');
  if (!/^##\s/m.test(a.body)) problems.push('body has no ## sections');
  if (a.faq.length < 2) problems.push('fewer than 2 FAQ items');
  if (problems.length) throw new Error(`The article failed checks: ${problems.join('; ')}`);
  // Prices go stale and must come from the tour pages, so flag them for the reviewer instead of failing.
  return /[¥$]\s?\d|\byen\b/i.test(a.body) ? ['The article mentions a price. Check it against the official source.'] : [];
}

const q = (s: string) => JSON.stringify(s);

function toMarkdown(a: Article, topic: Topic, heroImage: string | undefined, sources: string[]) {
  const lines = [
    '---',
    `title: ${q(a.title)}`,
    `description: ${q(a.description)}`,
    `publishedAt: ${q(today())}`,
    `area: ${q(topic.area)}`,
    ...(heroImage ? [`heroImage: ${q(heroImage)}`] : []),
    `relatedTours: ${JSON.stringify(a.relatedTours)}`,
    'faq:',
    ...a.faq.flatMap((f) => [`  - q: ${q(f.q)}`, `    a: ${q(f.a)}`]),
    `sources: ${JSON.stringify(sources)}`,
    `keyword: ${q(topic.keyword)}`,
    'generated: true',
    'draft: true',
    '---',
    a.body.trim(),
    '',
  ];
  return lines.join('\n');
}

// --- main ---
async function main() {
  const tours = readTours();
  const columns = readColumns();
  const topics = JSON.parse(readFileSync(TOPICS_FILE, 'utf8')) as TopicFile;

  const pending = columns.filter((c) => c.draft).length;
  if (pending >= MAX_PENDING) {
    summary(`Skipped: ${pending} column drafts are waiting for review (limit ${MAX_PENDING}). Publish or delete some, then it will continue.`);
    return;
  }
  if (!DRY_RUN && !process.env.ANTHROPIC_API_KEY) {
    summary('Skipped: ANTHROPIC_API_KEY is not set. Add it under Settings > Secrets and variables > Actions.');
    return;
  }

  const tourList = tours.map((t) => `- ${t.id}: ${t.title} (${t.area}). ${t.summary}${t.notes.length ? ` Notes: ${t.notes.join(' ')}` : ''}`).join('\n');
  const existing = columns.map((c) => `- ${c.title}`).join('\n');

  let topic = topics.queue[0];
  if (!DRY_RUN) client = new Anthropic();
  if (DRY_RUN) {
    console.log(topic ? `Next topic: ${JSON.stringify(topic, null, 2)}` : 'Queue is empty: Claude would pick a topic.');
    console.log(`\nTours given to Claude:\n${tourList}\n\nPending drafts: ${pending}/${MAX_PENDING}`);
    return;
  }

  if (!topic) {
    topic = await callJson<Topic>(
      HOUSE_RULES,
      `Pick the next column topic. Choose a specific search query that international travellers type when planning a Tokyo trip, that one of our tours genuinely helps with, and that the existing articles below do not already answer.\n\nOur tours:\n${tourList}\n\nExisting articles:\n${existing}`,
      {
        type: 'object',
        additionalProperties: false,
        required: ['keyword', 'angle', 'area', 'relatedTours'],
        properties: {
          keyword: { type: 'string' },
          angle: { type: 'string' },
          area: { type: 'string', enum: ['Shinjuku', 'Ueno', 'Asakusa'] },
          relatedTours: { type: 'array', items: { type: 'string', enum: tours.map((t) => t.id) } },
        },
      },
      4000,
    );
  }
  console.log(`Topic: ${topic.keyword}`);

  const { notes, sources } = await research(topic, tours);
  const article = await callJson<Article>(
    HOUSE_RULES,
    `Write the article.

Search query to answer: "${topic.keyword}"
Angle: ${topic.angle}
Area: ${topic.area}
Suggested related tours: ${topic.relatedTours.join(', ')}

Our tours (ids, names and notes you must respect):
${tourList}

Existing articles (do not repeat them; you may mention a related one in passing):
${existing}

Research notes (your only source for specific facts):
<notes>
${notes}
</notes>

In sourcesUsed, list the URLs from the notes that the article actually relies on.`,
    articleSchema(tours.map((t) => t.id), sources),
    32000,
  );

  const warnings = validate(article);
  const slug = uniqueSlug(article.slug, new Set(columns.map((c) => c.slug)));
  const related = article.relatedTours.length ? article.relatedTours : topic.relatedTours;
  const hero = tours.find((t) => t.id === related[0])?.heroImage;
  const used = article.sourcesUsed.length ? article.sourcesUsed : sources;
  const file = join(COLUMNS_DIR, `${slug}.md`);
  if (existsSync(file)) throw new Error(`${file} already exists`);
  writeFileSync(file, toMarkdown({ ...article, relatedTours: related }, topic, hero, used.slice(0, 10)));

  topics.queue = topics.queue.filter((t) => t.keyword !== topic.keyword);
  topics.done.push({ ...topic, slug, date: today() });
  writeFileSync(TOPICS_FILE, `${JSON.stringify(topics, null, 2)}\n`);

  summary(`Draft written: src/content/columns/${slug}.md`);
  summary(`Title: ${article.title}`);
  for (const w of warnings) summary(`Check: ${w}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `slug=${slug}\n`);
}

main().catch((err: unknown) => {
  if (err instanceof Anthropic.APIError) console.error(`Claude API error ${err.status}: ${err.message}`);
  else console.error(err);
  process.exit(1);
});
