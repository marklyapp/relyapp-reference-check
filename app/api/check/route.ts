/**
 * app/api/check/route.ts
 * POST endpoint that orchestrates the full background-check pipeline.
 *
 * Pipeline (serp/brave):
 *  1. Parse input (LinkedIn URL or plain name) via parseLinkedInUrl()
 *  2. Run web searches via searchPerson()
 *  3. Flag search results via flagContent()
 *  4. Generate a streaming report via generateReport()
 *  5. Return an SSE stream (text/event-stream)
 *
 * Pipeline (azure):
 *  1. Parse input (LinkedIn URL or plain name) via parseLinkedInUrl()
 *  2. Skip searchPerson() — report generation handles search internally
 *  3. Generate a streaming report via generateReport() (uses Responses API + web_search)
 *  4. Return an SSE stream (text/event-stream)
 *
 * refs #7, #13, #30
 */

import { NextRequest } from "next/server";
import { parseLinkedInUrl } from "@/lib/linkedin";
import { searchPerson, SearchPersonInput } from "@/lib/search";
import { flagContent } from "@/lib/keywords";
import { generateReport, ApplicantInput, CachedSearchResults } from "@/lib/report";
import { getConfig } from "@/lib/config";

export const maxDuration = 60;

// ─── Request body ─────────────────────────────────────────────────────────────

export interface CheckRequestBody {
  /**
   * Person\'s full name (preferred field, sent by the chat UI).
   * For backwards-compat, `input` is also accepted (plain name or LinkedIn URL).
   * At least one of `name` or `input` is required.
   */
  name?: string;
  /** @deprecated Use `name` instead. Kept for backwards-compatibility. */
  input?: string;
  /** Optional: explicit LinkedIn profile URL */
  linkedinUrl?: string;
  /** Optional: city/province e.g. "Calgary, AB" */
  location?: string;
  /** Optional: known employer(s) */
  employers?: string[];
  /** Optional: known usernames or email addresses */
  usernames?: string[];
  /** Optional: role being applied for */
  role?: string;
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
  /**
   * Optional: JSON string of cached search results from a previous run.
   * If provided, Stage 0 (term generation) and Stage 1 (web searches) are
   * skipped and the cached data is passed directly to Stage 2 consolidation.
   * Useful for re-rendering/reformatting without re-running expensive searches.
   */
  cachedResults?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: parts[0] };
  const lastName = parts[parts.length - 1];
  const firstName = parts.slice(0, parts.length - 1).join(" ");
  return { firstName, lastName };
}

