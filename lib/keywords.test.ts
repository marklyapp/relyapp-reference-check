/**
 * lib/keywords.test.ts
 * Unit tests for flagContent() and keyword exports.
 */

import {
  flagContent,
  politicalFigures,
  ideologies,
  politicalIssues,
  legalRegulatory,
} from "./keywords";

// ─── Type check helpers ──────────────────────────────────────────────────────

function isStringArray(arr: unknown): arr is string[] {
  return Array.isArray(arr) && arr.every((x) => typeof x === "string");
}

// ─── Export shape tests ──────────────────────────────────────────────────────

test("politicalFigures is a non-empty string array", () => {
  expect(isStringArray(politicalFigures)).toBe(true);
  expect(politicalFigures.length).toBeGreaterThan(0);
});

test("ideologies is a non-empty string array", () => {
  expect(isStringArray(ideologies)).toBe(true);
  expect(ideologies.length).toBeGreaterThan(0);
});

test("politicalIssues is a non-empty string array", () => {
  expect(isStringArray(politicalIssues)).toBe(true);
  expect(politicalIssues.length).toBeGreaterThan(0);
});

test("legalRegulatory is a non-empty string array", () => {
  expect(isStringArray(legalRegulatory)).toBe(true);
  expect(legalRegulatory.length).toBeGreaterThan(0);
});

// ─── flagContent return shape ─────────────────────────────────────────────────

test("flagContent returns an array", () => {
  expect(Array.isArray(flagContent("hello world"))).toBe(true);
});

test("flagContent returns [] for text with no keywords", () => {
  expect(flagContent("The quick brown fox jumps over the lazy dog.")).toEqual([]);
});

test("flagContent result items have category string and matches array", () => {
  const results = flagContent("Justin Trudeau discussed carbon tax and NATO.");
  for (const r of results) {
    expect(typeof r.category).toBe("string");
    expect(Array.isArray(r.matches)).toBe(true);
    expect(r.matches.length).toBeGreaterThan(0);
  }
});

// ─── Case-insensitive matching ────────────────────────────────────────────────

test("flagContent matches keywords case-insensitively (uppercase)", () => {
  const results = flagContent("CARBON TAX is controversial.");
  const cat = results.find((r) => r.category === "politicalIssues");
  expect(cat).toBeDefined();
  expect(cat!.matches.some((m) => m.toLowerCase() === "carbon tax")).toBe(true);
});

test("flagContent matches keywords case-insensitively (mixed case)", () => {
  const results = flagContent("Fascism and Communism are ideologies.");
  const cat = results.find((r) => r.category === "ideologies");
  expect(cat).toBeDefined();
  const lowerMatches = cat!.matches.map((m) => m.toLowerCase());
  expect(lowerMatches).toContain("fascism");
  expect(lowerMatches).toContain("communism");
});

// ─── Specific category detections ────────────────────────────────────────────

test("detects political figure: Justin Trudeau", () => {
  const results = flagContent("Justin Trudeau announced a new policy.");
  const cat = results.find((r) => r.category === "politicalFigures");
  expect(cat).toBeDefined();
  expect(cat!.matches).toContain("Justin Trudeau");
});

test("detects political figure: Hitler", () => {
  const results = flagContent("The article referenced Hitler.");
  const cat = results.find((r) => r.category === "politicalFigures");
  expect(cat).toBeDefined();
  expect(cat!.matches).toContain("Hitler");
});

test("detects ideology: Socialism", () => {
  const results = flagContent("Socialism is discussed in this piece.");
  const cat = results.find((r) => r.category === "ideologies");
  expect(cat).toBeDefined();
  expect(cat!.matches).toContain("Socialism");
});

test("detects political issue: 2SLGBTQI+", () => {
  const results = flagContent("Policy affecting 2SLGBTQI+ communities.");
  const cat = results.find((r) => r.category === "politicalIssues");
  expect(cat).toBeDefined();
  expect(cat!.matches).toContain("2SLGBTQI+");
});

test("detects political issue: Residential schools", () => {
  const results = flagContent("The legacy of Residential schools in Canada.");
  const cat = results.find((r) => r.category === "politicalIssues");
  expect(cat).toBeDefined();
  expect(cat!.matches).toContain("Residential schools");
});

test("detects political issue: MAID", () => {
  const results = flagContent("MAID legislation was debated in parliament.");
  const cat = results.find((r) => r.category === "politicalIssues");
  expect(cat).toBeDefined();
  expect(cat!.matches).toContain("MAID");
});

test("detects legal/regulatory: Supreme Court of Canada", () => {
  const results = flagContent("The Supreme Court of Canada issued a ruling.");
  const cat = results.find((r) => r.category === "legalRegulatory");
  expect(cat).toBeDefined();
  expect(cat!.matches).toContain("Supreme Court of Canada");
});

test("detects legal/regulatory: AHS", () => {
  const results = flagContent("AHS restructuring is ongoing.");
  // AHS appears in both politicalIssues and legalRegulatory
  const catLegal = results.find((r) => r.category === "legalRegulatory");
  const catPolicy = results.find((r) => r.category === "politicalIssues");
  expect(catLegal || catPolicy).toBeDefined();
});

// ─── Deduplication ───────────────────────────────────────────────────────────

test("flagContent deduplicates repeated matches within a category", () => {
  const results = flagContent("NATO, NATO, NATO again.");
  const cat = results.find((r) => r.category === "politicalIssues");
  expect(cat).toBeDefined();
  const natoMatches = cat!.matches.filter((m) => m.toLowerCase() === "nato");
  expect(natoMatches.length).toBe(1);
});

// ─── No external dependencies ────────────────────────────────────────────────

test("flagContent is a pure function with no side effects", () => {
  const text = "Carbon tax and gun control debates.";
  const result1 = flagContent(text);
  const result2 = flagContent(text);
  expect(JSON.stringify(result1)).toBe(JSON.stringify(result2));
});

// ─── Multiple category hits ───────────────────────────────────────────────────

test("flagContent can return matches across multiple categories", () => {
  const results = flagContent(
    "Justin Trudeau supports socialism and the carbon tax while the Supreme Court of Canada rules."
  );
  const categories = results.map((r) => r.category);
  expect(categories).toContain("politicalFigures");
  expect(categories).toContain("ideologies");
  expect(categories).toContain("politicalIssues");
  expect(categories).toContain("legalRegulatory");
});
