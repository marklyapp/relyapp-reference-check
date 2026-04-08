/**
 * app/api/check/route.ts
 * POST endpoint that orchestrates the full background-check pipeline.
 *
 * Pipeline:
 *  1. Parse input (LinkedIn URL or plain name) via parseLinkedInUrl()
 *  2. Run web searches via searchPerson()
 *  3. Flag search results via flagContent()
 *  4. Generate a streaming report via generateReport()
 *  5. Return an SSE stream (text/event-stream)
 *
 * refs #7
 */

import { NextRequest } from "next/server";
import { parseLinkedInUrl } from "@/lib/linkedin";
import { searchPerson, SearchPersonInput } from "@/lib/search";
import { flagContent } from "@/lib/keywords";
import { generateReport, ApplicantInput } from "@/lib/report";

// ─── Request body ─────────────────────────────────────────────────────────────

export interface CheckRequestBody {
  /** Person name or LinkedIn profile URL (required) */
  input: string;
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
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Splits "First [Middle] Last" into firstName / lastName.
 * Falls back to using the full string as firstName when no spaces present.
 */
function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: parts[0] };
  const lastName = parts[parts.length - 1];
  const firstName = parts.slice(0, parts.length - 1).join(" ");
  return { firstName, lastName };
}

/**
 * Builds a plain-text summary of all search results suitable for the LLM.
 */
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

/**
 * Returns a JSON error response.
 */
function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ─── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<Response> {
  // 1. Parse + validate request body
  let body: CheckRequestBody;
  try {
    body = (await req.json()) as CheckRequestBody;
  } catch {
    return jsonError("Invalid JSON in request body", 400);
  }

  if (!body.input || typeof body.input !== "string" || !body.input.trim()) {
    return jsonError('Missing required field: "input"', 400);
  }

  // 2. Parse LinkedIn URL or name
  const parsed = parseLinkedInUrl(body.input.trim());
  const searchName = parsed.searchName || body.input.trim();

  // Derive a human-readable name:
  // - If it was a LinkedIn URL, searchName is the profile slug (best we have)
  // - If it was a plain name, searchName IS the plain name
  const displayName = searchName
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

  // Split into first/last for searchPerson
  const { firstName, lastName } = splitName(displayName);

  // Build context array from optional fields
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

  // 3. Run web searches
  let searchResult: Awaited<ReturnType<typeof searchPerson>>;
  try {
    searchResult = await searchPerson(searchInput);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Search failed";
    return jsonError(`Search error: ${message}`, 502);
  }

  // 4. Flag content
  const allText = searchResult.results
    .map((r) => [r.title ?? "", r.snippet ?? ""].join(" "))
    .join("\n");
  const flagged = flagContent(allText);

  // 5. Build research data string
  const researchData = buildResearchData(searchResult.results, flagged);

  // 6. Build ApplicantInput for report generation
  const applicantInput: ApplicantInput = {
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

  // 7. Generate streaming report
  let reportStream: ReadableStream<Uint8Array>;
  try {
    reportStream = await generateReport(applicantInput);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Report generation failed";
    // Surface config/auth errors clearly
    if (message.includes("OPENAI_API_KEY")) {
      return jsonError("Server configuration error: OpenAI API key not set", 500);
    }
    return jsonError(`Report error: ${message}`, 502);
  }

  // 8. Return SSE stream
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
