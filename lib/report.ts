/**
 * lib/report.ts
 * Generates a structured background check report using OpenAI streaming.
 * Report format follows the Board Applicant Research Assistant specification.
 *
 * Supports two code paths:
 *  - azure: Two-stage pipeline:
 *      Stage 0 — Generate targeted sensitive search terms (Chat Completions, SEARCH_MODEL)
 *      Stage 1 — 8 parallel web searches via Responses API (SEARCH_MODEL / gpt-4.1)
 *      Stage 2 — Report consolidation via Chat Completions streaming (REPORT_MODEL / claude-opus-4-6)
 *  - serp/brave: Uses Chat Completions API with pre-fetched research data
 *
 * refs #6, #30, #34, #36, #45, #46, #55, #59
 */

import OpenAI from "openai";
import { getConfig } from "./config";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ApplicantInput {
  name: string;
  location: string;
  role?: string;
  employers?: string[];
  businesses?: string[];
  organizations?: string[];
  emails?: string[];
  phones?: string[];
  addresses?: string[];
  usernames?: string[];
  researchData: string;
}

export interface GenerateReportOptions {
  model?: string;
  temperature?: number;
}

export interface CachedSearchResults {
  timestamp: string;
  applicant: { name: string; location: string };
  generatedSearchTerms: string;
  searches: {
    professionalLegal: string;
    politicalDonations: string;
    generalWeb: string;
    linkedin: string;
    socialMedia: string;
    sensitiveTopics: string;
  };
}

// ─── Temperature helpers ──────────────────────────────────────────────────────

export function shouldOmitTemperature(model: string | undefined): boolean {
  if (!model) return false;
  return model.startsWith("gpt-5");
}

export function resolveTemperature(
  model: string | undefined,
  override?: number
): number | undefined {
  if (override !== undefined) return override;
  const config = getConfig();
  if (config.REPORT_TEMPERATURE !== undefined) return config.REPORT_TEMPERATURE;
  if (shouldOmitTemperature(model)) return undefined;
  return 0.3;
}

// ─── Sensitive Topics List ────────────────────────────────────────────────────

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
SENSITIVE TOPICS FLAGGING (refs #45, #55):
After the NOTABLE ITEMS section, add a ## SENSITIVE TOPICS FLAGGED section.
Cross-reference ALL search results against the sensitive topics list above and flag any matches.

Use SHORT source labels (e.g. "Wikipedia", "CBC News", "GoA", "Elections AB") instead of full URLs in the table. Full URLs go in the SOURCES section at the bottom.

Use emoji prefixes for severity in the Category column:
- 🔴 for high (Politicians, Political Party, Legal/Legislative, Ideologies, Fascism, Communism, Socialism)
- 🟠 for medium (Political Issues, Health Policy, Education, Social Issues, Immigration, MAID, Gun Control, NATO)
- 🟡 for contextual (Energy, Environment, Oil, Gas, Pipeline, Coal, Nuclear, Wind, Solar)

## SENSITIVE TOPICS FLAGGED

| Category | Topic | Finding | Source |
|----------|-------|---------|--------|
| 🔴 Political Party | UCP | Leader of Wildrose, merged into UCP in 2017 | Wikipedia |
| 🟠 Pipelines | Trans Mountain | Publicly advocated for pipeline expansion | CBC News |
| 🟡 Oil and Gas | Energy Minister | Current Minister since 2023 | GoA |

If NO sensitive topics are found: "No sensitive topics identified in search results."

The Category column must use one of: 🔴 Politicians, 🔴 Political Party, 🔴 Legal/Legislative, 🔴 Ideology, 🟠 Political Issue, 🟠 Health Policy, 🟠 Education, 🟠 Social Issue, 🟠 Immigration, 🟠 MAID, 🟠 Gun Control, 🟠 NATO, 🟡 Energy/Environment, 🟡 Oil and Gas, 🟡 Pipeline, 🟡 Coal, 🟡 Nuclear, 🟡 Wind/Solar.
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

SOURCE HONESTY: For Elections Alberta, Elections Canada, and Alberta Lobbyist Registry — the web search cannot directly query these form-based databases. Use '⚠️ Web search only' status unless actual specific records (amounts, dates, recipients) were found. State 'Web search only — direct database not yet queried' if no specific records exist.

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
| [Category] | [Topic] | [Finding] | [Short label e.g. Wikipedia] |

(If no sensitive topics found: "No sensitive topics identified in search results.")

PERSONAL INFORMATION
[Role/occupation description and any demographic details found in the research data]

DONATIONS
Elections AB: [Results or "None found"]
Elections Canada: [Results or "None found"]

SOCIAL MEDIA/ONLINE PRESENCE

Facebook:
Account: [URL or "None"]
Summary: [Brief summary, or "No activity found"]
Notable Posts: [Reference to Schedule A, or "None"]

Instagram:
Account: [URL or "None"]
Summary: [Brief summary, or "No activity found"]
Notable Posts: [Reference to Schedule B, or "None"]

LinkedIn:
Account: [URL or "None"]
Summary: [Brief summary, or "No activity found"]
Notable Posts: [Reference to Schedule C, or "None"]

Twitter/X:
Account: [URL or "None"]
Summary: [Brief summary, or "No activity found"]
Notable Posts: [Reference to Schedule D, or "None"]

YouTube:
Account: [URL or "None"]
Summary: [Brief summary, or "No activity found"]

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

    variations.push(`${first} ${last}`);
    variations.push(`${first[0]}. ${last}`);

    if (middle.length > 0) {
      variations.push(`${first} ${middle[0][0]}. ${last}`);
      variations.push(`${first} ${middle.join(" ")} ${last}`);
    }

    variations.push(`${last}, ${first}`);
    variations.push(`${last} ${first}`);
  }

  return Array.from(new Set(variations));
}

