/**
 * Brave Search provider test — isolated in its own file so the top-level
 * jest.mock() here cleanly overrides the config module without fighting the
 * serp-provider mock in search.test.ts.
 */

// Must appear before any import of lib/search
jest.mock('../lib/config', () => ({
  getConfig: () => ({
    OPENAI_API_KEY: 'test-openai',
    SEARCH_API_KEY: 'test-brave',
    SEARCH_API_PROVIDER: 'brave',
    OPENAI_MODEL: 'gpt-4.1',
  }),
}));

import { searchPerson } from '../lib/search';

const mockFetch = jest.fn();
global.fetch = mockFetch;

const braveResponse = {
  ok: true,
  json: () =>
    Promise.resolve({
      web: {
        results: [{ url: 'https://brave.com/result', title: 'Brave result', description: 'snippet' }],
      },
    }),
} as Response;

describe('searchPerson – Brave provider', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(braveResponse);
  });

  it('calls the Brave Search API endpoint', async () => {
    await searchPerson({ firstName: 'Jane', lastName: 'Smith' });
    const braveCall = mockFetch.mock.calls.find((call) =>
      (call[0] as string).includes('api.search.brave.com')
    );
    expect(braveCall).toBeDefined();
  });

  it('returns results from Brave responses', async () => {
    const result = await searchPerson({ firstName: 'Jane', lastName: 'Smith' });
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0].url).toBe('https://brave.com/result');
    expect(result.results[0].title).toBe('Brave result');
  });

  it('deduplicates Brave results by URL', async () => {
    const result = await searchPerson({ firstName: 'Jane', lastName: 'Smith' });
    const urls = result.results.map((r) => r.url);
    const uniqueUrls = new Set(urls);
    expect(uniqueUrls.size).toBe(urls.length);
    // All 20 sources return the same URL — only 1 should survive
    expect(result.results).toHaveLength(1);
  });
});
