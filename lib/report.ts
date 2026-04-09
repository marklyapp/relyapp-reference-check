/**
 * lib/report.ts
 * Generates a structured background check report using OpenAI streaming.
 * Report format follows the Board Applicant Research Assistant specification.
 *
 * Supports two code paths:
 *  - azure: Two-stage pipeline:
 *      Stage 1 — 5 parallel web searches via Responses API (SEARCH_MODEL / gpt-4.1)
 *      Stage 2 — Report consolidation via Chat Completions streaming (REPORT_MODEL / claude-opus-4-6)
 *  - serp/brave: Uses Chat Completions API with pre-fetched research data
 *
 * refs #6, #30, #34, #36, #45, #46
 */

import OpenAI from "openai";
import { getConfig } from "./config";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ApplicantInput {
  /** Full legal name */
  name: string;
  /** City/Province or full address */
  location: string;
  /** Optional: role/title being applied for */
  role?: string;
  /** Optional: known employer(s) */
  employers?: string[];
  /** Optional: businesses owned */
  businesses?: string[];
  /** Optional: volunteer/religious organizations */
  organizations?: string[];
  /** Optional: known email addresses */
  emails?: string[];
  /** Optional: known phone numbers */
  phones?: string[];
  /** Optional: known addresses */
  addresses?: string[];
  /** Optional: known social media usernames */
  usernames?: string[];
  /** Raw research data collected from web/social sources (used by serp/brave paths) */
  researchData: string;
}

export interface GenerateReportOptions {
  /** OpenAI model to use (default: gpt-4o) */
  model?: string;
  /** Temperature (default: 0.3 for consistent reports; omitted for gpt-5 models) */
  temperature?: number;
}

// ─── Temperature helpers ──────────────────────────────────────────────────────

/**
 * Returns true if the model does not support the temperature parameter.
 * gpt-5 models (e.g. gpt-5.4) only accept temperature=1 via the API, (claude-opus-4-6 accepts temperature normally — no change needed for claude-* models)
 * so we omit temperature entirely to avoid UnsupportedParamsError.
 */
export function shouldOmitTemperature(model: string | undefined): boolean {
  if (!model) return false;
  return model.startsWith("gpt-5");
}

/**
 * Resolves the effective temperature for a given model.
 * Priority: explicit override > REPORT_TEMPERATURE env var > default (0.3 for gpt-4, omit for gpt-5).
 *
 * Returns undefined when temperature should be omitted entirely.
 */
export function resolveTemperature(
  model: string | undefined,
  override?: number
): number | undefined {
  // 1. Explicit call-site override always wins
  if (override !== undefined) return override;

  // 2. Config-level env var override
  const config = getConfig();
  if (config.REPORT_TEMPERATURE !== undefined) return config.REPORT_TEMPERATURE;

  // 3. Default: omit for gpt-5, use 0.3 for everything else
  if (shouldOmitTemperature(model)) return undefined;
  return 0.3;
}

// ─── Sensitive Topics List ────────────────────────────────────────────────────
// refs #45: Added to Stage 2 consolidation prompt (azure) and serp/brave path.

