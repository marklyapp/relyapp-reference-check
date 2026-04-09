/**
 * lib/sources.ts
 * Structured data source integrations for the reference check pipeline.
 *
 * Queries three public Canadian political/lobbying databases:
 *  1. Elections Alberta — Contributor/Accepted Contribution Search (annual + campaign)
 *  2. Elections Canada — Contributions Search
 *  3. Alberta Lobbyist Registry — Registered Lobbyist Search
 *
 * All three use HTML form-based interfaces (not REST APIs), so this module
 * submits forms via fetch and parses the returned HTML tables.
 *
 * Results feed into the DONATIONS and NOTABLE ITEMS sections of reports.
 *
 * refs #43
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SourceQueryInput {
  /** Contributor/registrant last name */
  lastName: string;
  /** Contributor/registrant first name */
  firstName: string;
}

export interface ElectionsABContribution {
  event: string;
  contributor: string;
  location: string;
  recipient: string;
  receiptCount: string;
  amount: string;
}

export interface ElectionsCAContribution {
  contributor: string;
  recipientType: string;
  recipient: string;
  province: string;
  amount: string;
  year: string;
}

export interface LobbyistRecord {
  name: string;
  registrantType: string;
  status: string;
  subject: string;
  registrationDate: string;
}

export type SourceStatus =
  | 'ok'
  | 'no_results'
  | 'unavailable'
  | 'error';

export interface ElectionsABResult {
  source: 'Elections Alberta';
  url: string;
  status: SourceStatus;
  records: ElectionsABContribution[];
  /** Present when status === 'error' or 'unavailable' */
  error?: string;
  /** True when results were capped at 200 by the remote site */
  truncated?: boolean;
}

export interface ElectionsCAResult {
  source: 'Elections Canada';
  url: string;
  status: SourceStatus;
  records: ElectionsCAContribution[];
  error?: string;
  truncated?: boolean;
}

export interface LobbyistResult {
  source: 'Alberta Lobbyist Registry';
  url: string;
  status: SourceStatus;
  records: LobbyistRecord[];
  error?: string;
}

