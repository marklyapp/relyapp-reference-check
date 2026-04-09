/**
 * __tests__/sources.test.ts
 * Unit tests for lib/sources.ts
 *
 * All tests mock global fetch to avoid real network calls.
 * refs #43
 */

import {
  queryElectionsAB,
  queryElectionsCA,
  queryLobbyistRegistry,
  queryAllSources,
  formatSourcesResult,
  SourcesResult,
  ElectionsABResult,
  ElectionsCAResult,
  LobbyistResult,
} from '../lib/sources';

// ─── Mock fetch ───────────────────────────────────────────────────────────────

const mockFetch = jest.fn();
global.fetch = mockFetch;

function mockResponse(body: string, status = 200): Promise<Response> {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body),
    headers: { get: () => null },
  } as unknown as Response);
}

// ─── Elections Alberta sample HTML ───────────────────────────────────────────

const ELECTIONS_AB_SUCCESS_HTML = `
<html><body>
<TABLE CELLSPACING=1 CLASS=ListContainer>
  <TR>
    <TH>Event</TH>
    <TH>Contributor</TH>
    <TH>Location</TH>
    <TH>Recipient</TH>
    <TH>Receipt Count</TH>
    <TH>Amount</TH>
  </TR>
  <TBODY>
  <TR>
    <TD CLASS="ListCellW1">2023 Annual</TD>
    <TD CLASS="ListCellW1"><A HREF="javascript:void(0);">SMITH JANE</A></TD>
    <TD CLASS="ListCellW1">CALGARY</TD>
    <TD CLASS="ListCellW1">Constituency</TD>
    <TD CLASS="ListCellW1" ALIGN=RIGHT>1</TD>
    <TD CLASS="ListCellW1" ALIGN=RIGHT>$500.00</TD>
  </TR>
  <TR>
    <TD CLASS="ListCellW2">2022 Annual</TD>
    <TD CLASS="ListCellW2"><A HREF="javascript:void(0);">SMITH JANE</A></TD>
    <TD CLASS="ListCellW2">CALGARY</TD>
    <TD CLASS="ListCellW2">Party</TD>
    <TD CLASS="ListCellW2" ALIGN=RIGHT>2</TD>
    <TD CLASS="ListCellW2" ALIGN=RIGHT>$1,000.00</TD>
  </TR>
  </TBODY>
</TABLE>
</body></html>`;

const ELECTIONS_AB_EMPTY_HTML = `
<html><body>
<P>No records found for this search.</P>
</body></html>`;

const ELECTIONS_AB_TRUNCATED_HTML = ELECTIONS_AB_SUCCESS_HTML.replace(
  '<html>',
  '<html><!-- The results of this search are limited to the first 200 items encountered. -->'
);

// ─── Elections Canada sample HTML ─────────────────────────────────────────────

const ELECTIONS_CA_SUCCESS_HTML = `
<html><body>
<table>
  <tr>
    <th>Contributor</th>
    <th>Recipient Type</th>
    <th>Recipient</th>
    <th>Province</th>
    <th>Amount</th>
    <th>Year</th>
  </tr>
  <tr>
    <td>Smith, Jane</td>
    <td>Party</td>
    <td>Liberal Party of Canada</td>
    <td>AB</td>
    <td>$400.00</td>
    <td>2021</td>
  </tr>
</table>
</body></html>`;

const ELECTIONS_CA_EMPTY_HTML = `
<html><body>
<p>No contributions found for this search.</p>
</body></html>`;

// ─── Alberta Lobbyist Registry sample HTML ────────────────────────────────────

const LOBBYIST_PAGE_HTML = `
<html><body>
<form method="POST" action="/apex/wwv_flow.accept">
  <input type="hidden" name="p_flow_id" value="171">
  <input type="hidden" name="p_flow_step_id" value="9996">
  <input type="hidden" name="p_instance" value="123456789">
  <input type="hidden" name="p_page_submission_id" value="ABC123">
  <input type="hidden" name="p_arg_names" value="P9996_SEARCH_NAME">
</form>
</body></html>`;