export const SENSITIVE_TOPICS_LIST = `SENSITIVE TOPICS TO FLAG — check ALL search results for any mention of or connection to:

POLITICIANS & POLITICAL FIGURES:
- Politicians and political parties from the last 100 years (all English-speaking countries, all levels of government)
- Current Calgary or Edmonton Councillors/mayors
- Notable non-English figures: Hitler, Stalin, Mao, Putin, Zelensky, Xi Jinping

LEGAL & LEGISLATIVE:
- Any judicial decision
- Any federal or provincial legislation/bills
- Any existing Alberta public agencies (public-agency-list.alberta.ca)

IDEOLOGIES:
- Fascism, Communism, Socialism, Nationalism, Conservatism, Liberalism, Feminism, Environmentalism

POLITICAL ISSUES:
- Israel/Palestine, Emissions Regulation, Carbon Tax, COP conferences
- United Nations, Davos, World Economic Forum
- Residential schools, 2SLGBTQI+, Diversity/Equity/Inclusion
- Pipelines, Equalization, Sovereignty, Tariffs
- NATO, CUSMA, Iran War, Guns/Gun control

HEALTH POLICY:
- Mental Health/addiction, Supervised Consumption, Recovery, Safe Supply, MAID
- Immigration, Housing Costs, Affordability, COVID-19
- AHS restructuring, Public vs private healthcare
- Ambulance response times, Alberta Medical Association
- Emergency room wait times, Family doctor availability, Hospital bed space

EDUCATION:
- Teachers strike, Classroom sizes/complexity, Teacher pay
- Alberta Teachers' Association, K-12 Curriculum
- University Tuition, International Students, Arts Funding

ENERGY & ENVIRONMENT:
- Electricity/Water rates, Cell phone rates
- Fertilizer Regulation/Nitrogen Oxide emissions, Methane Emissions
- Alberta Energy Regulator, Canadian Energy Regulator
- Coal mining, Oil, Gas, Wind, Solar, Nuclear (any resource industry)
- Forest fire management, Logging industry

SOCIAL ISSUES:
- Missing and murdered indigenous women
- Truth and reconciliation
- Temporary Foreign Worker Program
- Mandatory Minimum sentences
- Property Tax, Transit, Policing, Pension, AISH`;

// ─── Sensitive Topics Flagging Instructions ───────────────────────────────────

const SENSITIVE_TOPICS_INSTRUCTIONS = `
SENSITIVE TOPICS FLAGGING (refs #45):
After the NOTABLE ITEMS section, add a ## SENSITIVE TOPICS FLAGGED section.
Cross-reference ALL search results against the sensitive topics list above and flag any matches.

Output the section as a markdown table:

## SENSITIVE TOPICS FLAGGED

| Category | Topic | Finding | Source |
|----------|-------|---------|--------|
| Political Party | United Conservative Party | Leader of Wildrose, merged into UCP | https://... |
| Energy | Oil & Gas Industry | Serves as Minister of Energy and Minerals | https://... |
| Pipelines | Trans Mountain | Publicly advocated for pipeline expansion | https://... |

If NO sensitive topics are found in the search results, the section should contain only:
"No sensitive topics identified in search results."

The Category column must use one of: Politicians, Political Party, Legal/Legislative, Ideology, Political Issue, Health Policy, Education, Energy/Environment, Social Issue.
`;

// ─── System Prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  return `You are a Board Applicant Research Assistant for the Government of Alberta Executive Council.
You produce structured background check reports on agency board applicants.
Your reports assess political donations, social media activity, and public information.
Be factual, neutral, and thorough. Use the research data provided to populate each section.
Never speculate beyond the provided data. If information is unavailable for a section, state "None found."

Report Format Rules:
- Use plain text with section headers in ALL CAPS
- Recommendation options: Proceed / Caution / Do Not Proceed
- Use "Caution" if there are notable political donations or controversial social media posts
- Use "Do Not Proceed" only for serious concerns (criminal history, extreme content)
- SCHEDULES only include posts/content that are flagged as notable or sensitive
- SOURCES/CHECKLIST uses checkmarks (✓) for sources that were searched
- SEARCH TERMS uses OR/AND operators with name variations

${SENSITIVE_TOPICS_LIST}
${SENSITIVE_TOPICS_INSTRUCTIONS}`;
}

// ─── Report Prompt (serp/brave path) ─────────────────────────────────────────

function buildReportPrompt(input: ApplicantInput): string {
  const searchTerms = generateSearchTerms(input);

  return `Generate a background check report for the following applicant using the research data provided.
Follow the EXACT format below — do not omit any section.

APPLICANT: ${input.name}
LOCATION: ${input.location}
${input.role ? `ROLE: ${input.role}` : ""}
${input.employers?.length ? `EMPLOYERS: ${input.employers.join(", ")}` : ""}
${input.businesses?.length ? `BUSINESSES: ${input.businesses.join(", ")}` : ""}
${input.organizations?.length ? `ORGANIZATIONS: ${input.organizations.join(", ")}` : ""}

