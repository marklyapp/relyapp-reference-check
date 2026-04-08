import { getConfig } from './config';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SearchPersonInput {
  firstName: string;
  lastName: string;
  /** Optional extra context terms: location, employer, username, email, phone, address, business */
  context?: string[];
}

export interface SearchResult {
  source: string;
  query: string;
  url?: string;
  title?: string;
  snippet?: string;
  /** Raw result object from the API */
  raw?: unknown;
}

export interface SearchPersonResult {
  input: SearchPersonInput;
  queries: string[];
  results: SearchResult[];
  errors: { source: string; query: string; error: string }[];
}

// ─── Search term generation ───────────────────────────────────────────────────

/**
 * Generates name-variation search queries following the pattern:
 *   "First Last" OR "Last, First" OR "FirstLast" OR "LastFirst"
 *   OR "First.Last" OR "First-Last" AND "<context>"
 */
export function buildNameQuery(input: SearchPersonInput): string {
  const { firstName, lastName, context = [] } = input;
  const f = firstName.trim();
  const l = lastName.trim();

  const nameVariants = [
    `"${f} ${l}"`,
    `"${l}, ${f}"`,
    `"${f}${l}"`,
    `"${l}${f}"`,
    `"${f}.${l}"`,
    `"${f}-${l}"`,
  ];

  let query = nameVariants.join(' OR ');

  if (context.length > 0) {
    const contextPart = context.map((c) => `"${c}"`).join(' OR ');
    query = `(${query}) AND (${contextPart})`;
  }

  return query;
}

/**
 * Builds a targeted site-specific query.
 */
export function buildSiteQuery(input: SearchPersonInput, site: string, extra?: string): string {
  const base = buildNameQuery(input);
  const siteFilter = `site:${site}`;
  return extra ? `${base} ${siteFilter} ${extra}` : `${base} ${siteFilter}`;
}

// ─── Source query descriptors ─────────────────────────────────────────────────

interface SourceDescriptor {
  source: string;
  buildQuery: (input: SearchPersonInput) => string;
}

function sources(input: SearchPersonInput): SourceDescriptor[] {
  const nameBase = buildNameQuery(input);

  return [
    // ── Elections AB ──────────────────────────────────────────────────────────
    {
      source: 'Elections AB – contributor (quarterly/annual)',
      buildQuery: (i) =>
        `${buildNameQuery(i)} site:elections.ab.ca "contributor" OR "donor" OR "campaign finance"`,
    },
    {
      source: 'Elections AB – leadership/nomination/third-party',
      buildQuery: (i) =>
        `${buildNameQuery(i)} site:elections.ab.ca "leadership" OR "nomination" OR "third-party advertising"`,
    },

    // ── Elections Canada ──────────────────────────────────────────────────────
    {
      source: 'Elections Canada – donation database',
      buildQuery: (i) =>
        `${buildNameQuery(i)} site:elections.ca OR site:open.canada.ca "political contribution" OR "donation" OR "contributor"`,
    },

    // ── CanLii ────────────────────────────────────────────────────────────────
    {
      source: 'CanLii – court cases & judicial decisions',
      buildQuery: (i) => `${buildNameQuery(i)} site:canlii.org`,
    },

    // ── Professional discipline databases ─────────────────────────────────────
    {
      source: 'Law Society of Alberta',
      buildQuery: (i) => `${buildNameQuery(i)} site:lawsociety.ab.ca`,
    },
    {
      source: 'Real Estate Council of Alberta',
      buildQuery: (i) => `${buildNameQuery(i)} site:reca.ca`,
    },
    {
      source: 'CPA Alberta',
      buildQuery: (i) => `${buildNameQuery(i)} site:cpaalberta.ca`,
    },
    {
      source: 'APEGA – P.Eng',
      buildQuery: (i) => `${buildNameQuery(i)} site:apega.ca`,
    },
    {
      source: 'Professional discipline – general',
      buildQuery: (i) =>
        `${buildNameQuery(i)} "disciplinary" OR "professional misconduct" OR "licence revoked" OR "suspended"`,
    },

    // ── LinkedIn ──────────────────────────────────────────────────────────────
    {
      source: 'LinkedIn – profile',
      buildQuery: (i) => `${buildNameQuery(i)} site:linkedin.com/in`,
    },
    {
      source: 'LinkedIn – posts & activity',
      buildQuery: (i) => `${buildNameQuery(i)} site:linkedin.com "posts" OR "activity" OR "comments"`,
    },

    // ── Twitter / X ───────────────────────────────────────────────────────────
    {
      source: 'Twitter/X – tweets & replies',
      buildQuery: (i) => `${buildNameQuery(i)} site:twitter.com OR site:x.com`,
    },
    {
      source: 'Twitter/X – media & following',
      buildQuery: (i) =>
        `${buildNameQuery(i)} site:twitter.com OR site:x.com "media" OR "following" OR "followers"`,
    },

    // ── Facebook ──────────────────────────────────────────────────────────────
    {
      source: 'Facebook – profile',
      buildQuery: (i) => `${buildNameQuery(i)} site:facebook.com`,
    },
    {
      source: 'Facebook – photos, about, likes, events',
      buildQuery: (i) =>
        `${buildNameQuery(i)} site:facebook.com "photos" OR "about" OR "likes" OR "events"`,
    },

    // ── Instagram ─────────────────────────────────────────────────────────────
    {
      source: 'Instagram – posts & tagged',
      buildQuery: (i) => `${buildNameQuery(i)} site:instagram.com`,
    },
    {
      source: 'Instagram – reels & following',
      buildQuery: (i) =>
        `${buildNameQuery(i)} site:instagram.com "reels" OR "following"`,
    },

    // ── YouTube ───────────────────────────────────────────────────────────────
    {
      source: 'YouTube – channel & videos',
      buildQuery: (i) => `${buildNameQuery(i)} site:youtube.com`,
    },

    // ── Google – general broad search ─────────────────────────────────────────
    {
      source: 'Google – broad name search',
      buildQuery: (i) => buildNameQuery(i),
    },
  ];
}

