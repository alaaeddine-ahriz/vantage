# World Watchout

A control center for world news, built for market research in energy and industry. It pulls about 90 live RSS wires, sorts every headline into one of six lanes, runs a market ticker across the top, highlights the terms you are watching and keeps the items you star. On top of that it tags every headline with countries, companies, commodities, organisations and topics, and turns those tags into a globe, a force graph and a set of explainable patterns, all computed in the browser. No accounts, no database, no API key required: a Next.js app that fetches public feeds and public quote endpoints and stores your preferences in the browser. One optional key (`ANTHROPIC_API_KEY`) enables the AI brief.

![World Watchout desktop view: ticker, filter sidebar, six lane columns, watchlist and source health](docs/screenshot-desktop.png)

![Globe view: mention intensity per country, lane-coloured points and flow arcs](docs/screenshot-globe.png)

![Graph view: entities, events, co-occurrence and causal links](docs/screenshot-graph.png)

![Intel view: spikes, emerging entities, clusters and the AI brief](docs/screenshot-intel.png)

## Features

- **Six lanes**: Oil & Gas, Power & Grid, Renewables & Transition, Industry & Materials, Policy & Geopolitics, Markets & Macro. Lanes are assigned by keyword rules (English and French), with secondary lanes shown when you expand a row. Lanes view or a single Stream view.
- **Globe**: 3D globe (globe.gl, three.js, world-atlas country shapes bundled, no external tiles) shaded by mention intensity per country, lane-coloured points, animated flow arcs between countries named together in a headline (companies count as their home country). Click a country to filter every other view; a headline sheet lists that country's items.
- **Graph**: zoomable force graph (react-force-graph-2d) of countries, companies, commodities, organisations, topics and event nodes (the headlines that bind them). Co-occurrence links plus typed causal links (causes, impacts, triggers, responds, supplies) drawn with arrows and particles. Labels reveal progressively as you zoom; focus a node to see its neighbourhood, its headlines and its links. A "causal only" toggle and a node finder.
- **Intel**: explainable local patterns (spikes against a 6-day baseline, emerging entities, co-occurrence clusters, co-movement) computed in the browser in about 50 ms on every refresh and filter change, each one citing its headlines, plus an AI brief on demand (see below).
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
| `v` | cycle Lanes, Stream, Globe, Graph, Intel |
| `w` | toggle watchlist-only |
| `t` | toggle theme |

Preferences (watchlist, saved items, filters, view, theme) live in `localStorage` under `ww:prefs:v1`.

## Run locally

```bash
npm install
npm run dev        # http://localhost:3000
```

Offline, deterministic sample data (no network calls, reproducible screenshots). `WW_MOCK=1` also mocks `/api/brief`, which then returns a deterministic sample brief derived from the request instead of calling the model:

```bash
WW_MOCK=1 npm run dev
```

To try the AI brief locally, put `ANTHROPIC_API_KEY=...` in `.env.local` (see `.env.example`).

Tests and production build:

```bash
npm test           # offline: feed parsing, dedupe, classifier, entity extraction, intel patterns, brief validation and mock (tsx, no network)
npm run build
```

## Deploy to Vercel

Import the repository; no environment variables are needed for feeds, quotes, globe, graph and local patterns. Add `ANTHROPIC_API_KEY` (Project Settings, Environment Variables) if you want the AI brief.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/alaaeddine-ahriz/world-watchout)

How load is kept off the publishers:

- The routes export `maxDuration` (60 s for `/api/feeds`, 30 s for `/api/markets`, 120 s for `/api/brief`) so a slow feed or a long model call cannot pin a function.
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

## AI brief

The Intel view has one button, "Generate brief". It POSTs the currently filtered headlines to `/api/brief`: at most 250 items (ids, titles, sources, lanes, regions, ages in hours, short summaries), the local patterns and your watchlist. The route (`src/app/api/brief/route.ts`, logic in `src/lib/brief.ts`) sends them to Claude and returns a `Brief`:

- a one-line headline and a Markdown recap (4 to 8 bullets);
- per-lane summaries, each citing the item ids it rests on (ids that are not in the request are dropped server side);
- patterns with a confidence score, confirming, refuting or extending the local ones;
- typed causal links (causes, impacts, triggers, responds, supplies) between named entities; the client maps the labels to gazetteer ids and merges them into the Graph view as dashed amber links;
- suggested watch terms, one click to add to the watchlist.

Configuration: model `claude-opus-5`, structured JSON output against `BRIEF_SCHEMA`, adaptive thinking, `max_tokens` 8000, and prompt caching on the system prompt (the analyst instructions are identical between calls, so only the headline payload is billed at full price). The request language follows the batch: French when most items are French, English otherwise.

Enable it by setting `ANTHROPIC_API_KEY` on Vercel (Project Settings, Environment Variables) or in `.env.local`. Without a key the button still works: the route returns a deterministic sample brief built from the same request and marks it `mock` with `error: "ANTHROPIC_API_KEY not set"`, and the panel says so.

Cost: one call per click, nothing runs automatically. Input is roughly the size of 250 headlines (a few thousand tokens, compact JSON keys) plus the cached system prompt; output is capped at 8k tokens including thinking. Shrink the window or the filters to send fewer items.

Privacy: only headline text, source names, lanes, timestamps and your watch terms leave the browser. No personal data, no saved items, no preferences.

## Entities and patterns