function buildResearchData(
  results: Awaited<ReturnType<typeof searchPerson>>["results"],
  flagged: ReturnType<typeof flagContent>
): string {
  const lines: string[] = [];

  if (results.length === 0) {
    lines.push("No search results found.");
  } else {
    for (const r of results) {
      lines.push(`[${r.source.toUpperCase()}] ${r.title ?? "Untitled"}`);
      if (r.url) lines.push(`URL: ${r.url}`);
      if (r.snippet) lines.push(`Snippet: ${r.snippet}`);
      lines.push("");
    }
  }

  if (flagged.length > 0) {
    lines.push("--- FLAGGED KEYWORDS ---");
    for (const { category, matches } of flagged) {
      lines.push(`${category}: ${matches.join(", ")}`);
    }
  }

  return lines.join("\n");
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ─── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<Response> {
  let body: CheckRequestBody;
  try {
    body = (await req.json()) as CheckRequestBody;
  } catch {
    return jsonError("Invalid JSON in request body", 400);
  }

  // Accept `name` (new) or `input` (legacy)
  const rawInput = (body.name ?? body.input ?? "").trim();

  if (!rawInput) {
    return jsonError("Missing required field: name", 400);
  }

  if (rawInput.length > 200) {
    return jsonError("Name is too long (max 200 characters)", 400);
  }

  // Determine the display name
  const linkedinSource = body.linkedinUrl?.trim() ?? rawInput;
  const parsed = parseLinkedInUrl(linkedinSource);
  const searchName = parsed.searchName || rawInput;

  const displayName = searchName
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c: string) => c.toUpperCase());

  const { firstName, lastName } = splitName(displayName);

  const config = getConfig();
  const isAzure = config.SEARCH_API_PROVIDER === "azure";

  // ── Build applicant input ─────────────────────────────────────────────────

  let applicantInput: ApplicantInput;

  if (isAzure) {
    // Azure path: skip searchPerson() — report.ts handles search internally
    // via the Responses API web_search tool.
    applicantInput = {
      name: displayName,
      location: body.location ?? "Unknown",
      researchData: "", // unused by azure path
      ...(body.role && { role: body.role }),
      ...(body.employers?.length && { employers: body.employers }),
      ...(body.businesses?.length && { businesses: body.businesses }),
      ...(body.organizations?.length && { organizations: body.organizations }),
      ...(body.emails?.length && { emails: body.emails }),
      ...(body.phones?.length && { phones: body.phones }),
      ...(body.addresses?.length && { addresses: body.addresses }),
    };
  } else {
    // serp/brave path: run web searches first, then pass results to report
    const context: string[] = [];
    if (body.location) context.push(body.location);
    if (body.employers?.length) context.push(...body.employers);
    if (body.usernames?.length) context.push(...body.usernames);
    if (body.emails?.length) context.push(...body.emails);
    if (body.organizations?.length) context.push(...body.organizations);
    if (body.businesses?.length) context.push(...body.businesses);

    const searchInput: SearchPersonInput = {
      firstName,
      lastName,
      ...(context.length > 0 && { context }),
    };

    let searchResult: Awaited<ReturnType<typeof searchPerson>>;
    try {
      searchResult = await searchPerson(searchInput);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Search failed";
      if (/rate.?limit|429|too many requests/i.test(message)) {
        return jsonError(
          "Rate limit reached: the search service is temporarily unavailable. Please try again in a few minutes.",
          429
        );
      }
      return jsonError(`Search error: ${message}`, 502);
    }

    const allText = searchResult.results
      .map((r) => [r.title ?? "", r.snippet ?? ""].join(" "))
      .join("\n");
    const flagged = flagContent(allText);
    const researchData = buildResearchData(searchResult.results, flagged);

    applicantInput = {
      name: displayName,
      location: body.location ?? "Unknown",
      researchData,
      ...(body.role && { role: body.role }),
      ...(body.employers?.length && { employers: body.employers }),
      ...(body.businesses?.length && { businesses: body.businesses }),
      ...(body.organizations?.length && { organizations: body.organizations }),
      ...(body.emails?.length && { emails: body.emails }),
      ...(body.phones?.length && { phones: body.phones }),
      ...(body.addresses?.length && { addresses: body.addresses }),
    };
  }

  // ── Generate streaming report ─────────────────────────────────────────────

  // Parse cachedResults if provided (azure path only — bypasses Stage 0+1)
  let parsedCache: CachedSearchResults | undefined;
  if (isAzure && body.cachedResults) {
    try {
      parsedCache = JSON.parse(body.cachedResults) as CachedSearchResults;
    } catch {
      return jsonError("Invalid cachedResults: must be a valid JSON string", 400);
    }
  }

  let reportStream: ReadableStream<Uint8Array>;
  try {
    reportStream = await generateReport(applicantInput, {}, parsedCache);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Report generation failed";
    if (message.includes("OPENAI_API_KEY")) {
      return jsonError(
        "Server configuration error: OpenAI API key not set",
        500
      );
    }
    if (/rate.?limit|429/i.test(message)) {
      return jsonError(
        "Rate limit reached: the AI service is temporarily unavailable. Please try again in a few minutes.",
        429
      );
    }
    if (/401|403|unauthorized|forbidden/i.test(message)) {
      return jsonError(
        "Authentication error: the AI service API key is invalid or missing.",
        401
      );
    }
    return jsonError(`Report error: ${message}`, 502);
  }

  return new Response(reportStream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