function generateSearchTerms(input: ApplicantInput): string {
  const nameVars = generateNameVariations(input.name);
  const location = input.location;

  const lines: string[] = [];

  const nameOrStr = nameVars.map((n) => `"${n}"`).join(" OR ");
  lines.push(`Names: (${nameOrStr}) AND "${location}"`);

  if (input.employers?.length) {
    for (const employer of input.employers) {
      lines.push(`(${nameOrStr}) AND "${employer}"`);
    }
  }

  if (input.businesses?.length) {
    for (const biz of input.businesses) {
      lines.push(`(${nameOrStr}) AND "${biz}"`);
    }
  }

  if (input.organizations?.length) {
    for (const org of input.organizations) {
      lines.push(`(${nameOrStr}) AND "${org}"`);
    }
  }

  if (input.emails?.length) {
    lines.push(`Emails: ${input.emails.join(", ")}`);
    for (const email of input.emails) {
      lines.push(`"${email}"`);
    }
  }

  if (input.phones?.length) {
    lines.push(`Phone Numbers: ${input.phones.join(", ")}`);
    for (const phone of input.phones) {
      lines.push(`"${phone}"`);
    }
  }

  if (input.addresses?.length) {
    lines.push(`Addresses: ${input.addresses.join(", ")}`);
    for (const addr of input.addresses) {
      lines.push(`"${addr}"`);
    }
  }

  return lines.join("\n");
}

// ─── Azure: Stage 1 — searchWithAzure ────────────────────────────────────────

export async function searchWithAzure(
  client: OpenAI,
  model: string,
  focusPrompt: string,
  label?: string
): Promise<string> {
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
      if (item?.type === "output_text" && typeof item.text === "string") {
        textParts.push(item.text);
      }
    }
    if (textParts.length > 0) return textParts.join("\n");
  }

  if (typeof response?.output_text === "string") {
    return response.output_text;
  }

  throw new Error(`searchWithAzure(${label ?? "?"}): no text extracted from Responses API response. model=${model}`);
}

// ─── Azure: Stage 2 consolidation prompt ─────────────────────────────────────