export interface SourcesResult {
  electionsAB: ElectionsABResult;
  electionsCA: ElectionsCAResult;
  lobbyist: LobbyistResult;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ELECTIONS_AB_URL =
  'https://efpublic.elections.ab.ca/efCTACSSearch.cfm?MODE=BROWSE&MID=CT_ACS';
const ELECTIONS_AB_PUBLIC_URL =
  'https://efpublic.elections.ab.ca/efCTACSSearch.cfm?MID=CT_ACS';

const ELECTIONS_CA_URL =
  'https://www.elections.ca/WPAPPS/WPF/EN/CCS/SearchContributions';
const ELECTIONS_CA_PUBLIC_URL =
  'https://www.elections.ca/WPAPPS/WPF/EN/CCS/Index?returnStatus=1&reportOption=5';

const LOBBYIST_AB_SEARCH_URL =
  'https://albertalobbyistregistry.ca/apex/wwv_flow.accept';
const LOBBYIST_AB_PUBLIC_URL =
  'https://albertalobbyistregistry.ca/apex/f?p=171:9996:::::CMS_SITE,CMS_PAGE:ABLBY,SRCH_REG';

const FETCH_TIMEOUT_MS = 15_000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Strips HTML tags and decodes common entities from a raw HTML string. */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&emsp;/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/** Normalises whitespace in a string. */
function normalise(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Fetches a URL with an AbortController-based timeout.
 * Returns null (instead of throwing) on network/timeout errors.
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = FETCH_TIMEOUT_MS
): Promise<Response | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ─── HTML Table Parser ────────────────────────────────────────────────────────

/**
 * Minimal HTML table parser.
 *
 * Returns an array of row arrays, where each inner array contains the text
 * content of each cell (TD or TH).  Handles rowspan/colspan by skipping them
 * (we only need the text values for display).
 *
 * Works on the messy, non-XHTML output produced by ColdFusion / Oracle APEX.
 */
function parseHtmlTable(html: string): string[][] {
  const rows: string[][] = [];
  // Lookahead: next TR open tag, closing structural tags (TBODY/TABLE/THEAD/TFOOT), or end-of-string.
  // This handles:
  //   - Tables without closing </TR> tags (ColdFusion / Elections Alberta)
  //   - Tables with <TBODY> between header and data rows
  //   - Tables where the extracted content has no trailing </TABLE>
  const trPattern = /<TR[^>]*>([\s\S]*?)(?=<TR[^>]*>|<\/T(?:BODY|ABLE|HEAD|FOOT)[^>]*>|$)/gi;
  let trMatch: RegExpExecArray | null;

  while ((trMatch = trPattern.exec(html)) !== null) {
    const rowHtml = trMatch[1];
    const cells: string[] = [];
    // Lookahead: next TH/TD, closing TR/TD/TH, closing structural tags, or end-of-string.
    const tdPattern = /<T[DH][^>]*>([\s\S]*?)(?=<T[DH][^>]*>|<\/T[RDH]|<\/T(?:BODY|ABLE|HEAD|FOOT)|$)/gi;
    let tdMatch: RegExpExecArray | null;

    while ((tdMatch = tdPattern.exec(rowHtml)) !== null) {
      cells.push(normalise(stripHtml(tdMatch[1])));
    }

    if (cells.length > 0) {
      rows.push(cells);
    }
  }

  return rows;
}

// ─── 1. Elections Alberta ─────────────────────────────────────────────────────

/**
 * Queries the Elections Alberta Contributor/Accepted Contribution Search.
 *
 * The form at efpublic.elections.ab.ca accepts a POST with `txtContributorName`
 * and `MODE=BROWSE` and returns an HTML table of contributions.
 *
 * Columns: Event | Contributor | Location | Recipient | Receipt Count | Amount
 */
export async function queryElectionsAB(
  input: SourceQueryInput
): Promise<ElectionsABResult> {
  const contributorName = `${input.lastName} ${input.firstName}`.trim();

  const body = new URLSearchParams({
    txtContributorName: contributorName,
    cboYear: '',
    cboParty: '0',
    cboElectoralDivision: '0',
    btnSubmit: ' Search ',
  });

  const res = await fetchWithTimeout(ELECTIONS_AB_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': 'Mozilla/5.0 (compatible; RelyApp/1.0)',
      Referer: ELECTIONS_AB_PUBLIC_URL,
    },
    body: body.toString(),
  });

  if (!res) {
    return {
      source: 'Elections Alberta',
      url: ELECTIONS_AB_PUBLIC_URL,
      status: 'unavailable',
      records: [],
      error: 'Network error or timeout connecting to Elections Alberta',
    };
  }

  if (!res.ok) {
    return {
      source: 'Elections Alberta',
      url: ELECTIONS_AB_PUBLIC_URL,
      status: 'error',
      records: [],
      error: `Elections Alberta returned HTTP ${res.status}`,
    };
  }

  const html = await res.text();

  // Check for "no records" message
  if (/no record/i.test(html) && !/<TBODY/i.test(html)) {
    return {
      source: 'Elections Alberta',
      url: ELECTIONS_AB_PUBLIC_URL,
      status: 'no_results',
      records: [],
    };
  }

  // Extract the results table (starts after the <TBODY> tag inside ListContainer)
  const tableMatch = html.match(/<TABLE[^>]*ListContainer[^>]*>([\s\S]*?)<\/TABLE>/i);
  if (!tableMatch) {
    // No table means no results
    return {
      source: 'Elections Alberta',
      url: ELECTIONS_AB_PUBLIC_URL,
      status: 'no_results',
      records: [],
    };
  }

  const rows = parseHtmlTable(tableMatch[1]);

  // Skip header row(s) — identify by presence of "Event" or "Contributor" header text
  const dataRows = rows.filter((row) => {
    const first = row[0]?.toLowerCase() ?? '';
    return first !== 'event' && first !== '' && row.length >= 5;
  });

  if (dataRows.length === 0) {
    return {
      source: 'Elections Alberta',
      url: ELECTIONS_AB_PUBLIC_URL,
      status: 'no_results',
      records: [],
    };
  }

  const truncated = /limited to the first 200/i.test(html);

  const records: ElectionsABContribution[] = dataRows.map((row) => ({
    event: row[0] ?? '',
    contributor: row[1] ?? '',
    location: row[2] ?? '',
    recipient: row[3] ?? '',
    receiptCount: row[4] ?? '',
    amount: row[5] ?? '',
  }));

  return {
    source: 'Elections Alberta',
    url: ELECTIONS_AB_PUBLIC_URL,
    status: 'ok',
    records,
    truncated,
  };
}

