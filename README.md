# World Watchout

A control center for world news, built for market research in energy and industry. It pulls about 90 live RSS wires, sorts every headline into one of six lanes, runs a market ticker across the top, highlights the terms you are watching and keeps the items you star. No accounts, no API keys, no database: a Next.js app that fetches public feeds and public quote endpoints and stores your preferences in the browser.

## Features

- **Six lanes**: Oil & Gas, Power & Grid, Renewables & Transition, Industry & Materials, Policy & Geopolitics, Markets & Macro. Lanes are assigned by keyword rules (English and French), with secondary lanes shown when you expand a row. Lanes view or a single Stream view.
- **About 90 live sources**: global wires, energy and industry trade press, Asia, MENA, French press, plus Google News topic wires. All keyless RSS or Atom; aggregator items show the real publisher "via wire".
- **Market ticker**: 27 instruments across energy, metals, FX, indices and rates. Yahoo Finance chart endpoint first, Stooq then Frankfurter (ECB) as fallbacks. Keyless and best effort: a tile shows `n/a` when every provider fails.
- **Watchlist**: amber highlights in titles and summaries, per-term hit counts for the current window, a watch-only toggle, click a term to search it.
- **Saved items**: star a headline to keep it (up to 500), export as CSV or Markdown.
- **Search**: plain words match title, summary and source; `lane:oilgas` and `src:oilprice` tokens narrow by lane or source id. Time windows from 1h to 7d.
- **Filters**: region (Global, Europe, France, MENA, Asia, Americas, Africa), language (EN, FR, AR), and a per-source on/off list with counts.
- **Source health panel**: ok / failed / pending counters and the error text for every failed feed.
- **Auto refresh** every 5 minutes, paused while the tab is hidden and caught up when it comes back. New items since the last refresh carry a `new` tag.
- **Dark and light themes**, applied before hydration so there is no flash.
- **Keyboard shortcuts**:

| Key | Action |
| --- | --- |
| `/` | focus search |
| `Esc` | clear search |
| `r` | refresh feeds and quotes |
| `v` | toggle Lanes / Stream view |
| `w` | toggle watchlist-only |
| `t` | toggle theme |

Preferences (watchlist, saved items, filters, view, theme) live in `localStorage` under `ww:prefs:v1`.

## Run locally

```bash
npm install
npm run dev        # http://localhost:3000
```

Offline, deterministic sample data (no network calls, reproducible screenshots):

```bash
WW_MOCK=1 npm run dev
```

Tests and production build:

```bash
npm test           # offline: feed parsing, dedupe, classifier (tsx, no network)
npm run build
```

## Deploy to Vercel

Import the repository; no environment variables are needed.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/alaaeddine-ahriz/world-watchout)

How load is kept off the publishers:

- The routes export `maxDuration` (60 s for `/api/feeds`, 30 s for `/api/markets`) so a slow feed cannot pin a function.
- Feed fetches use the Next.js data cache (`next: { revalidate: 240 }`; 120 s for quotes), so identical fetches within that window are served from cache instead of re-hitting the publisher for every visitor.
- Responses carry `Cache-Control: public, s-maxage=120, stale-while-revalidate=600` (feeds) and `s-maxage=60, stale-while-revalidate=300` (markets), so the Vercel CDN answers most page loads. A response where every source failed is sent `no-store` so a bad batch is never cached.
- The client fans out `FEED_BATCHES` (4) parallel requests, each covering a quarter of the catalogue, so each function invocation stays short and one failed batch only greys out its own sources.

## Sources

The catalogue is the `SOURCES` array in `src/lib/sources.ts`. Each entry:

| Field | Meaning |
| --- | --- |
| `id` | unique slug; used by `src:` search tokens, the per-source toggle and health. Keep the `gn-` prefix for Google News wires: dedupe treats those as aggregator copies and lets a direct feed win. |
| `name` | label shown in the UI |
| `url` | RSS, Atom or RSS 1.0 feed URL (use the `gnews()` helper for Google News searches) |
| `region` | `global`, `europe`, `france`, `mena`, `asia`, `americas` or `africa` |
| `lang` | `en`, `fr` or `ar` |
| `lane` | default lane when no keyword rule matches; also a small bias in scoring |
| `kind` | omit for plain feeds; `"gnews"` extracts the publisher and strips the " - Publisher" title suffix |