const LOBBYIST_RESULTS_HTML = `
<html><body>
<table>
  <tr>
    <th>Name</th>
    <th>Registrant Type</th>
    <th>Status</th>
    <th>Subject Matter</th>
    <th>Registration Date</th>
  </tr>
  <tr>
    <td>Smith, Jane</td>
    <td>Consultant Lobbyist</td>
    <td>Active</td>
    <td>Energy regulation</td>
    <td>2022-01-15</td>
  </tr>
</table>
</body></html>`;

const LOBBYIST_EMPTY_HTML = `
<html><body>
<p>No records found for this search criteria.</p>
</body></html>`;

// ─── queryElectionsAB ─────────────────────────────────────────────────────────

describe('queryElectionsAB', () => {
  beforeEach(() => mockFetch.mockReset());

  it('returns parsed records on success', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(ELECTIONS_AB_SUCCESS_HTML));
    const result = await queryElectionsAB({ firstName: 'Jane', lastName: 'Smith' });

    expect(result.source).toBe('Elections Alberta');
    expect(result.status).toBe('ok');
    expect(result.records).toHaveLength(2);
    expect(result.records[0].event).toBe('2023 Annual');
    expect(result.records[0].contributor).toBe('SMITH JANE');
    expect(result.records[0].location).toBe('CALGARY');
    expect(result.records[0].amount).toBe('$500.00');
  });

  it('returns no_results when empty response', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(ELECTIONS_AB_EMPTY_HTML));
    const result = await queryElectionsAB({ firstName: 'Jane', lastName: 'Smith' });

    expect(result.status).toBe('no_results');
    expect(result.records).toHaveLength(0);
  });

  it('marks result as truncated when 200-item limit message present', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(ELECTIONS_AB_TRUNCATED_HTML));
    const result = await queryElectionsAB({ firstName: 'Jane', lastName: 'Smith' });

    expect(result.truncated).toBe(true);
  });

  it('returns unavailable when fetch fails (network error)', async () => {
    mockFetch.mockResolvedValueOnce(null);
    const result = await queryElectionsAB({ firstName: 'Jane', lastName: 'Smith' });

    expect(result.status).toBe('unavailable');
    expect(result.error).toBeDefined();
  });

  it('returns error on non-2xx HTTP status', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse('Server Error', 500));
    const result = await queryElectionsAB({ firstName: 'Jane', lastName: 'Smith' });

    expect(result.status).toBe('error');
    expect(result.error).toContain('500');
  });

  it('submits POST to Elections Alberta with correct contributor name', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(ELECTIONS_AB_SUCCESS_HTML));
    await queryElectionsAB({ firstName: 'Jane', lastName: 'Smith' });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('efpublic.elections.ab.ca');
    expect(init.method).toBe('POST');
    expect(String(init.body)).toContain('Smith');
    expect(String(init.body)).toContain('Jane');
  });
});

// ─── queryElectionsCA ─────────────────────────────────────────────────────────

describe('queryElectionsCA', () => {
  beforeEach(() => mockFetch.mockReset());

  it('returns parsed records on success', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(ELECTIONS_CA_SUCCESS_HTML));
    const result = await queryElectionsCA({ firstName: 'Jane', lastName: 'Smith' });

    expect(result.source).toBe('Elections Canada');
    expect(result.status).toBe('ok');
    expect(result.records).toHaveLength(1);
    expect(result.records[0].contributor).toBe('Smith, Jane');
    expect(result.records[0].recipient).toBe('Liberal Party of Canada');
    expect(result.records[0].amount).toBe('$400.00');
    expect(result.records[0].year).toBe('2021');
  });

  it('returns no_results when empty response', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(ELECTIONS_CA_EMPTY_HTML));
    const result = await queryElectionsCA({ firstName: 'Jane', lastName: 'Smith' });

    expect(result.status).toBe('no_results');
    expect(result.records).toHaveLength(0);
  });

  it('falls back to POST when GET returns null (timeout)', async () => {
    // First call (GET) returns null (timeout), second call (POST) succeeds
    mockFetch
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(mockResponse(ELECTIONS_CA_SUCCESS_HTML));

    const result = await queryElectionsCA({ firstName: 'Jane', lastName: 'Smith' });
    expect(result.status).toBe('ok');
    expect(result.records).toHaveLength(1);
  });

  it('returns unavailable when both GET and POST fail', async () => {
    mockFetch.mockResolvedValue(null);
    const result = await queryElectionsCA({ firstName: 'Jane', lastName: 'Smith' });

    expect(result.status).toBe('unavailable');
    expect(result.error).toBeDefined();
  });

  it('returns error on non-2xx HTTP status', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse('Error', 503));
    const result = await queryElectionsCA({ firstName: 'Jane', lastName: 'Smith' });

    expect(result.status).toBe('error');
    expect(result.error).toContain('503');
  });
});

