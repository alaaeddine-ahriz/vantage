import { BLOCKED_PHRASES, GAZETTEER } from "./gazetteer";
import type { Entity } from "./intel-types";
import { fold } from "./text";

/**
 * Entity extraction over the gazetteer. Client-safe: no Node imports.
 *
 * One combined regex is compiled lazily from every alias (longest first, so
 * "saudi aramco" wins over "saudi") and run once over the folded text.
 * Aliases shorter than three characters ("US", "EU", "BP") only count when
 * they are upper-case in the raw text, through a second case-sensitive regex,
 * so the pronoun "us" and the French "eu" never tag a country.
 */

export const ENTITY_BY_ID: Record<string, Entity> = Object.fromEntries(
  GAZETTEER.map((e) => [e.id, e]),
);

/** Kinds that may also be tagged when found inside a longer company or country alias ("US Steel" gives steel). */
const NESTED_KINDS = new Set<string>(["commodity", "topic"]);

const SHORT_MAX = 2;

interface Matcher {
  /** Folded-text regex over every alias of 3+ characters plus the blocked phrases. */
  long: RegExp;
  /** Raw-text, case-sensitive regex over the upper-cased short aliases. */
  short: RegExp | null;
  /** Folded-text regex over commodity and topic aliases only, used inside multi-word matches. */
  nested: RegExp;
  byAlias: Map<string, string>;
  byShort: Map<string, string>;
}

let cached: Matcher | null = null;

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

interface TrieNode {
  end: boolean;
  next: Map<string, TrieNode>;
}

/**
 * Serialises the aliases as a prefix trie so the regex engine dispatches on
 * one character at a time instead of trying thousands of alternatives at
 * every position. Optional groups are greedy, so the longest alias that also
 * satisfies the right-hand boundary wins ("saudi aramco" over "saudi").
 */
function alternation(list: string[]): string {
  const root: TrieNode = { end: false, next: new Map() };
  for (const alias of list) {
    let node = root;
    for (const ch of alias) {
      let child = node.next.get(ch);
      if (!child) {
        child = { end: false, next: new Map() };
        node.next.set(ch, child);
      }
      node = child;
    }
    node.end = true;
  }
  const serialise = (node: TrieNode): string => {
    if (node.next.size === 0) return "";
    const parts: string[] = [];
    for (const [ch, child] of node.next) parts.push(escape(ch) + serialise(child));
    const body = parts.length === 1 ? parts[0] : `(?:${parts.join("|")})`;
    return node.end ? `(?:${body})?` : body;
  };
  return serialise(root);
}

const LEFT = "(?<![\\p{L}\\p{N}])";
const RIGHT = "(?![\\p{L}\\p{N}])";

function build(): Matcher {
  const byAlias = new Map<string, string>();
  const byShort = new Map<string, string>();
  const nestedAliases: string[] = [];
  for (const e of GAZETTEER) {
    for (const a of e.aliases) {
      if (a.length <= SHORT_MAX) {
        byShort.set(a.toUpperCase(), e.id);
        continue;
      }
      if (!byAlias.has(a)) byAlias.set(a, e.id);
      if (NESTED_KINDS.has(e.kind)) nestedAliases.push(a);
    }
  }
  const longAliases = [...byAlias.keys()];
  for (const b of BLOCKED_PHRASES) {
    const f = fold(b);
    if (!byAlias.has(f)) {
      byAlias.set(f, "");
      longAliases.push(f);
    }
  }
  const shorts = [...byShort.keys()];
  return {
    long: new RegExp(`${LEFT}(?:${alternation(longAliases)})${RIGHT}`, "giu"),
    short: shorts.length ? new RegExp(`${LEFT}(?:${alternation(shorts)})${RIGHT}`, "gu") : null,
    nested: new RegExp(`${LEFT}(?:${alternation(nestedAliases)})${RIGHT}`, "giu"),
    byAlias,
    byShort,
  };
}

function matcher(): Matcher {
  if (!cached) cached = build();
  return cached;
}

/**
 * Entity ids mentioned in `text`, deduplicated, in order of first occurrence.
 * `fold` is applied once; positions in the folded text line up with the raw
 * text closely enough for ordering, which is all we need.
 */
export function extractEntities(text: string): string[] {
  if (!text) return [];
  const m = matcher();
  const folded = fold(text);
  const hits: { at: number; id: string }[] = [];

  m.long.lastIndex = 0;
  let r: RegExpExecArray | null;
  while ((r = m.long.exec(folded)) !== null) {
    const alias = r[0];
    const id = m.byAlias.get(alias);
    if (id) hits.push({ at: r.index, id });
    // "US Steel" or "Tata Steel" also mention steel: scan inside multi-word matches
    // for commodity and topic aliases, whatever the outer entity kind.
    if (alias.includes(" ") || alias.includes("-")) {
      const outer = id ? ENTITY_BY_ID[id] : undefined;
      if (!outer || !NESTED_KINDS.has(outer.kind)) {
        m.nested.lastIndex = 0;
        let n: RegExpExecArray | null;
        while ((n = m.nested.exec(alias)) !== null) {
          const nid = m.byAlias.get(n[0]);
          if (nid && nid !== id) hits.push({ at: r.index + n.index, id: nid });
        }
      }
    }
    if (r[0].length === 0) m.long.lastIndex++;
  }

  if (m.short) {
    m.short.lastIndex = 0;
    while ((r = m.short.exec(text)) !== null) {
      const id = m.byShort.get(r[0]);
      if (id) hits.push({ at: r.index, id });
    }
  }

  hits.sort((a, b) => a.at - b.at);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const h of hits) {
    if (!seen.has(h.id)) {
      seen.add(h.id);
      out.push(h.id);
    }
  }
  return out;
}

/** Drops the compiled matcher so the next extraction rebuilds it (tests, hot reload). */
export function resetEntityMatcher(): void {
  cached = null;
}