To add a feed, append an entry; to remove one, delete its line. Batches are assigned by index modulo `FEED_BATCHES`, so order does not matter. Raising `FEED_BATCHES` spreads the sources over more parallel invocations (the route accepts up to 16). Per batch, feeds are fetched 12 at a time with a 9 s timeout, capped at 60 items per feed, and anything older than 7 days is dropped.

A frank note: the feeds were curated from known public RSS endpoints but could not be verified from the build environment (no outbound access to the publishers). Expect a handful to 404, redirect to an HTML page ("not a feed") or time out. The Source health panel in the right column, and the Sources list in the sidebar, show the error text for each failed feed: that is the place to spot what needs pruning or swapping after the first real run.

## Lanes

`src/lib/classify.ts` holds one regex per lane (`RULES`), with English and French terms side by side. Text is folded (lowercase, diacritics stripped) before matching, so `électricité` matches `electricite`. Scoring per lane:

- each distinct term hit in the title counts 3, each distinct hit in the first 600 characters of the summary counts 1 (at most 12 distinct hits per lane);
- the source's default lane gets a bias of 1.5, so a generic headline from a power-sector outlet lands in Power rather than Markets;
- the top score is the primary lane; any lane scoring at least `max(2, top / 2)` is kept as a secondary lane (shown when a row is expanded, and matched by `lane:` searches);
- ties fall back to `LANE_ORDER`; no hit at all falls back to the source lane.

To tune: add or remove terms in the relevant regex (lowercase, accent-free, `\b` bounded), then run `npm test`. The `classify:` cases at the bottom of `scripts/test-feeds.ts` are the place to pin a headline you care about.

## Market data

The symbol list is `SYMBOLS` in `src/lib/markets.ts` (`id`, `symbol`, `label`, `group`, `unit`, optional `note`). Providers, in order:

1. Yahoo Finance chart endpoint (`/v8/finance/chart/<symbol>?range=5d&interval=1d`): price, previous close and a short sparkline.
2. Stooq CSV, for the twelve ids in the `STOOQ` map: change is measured against the open.
3. Frankfurter (ECB reference rates), for EUR/USD and GBP/USD only: daily rate, no change figure.

Two tiles are proxies and say so in their tooltip: the EU carbon (EUA) tile uses `CO2.L`, the SparkChange physical EUA ETC on the LSE; the uranium tile uses `URA`, the Global X Uranium ETF. The symbols most likely to be missing on Yahoo are `TTF=F`, `MTF=F`, `ALI=F`, `HRC=F` and `CO2.L`; they render `n/a` until you swap them for something the endpoint serves.

Quotes are delayed and best effort. They are there for orientation while reading the news, not for trading.

## Project layout

```
next.config.ts
package.json
public/favicon.svg
scripts/
  fixtures/            sample RSS 2.0, Atom, RSS 1.0 (RDF) and Google News feeds
  test-feeds.ts        offline tests: parsing, link cleaning, dedupe, classifier
src/
  app/
    api/feeds/route.ts     GET /api/feeds?batch=N&of=M
    api/markets/route.ts   GET /api/markets
    globals.css            theme tokens, layout, lane colours
    layout.tsx             metadata and pre-hydration theme bootstrap
    page.tsx
  components/
    Dashboard.tsx      state, fetch fan-out, refresh loop, keyboard shortcuts
    TopBar.tsx         clock, counters, search, view and theme toggles
    Ticker.tsx         market strip
    Sidebar.tsx        window, lanes, regions, languages, per-source toggles
    LaneBoard.tsx      lanes and stream views
    NewsRow.tsx        one headline row
    RightPanel.tsx     watchlist, saved items, source health
    util.ts            prefs, search parsing, watch matcher, CSV and MD export
  lib/
    classify.ts        keyword rules and lane scoring
    feeds.ts           fetch, parse, normalise, dedupe
    markets.ts         symbol list and quote providers
    mock.ts            deterministic sample data for WW_MOCK=1
    sources.ts         feed catalogue and FEED_BATCHES
    types.ts           shared types, lane, region and language lists
```

## Roadmap ideas

- EIA and ENTSO-E API keys for official inventories, generation and cross-border flows.
- Alert rules: email or Slack when a watch term spikes within a window.
- Per-lane digests (daily or weekly) built from saved and top items.
- Deduping the same story across languages, not only across feeds.