// ─── queryLobbyistRegistry ────────────────────────────────────────────────────

describe('queryLobbyistRegistry', () => {
  beforeEach(() => mockFetch.mockReset());

  it('returns parsed records on success', async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse(LOBBYIST_PAGE_HTML))   // page fetch
      .mockResolvedValueOnce(mockResponse(LOBBYIST_RESULTS_HTML)); // form submit

    const result = await queryLobbyistRegistry({ firstName: 'Jane', lastName: 'Smith' });

    expect(result.source).toBe('Alberta Lobbyist Registry');
    expect(result.status).toBe('ok');
    expect(result.records).toHaveLength(1);
    expect(result.records[0].name).toBe('Smith, Jane');
    expect(result.records[0].registrantType).toBe('Consultant Lobbyist');
    expect(result.records[0].status).toBe('Active');
  });

  it('returns no_results when no records found', async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse(LOBBYIST_PAGE_HTML))
      .mockResolvedValueOnce(mockResponse(LOBBYIST_EMPTY_HTML));

    const result = await queryLobbyistRegistry({ firstName: 'Jane', lastName: 'Smith' });
    expect(result.status).toBe('no_results');
    expect(result.records).toHaveLength(0);
  });

  it('returns unavailable when APEX session cannot be extracted', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse('<html><body>No APEX fields here</body></html>'));

    const result = await queryLobbyistRegistry({ firstName: 'Jane', lastName: 'Smith' });
    expect(result.status).toBe('unavailable');
    expect(result.error).toBeDefined();
  });

  it('returns unavailable when page fetch fails', async () => {
    mockFetch.mockResolvedValueOnce(null);

    const result = await queryLobbyistRegistry({ firstName: 'Jane', lastName: 'Smith' });
    expect(result.status).toBe('unavailable');
    expect(result.error).toBeDefined();
  });

  it('returns error on non-2xx HTTP status from page', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse('Not Found', 404));

    const result = await queryLobbyistRegistry({ firstName: 'Jane', lastName: 'Smith' });
    expect(result.status).toBe('error');
    expect(result.error).toContain('404');
  });

  it('submits APEX form fields extracted from the page', async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse(LOBBYIST_PAGE_HTML))
      .mockResolvedValueOnce(mockResponse(LOBBYIST_RESULTS_HTML));

    await queryLobbyistRegistry({ firstName: 'Jane', lastName: 'Smith' });

    const [, submitInit] = mockFetch.mock.calls[1] as [string, RequestInit];
    const body = String(submitInit.body);
    expect(body).toContain('p_instance=123456789');
    expect(body).toContain('p_flow_id=171');
    expect(body).toContain('Jane');
    expect(body).toContain('Smith');
  });
});

// ─── queryAllSources ──────────────────────────────────────────────────────────

