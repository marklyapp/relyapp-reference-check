import { buildNameQuery, buildSiteQuery, searchPerson, SearchPersonInput } from '../lib/search';

// ─── buildNameQuery ───────────────────────────────────────────────────────────

describe('buildNameQuery', () => {
  const input: SearchPersonInput = { firstName: 'Jane', lastName: 'Smith' };

  it('includes all six name variants', () => {
    const q = buildNameQuery(input);
    expect(q).toContain('"Jane Smith"');
    expect(q).toContain('"Smith, Jane"');
    expect(q).toContain('"JaneSmith"');
    expect(q).toContain('"SmithJane"');
    expect(q).toContain('"Jane.Smith"');
    expect(q).toContain('"Jane-Smith"');
  });

  it('joins variants with OR', () => {
    const q = buildNameQuery(input);
    expect(q).toMatch(/"Jane Smith" OR "Smith, Jane"/);
  });

  it('appends context with AND when provided', () => {
    const q = buildNameQuery({ ...input, context: ['Calgary', 'Acme Corp'] });
    expect(q).toContain('AND');
    expect(q).toContain('"Calgary"');
    expect(q).toContain('"Acme Corp"');
  });

  it('no AND clause when context is empty', () => {
    const q = buildNameQuery(input);
    expect(q).not.toContain('AND');
  });
});

// ─── buildSiteQuery ───────────────────────────────────────────────────────────

describe('buildSiteQuery', () => {
  const input: SearchPersonInput = { firstName: 'Jane', lastName: 'Smith' };

  it('includes site filter', () => {
    const q = buildSiteQuery(input, 'linkedin.com/in');
    expect(q).toContain('site:linkedin.com/in');
  });

  it('appends extra term when given', () => {
    const q = buildSiteQuery(input, 'twitter.com', '"profile"');
    expect(q).toContain('"profile"');
  });
});

// ─── searchPerson (mocked) ────────────────────────────────────────────────────

// Mock getConfig so tests run without real env vars
jest.mock('../lib/config', () => ({
  getConfig: () => ({
    OPENAI_API_KEY: 'test-openai',
    SEARCH_API_KEY: 'test-search',
    SEARCH_API_PROVIDER: 'serp',
  }),
}));

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

const serpResponse = (results: object[]) =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ organic_results: results }),
  } as Response);

describe('searchPerson', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(serpResponse([]));
  });

  it('returns a result object with input, queries, results, and errors fields', async () => {
    const result = await searchPerson({ firstName: 'Jane', lastName: 'Smith' });
    expect(result).toHaveProperty('input');
    expect(result).toHaveProperty('queries');
    expect(result).toHaveProperty('results');
    expect(result).toHaveProperty('errors');
  });

  it('generates exactly 20 source queries', async () => {
    const result = await searchPerson({ firstName: 'Jane', lastName: 'Smith' });
    expect(result.queries).toHaveLength(20);
  });

  it('generates at least one query per expected source category', async () => {
    const result = await searchPerson({ firstName: 'Jane', lastName: 'Smith' });
    const combined = result.queries.join(' ');
    expect(combined).toContain('elections.ab.ca');
    expect(combined).toContain('elections.ca');
    expect(combined).toContain('canlii.org');
    expect(combined).toContain('linkedin.com');
    expect(combined).toContain('twitter.com');
    expect(combined).toContain('facebook.com');
    expect(combined).toContain('instagram.com');
    expect(combined).toContain('youtube.com');
  });

  it('collects results from all sources', async () => {
    mockFetch.mockResolvedValue(
      serpResponse([{ link: 'https://example.com', title: 'Test', snippet: 'A result' }])
    );
    const result = await searchPerson({ firstName: 'Jane', lastName: 'Smith' });
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0]).toHaveProperty('url');
    expect(result.results[0]).toHaveProperty('title');
    expect(result.results[0]).toHaveProperty('snippet');
  });

  it('deduplicates results by URL', async () => {
    // Same URL returned by every source
    mockFetch.mockResolvedValue(
      serpResponse([{ link: 'https://dup.example.com', title: 'Dup', snippet: 'Duplicate result' }])
    );
    const result = await searchPerson({ firstName: 'Jane', lastName: 'Smith' });
    const urls = result.results.map((r) => r.url);
    const uniqueUrls = new Set(urls);
    expect(uniqueUrls.size).toBe(urls.length);
    // All 20 sources return the same URL, so only 1 result should survive dedup
    expect(result.results).toHaveLength(1);
  });

  it('records errors without aborting the whole search', async () => {
    // Fail on first call, succeed on the rest
    mockFetch
      .mockRejectedValueOnce(new Error('Network failure'))
      .mockResolvedValue(serpResponse([]));

    const result = await searchPerson({ firstName: 'Jane', lastName: 'Smith' });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0].error).toBe('Network failure');
  });

  it('Elections Canada queries use parenthesised OR site scopes', async () => {
    const result = await searchPerson({ firstName: 'Jane', lastName: 'Smith' });
    const ecQuery = result.queries.find((q) => q.includes('elections.ca OR site:open.canada.ca'));
    expect(ecQuery).toBeDefined();
    // Site group must be wrapped in parentheses
    expect(ecQuery).toMatch(/\(site:elections\.ca OR site:open\.canada\.ca\)/);
  });
});