// ─── 2. Elections Canada ──────────────────────────────────────────────────────

/**
 * Queries the Elections Canada Contributions Search.
 *
 * The search form at elections.ca accepts contributor name and returns an HTML
 * table with federal political contribution records.
 *
 * Columns: Contributor | Recipient Type | Recipient | Province | Amount | Year
 */
export async function queryElectionsCA(
  input: SourceQueryInput
): Promise<ElectionsCAResult> {
  // Elections Canada uses a query-string GET interface in addition to the form POST.
  // Attempt both patterns for resilience.
  const params = new URLSearchParams({
    ContributorName: `${input.lastName}%2C ${input.firstName}`.trim(),
    ReportOption: '5',
    returnStatus: '1',
  });

  const getUrl = `${ELECTIONS_CA_PUBLIC_URL}&${params.toString()}`;

  const res = await fetchWithTimeout(
    getUrl,
    {
      method: 'GET',
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': 'Mozilla/5.0 (compatible; RelyApp/1.0)',
      },
    },
    12_000
  );

  if (!res) {
    // Fallback: try POST to the search endpoint
    const postBody = new URLSearchParams({
      ContributorName: `${input.lastName}, ${input.firstName}`.trim(),
      ReportOption: '5',
    });

    const postRes = await fetchWithTimeout(
      ELECTIONS_CA_URL,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'text/html,application/xhtml+xml',
          'User-Agent': 'Mozilla/5.0 (compatible; RelyApp/1.0)',
          Referer: ELECTIONS_CA_PUBLIC_URL,
        },
        body: postBody.toString(),
      },
      12_000
    );

    if (!postRes) {
      return {
        source: 'Elections Canada',
        url: ELECTIONS_CA_PUBLIC_URL,
        status: 'unavailable',
        records: [],
        error: 'Network error or timeout connecting to Elections Canada',
      };
    }

    if (!postRes.ok) {
      return {
        source: 'Elections Canada',
        url: ELECTIONS_CA_PUBLIC_URL,
        status: 'error',
        records: [],
        error: `Elections Canada returned HTTP ${postRes.status}`,
      };
    }

    return parseElectionsCAHtml(await postRes.text());
  }

  if (!res.ok) {
    return {
      source: 'Elections Canada',
      url: ELECTIONS_CA_PUBLIC_URL,
      status: 'error',
      records: [],
      error: `Elections Canada returned HTTP ${res.status}`,
    };
  }

  return parseElectionsCAHtml(await res.text());
}

