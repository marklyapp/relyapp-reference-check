/**
 * lib/report.ts
 * Generates a structured background check report using OpenAI streaming.
 * Report format follows the Board Applicant Research Assistant specification.
 *
 * Supports two code paths:
 *  - azure: Two-stage pipeline:
 *      Stage 1 — 3 parallel web searches via Responses API (SEARCH_MODEL / gpt-4.1)
 *      Stage 2 — Report consolidation via Chat Completions streaming (REPORT_MODEL / gpt-5.4-pro)
 *  - serp/brave: Uses Chat Completions API with pre-fetched research data
 *
 * refs #6, #30, #34, #36
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
 * gpt-5 models (e.g. gpt-5.4-pro) do not accept the temperature parameter at
 * all — passing it triggers UnsupportedParamsError — so we omit it entirely.
 */
export function shouldOmitTemperature(model: string | undefined): boolean {
  if (!model) return false;
  return model.startsWith("gpt-5");
}

/**
 * Resolves the effective temperature for a given model.
 * Priority: explicit override > REPORT_TEMPERATURE env var > default (0.3 for gpt-4, omit for gpt-5).
 * The gpt-5 guard always takes priority — if the model is gpt-5, temperature is
 * omitted regardless of any configured override, preventing UnsupportedParamsError.
 *
 * Returns undefined when temperature should be omitted entirely.
 */
export function resolveTemperature(
  model: string | undefined,
  override?: number
): number | undefined {
  // Collapse desired value from: explicit override > env var config > default (0.3)
  const config = getConfig();
  const desired =
    override !== undefined
      ? override
      : config.REPORT_TEMPERATURE !== undefined
      ? config.REPORT_TEMPERATURE
      : 0.3;

  // gpt-5 guard always wins — these models reject the temperature param entirely.
  if (shouldOmitTemperature(model)) return undefined;
  return desired;
}

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
- SEARCH TERMS uses OR/AND operators with name variations`;
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

Generate the report in this EXACT format:

${input.name.toUpperCase()} BACKGROUND CHECK
${input.location}
Recommendation: [Proceed / Caution / Do Not Proceed]

NOTABLE ITEMS
- [Key finding 1, with source URL]
- [Add more as needed, or "None identified" if nothing notable]

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
 * Stage 1: 3 parallel Responses API calls (SEARCH_MODEL + web_search tool)
 *   - General info, news, professional background, employer history
 *   - Political donations, regulatory/discipline records, court cases
 *   - Social media profiles and activity
 *
 * Stage 2: Chat Completions streaming (REPORT_MODEL) consolidates search
 *   results into the final structured report, streamed back as SSE.
 *
 * Progress SSE events are sent during Stage 1 so the client knows we're working.
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
  const nameOrStr = nameVars.map((n) => `"${n}"`).join(" OR ");
  const applicantCtx = [
    `Name: ${input.name} (also try: ${nameVars.slice(1).join(", ")})`,
    `Location: ${input.location}`,
    input.role ? `Role: ${input.role}` : "",
    input.employers?.length ? `Employers: ${input.employers.join(", ")}` : "",
    input.businesses?.length ? `Businesses: ${input.businesses.join(", ")}` : "",
    input.organizations?.length ? `Organizations: ${input.organizations.join(", ")}` : "",
    input.emails?.length ? `Emails: ${input.emails.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  // Focus prompts for each of the 3 parallel searches
  const focus1 = `Search the entire internet for general information about the following applicant.
Find: news articles, professional background, employer history, business connections, general web presence.
Search using name variations: ${nameOrStr} AND "${input.location}".
Be thorough and comprehensive. Cite every source with its full URL.

APPLICANT INFO:
${applicantCtx}`;

  const focus2 = `Search the entire internet for political and regulatory records about the following applicant.
Find: political donations (Elections Alberta, Elections Canada), professional discipline records,
court cases (CanLii), regulatory filings, any involvement with professional governing bodies
(Law Society of Alberta, RECA, APEGA, CPA Alberta, etc.).
Search using name variations: ${nameOrStr}.
Be thorough and comprehensive. Cite every source with its full URL.

APPLICANT INFO:
${applicantCtx}`;

  const focus3 = `Search the entire internet for all social media profiles and activity for the following applicant.
Find: LinkedIn, Facebook, Twitter/X, Instagram, YouTube profiles and posts, comments, activity.
Look for all profile variations and usernames. Search using: ${nameOrStr}.
Be thorough and comprehensive. Cite every profile URL and post URL found.

APPLICANT INFO:
${applicantCtx}`;

  const encoder = new TextEncoder();

  const readableStream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        // ── Stage 1: 3 parallel web searches ──────────────────────────────
        // Send progress event so the client knows we're searching
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ status: "Searching the web..." })}\n\n`
          )
        );

        const [result1, result2, result3] = await Promise.all([
          searchWithAzure(client, focus1, searchModel),
          searchWithAzure(client, focus2, searchModel),
          searchWithAzure(client, focus3, searchModel),
        ]);

        const searchResults = [
          "=== GENERAL SEARCH RESULTS ===",
          result1,
          "",
          "=== POLITICAL/REGULATORY SEARCH RESULTS ===",
          result2,
          "",
          "=== SOCIAL MEDIA SEARCH RESULTS ===",
          result3,
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
 * Routes to the correct implementation based on SEARCH_API_PROVIDER:
 *  - 'azure': Two-stage pipeline — 3 parallel gpt-4.1 web searches (SEARCH_MODEL)
 *             then gpt-5.4-pro consolidation via Chat Completions (REPORT_MODEL)
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