RESEARCH DATA:
${input.researchData}

PRE-GENERATED SEARCH TERMS (include these verbatim in the SEARCH TERMS section):
${searchTerms}

---

OUTPUT FORMAT (follow exactly):

${input.name.toUpperCase()} BACKGROUND CHECK
${input.location}
Recommendation: [Proceed / Caution / Do Not Proceed]

NOTABLE ITEMS
- [Key finding 1]
- [Key finding 2]
- [Add more as needed, or "None identified" if nothing notable]

## SENSITIVE TOPICS FLAGGED

| Category | Topic | Finding | Source |
|----------|-------|---------|--------|
| [Category] | [Topic matched from sensitive topics list] | [What was found] | [URL] |

(If no sensitive topics found: "No sensitive topics identified in search results.")

PERSONAL INFORMATION
[Role/occupation description and any demographic details found in the research data]

DONATIONS
Elections AB: [Results or "None found"]
Elections Canada: [Results or "None found"]

SOCIAL MEDIA/ONLINE PRESENCE

Facebook:
Account: [URL or "None"]
Summary: [Brief summary of content found, or "No activity found"]
Notable Posts: [Reference to Schedule A, or "None"]

Instagram:
Account: [URL or "None"]
Summary: [Brief summary of content found, or "No activity found"]
Notable Posts: [Reference to Schedule B, or "None"]

LinkedIn:
Account: [URL or "None"]
Summary: [Brief summary of content found, or "No activity found"]
Notable Posts: [Reference to Schedule C, or "None"]

Twitter/X:
Account: [URL or "None"]
Summary: [Brief summary of content found, or "No activity found"]
Notable Posts: [Reference to Schedule D, or "None"]

YouTube:
Account: [URL or "None"]
Summary: [Brief summary of content found, or "No activity found"]

Other:
[Any other platforms or "None"]
Notable Posts: [Reference to Schedule E, or "None"]

SCHEDULE A – Facebook
[List flagged posts with direct URLs, or "No flagged posts"]

SCHEDULE B – Instagram
[List flagged posts with direct URLs, or "No flagged posts"]

SCHEDULE C – LinkedIn
[List flagged posts with direct URLs, or "No flagged posts"]

SCHEDULE D – Twitter/X
[List flagged posts with direct URLs, or "No flagged posts"]

SCHEDULE E – Other
[List flagged posts with direct URLs, or "No flagged posts"]

SOURCES/CHECKLIST
✓ Professional Discipline (Law Society of Alberta, Real Estate Council of Alberta, APEGA)
✓ Elections AB contributor search (quarterly, annual, leadership, nomination, third-party ads)
✓ Elections Canada donation database
✓ Google (search terms listed below)
✓ LinkedIn (Resume Info, Top Interests, Posts, Comments, Reactions)
✓ Twitter/X (Tweets, Replies, Media, Following, Username)
✓ Facebook (Friends, Photos, About Info, Likes/Events, Posts, Username)
✓ Instagram (Posts and comments, Tagged Posts, Reels, Following, Username)
✓ YouTube
✓ CanLii (Canadian Legal Information Institute)