function parseElectionsCAHtml(html: string): ElectionsCAResult {
  if (/no contribution[s]? found|no result/i.test(html)) {
    return {
      source: 'Elections Canada',
      url: ELECTIONS_CA_PUBLIC_URL,
      status: 'no_results',
      records: [],
    };
  }

  // Look for any table that contains "Contributor" or "Amount" headers
  const tableMatch = html.match(
    /<table[^>]*>([\s\S]*?contributor[\s\S]*?)<\/table>/i
  );

  if (!tableMatch) {
    // No results table — treat as no results (Elections Canada renders no table when empty)
    return {
      source: 'Elections Canada',
      url: ELECTIONS_CA_PUBLIC_URL,
      status: 'no_results',
      records: [],
    };
  }

  const rows = parseHtmlTable(tableMatch[1]);

  const dataRows = rows.filter((row) => {
    const first = row[0]?.toLowerCase() ?? '';
    return first !== 'contributor' && first !== '' && row.length >= 4;
  });

  if (dataRows.length === 0) {
    return {
      source: 'Elections Canada',
      url: ELECTIONS_CA_PUBLIC_URL,
      status: 'no_results',
      records: [],
    };
  }

  const truncated = /results are limited|showing \d+ of \d+/i.test(html);

  const records: ElectionsCAContribution[] = dataRows.map((row) => ({
    contributor: row[0] ?? '',
    recipientType: row[1] ?? '',
    recipient: row[2] ?? '',
    province: row[3] ?? '',
    amount: row[4] ?? '',
    year: row[5] ?? '',
  }));

  return {
    source: 'Elections Canada',
    url: ELECTIONS_CA_PUBLIC_URL,
    status: 'ok',
    records,
    truncated,
  };
}

// ─── 3. Alberta Lobbyist Registry ─────────────────────────────────────────────

/**
 * Queries the Alberta Lobbyist Registry for a registrant by name.
 *
 * The registry uses Oracle APEX (wwv_flow.accept) with session tokens.
 * This function first fetches the search page to extract the APEX session/flow
 * IDs, then submits the search form.
 *
 * Columns: Name | Registrant Type | Status | Subject Matter | Registration Date
 */
export async function queryLobbyistRegistry(
  input: SourceQueryInput
): Promise<LobbyistResult> {
  // Step 1: GET the search page to extract APEX session tokens
  const pageRes = await fetchWithTimeout(
    LOBBYIST_AB_PUBLIC_URL,
    {
      method: 'GET',
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': 'Mozilla/5.0 (compatible; RelyApp/1.0)',
      },
    },
    12_000
  );

  if (!pageRes) {
    return {
      source: 'Alberta Lobbyist Registry',
      url: LOBBYIST_AB_PUBLIC_URL,
      status: 'unavailable',
      records: [],
      error: 'Network error or timeout connecting to Alberta Lobbyist Registry',
    };
  }

  if (!pageRes.ok) {
    return {
      source: 'Alberta Lobbyist Registry',
      url: LOBBYIST_AB_PUBLIC_URL,
      status: 'error',
      records: [],
      error: `Alberta Lobbyist Registry returned HTTP ${pageRes.status}`,
    };
  }

  const pageHtml = await pageRes.text();

  // Extract APEX hidden fields: p_flow_id, p_flow_step_id, p_instance, p_page_submission_id
  const apexFields = extractApexFields(pageHtml);

  if (!apexFields.pInstance) {
    // APEX session not available — site may require JavaScript
    return {
      source: 'Alberta Lobbyist Registry',
      url: LOBBYIST_AB_PUBLIC_URL,
      status: 'unavailable',
      records: [],
      error:
        'Alberta Lobbyist Registry requires JavaScript for form submission. Direct query not available.',
    };
  }

  // Step 2: Build the APEX form submission
  const cookies = pageRes.headers.get('set-cookie') ?? '';
  const cookieHeader = extractCookies(cookies);

  const searchName = `${input.firstName} ${input.lastName}`.trim();

  const apexBody = new URLSearchParams({
    p_flow_id: apexFields.pFlowId,
    p_flow_step_id: apexFields.pFlowStepId,
    p_instance: apexFields.pInstance,
    p_page_submission_id: apexFields.pPageSubmissionId,
    p_request: 'SEARCH',
    p_reload_on_submit: 'S',
    p_md5_checksum: '',
    p_arg_names: apexFields.pArgName ?? 'P9996_SEARCH_NAME',
    p_t01: searchName,
  });

  const submitRes = await fetchWithTimeout(
    LOBBYIST_AB_SEARCH_URL,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': 'Mozilla/5.0 (compatible; RelyApp/1.0)',
        Referer: LOBBYIST_AB_PUBLIC_URL,
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
      body: apexBody.toString(),
    },
    12_000
  );

  if (!submitRes) {
    return {
      source: 'Alberta Lobbyist Registry',
      url: LOBBYIST_AB_PUBLIC_URL,
      status: 'unavailable',
      records: [],
      error: 'Network error or timeout submitting search to Alberta Lobbyist Registry',
    };
  }

  if (!submitRes.ok) {
    return {
      source: 'Alberta Lobbyist Registry',
      url: LOBBYIST_AB_PUBLIC_URL,
      status: 'error',
      records: [],
      error: `Alberta Lobbyist Registry returned HTTP ${submitRes.status} on search`,
    };
  }

  return parseLobbyistHtml(await submitRes.text());
}