function buildConsolidationPrompt(
  input: ApplicantInput,
  searchResults: string,
  generatedTerms: string
): string {
  const searchTerms = generateSearchTerms(input);

  const generatedTermsSection = generatedTerms.trim()
    ? `\nAI-GENERATED SENSITIVE TOPIC SEARCH TERMS:\n${generatedTerms.trim()}`
    : "";

  return `You are a Board Applicant Research Assistant for the Government of Alberta Executive Council.
Below are raw web search results gathered about the applicant. Consolidate them into a structured background check report.

IMPORTANT: In the SENSITIVE TOPICS FLAGGED table, use SHORT source labels (e.g. "Wikipedia", "CBC News", "GoA", "Elections AB") instead of full URLs. Full URLs go in the SOURCES section.

Use emoji prefixes for severity in the SENSITIVE TOPICS FLAGGED table Category column:
- 🔴 for high (Politicians, Political Party, Legal/Legislative, Ideologies, Fascism, Communism, Socialism)
- 🟠 for medium (Political Issues, Health Policy, Education, Social Issues, Immigration, MAID, Gun Control, NATO)
- 🟡 for contextual (Energy, Environment, Oil, Gas, Pipeline, Coal, Nuclear, Wind, Solar)

SOURCE HONESTY: For Elections Alberta, Elections Canada, and Alberta Lobbyist Registry — the web search cannot directly query these form-based databases. Use '⚠️ Web search only' status unless actual specific records (amounts, dates, recipients) were found. State 'Web search only — direct database not yet queried' if no specific records exist.

FORMAT RULES: Use TABLES for structured data. Avoid paragraphs — bullets and tables only. Each source section: records found = table, no records = one line. Report must be scannable.

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

PRE-GENERATED SEARCH TERMS (include ALL of these verbatim in the SEARCH TERMS section):
${searchTerms}
${generatedTermsSection}

---

Generate the report in this EXACT format. Every section is mandatory — use "No records found" or "No profile found" when a source returned nothing.

${input.name.toUpperCase()} BACKGROUND CHECK
${input.location}
Recommendation: [Proceed / Caution / Do Not Proceed]

NOTABLE ITEMS
- [Key finding 1, with source]
- [Add more as needed, or "None identified" if nothing notable]

## SENSITIVE TOPICS FLAGGED

| Category | Topic | Finding | Source |
|----------|-------|---------|--------|
| 🔴 Political Party | UCP | Leader of Wildrose, merged into UCP in 2017 | Wikipedia |
| 🟠 Pipelines | Trans Mountain | Publicly advocated for pipeline expansion as Energy Minister | CBC News |
| 🟡 Oil and Gas | Energy Minister | Current Minister of Energy and Minerals since 2023 | GoA |

(If no sensitive topics found: "No sensitive topics identified in search results.")

PERSONAL INFORMATION
[Role/occupation description and any demographic details found. Cite sources.]

DONATIONS
Elections AB: [Results with source, or "None found"]
Elections Canada: [Results with source, or "None found"]

SOCIAL MEDIA/ONLINE PRESENCE

Facebook:
Account: [URL or "None"]
Summary: [Brief summary, or "No activity found"]
Notable Posts: [Reference to Schedule A, or "None"]

Instagram:
Account: [URL or "None"]
Summary: [Brief summary, or "No activity found"]
Notable Posts: [Reference to Schedule B, or "None"]

LinkedIn:
Account: [URL or "None"]
Summary: [Brief summary, or "No activity found"]
Notable Posts: [Reference to Schedule C, or "None"]

Twitter/X:
Account: [URL or "None"]
Summary: [Brief summary, or "No activity found"]
Notable Posts: [Reference to Schedule D, or "None"]

YouTube:
Account: [URL or "None"]
Summary: [Brief summary, or "No activity found"]

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

Each section below MUST appear in the report. State "No records found" or "No profile found" explicitly when a source returned nothing.

## 1. PROFESSIONAL DISCIPLINE
[Findings from Law Society of Alberta (lsa.ca), Real Estate Council of Alberta (reca.ca), APEGA, or any other professional regulatory bodies. Or "No records found."]

## 2. ELECTIONS ALBERTA
[Donation records from efpublic.elections.ab.ca — amounts, recipients, dates. Or "No contributions found."]

## 3. ELECTIONS CANADA
[Donation records from elections.ca — amounts, recipients, dates. Or "No contributions found."]

## 4. GOOGLE SEARCH RESULTS
[News articles, public records, court records, business registrations, and other general web findings. Cite all source URLs.]

## 5. LINKEDIN
[Profile URL, work history, education, posts, articles, interests, skills. Or "No profile found."]

## 6. TWITTER/X
[Profile URL, bio, recent tweets/replies, notable follows, media. Or "No profile found."]

## 7. FACEBOOK
[Profile URL, about info, posts, friends list (notable connections), photos, likes/events. Or "No profile found."]

## 8. INSTAGRAM
[Profile URL, bio, posts, tagged posts, reels, following list. Or "No profile found."]

## 9. YOUTUBE
[Channel URL, uploaded videos, comments on other videos, playlists/subscriptions. Or "No channel found."]

## 10. CANLII
[Court cases from canlii.org — case name, citation, court, date, summary. Or "No cases found."]

## 11. ALBERTA LOBBYIST REGISTRY
[⚠️ Web search only — albertalobbyistregistry.ca is a form-based database; web search cannot directly query it. If specific lobbying registrations were found in search results, list them in a table. Otherwise: "Web search only — direct database not yet queried."]

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
${searchTerms}
${generatedTermsSection}`;
}

// ─── Azure: generateReportAzure (Two-stage pipeline) ─────────────────────────