SEARCH TERMS
${searchTerms}`;
}

// ─── Search Term Generation ───────────────────────────────────────────────────

function generateNameVariations(fullName: string): string[] {
  const parts = fullName.trim().split(/\s+/);
  const variations: string[] = [fullName];

  if (parts.length >= 2) {
    const first = parts[0];
    const last = parts[parts.length - 1];
    const middle = parts.slice(1, -1);

    // First Last
    variations.push(`${first} ${last}`);

    // First initial + Last
    variations.push(`${first[0]}. ${last}`);

    // With middle initial if present
    if (middle.length > 0) {
      variations.push(`${first} ${middle[0][0]}. ${last}`);
      variations.push(`${first} ${middle.join(" ")} ${last}`);
    }

    // Last, First
    variations.push(`${last}, ${first}`);
    variations.push(`${last} ${first}`);
  }

  return Array.from(new Set(variations));
}

function generateSearchTerms(input: ApplicantInput): string {
  const nameVars = generateNameVariations(input.name);
  const location = input.location;

  const lines: string[] = [];

  // Name + location combinations
  const nameOrStr = nameVars.map((n) => `"${n}"`).join(" OR ");
  lines.push(`Names: (${nameOrStr}) AND "${location}"`);

  // Name + employer
  if (input.employers?.length) {
    for (const employer of input.employers) {
      lines.push(`(${nameOrStr}) AND "${employer}"`);
    }
  }

  // Name + businesses
  if (input.businesses?.length) {
    for (const biz of input.businesses) {
      lines.push(`(${nameOrStr}) AND "${biz}"`);
    }
  }

  // Name + organizations
  if (input.organizations?.length) {
    for (const org of input.organizations) {
      lines.push(`(${nameOrStr}) AND "${org}"`);
    }
  }

  // Emails
  if (input.emails?.length) {
    lines.push(`Emails: ${input.emails.join(", ")}`);
    for (const email of input.emails) {
      lines.push(`"${email}"`);
    }
  }

  // Phone numbers
  if (input.phones?.length) {
    lines.push(`Phone Numbers: ${input.phones.join(", ")}`);
    for (const phone of input.phones) {
      lines.push(`"${phone}"`);
    }
  }

  // Addresses
  if (input.addresses?.length) {
    lines.push(`Addresses: ${input.addresses.join(", ")}`);
    for (const addr of input.addresses) {
      lines.push(`"${addr}"`);
    }
  }

  return lines.join("\n");
}

// ─── Azure: Stage 1 — searchWithAzure ────────────────────────────────────────

/**
 * Performs a single focused web search using the Responses API + web_search tool.
 * Returns the full text output (with inline citations) from the model.
 *
 * @param client      - Configured OpenAI client (pointing at LiteLLM proxy)
 * @param focusPrompt - The focused search instruction for this call (already contains applicant context)
 * @param model       - Model to use (SEARCH_MODEL, default gpt-4.1)
 */
export async function searchWithAzure(
  client: OpenAI,
  focusPrompt: string,
  model: string
): Promise<string> {
  // Build request params — omit temperature for gpt-5 models
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const params: Record<string, any> = {
    model,
    stream: false,
    tools: [{ type: "web_search" }],
    input: focusPrompt,
  };

  const temp = resolveTemperature(model);
  if (temp !== undefined) {
    params.temperature = temp;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response = await (client.responses.create as any)(params);

  // Extract text from the response output array
  // The Responses API returns: { output: [{ type: "message", content: [{ type: "output_text", text: "..." }] }] }
  if (response?.output && Array.isArray(response.output)) {
    const textParts: string[] = [];
    for (const item of response.output) {
      if (item?.content && Array.isArray(item.content)) {
        for (const block of item.content) {
          if (block?.type === "output_text" && typeof block.text === "string") {
            textParts.push(block.text);
          }
        }
      }
      // Fallback: item itself might be a text block
      if (item?.type === "output_text" && typeof item.text === "string") {
        textParts.push(item.text);
      }
    }
    if (textParts.length > 0) return textParts.join("\n");
  }

  // Fallback: try response.output_text directly
  if (typeof response?.output_text === "string") {
    return response.output_text;
  }

  throw new Error(`searchWithAzure: no text extracted from Responses API response. model=${model}`);
}

// ─── Azure: Stage 2 consolidation prompt ─────────────────────────────────────

function buildConsolidationPrompt(
  input: ApplicantInput,
  searchResults: string
): string {
  const searchTerms = generateSearchTerms(input);

  return `You are a Board Applicant Research Assistant for the Government of Alberta Executive Council.
Below are raw web search results gathered about the applicant. Consolidate them into a structured background check report.

IMPORTANT: Every finding must cite a source URL. The SOURCES section must list every URL actually found. Do not list sources you didn't find.

${SENSITIVE_TOPICS_LIST}
${SENSITIVE_TOPICS_INSTRUCTIONS}

