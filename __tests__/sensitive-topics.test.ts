/**
 * __tests__/sensitive-topics.test.ts
 * Tests verifying the sensitive topics flagging added in issue #45.
 *
 * Verifies that:
 * - SENSITIVE_TOPICS_LIST is exported and contains all major categories
 * - The system prompt (serp/brave path) includes the sensitive topics list
 * - The system prompt instructs flagging with category/topic/finding/source columns
 * - The consolidation prompt (azure path) includes the sensitive topics list
 * - Both prompts contain the SENSITIVE TOPICS FLAGGED section instruction
 *
 * refs #45
 */

import OpenAI from "openai";
import { SENSITIVE_TOPICS_LIST } from "../lib/report";

// ─── Mock config module ───────────────────────────────────────────────────────

const mockGetConfig = jest.fn(() => ({
  OPENAI_API_KEY: "test-key",
  SEARCH_API_PROVIDER: "serp" as const,
  OPENAI_MODEL: "gpt-4.1",
  SEARCH_MODEL: "gpt-4.1",
  REPORT_MODEL: "claude-opus-4-6",
  REPORT_TEMPERATURE: undefined as number | undefined,
}));

jest.mock("../lib/config", () => ({
  getConfig: (...args: unknown[]) => mockGetConfig(...args),
  resetConfig: jest.fn(),
}));

jest.mock("openai");

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal async iterable stream mock that yields one chunk */
function makeStreamMock(chunks: string[] = ["hello"]) {
  async function* gen() {
    for (const text of chunks) {
      yield { choices: [{ delta: { content: text } }] };
    }
  }
  return gen();
}

interface PromptCapture {
  systemPrompt: string;
  userPrompt: string;
}

/** Runs generateReport and captures the messages sent to chat.completions.create */
async function capturePrompts(provider: "serp" | "azure"): Promise<PromptCapture> {
  // Set OPENAI_API_KEY so the guard passes
  const origKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";

  try {
    mockGetConfig.mockReturnValue({
      OPENAI_API_KEY: "test-key",
      SEARCH_API_PROVIDER: provider,
      OPENAI_MODEL: "gpt-4.1",
      SEARCH_MODEL: "gpt-4.1",
      REPORT_MODEL: "claude-opus-4-6",
      REPORT_TEMPERATURE: undefined,
    });

    const mockCreate = jest.fn().mockResolvedValue(makeStreamMock(["ok"]));
    const mockResponsesCreate = jest.fn().mockResolvedValue({
      output: [{ content: [{ type: "output_text", text: "search result" }] }],
    });

    (OpenAI as jest.MockedClass<typeof OpenAI>).mockImplementation(() => ({
      chat: { completions: { create: mockCreate } },
      responses: { create: mockResponsesCreate },
    } as unknown as OpenAI));

    // Re-require to pick up updated mock state
    jest.isolateModules(() => {});
    const { generateReport } = require("../lib/report");

    const stream = await generateReport({
      name: "Test Applicant",
      location: "Edmonton, AB",
      researchData: "some research data",
    });

    const reader = stream.getReader();
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }

    if (!mockCreate.mock.calls.length) {
      throw new Error("chat.completions.create was never called");
    }

    const messages = mockCreate.mock.calls[0][0].messages as Array<{ role: string; content: string }>;
    const systemMsg = messages.find((m) => m.role === "system");
    const userMsg = messages.find((m) => m.role === "user");

    return {
      systemPrompt: systemMsg?.content ?? "",
      userPrompt: userMsg?.content ?? "",
    };
  } finally {
    if (origKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = origKey;
    }
  }
}

// ─── SENSITIVE_TOPICS_LIST export ─────────────────────────────────────────────

describe("SENSITIVE_TOPICS_LIST export", () => {
  it("is a non-empty string", () => {
    expect(typeof SENSITIVE_TOPICS_LIST).toBe("string");
    expect(SENSITIVE_TOPICS_LIST.length).toBeGreaterThan(100);
  });

  it("contains POLITICIANS & POLITICAL FIGURES category", () => {
    expect(SENSITIVE_TOPICS_LIST).toContain("POLITICIANS & POLITICAL FIGURES");
  });

  it("contains IDEOLOGIES category with key items", () => {
    expect(SENSITIVE_TOPICS_LIST).toContain("IDEOLOGIES");
    expect(SENSITIVE_TOPICS_LIST).toContain("Fascism");
    expect(SENSITIVE_TOPICS_LIST).toContain("Communism");
    expect(SENSITIVE_TOPICS_LIST).toContain("Socialism");
    expect(SENSITIVE_TOPICS_LIST).toContain("Conservatism");
    expect(SENSITIVE_TOPICS_LIST).toContain("Liberalism");
    expect(SENSITIVE_TOPICS_LIST).toContain("Feminism");
    expect(SENSITIVE_TOPICS_LIST).toContain("Environmentalism");
  });

  it("contains ENERGY & ENVIRONMENT category with key items", () => {
    expect(SENSITIVE_TOPICS_LIST).toContain("ENERGY & ENVIRONMENT");
    expect(SENSITIVE_TOPICS_LIST).toContain("Oil");
    expect(SENSITIVE_TOPICS_LIST).toContain("Gas");
    expect(SENSITIVE_TOPICS_LIST).toContain("Nuclear");
    expect(SENSITIVE_TOPICS_LIST).toContain("Alberta Energy Regulator");
  });

  it("contains HEALTH POLICY category with key items", () => {
    expect(SENSITIVE_TOPICS_LIST).toContain("HEALTH POLICY");
    expect(SENSITIVE_TOPICS_LIST).toContain("COVID-19");
    expect(SENSITIVE_TOPICS_LIST).toContain("MAID");
    expect(SENSITIVE_TOPICS_LIST).toContain("AHS restructuring");
  });

  it("contains EDUCATION category with key items", () => {
    expect(SENSITIVE_TOPICS_LIST).toContain("EDUCATION");
    expect(SENSITIVE_TOPICS_LIST).toContain("Alberta Teachers' Association");
    expect(SENSITIVE_TOPICS_LIST).toContain("K-12 Curriculum");
  });

  it("contains SOCIAL ISSUES category with key items", () => {
    expect(SENSITIVE_TOPICS_LIST).toContain("SOCIAL ISSUES");
    expect(SENSITIVE_TOPICS_LIST).toContain("Missing and murdered indigenous women");
    expect(SENSITIVE_TOPICS_LIST).toContain("Truth and reconciliation");
    expect(SENSITIVE_TOPICS_LIST).toContain("AISH");
  });

  it("contains POLITICAL ISSUES category with key items", () => {
    expect(SENSITIVE_TOPICS_LIST).toContain("POLITICAL ISSUES");
    expect(SENSITIVE_TOPICS_LIST).toContain("Israel/Palestine");
    expect(SENSITIVE_TOPICS_LIST).toContain("Carbon Tax");
    expect(SENSITIVE_TOPICS_LIST).toContain("2SLGBTQI+");
    expect(SENSITIVE_TOPICS_LIST).toContain("Pipelines");
  });

  it("contains LEGAL & LEGISLATIVE category", () => {
    expect(SENSITIVE_TOPICS_LIST).toContain("LEGAL & LEGISLATIVE");
    expect(SENSITIVE_TOPICS_LIST).toContain("judicial decision");
  });
});

