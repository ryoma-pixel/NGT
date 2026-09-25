# Column routine: how to write one column draft

A scheduled Claude Code session (a Routine, Mon/Wed/Fri 05:53 JST) follows this file to write **one** column draft for ninjagotours.com.
It runs on the owner's Claude plan, so it needs no API key. Edit this file to change how columns are written; the next run uses it.

The rules below are the same as in `scripts/generate-column.ts` (the API version, kept as a paid alternative).

## 0. Settings

- Branch to read and write: `claude/ninja-go-tours-website-redesign-0vzadh` (change this line when the site moves to its production branch).
- Stop when this many drafts are waiting for review: 7.

## 1. Get ready

1. Use the repository at `/home/user/NGT`. If it is not there, clone `ryoma-pixel/NGT` into it.
2. `git fetch origin <branch>` and `git checkout -B <branch> origin/<branch>` (always start from the latest).
3. Read `CLAUDE.md` (project rules). Never publish anything, never change DNS or other settings, never touch files other than those listed in step 5.
4. Count the drafts waiting for review: files in `src/content/columns/` with `draft: true` in the front matter. If there are 7 or more, stop and report "Skipped: N drafts are waiting for review". Do not write anything.

## 2. Pick the topic

- Take the first item of `queue` in `src/data/column-topics.json` (keyword, angle, area, relatedTours).
- If the queue is empty, choose a specific search query that international travellers type when planning a Tokyo trip, that one of our tours genuinely helps with, and that no existing column already answers (check the titles in `src/content/columns/`).

## 3. Research

- Search the web (WebSearch, WebFetch) for the facts a careful travel writer needs: history, what to see, practical details (access, opening hours, rules, typical costs), etiquette, seasonal notes.
- Prefer official sources (city, shrine or temple, park, station, government tourism sites) and well-known travel publications.
- Keep notes as bullet points, each with its source URL. Mark anything that changes often (hours, prices, dates) as "check before publishing". If sources disagree, note it.
- If you cannot find enough reliable facts, stop and report it instead of writing a thin article.

## 4. Write (house rules)

You write the "Column" section of NINJA GO TOURS, a Tokyo company that runs 60-minute walking tours with a local guide (a "Ninja") in Shinjuku, Ueno and Asakusa.

Readers: international travellers (mostly English speakers) planning a Tokyo trip, often reading on a phone or getting the article summarised by an AI search engine.

Voice: warm, curious, concrete, a friendly local. Plain English, short paragraphs. No hype words ("hidden gem", "must-see", "ultimate"), no clickbait, no emoji.

Accuracy (most important):
- Use only facts from your research notes, plus basic, stable facts any Tokyo guidebook agrees on. Never invent numbers, opening hours, prices, dates, quotes, statistics, reviews, customer stories or guide names.
- If a practical detail is "check before publishing" or not in your notes, describe it without the exact figure and tell readers to check the official site.
- Be respectful with safety, religion and LGBTQ+ topics. No stereotypes.

Our tours: read `src/content/tours/*.md` (skip `draft: true`). Respect what each file says:
- `comingSoon: true` → not bookable yet, say "coming soon".
- `noCostume: true` → the guide does not wear a Ninja costume on that tour; do not describe it as walking with a Ninja.
- `seasonal` → mention the season.
- Never mention tour prices, discounts or availability (the tour pages are the source of truth).

Structure (for search and AI answers):
- Start with a 2-3 sentence paragraph that directly answers the search query. No heading above it.
- Then 4-7 sections with `##` headings phrased the way people search (questions or clear topics). `###` is allowed inside sections. Bullet lists or one small table where they help.
- 1,100-1,600 words in the body. No `#` (H1), no images, no HTML.
- Mention NINJA GO TOURS at most twice, only where it genuinely helps. Link 1-2 related tours as `[text](/tour/<id>)`.
- End with a short `## Explore it with a local` section (2-3 sentences) that links one related tour.
- 3-5 FAQ items: real traveller questions, each answer 1-3 self-contained sentences.

## 5. Save the draft

Create `src/content/columns/<slug>.md` (slug: lowercase words joined by hyphens, 3-6 words, contains the keyword; must not already exist) with exactly this front matter:

```
---
title: "45-70 characters, contains the keyword, no clickbait"
description: "Meta description, 120-155 characters, answers the query"
publishedAt: "YYYY-MM-DD (today, Tokyo time)"
area: "Shinjuku | Ueno | Asakusa"
heroImage: "the heroImage of the first related tour"
relatedTours: ["tour-id", "tour-id"]
faq:
  - q: "Question"
    a: "Answer"
sources: ["https://...", "https://..."]   # up to 10 URLs the article relies on
keyword: "the search query"
generated: true
draft: true
---
Article body in Markdown
```

`draft: true` is required: the column only goes live after a person checks it in Pages CMS.

Then, in `src/data/column-topics.json`, remove the topic from `queue` and add it to `done` as `{ ...topic, "slug": "<slug>", "date": "YYYY-MM-DD" }` (keep the JSON formatting: 2-space indent).

## 6. Check, commit, push

1. `npm ci` (if `node_modules` is missing), then `npm run build`. It must finish with 0 errors; fix the draft if not.
2. Commit only the new column and `src/data/column-topics.json`, message `Column draft: <slug>`.
3. `git push origin <branch>`. If it is rejected because the branch moved, `git pull --rebase origin <branch>` and push again. On network errors retry up to 4 times (2s, 4s, 8s, 16s).

## 7. Report (in Japanese)

End with a short report for the owner:
- タイトルと、確認用URLでのパス（`/column/<slug>`）
- 公開前に確認すべき点：数字（営業時間・料金・日付）とその出典、「check before publishing」にした箇所、料金らしき記述の有無
- 確認と公開の方法：Pages CMS の Column でその記事を開き、事実を確かめて draft を外す（外すまで本番サイトには出ない）