describe('queryAllSources', () => {
  beforeEach(() => mockFetch.mockReset());

  it('returns results from all three sources', async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse(ELECTIONS_AB_SUCCESS_HTML))  // elections AB
      .mockResolvedValueOnce(mockResponse(ELECTIONS_CA_SUCCESS_HTML))  // elections CA
      .mockResolvedValueOnce(mockResponse(LOBBYIST_PAGE_HTML))         // lobbyist page
      .mockResolvedValueOnce(mockResponse(LOBBYIST_RESULTS_HTML));     // lobbyist search

    const result = await queryAllSources({ firstName: 'Jane', lastName: 'Smith' });

    expect(result.electionsAB.source).toBe('Elections Alberta');
    expect(result.electionsCA.source).toBe('Elections Canada');
    expect(result.lobbyist.source).toBe('Alberta Lobbyist Registry');
  });

  it('does not abort if one source fails', async () => {
    // Elections AB network times out (fetch returns null), others succeed.
    // fetchWithTimeout returns null on network error → status becomes 'unavailable'.
    mockFetch
      .mockResolvedValueOnce(null)                                       // elections AB timeout
      .mockResolvedValueOnce(mockResponse(ELECTIONS_CA_SUCCESS_HTML))  // elections CA
      .mockResolvedValueOnce(mockResponse(LOBBYIST_PAGE_HTML))         // lobbyist page
      .mockResolvedValueOnce(mockResponse(LOBBYIST_RESULTS_HTML));     // lobbyist search

    const result = await queryAllSources({ firstName: 'Jane', lastName: 'Smith' });

    // Network failures surface as 'unavailable' (handled inside each query function)
    expect(result.electionsAB.status).toBe('unavailable');
    expect(result.electionsCA.status).toBe('ok');
    expect(result.lobbyist.status).toBe('ok');
  });

  it('returns unavailable status for all sources if all network calls fail', async () => {
    // When fetch resolves to null (timeout/network error), each source returns 'unavailable'.
    // Elections CA attempts GET then POST fallback (2 null calls); lobbyist page = 1 null call.
    mockFetch.mockResolvedValue(null);

    const result = await queryAllSources({ firstName: 'Jane', lastName: 'Smith' });

    expect(result.electionsAB.status).toBe('unavailable');
    // Elections CA tries GET (null) then POST (null) → unavailable
    expect(result.electionsCA.status).toBe('unavailable');
    // Lobbyist page returns null → unavailable
    expect(result.lobbyist.status).toBe('unavailable');
  });
});

// ─── formatSourcesResult ─────────────────────────────────────────────────────

describe('formatSourcesResult', () => {
  const makeResult = (
    abStatus: ElectionsABResult['status'],
    caStatus: ElectionsCAResult['status'],
    lobStatus: LobbyistResult['status']
  ): SourcesResult => ({
    electionsAB: {
      source: 'Elections Alberta',
      url: 'https://efpublic.elections.ab.ca',
      status: abStatus,
      records:
        abStatus === 'ok'
          ? [{ event: '2023 Annual', contributor: 'SMITH JANE', location: 'CALGARY', recipient: 'UCP', receiptCount: '1', amount: '$500.00' }]
          : [],
      error: abStatus === 'error' ? 'Timeout' : undefined,
    },
    electionsCA: {
      source: 'Elections Canada',
      url: 'https://elections.ca',
      status: caStatus,
      records:
        caStatus === 'ok'
          ? [{ contributor: 'Smith, Jane', recipientType: 'Party', recipient: 'Liberal', province: 'AB', amount: '$400.00', year: '2021' }]
          : [],
      error: caStatus === 'error' ? 'Timeout' : undefined,
    },
    lobbyist: {
      source: 'Alberta Lobbyist Registry',
      url: 'https://albertalobbyistregistry.ca',
      status: lobStatus,
      records:
        lobStatus === 'ok'
          ? [{ name: 'Smith, Jane', registrantType: 'Consultant', status: 'Active', subject: 'Energy', registrationDate: '2022-01-15' }]
          : [],
      error: lobStatus === 'error' ? 'Timeout' : undefined,
    },
  });

  it('formats successful results as markdown tables', () => {
    const output = formatSourcesResult(makeResult('ok', 'ok', 'ok'));

    expect(output).toContain('### Elections Alberta');
    expect(output).toContain('### Elections Canada');
    expect(output).toContain('### Alberta Lobbyist Registry');
    expect(output).toContain('SMITH JANE');
    expect(output).toContain('Liberal');
    expect(output).toContain('Consultant');
    // Should have table headers
    expect(output).toContain('| Event |');
    expect(output).toContain('| Contributor |');
    expect(output).toContain('| Name |');
  });

  it('shows "No contributions found" for no_results', () => {
    const output = formatSourcesResult(makeResult('no_results', 'no_results', 'no_results'));

    expect(output).toContain('No contributions found.');
    expect(output).toContain('Not registered as a lobbyist.');
  });

  it('shows warning for error status', () => {
    const output = formatSourcesResult(makeResult('error', 'unavailable', 'error'));

    expect(output).toContain('⚠️');
    expect(output).toContain('Timeout');
  });

  it('shows truncation warning when truncated is true', () => {
    const result = makeResult('ok', 'no_results', 'no_results');
    result.electionsAB.truncated = true;
    const output = formatSourcesResult(result);

    expect(output).toContain('limited to first 200 records');
  });
});