// ─── API adapters ─────────────────────────────────────────────────────────────

async function searchViaSerpAPI(query: string, apiKey: string): Promise<SearchResult[]> {
  const params = new URLSearchParams({
    q: query,
    api_key: apiKey,
    num: '10',
    hl: 'en',
    gl: 'ca',
  });

  const res = await fetch(`https://serpapi.com/search.json?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`SerpAPI error ${res.status}: ${await res.text()}`);
  }

  const data = (await res.json()) as {
    organic_results?: { link?: string; title?: string; snippet?: string }[];
  };

  return (data.organic_results ?? []).map((r) => ({
    source: 'serpapi',
    query,
    url: r.link,
    title: r.title,
    snippet: r.snippet,
    raw: r,
  }));
}

async function searchViaBraveAPI(query: string, apiKey: string): Promise<SearchResult[]> {
  const params = new URLSearchParams({
    q: query,
    count: '10',
    country: 'CA',
    search_lang: 'en',
  });

  const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params.toString()}`, {
    headers: {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': apiKey,
    },
  });

  if (!res.ok) {
    throw new Error(`Brave Search error ${res.status}: ${await res.text()}`);
  }

  const data = (await res.json()) as {
    web?: { results?: { url?: string; title?: string; description?: string }[] };
  };

  return (data.web?.results ?? []).map((r) => ({
    source: 'brave',
    query,
    url: r.url,
    title: r.title,
    snippet: r.description,
    raw: r,
  }));
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Searches for a person across multiple sources using SerpAPI or Brave Search,
 * based on `SEARCH_API_PROVIDER` config.
 *
 * Each source generates a targeted query using name variations + site filters.
 * Results and errors are returned together — errors for individual sources do
 * not abort the overall search.
 *
 * @example
 * const result = await searchPerson({
 *   firstName: 'Jane',
 *   lastName: 'Smith',
 *   context: ['Calgary', 'Acme Corp'],
 * });
 */
export async function searchPerson(input: SearchPersonInput): Promise<SearchPersonResult> {
  const config = getConfig();
  const { SEARCH_API_KEY: apiKey, SEARCH_API_PROVIDER: provider } = config;

  const sourceList = sources(input);
  const allResults: SearchResult[] = [];
  const allErrors: SearchPersonResult['errors'] = [];
  const queries: string[] = [];

  for (const descriptor of sourceList) {
    const query = descriptor.buildQuery(input);
    queries.push(query);

    try {
      const results =
        provider === 'brave'
          ? await searchViaBraveAPI(query, apiKey)
          : await searchViaSerpAPI(query, apiKey);

      const tagged = results.map((r) => ({ ...r, source: descriptor.source }));
      allResults.push(...tagged);
    } catch (err) {
      allErrors.push({
        source: descriptor.source,
        query,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    input,
    queries,
    results: allResults,
    errors: allErrors,
  };
}