APPLICANT: ${input.name}
LOCATION: ${input.location}
${input.role ? `ROLE: ${input.role}` : ""}
${input.employers?.length ? `EMPLOYERS: ${input.employers.join(", ")}` : ""}
${input.businesses?.length ? `BUSINESSES: ${input.businesses.join(", ")}` : ""}
${input.organizations?.length ? `ORGANIZATIONS: ${input.organizations.join(", ")}` : ""}

RAW SEARCH RESULTS:
${searchResults}

PRE-GENERATED SEARCH TERMS (include these verbatim in the SEARCH TERMS section):
${searchTerms}

---

Generate the report in this EXACT format. Every section is mandatory — use "No records found" or "No profile found" when a source returned nothing.

${input.name.toUpperCase()} BACKGROUND CHECK
${input.location}
Recommendation: [Proceed / Caution / Do Not Proceed]

NOTABLE ITEMS
- [Key finding 1, with source URL]
- [Add more as needed, or "None identified" if nothing notable]

## SENSITIVE TOPICS FLAGGED

| Category | Topic | Finding | Source |
|----------|-------|---------|--------|
| [Category] | [Topic matched from sensitive topics list] | [What was found] | [URL] |

(If no sensitive topics found: "No sensitive topics identified in search results.")

PERSONAL INFORMATION
[Role/occupation description and any demographic details found. Cite sources.]

DONATIONS
Elections AB: [Results with source URL, or "None found"]
Elections Canada: [Results with source URL, or "None found"]

SOCIAL MEDIA/ONLINE PRESENCE

Facebook:
Account: [URL or "None"]
Summary: [Brief summary of content found, or "No activity found"]
Notable Posts: [Reference to Schedule A, or "None"]

Instagram:
Account: [URL or "None"]
Summary: [Brief summary of content found, or "No activity found"]
Notable Posts: [Reference to Schedule B, or "None"]

LinkedIn:
Account: [URL or "None"]
Summary: [Brief summary of content found, or "No activity found"]
Notable Posts: [Reference to Schedule C, or "None"]

Twitter/X:
Account: [URL or "None"]
Summary: [Brief summary of content found, or "No activity found"]
Notable Posts: [Reference to Schedule D, or "None"]

YouTube:
Account: [URL or "None"]
Summary: [Brief summary of content found, or "No activity found"]

Other:
[Any other platforms or "None"]
Notable Posts: [Reference to Schedule E, or "None"]

SCHEDULE A – Facebook
[List flagged posts with direct URLs, or "No flagged posts"]

SCHEDULE B – Instagram
[List flagged posts with direct URLs, or "No flagged posts"]

SCHEDULE C – LinkedIn
[List flagged posts with direct URLs, or "No flagged posts"]

SCHEDULE D – Twitter/X
[List flagged posts with direct URLs, or "No flagged posts"]

SCHEDULE E – Other
[List flagged posts with direct URLs, or "No flagged posts"]

--- MANDATORY 10-SOURCE DETAILED FINDINGS ---

Each section below MUST appear in the report. State "No records found" or "No profile found" explicitly when a source returned nothing. Every finding must cite a source URL.

## 1. PROFESSIONAL DISCIPLINE
[Findings from Law Society of Alberta (lsa.ca), Real Estate Council of Alberta (reca.ca), APEGA, or any other professional regulatory bodies. Include disciplinary actions, suspensions, license revocations. Or "No records found."]

## 2. ELECTIONS ALBERTA
[Donation records from efpublic.elections.ab.ca — amounts, recipients, dates. Or "No contributions found."]

## 3. ELECTIONS CANADA
[Donation records from elections.ca — amounts, recipients, dates. Or "No contributions found."]

## 4. GOOGLE SEARCH RESULTS
[News articles, public records, court records, business registrations, and other general web findings. Cite all source URLs.]

## 5. LINKEDIN
[Profile URL, work history, education, posts, articles, interests, skills, connections summary. Or "No profile found."]