interface ApexFields {
  pFlowId: string;
  pFlowStepId: string;
  pInstance: string;
  pPageSubmissionId: string;
  pArgName?: string;
}

function extractApexFields(html: string): ApexFields {
  const field = (name: string): string => {
    const m = html.match(
      new RegExp(`<input[^>]+name=["']?${name}["']?[^>]+value=["']([^"']+)["']`, 'i')
    ) ?? html.match(
      new RegExp(`<input[^>]+value=["']([^"']+)["'][^>]+name=["']?${name}["']?`, 'i')
    );
    return m ? m[1] : '';
  };

  return {
    pFlowId: field('p_flow_id'),
    pFlowStepId: field('p_flow_step_id'),
    pInstance: field('p_instance'),
    pPageSubmissionId: field('p_page_submission_id'),
    pArgName: field('p_arg_names') || undefined,
  };
}

function extractCookies(setCookieHeader: string): string {
  // Parse Set-Cookie header(s) into a Cookie: name=value; name2=value2 string
  return setCookieHeader
    .split(',')
    .map((c) => c.split(';')[0]?.trim())
    .filter(Boolean)
    .join('; ');
}

function parseLobbyistHtml(html: string): LobbyistResult {
  if (/no record[s]? found|no result[s]?|0 result/i.test(html)) {
    return {
      source: 'Alberta Lobbyist Registry',
      url: LOBBYIST_AB_PUBLIC_URL,
      status: 'no_results',
      records: [],
    };
  }

  // Look for a table with lobbying registration data
  const tableMatch = html.match(
    /<table[^>]*>([\s\S]*?(?:registrant|lobbyist|subject)[\s\S]*?)<\/table>/i
  );

  if (!tableMatch) {
    return {
      source: 'Alberta Lobbyist Registry',
      url: LOBBYIST_AB_PUBLIC_URL,
      status: 'no_results',
      records: [],
    };
  }

  const rows = parseHtmlTable(tableMatch[1]);

  const dataRows = rows.filter((row) => {
    const first = row[0]?.toLowerCase() ?? '';
    return (
      first !== 'name' &&
      first !== 'registrant' &&
      first !== '' &&
      row.length >= 3
    );
  });

  if (dataRows.length === 0) {
    return {
      source: 'Alberta Lobbyist Registry',
      url: LOBBYIST_AB_PUBLIC_URL,
      status: 'no_results',
      records: [],
    };
  }

  const records: LobbyistRecord[] = dataRows.map((row) => ({
    name: row[0] ?? '',
    registrantType: row[1] ?? '',
    status: row[2] ?? '',
    subject: row[3] ?? '',
    registrationDate: row[4] ?? '',
  }));

  return {
    source: 'Alberta Lobbyist Registry',
    url: LOBBYIST_AB_PUBLIC_URL,
    status: 'ok',
    records,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Queries all three structured data sources in parallel for a given person.
 *
 * Errors from any individual source are captured in the result's `error`
 * field and do not abort the other queries.
 *
 * @example
 * const results = await queryAllSources({ firstName: 'Jane', lastName: 'Smith' });
 * // results.electionsAB.records → ElectionsABContribution[]
 * // results.electionsCA.records → ElectionsCAContribution[]
 * // results.lobbyist.records    → LobbyistRecord[]
 */
export async function queryAllSources(
  input: SourceQueryInput
): Promise<SourcesResult> {
  const [electionsAB, electionsCA, lobbyist] = await Promise.all([
    queryElectionsAB(input).catch((err): ElectionsABResult => ({
      source: 'Elections Alberta',
      url: ELECTIONS_AB_PUBLIC_URL,
      status: 'error',
      records: [],
      error: err instanceof Error ? err.message : String(err),
    })),
    queryElectionsCA(input).catch((err): ElectionsCAResult => ({
      source: 'Elections Canada',
      url: ELECTIONS_CA_PUBLIC_URL,
      status: 'error',
      records: [],
      error: err instanceof Error ? err.message : String(err),
    })),
    queryLobbyistRegistry(input).catch((err): LobbyistResult => ({
      source: 'Alberta Lobbyist Registry',
      url: LOBBYIST_AB_PUBLIC_URL,
      status: 'error',
      records: [],
      error: err instanceof Error ? err.message : String(err),
    })),
  ]);

  return { electionsAB, electionsCA, lobbyist };
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

/**
 * Formats a SourcesResult into a compact markdown string suitable for
 * inclusion in a report's DONATIONS / LOBBYIST REGISTRY sections.
 */
export function formatSourcesResult(result: SourcesResult): string {
  const lines: string[] = [];

  // Elections Alberta
  lines.push('### Elections Alberta (Contributions)');
  const ab = result.electionsAB;
  if (ab.status === 'ok' && ab.records.length > 0) {
    if (ab.truncated) {
      lines.push('> ⚠️ Results limited to first 200 records. Narrow search on the Elections Alberta website for complete results.');
    }
    lines.push('| Event | Contributor | Location | Recipient | Receipts | Amount |');
    lines.push('|-------|-------------|----------|-----------|----------|--------|');
    for (const r of ab.records) {
      lines.push(`| ${r.event} | ${r.contributor} | ${r.location} | ${r.recipient} | ${r.receiptCount} | ${r.amount} |`);
    }
  } else if (ab.status === 'no_results') {
    lines.push('No contributions found.');
  } else {
    lines.push(`⚠️ ${ab.error ?? 'Unavailable — check manually at: ' + ab.url}`);
  }

  lines.push('');

  // Elections Canada
  lines.push('### Elections Canada (Contributions)');
  const ca = result.electionsCA;
  if (ca.status === 'ok' && ca.records.length > 0) {
    if (ca.truncated) {
      lines.push('> ⚠️ Results may be truncated. Check directly at Elections Canada website.');
    }
    lines.push('| Contributor | Recipient Type | Recipient | Province | Amount | Year |');
    lines.push('|-------------|----------------|-----------|----------|--------|------|');
    for (const r of ca.records) {
      lines.push(`| ${r.contributor} | ${r.recipientType} | ${r.recipient} | ${r.province} | ${r.amount} | ${r.year} |`);
    }
  } else if (ca.status === 'no_results') {
    lines.push('No contributions found.');
  } else {
    lines.push(`⚠️ ${ca.error ?? 'Unavailable — check manually at: ' + ca.url}`);
  }

  lines.push('');

  // Alberta Lobbyist Registry
  lines.push('### Alberta Lobbyist Registry');
  const lob = result.lobbyist;
  if (lob.status === 'ok' && lob.records.length > 0) {
    lines.push('| Name | Registrant Type | Status | Subject Matter | Registration Date |');
    lines.push('|------|-----------------|--------|----------------|-------------------|');
    for (const r of lob.records) {
      lines.push(`| ${r.name} | ${r.registrantType} | ${r.status} | ${r.subject} | ${r.registrationDate} |`);
    }
  } else if (lob.status === 'no_results') {
    lines.push('Not registered as a lobbyist.');
  } else {
    lines.push(`⚠️ ${lob.error ?? 'Unavailable — check manually at: ' + lob.url}`);
  }

  return lines.join('\n');
}