// ─── System prompt (serp/brave path) ─────────────────────────────────────────

describe("buildSystemPrompt — serp/brave path (sensitive topics, refs #45)", () => {
  let captured: PromptCapture;

  beforeAll(async () => {
    captured = await capturePrompts("serp");
  });

  it("contains the sensitive topics list", () => {
    expect(captured.systemPrompt).toContain("SENSITIVE TOPICS TO FLAG");
    expect(captured.systemPrompt).toContain("POLITICIANS & POLITICAL FIGURES");
  });

  it("contains all major categories", () => {
    expect(captured.systemPrompt).toContain("IDEOLOGIES");
    expect(captured.systemPrompt).toContain("ENERGY & ENVIRONMENT");
    expect(captured.systemPrompt).toContain("HEALTH POLICY");
    expect(captured.systemPrompt).toContain("EDUCATION");
    expect(captured.systemPrompt).toContain("SOCIAL ISSUES");
    expect(captured.systemPrompt).toContain("POLITICAL ISSUES");
  });

  it("instructs flagging with SENSITIVE TOPICS FLAGGED section", () => {
    expect(captured.systemPrompt).toContain("SENSITIVE TOPICS FLAGGED");
  });

  it("instructs table format with category/topic/finding/source columns", () => {
    expect(captured.systemPrompt).toContain("Category");
    expect(captured.systemPrompt).toContain("Topic");
    expect(captured.systemPrompt).toContain("Finding");
    expect(captured.systemPrompt).toContain("Source");
  });

  it("instructs fallback message when no topics found", () => {
    expect(captured.systemPrompt).toContain("No sensitive topics identified");
  });
});

// ─── User prompt (serp/brave path) ───────────────────────────────────────────

describe("buildReportPrompt — serp/brave path (sensitive topics table, refs #45)", () => {
  let captured: PromptCapture;

  beforeAll(async () => {
    captured = await capturePrompts("serp");
  });

  it("includes SENSITIVE TOPICS FLAGGED section in output format", () => {
    expect(captured.userPrompt).toContain("SENSITIVE TOPICS FLAGGED");
  });

  it("includes the markdown table header with correct columns", () => {
    expect(captured.userPrompt).toContain("| Category | Topic | Finding | Source |");
  });
});

// ─── Consolidation prompt (azure path) ───────────────────────────────────────

describe("buildConsolidationPrompt — azure path (sensitive topics, refs #45)", () => {
  let captured: PromptCapture;

  beforeAll(async () => {
    captured = await capturePrompts("azure");
  });

  it("contains the sensitive topics list", () => {
    expect(captured.userPrompt).toContain("SENSITIVE TOPICS TO FLAG");
    expect(captured.userPrompt).toContain("POLITICIANS & POLITICAL FIGURES");
  });

  it("contains all major categories", () => {
    expect(captured.userPrompt).toContain("IDEOLOGIES");
    expect(captured.userPrompt).toContain("ENERGY & ENVIRONMENT");
    expect(captured.userPrompt).toContain("HEALTH POLICY");
    expect(captured.userPrompt).toContain("EDUCATION");
    expect(captured.userPrompt).toContain("SOCIAL ISSUES");
    expect(captured.userPrompt).toContain("POLITICAL ISSUES");
  });

  it("instructs flagging with SENSITIVE TOPICS FLAGGED section", () => {
    expect(captured.userPrompt).toContain("SENSITIVE TOPICS FLAGGED");
  });

  it("instructs table format with category/topic/finding/source columns", () => {
    expect(captured.userPrompt).toContain("| Category | Topic | Finding | Source |");
  });

  it("instructs fallback message when no topics found", () => {
    expect(captured.userPrompt).toContain("No sensitive topics identified");
  });
});