## 6. TWITTER/X
[Profile URL, bio, recent tweets/replies, notable follows, media. Or "No profile found."]

## 7. FACEBOOK
[Profile URL, about info, posts, friends list (notable connections), photos, likes/events. Or "No profile found."]

## 8. INSTAGRAM
[Profile URL, bio, posts, tagged posts, reels, following list. Or "No profile found."]

## 9. YOUTUBE
[Channel URL, uploaded videos, comments on other videos, playlists/subscriptions. Or "No channel found."]

## 10. CANLII
[Court cases from canlii.org — case name, citation, court, date, summary. Check as party, witness, or mentioned individual. Or "No cases found."]

--- END MANDATORY SECTIONS ---

SOURCES
[List every URL actually found during the search. Do not list sources you didn't find.]

SOURCES/CHECKLIST
✓ Professional Discipline (Law Society of Alberta, Real Estate Council of Alberta, APEGA)
✓ Elections AB contributor search (quarterly, annual, leadership, nomination, third-party ads)
✓ Elections Canada donation database
✓ Google (search terms listed below)
✓ LinkedIn (Resume Info, Top Interests, Posts, Comments, Reactions)
✓ Twitter/X (Tweets, Replies, Media, Following, Username)
✓ Facebook (Friends, Photos, About Info, Likes/Events, Posts, Username)
✓ Instagram (Posts and comments, Tagged Posts, Reels, Following, Username)
✓ YouTube
✓ CanLii (Canadian Legal Information Institute)

SEARCH TERMS
${searchTerms}`;
}

// ─── Azure: generateReportAzure (Two-stage pipeline) ─────────────────────────

/**
 * Two-stage pipeline for the Azure/LiteLLM path:
 *
 * Stage 1: 5 parallel Responses API calls (SEARCH_MODEL + web_search tool)
 *   1. Professional & Legal (Law Society, RECA, CanLII, regulatory bodies)
 *   2. Political donations (Elections Alberta, Elections Canada)
 *   3. General web (news, public records, court cases, business registrations)
 *   4. LinkedIn (work history, posts, articles, interests)
 *   5. Social media (Twitter/X, Facebook, Instagram, YouTube)
 *
 * Stage 2: Chat Completions streaming (REPORT_MODEL) consolidates search
 *   results into the final structured report with mandatory 10-source sections,
 *   streamed back as SSE.
 *
 * Progress SSE events are sent during Stage 1 so the client knows we're working.
 *
 * refs #46
 */
async function generateReportAzure(
  input: ApplicantInput,
  options: GenerateReportOptions = {}
): Promise<ReadableStream<Uint8Array>> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is not set");
  }

  const azureEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const baseURL = azureEndpoint ?? process.env.OPENAI_BASE_URL;

  const clientOptions: ConstructorParameters<typeof OpenAI>[0] = { apiKey };
  if (baseURL) clientOptions.baseURL = baseURL;

  const client = new OpenAI(clientOptions);
  const config = getConfig();
  const searchModel = config.SEARCH_MODEL;
  const reportModel = options.model ?? config.REPORT_MODEL;

  // Build a compact applicant context string for search prompts
  const nameVars = generateNameVariations(input.name);
  const nameParts = input.name.trim().split(/\s+/);
  const firstName = nameParts[0] ?? input.name;
  const lastName = nameParts[nameParts.length - 1] ?? input.name;

  const applicantCtx = [
    `Name: ${input.name} (also try: ${nameVars.slice(1).join(", ")})`,
    `Location: ${input.location}`,
    input.role ? `Role: ${input.role}` : "",
    input.employers?.length ? `Employers: ${input.employers.join(", ")}` : "",
    input.businesses?.length ? `Businesses: ${input.businesses.join(", ")}` : "",
    input.organizations?.length ? `Organizations: ${input.organizations.join(", ")}` : "",
    input.emails?.length ? `Emails: ${input.emails.join(", ")}` : "",
    input.usernames?.length ? `Known usernames: ${input.usernames.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  // ── Stage 1: 5 parallel web search prompts ────────────────────────────────
  // Each prompt is RETRIEVAL ONLY — no analysis, no summarization.
  // All analysis happens in Stage 2.

  // Search 1 — Professional & Legal
  const focus1 = `Find all information about ${input.name} from ${input.location} on: Law Society of Alberta (lsa.ca), Real Estate Council of Alberta (reca.ca), CanLII (canlii.org), and any other professional regulatory bodies. Return all results verbatim with URLs. Do not analyze or summarize.

APPLICANT INFO:
${applicantCtx}`;

  // Search 2 — Political Donations
  const focus2 = `Find all information about ${input.name} from ${input.location} on: Elections Alberta contributor search (efpublic.elections.ab.ca), Elections Canada contribution search (elections.ca/WPAPPS/WPF). Return all donation records, amounts, recipients, dates verbatim with URLs. Do not analyze or summarize.

APPLICANT INFO:
${applicantCtx}`;

  // Search 3 — General Web
  const focus3 = `Find all information about ${input.name} from ${input.location}. Search using name variations: "${firstName} ${lastName}" OR "${lastName}, ${firstName}" OR "${firstName}${lastName}". Search for news articles, public records, court cases, government records, business registrations. Return all results verbatim with URLs. Do not analyze or summarize.

APPLICANT INFO:
${applicantCtx}`;

  // Search 4 — LinkedIn
  const focus4 = `Find the LinkedIn profile for ${input.name} from ${input.location}. Return: full work history, education, posts, articles, interests, skills, connections, and profile URL. Return all information verbatim. Do not analyze or summarize.

APPLICANT INFO:
${applicantCtx}`;

  // Search 5 — Social Media (Twitter, Facebook, Instagram, YouTube)
  const focus5 = `Find all social media profiles for ${input.name} from ${input.location} on Twitter/X, Facebook, Instagram, and YouTube. Return: profile URLs, bios, recent posts, followers/following, media, comments, tagged content. Return all information verbatim with URLs. Do not analyze or summarize.

APPLICANT INFO:
${applicantCtx}`;

  const encoder = new TextEncoder();

  const readableStream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        // ── Stage 1: 5 parallel web searches ──────────────────────────────
        // Send individual progress events for each search so the client can
        // display meaningful status updates during the longer search phase.

        const keepalive = setInterval(() => {
          try { controller.enqueue(encoder.encode(':\n\n')); } catch {}
        }, 5000);

        let result1: string, result2: string, result3: string, result4: string, result5: string;
        try {
          // Fire all 5 searches in parallel; send status events before awaiting
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ status: "Searching professional & legal databases..." })}\n\n`
            )
          );
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ status: "Searching political donation records..." })}\n\n`
            )
          );
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ status: "Searching the web..." })}\n\n`
            )
          );
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ status: "Searching LinkedIn..." })}\n\n`
            )
          );
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ status: "Searching social media..." })}\n\n`
            )
          );

          [result1, result2, result3, result4, result5] = await Promise.all([
            searchWithAzure(client, focus1, searchModel),
            searchWithAzure(client, focus2, searchModel),
            searchWithAzure(client, focus3, searchModel),
            searchWithAzure(client, focus4, searchModel),
            searchWithAzure(client, focus5, searchModel),
          ]);
        } finally {
          clearInterval(keepalive);
        }

        const searchResults = [
          "=== PROFESSIONAL & LEGAL SEARCH RESULTS ===",
          result1,
          "",
          "=== POLITICAL DONATIONS SEARCH RESULTS ===",
          result2,
          "",
          "=== GENERAL WEB SEARCH RESULTS ===",
          result3,
          "",
          "=== LINKEDIN SEARCH RESULTS ===",
          result4,
          "",
          "=== SOCIAL MEDIA SEARCH RESULTS ===",
          result5,
        ].join("\n");

        // ── Stage 2: Chat Completions streaming — consolidate into report ──
        const systemPrompt = buildSystemPrompt();
        const consolidationPrompt = buildConsolidationPrompt(input, searchResults);

        // Resolve temperature — omit entirely for gpt-5 models
        const temperature = resolveTemperature(reportModel, options.temperature);

        const openaiStream = await client.chat.completions.create({
          model: reportModel,
          stream: true as const,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: consolidationPrompt },
          ],
          max_tokens: 16000,
          ...(temperature !== undefined ? { temperature } : {}),
        });

        for await (const chunk of openaiStream) {
          const content = chunk.choices[0]?.delta?.content;
          if (content) {
            const sseMessage = `data: ${JSON.stringify({ text: content })}\n\n`;
            controller.enqueue(encoder.encode(sseMessage));
          }
        }

        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (error) {
        const errMessage =
          error instanceof Error ? error.message : "Unknown streaming error";
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ error: errMessage })}\n\n`)
        );
        controller.close();
        throw error;
      }
    },
  });

  return readableStream;
}