async function generateReportAzure(
  input: ApplicantInput,
  options: GenerateReportOptions = {},
  cachedResults?: CachedSearchResults
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

  const encoder = new TextEncoder();

  const readableStream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const keepalive = setInterval(() => {
          try { controller.enqueue(encoder.encode(':\n\n')); } catch {}
        }, 5000);

        let generatedTerms: string;
        let result1: string, result2: string, result3: string, result4: string, result5: string;
        let result6a: string, result6b: string, result6c: string;

        if (cachedResults) {
          // ── Use cached results — skip Stage 0 and Stage 1 ─────────────
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ status: "Using cached search results — skipping to Stage 2..." })}\n\n`
            )
          );
          generatedTerms = cachedResults.generatedSearchTerms;
          result1 = cachedResults.searches.professionalLegal;
          result2 = cachedResults.searches.politicalDonations;
          result3 = cachedResults.searches.generalWeb;
          result4 = cachedResults.searches.linkedin;
          result5 = cachedResults.searches.socialMedia;
          // sensitiveTopics in cache is the merged result of all 3 batches
          result6a = cachedResults.searches.sensitiveTopics;
          result6b = "";
          result6c = "";
          clearInterval(keepalive);
        } else {
          try {
            // ── Stage 0: Generate targeted sensitive search terms ──────────
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ status: "Generating targeted search terms..." })}\n\n`
              )
            );

            const searchTermsResponse = await client.chat.completions.create({
              model: config.SEARCH_MODEL,
              messages: [
                {
                  role: "system",
                  content: "Generate 30 targeted web search terms that combine this person's name with sensitive political and social topics. One search term per line. No numbering, no explanations.",
                },
                {
                  role: "user",
                  content: `Subject: ${input.name}, ${input.location}.\n\nSensitive topics to cross-reference:\n${SENSITIVE_TOPICS_LIST}`,
                },
              ],
              max_tokens: 500,
            });
            generatedTerms = searchTermsResponse.choices[0].message.content ?? "";

            // ── Split generatedTerms into 3 batches of 10 for parallel execution (refs #59) ──
            const termLines = generatedTerms
              .split("\n")
              .map((l) => l.trim())
              .filter(Boolean);
            const batch1 = termLines.slice(0, 10).join("\n");
            const batch2 = termLines.slice(10, 20).join("\n");
            const batch3 = termLines.slice(20, 30).join("\n");

            // ── Stage 1: 8 parallel web searches (refs #59) ─────────────────────────
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
                `data: ${JSON.stringify({ status: "Searching professional background & career history..." })}\n\n`
              )
            );
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ status: "Searching social media coverage & public statements..." })}\n\n`
              )
            );
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ status: "Running sensitive topics cross-reference (batch 1 of 3)..." })}\n\n`
              )
            );
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ status: "Running sensitive topics cross-reference (batch 2 of 3)..." })}\n\n`
              )
            );
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ status: "Running sensitive topics cross-reference (batch 3 of 3)..." })}\n\n`
              )
            );

            // Search 1 — Professional & Legal
            const focus1 = `Find all information about ${input.name} from ${input.location} on: Law Society of Alberta (lsa.ca), Real Estate Council of Alberta (reca.ca), CanLII (canlii.org), and any other professional regulatory bodies. Also search Alberta Lobbyist Registry (albertalobbyistregistry.ca) for any lobbying registrations. Return all results verbatim with URLs. Do not analyze or summarize.\n\nAPPLICANT INFO:\n${applicantCtx}`;

            // Search 2 — Political Donations
            const focus2 = `Find all information about ${input.name} from ${input.location} on: Elections Alberta contributor search (efpublic.elections.ab.ca), Elections Canada contribution search (elections.ca/WPAPPS/WPF). Return all donation records, amounts, recipients, dates verbatim with URLs. Do not analyze or summarize.\n\nAPPLICANT INFO:\n${applicantCtx}`;

            // Search 3 — General Web
            const focus3 = `Find all information about ${input.name} from ${input.location}. Search using name variations: "${firstName} ${lastName}" OR "${lastName}, ${firstName}" OR "${firstName}${lastName}". Search for news articles, public records, court cases, government records, business registrations. Return all results verbatim with URLs. Do not analyze or summarize.\n\nAPPLICANT INFO:\n${applicantCtx}`;

            // Search 4 — LinkedIn (reframed to avoid refusals — refs #59)
            const focus4 = `Search for the professional background, career history, education, and business activities of ${input.name} from ${input.location}. Look for professional directory listings, company bios, conference speaker profiles, board memberships, and any public career information. Include employment history, educational institutions, professional certifications, and published articles or presentations. Return all findings verbatim with URLs.\n\nAPPLICANT INFO:\n${applicantCtx}`;

            // Search 5 — Social Media (reframed to avoid refusals — refs #59)
            const focus5 = `Search for public statements, commentary, and online activity by ${input.name} from ${input.location} across social media platforms. Look for:\n- News articles quoting their social media posts\n- Public tweets or X posts reported in media\n- Facebook posts or statements covered in news\n- YouTube videos featuring or by this person\n- Reddit threads discussing this person\n- Any viral or controversial social media moments\n- Public commentary on political or social issues\nReturn all findings verbatim with URLs.\n\nAPPLICANT INFO:\n${applicantCtx}`;

            // Search 6a/6b/6c — Sensitive Topics Cross-Reference split into 3 batches of 10 (refs #59)
            // Each batch is a separate parallel call to prevent the model from stopping early
            const focus6a = `Search the web for EACH of the following search terms. Return ALL results found with URLs. Do not analyze or summarize.\n\nSearch terms:\n${batch1}`;
            const focus6b = `Search the web for EACH of the following search terms. Return ALL results found with URLs. Do not analyze or summarize.\n\nSearch terms:\n${batch2}`;
            const focus6c = `Search the web for EACH of the following search terms. Return ALL results found with URLs. Do not analyze or summarize.\n\nSearch terms:\n${batch3}`;

            [result1, result2, result3, result4, result5, result6a, result6b, result6c] = await Promise.all([
              searchWithAzure(client, searchModel, focus1, 'professional-legal'),
              searchWithAzure(client, searchModel, focus2, 'political-donations'),
              searchWithAzure(client, searchModel, focus3, 'general-web'),
              searchWithAzure(client, searchModel, focus4, 'linkedin'),
              searchWithAzure(client, searchModel, focus5, 'social-media'),
              searchWithAzure(client, searchModel, focus6a, 'sensitive-topics-batch-1'),
              searchWithAzure(client, searchModel, focus6b, 'sensitive-topics-batch-2'),
              searchWithAzure(client, searchModel, focus6c, 'sensitive-topics-batch-3'),
            ]);
          } finally {
            clearInterval(keepalive);
          }

          // Cache raw search results — send as SSE event so client can store for re-rendering
          // Merge all 3 sensitive batches into one combined string for the cache
          const mergedSensitiveTopics = [
            result6a ? `=== SENSITIVE TOPICS BATCH 1 ===\n${result6a}` : "",
            result6b ? `\n=== SENSITIVE TOPICS BATCH 2 ===\n${result6b}` : "",
            result6c ? `\n=== SENSITIVE TOPICS BATCH 3 ===\n${result6c}` : "",
          ].filter(Boolean).join("\n");

          const cacheData: CachedSearchResults = {
            timestamp: new Date().toISOString(),
            applicant: { name: input.name, location: input.location },
            generatedSearchTerms: generatedTerms,
            searches: {
              professionalLegal: result1,
              politicalDonations: result2,
              generalWeb: result3,
              linkedin: result4,
              socialMedia: result5,
              sensitiveTopics: mergedSensitiveTopics,
            },
          };

          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ cache: cacheData })}\n\n`)
          );
        }

        // Merge sensitive topic batches — result6b/6c are "" when using cache (already merged in result6a)
        const sensitiveTopicsResult = cachedResults
          ? result6a
          : [
              result6a ? `=== SENSITIVE TOPICS BATCH 1 ===\n${result6a}` : "",
              result6b ? `\n=== SENSITIVE TOPICS BATCH 2 ===\n${result6b}` : "",
              result6c ? `\n=== SENSITIVE TOPICS BATCH 3 ===\n${result6c}` : "",
            ].filter(Boolean).join("\n");

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
          "",
          "=== SENSITIVE TOPICS CROSS-REFERENCE RESULTS ===",
          sensitiveTopicsResult,
        ].join("\n");

        // Stage 2: Chat Completions streaming — consolidate into report
        const systemPrompt = buildSystemPrompt();
        const consolidationPrompt = buildConsolidationPrompt(input, searchResults, generatedTerms);

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

  const temperature = resolveTemperature(model, options.temperature);

  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildReportPrompt(input);

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
      }
    },
  });

  return readableStream;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function generateReport(
  input: ApplicantInput,
  options: GenerateReportOptions = {},
  cachedResults?: CachedSearchResults
): Promise<ReadableStream<Uint8Array>> {
  const config = getConfig();

  if (config.SEARCH_API_PROVIDER === "azure") {
    return generateReportAzure(input, options, cachedResults);
  }

  return generateReportChatCompletions(input, options);
}