The gazetteer is `src/lib/gazetteer.ts`: 197 countries, about 200 companies, 21 commodities, 18 organisations and 30 topics, each with folded EN and FR aliases (lowercase, no diacritics, so `Électricité de France` and `EDF` both resolve). Countries carry a centroid for the globe; companies carry a home country (`iso2`) and a sector lane; the EU carries coordinates so it can appear on the globe as a place. `BLOCKED_PHRASES` at the bottom lists phrases the extractor consumes without tagging ("dow jones" is not the chemicals group, "gold medal" is not the metal).

To add a company, append one line to `COMPANIES`:

```ts
company("verbund", "Verbund", "AT", "power", ["verbund ag", "oesterreichische elektrizitaetswirtschaft"]),
```

The fields are `id` (unique slug, used in graph node ids and pattern ids), `kind` (set by the helper), `label` (shown in the UI), `iso2` (home country, drives globe flows), `lat`/`lng` (optional, only countries and the EU need them), `aliases` (folded lowercase; the helper folds them again as a guard, and the label itself is always an alias) and `sector` (a lane id, used for node colour). Aliases of one or two characters ("BP", "EU", "US") are matched case-sensitively on the raw text so they never collide with ordinary words. Run `npm test` after editing: `scripts/test-intel.ts` pins extraction cases.

Extraction (`src/lib/entities.ts`): all aliases of three or more characters are compiled once into a single regex serialised as a prefix trie, so the engine dispatches one character at a time instead of trying thousands of alternatives at each position. Boundaries are Unicode aware (`(?<![\p{L}\p{N}])` and `(?![\p{L}\p{N}])`), so `shell` does not match inside `shellfish` and accented words bound correctly. The longest alias wins ("saudi aramco" over "saudi"). Short uppercase acronyms go through a second, case-sensitive regex over the raw text. Inside a multi-word match, commodity and topic aliases are also tagged ("US Steel" gives steel). Mentions are cached per item id, so a refresh that returns the same items costs one Map lookup each.

Flows (`src/lib/intel.ts`): for every headline, the countries it names, plus the home countries of the companies it names, are listed in order of first mention. The first one is the origin and each later one is a destination, so a headline that names Qatar, TotalEnergies and Germany gives arcs QA to FR and QA to DE. Arcs are counted, coloured by their dominant lane, capped at 200 and carry up to 30 item ids for the headline sheet.

Patterns, scored 0 to 1, top 25 kept:

| Kind | Fires when | Score |
| --- | --- | --- |
| spike | an entity has at least 3 mentions in the last 24h and at least twice its baseline, where baseline is mentions over the previous 6 days divided by 6 | `(recent - baseline) / max(3, 2 * baseline)` |
| emerging | at least 3 mentions in the last 48h and none in the five days before | `recent48 / 6` |
| cluster | a pair of entities shares at least 3 headlines (top 12 pairs) | `shared / 8` |
| co-movement | a country or organisation and a commodity both spike in the same 24h and share headlines | mean of the two spike scores |

Every pattern lists the entity ids and item ids behind it, so the Intel panel can show the headlines that produced it. To tune, edit the thresholds inline in the patterns block of `buildIntel` (`recent >= 3`, `2 * baseline`, `recent48 >= 3`, `p.count >= 3`, the divisors) and the graph thresholds just above it (`minMentions`, `minShared`, `maxNodes` default 250, 60 event candidates). Nothing is randomised: the same items and the same `now` give the same snapshot, which is what `scripts/test-intel.ts` checks.

## Project layout

```
next.config.ts
package.json
public/favicon.svg
docs/                  screenshots
scripts/
  fixtures/            sample RSS 2.0, Atom, RSS 1.0 (RDF) and Google News feeds
  test-feeds.ts        offline tests: parsing, link cleaning, dedupe, classifier
  test-brief.ts        offline tests: brief request validation, normalisation, mock brief
  test-intel.ts        offline tests: entity extraction, flows, graph, patterns
src/
  app/
    api/brief/route.ts     POST /api/brief (Claude, or a mock without a key)
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
    GlobeView.tsx      3D globe: points, arcs, country pick, headline sheet (+ .module.css)
    GraphView.tsx      force graph: entities, events, causal links, focus, finder (+ .module.css)
    IntelPanel.tsx     patterns, AI brief, watch suggestions (+ .module.css)
    NewsRow.tsx        one headline row
    RightPanel.tsx     watchlist, saved items, source health
    util.ts            prefs, VIEWS, search parsing, watch matcher, CSV and MD export
  lib/
    brief.ts           brief validation, prompt, JSON schema, normalisation, mock brief
    classify.ts        keyword rules and lane scoring
    entities.ts        trie regex entity extractor over the gazetteer
    feeds.ts           fetch, parse, normalise, dedupe
    gazetteer.ts       countries, companies, commodities, orgs, topics, aliases
    intel-types.ts     entity, geo, graph, pattern and brief types
    intel.ts           mentions, points, flows, graph and patterns (browser safe)
    markets.ts         symbol list and quote providers
    mock.ts            deterministic sample data for WW_MOCK=1
    sources.ts         feed catalogue and FEED_BATCHES
    text.ts            fold and title key helpers shared by server and client
    types.ts           shared types, lane, region and language lists
```

## Roadmap ideas

- EIA and ENTSO-E API keys for official inventories, generation and cross-border flows.
- Alert rules: email or Slack when a watch term or a pattern spikes within a window.
- Per-lane digests (daily or weekly) built from saved and top items.
- Deduping the same story across languages, not only across feeds.