// ─── generateReport (Chat Completions path — serp/brave) ──────────────────────

/**
 * Generates a structured background check report via OpenAI Chat Completions streaming.
 * Used when SEARCH_API_PROVIDER is 'serp' or 'brave' (pre-fetched research data).
 *
 * @param input - Applicant data and raw research content
 * @param options - Optional model/temperature overrides
 * @returns A ReadableStream of SSE-formatted text chunks
 */
async function generateReportChatCompletions(
  input: ApplicantInput,
  options: GenerateReportOptions = {}
): Promise<ReadableStream<Uint8Array>> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is not set");
  }

  const clientOptions: ConstructorParameters<typeof OpenAI>[0] = { apiKey };
  const baseURL = process.env.OPENAI_BASE_URL;
  if (baseURL) clientOptions.baseURL = baseURL;

  const client = new OpenAI(clientOptions);
  const model = options.model ?? getConfig().OPENAI_MODEL;

  // Resolve temperature — omit entirely for gpt-5 models
  const temperature = resolveTemperature(model, options.temperature);

  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildReportPrompt(input);

  // Convert OpenAI stream to a Web API ReadableStream for SSE.
  // The create call is inside start() so errors are surfaced as SSE error events.
  const encoder = new TextEncoder();

  const readableStream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const openaiStream = await client.chat.completions.create({
          model,
          stream: true as const,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          max_tokens: 16000,
          ...(temperature !== undefined ? { temperature } : {}),
        });

        for await (const chunk of openaiStream) {
          const content = chunk.choices[0]?.delta?.content;
          if (content) {
            // SSE format: data: <content>\n\n
            const sseMessage = `data: ${JSON.stringify({ text: content })}\n\n`;
            controller.enqueue(encoder.encode(sseMessage));
          }
        }
        // Send [DONE] signal unconditionally after stream ends
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (error) {
        const errMessage =
          error instanceof Error ? error.message : "Unknown streaming error";
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ error: errMessage })}\n\n`)
        );
        controller.close();
      }
    },
  });

  return readableStream;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Generates a structured background check report via OpenAI streaming.
 *
 * Routes to the correct implementation based on SEARCH_API_PROVIDER
 *  - 'azure': Two-stage pipeline — 5 parallel gpt-4.1 web searches (SEARCH_MODEL)
 *             then consolidation via Chat Completions streaming (REPORT_MODEL)
 *  - 'serp' | 'brave': Uses Chat Completions with pre-fetched researchData
 *
 * @param input - Applicant data and raw research content
 * @param options - Optional model/temperature overrides
 * @returns A ReadableStream of SSE-formatted text chunks
 *
 * @example
 * const stream = await generateReport({
 *   name: "Homer Simpson",
 *   location: "Springfield, AB",
 *   researchData: "",
 * });
 * // Pipe stream to HTTP response for SSE consumption
 */
export async function generateReport(
  input: ApplicantInput,
  options: GenerateReportOptions = {}
): Promise<ReadableStream<Uint8Array>> {
  const config = getConfig();

  if (config.SEARCH_API_PROVIDER === "azure") {
    return generateReportAzure(input, options);
  }

  return generateReportChatCompletions(input, options);
}
