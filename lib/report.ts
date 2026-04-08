/**
 * lib/report.ts
 * Generates a structured background check report using OpenAI streaming.
 * Report format follows the Board Applicant Research Assistant specification.
 *
 * refs #6
 */

import OpenAI from "openai";

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
  /** Raw research data collected from web/social sources */
  researchData: string;
}

export interface GenerateReportOptions {
  /** OpenAI model to use (default: gpt-4o) */
  model?: string;
  /** Temperature (default: 0.3 for consistent reports) */
  temperature?: number;
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

// ─── Report Prompt ────────────────────────────────────────────────────────────

function buildReportPrompt(input: ApplicantInput): string {
  const nameVariations = generateNameVariations(input.name);
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

// ─── generateReport ───────────────────────────────────────────────────────────

/**
 * Generates a structured background check report via OpenAI streaming.
 *
 * @param input - Applicant data and raw research content
 * @param options - Optional model/temperature overrides
 * @returns A ReadableStream of SSE-formatted text chunks
 *
 * @example
 * const stream = await generateReport({
 *   name: "Homer Simpson",
 *   location: "Springfield, AB",
 *   researchData: "...",
 * });
 * // Pipe stream to HTTP response for SSE consumption
 */
export async function generateReport(
  input: ApplicantInput,
  options: GenerateReportOptions = {}
): Promise<ReadableStream<Uint8Array>> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is not set");
  }

  const client = new OpenAI({ apiKey });
  const model = options.model ?? "gpt-4o";
  const temperature = options.temperature ?? 0.3;

  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildReportPrompt(input);

  // Create streaming completion
  const openaiStream = await client.chat.completions.create({
    model,
    temperature,
    stream: true,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  // Convert OpenAI stream to a Web API ReadableStream for SSE
  const encoder = new TextEncoder();

  const readableStream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
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
