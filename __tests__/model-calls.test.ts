/**
 * __tests__/model-calls.test.ts
 * Integration smoke tests for model call parameters.
 *
 * Verifies that:
 * - Chat Completions calls for gpt-5 models do NOT include temperature
 * - Chat Completions calls for gpt-4 models DO include temperature=0.3
 * - Responses API calls work without temperature for gpt-5
 * - 400 errors are caught and surfaced properly
 * - REPORT_TEMPERATURE env var override works
 *
 * refs #36
 */

import OpenAI from "openai";
import { shouldOmitTemperature, resolveTemperature, searchWithAzure } from "../lib/report";

// ─── Mock config module ───────────────────────────────────────────────────────

const mockGetConfig = jest.fn(() => ({
  OPENAI_API_KEY: "test-key",
  SEARCH_API_PROVIDER: "azure" as const,
  OPENAI_MODEL: "gpt-4.1",
  SEARCH_MODEL: "gpt-4.1",
  REPORT_MODEL: "gpt-5.4-pro",
  REPORT_TEMPERATURE: undefined as number | undefined,
}));

jest.mock("../lib/config", () => ({
  getConfig: (...args: unknown[]) => mockGetConfig(...args),
  resetConfig: jest.fn(),
}));

jest.mock("openai");

// ─── shouldOmitTemperature ────────────────────────────────────────────────────

describe("shouldOmitTemperature", () => {
  it("returns true for gpt-5 models", () => {
    expect(shouldOmitTemperature("gpt-5")).toBe(true);
    expect(shouldOmitTemperature("gpt-5.4-pro")).toBe(true);
    expect(shouldOmitTemperature("gpt-5-turbo")).toBe(true);
  });

  it("returns false for gpt-4 models", () => {
    expect(shouldOmitTemperature("gpt-4")).toBe(false);
    expect(shouldOmitTemperature("gpt-4.1")).toBe(false);
    expect(shouldOmitTemperature("gpt-4o")).toBe(false);
    expect(shouldOmitTemperature("gpt-4-turbo")).toBe(false);
  });

  it("returns false for non-gpt-5 models", () => {
    expect(shouldOmitTemperature("claude-3")).toBe(false);
    expect(shouldOmitTemperature("o1-mini")).toBe(false);
  });

  it("returns false for undefined model", () => {
    expect(shouldOmitTemperature(undefined)).toBe(false);
  });
});

// ─── resolveTemperature ───────────────────────────────────────────────────────

describe("resolveTemperature", () => {
  beforeEach(() => {
    // Reset to default config (no REPORT_TEMPERATURE override)
    mockGetConfig.mockReturnValue({
      OPENAI_API_KEY: "test-key",
      SEARCH_API_PROVIDER: "azure" as const,
      OPENAI_MODEL: "gpt-4.1",
      SEARCH_MODEL: "gpt-4.1",
      REPORT_MODEL: "gpt-5.4-pro",
      REPORT_TEMPERATURE: undefined,
    });
  });

  it("returns undefined for gpt-5 models (no override)", () => {
    expect(resolveTemperature("gpt-5.4-pro")).toBeUndefined();
  });

  it("returns 0.3 for gpt-4 models (no override)", () => {
    expect(resolveTemperature("gpt-4.1")).toBe(0.3);
    expect(resolveTemperature("gpt-4o")).toBe(0.3);
  });

  it("returns explicit override for non-gpt-5 models; gpt-5 guard still wins", () => {
    // gpt-5 guard takes priority over all overrides — temperature always omitted
    expect(resolveTemperature("gpt-5.4-pro", 1)).toBeUndefined();
    // Non-gpt-5 models honour explicit override
    expect(resolveTemperature("gpt-4.1", 0.7)).toBe(0.7);
  });

  it("returns REPORT_TEMPERATURE config value when set", () => {
    mockGetConfig.mockReturnValue({
      OPENAI_API_KEY: "test-key",
      SEARCH_API_PROVIDER: "azure" as const,
      OPENAI_MODEL: "gpt-4.1",
      SEARCH_MODEL: "gpt-4.1",
      REPORT_MODEL: "gpt-5.4-pro",
      REPORT_TEMPERATURE: 0.5,
    });
    // gpt-5 guard always wins — temperature is omitted even when REPORT_TEMPERATURE is set
    expect(resolveTemperature("gpt-5.4-pro")).toBeUndefined();
    // Non-gpt-5 models honour the config override
    expect(resolveTemperature("gpt-4.1")).toBe(0.5);
  });

  it("explicit override takes precedence over REPORT_TEMPERATURE", () => {
    mockGetConfig.mockReturnValue({
      OPENAI_API_KEY: "test-key",
      SEARCH_API_PROVIDER: "azure" as const,
      OPENAI_MODEL: "gpt-4.1",
      SEARCH_MODEL: "gpt-4.1",
      REPORT_MODEL: "gpt-5.4-pro",
      REPORT_TEMPERATURE: 0.5,
    });
    expect(resolveTemperature("gpt-4.1", 0.9)).toBe(0.9);
  });
});

// ─── Chat Completions: temperature param tests ────────────────────────────────

describe("Chat Completions temperature param", () => {
  let mockCreate: jest.Mock;

  // Minimal async iterable stream mock
  function makeStreamMock(chunks: string[]) {
    async function* gen() {
      for (const text of chunks) {
        yield { choices: [{ delta: { content: text } }] };
      }
    }
    return gen();
  }

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.OPENAI_API_KEY = "test-key";

    mockCreate = jest.fn().mockResolvedValue(makeStreamMock(["hello"]));

    const MockOpenAI = OpenAI as jest.MockedClass<typeof OpenAI>;
    MockOpenAI.mockImplementation(() => ({
      chat: {
        completions: {
          create: mockCreate,
        },
      },
      responses: {
        create: jest.fn(),
      },
    } as unknown as OpenAI));
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  it("does NOT pass temperature for gpt-5 models (serp path)", async () => {
    mockGetConfig.mockReturnValue({
      OPENAI_API_KEY: "test-key",
      SEARCH_API_PROVIDER: "serp" as const,
      OPENAI_MODEL: "gpt-5.4-pro",
      SEARCH_MODEL: "gpt-4.1",
      REPORT_MODEL: "gpt-5.4-pro",
      REPORT_TEMPERATURE: undefined,
    });

    const { generateReport } = require("../lib/report");

    const stream = await generateReport({
      name: "Test User",
      location: "Edmonton, AB",
      researchData: "some data",
    });

    // Consume the stream
    const reader = stream.getReader();
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }

    expect(mockCreate).toHaveBeenCalled();
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs).not.toHaveProperty("temperature");
    expect(callArgs.model).toBe("gpt-5.4-pro");
  });

  it("DOES pass temperature=0.3 for gpt-4 models (serp path)", async () => {
    mockGetConfig.mockReturnValue({
      OPENAI_API_KEY: "test-key",
      SEARCH_API_PROVIDER: "serp" as const,
      OPENAI_MODEL: "gpt-4.1",
      SEARCH_MODEL: "gpt-4.1",
      REPORT_MODEL: "gpt-4.1",
      REPORT_TEMPERATURE: undefined,
    });

    const { generateReport } = require("../lib/report");

    const stream = await generateReport({
      name: "Test User",
      location: "Edmonton, AB",
      researchData: "some data",
    });

    const reader = stream.getReader();
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }

    expect(mockCreate).toHaveBeenCalled();
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs).toHaveProperty("temperature", 0.3);
    expect(callArgs.model).toBe("gpt-4.1");
  });

  it("uses REPORT_TEMPERATURE override when set", async () => {
    mockGetConfig.mockReturnValue({
      OPENAI_API_KEY: "test-key",
      SEARCH_API_PROVIDER: "serp" as const,
      OPENAI_MODEL: "gpt-4.1",
      SEARCH_MODEL: "gpt-4.1",
      REPORT_MODEL: "gpt-4.1",
      REPORT_TEMPERATURE: 0.7,
    });

    const { generateReport } = require("../lib/report");

    const stream = await generateReport({
      name: "Test User",
      location: "Edmonton, AB",
      researchData: "some data",
    });

    const reader = stream.getReader();
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }

    expect(mockCreate).toHaveBeenCalled();
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs).toHaveProperty("temperature", 0.7);
  });

  it("surfaces 400 errors as SSE error events (serp path)", async () => {
    mockGetConfig.mockReturnValue({
      OPENAI_API_KEY: "test-key",
      SEARCH_API_PROVIDER: "serp" as const,
      OPENAI_MODEL: "gpt-4.1",
      SEARCH_MODEL: "gpt-4.1",
      REPORT_MODEL: "gpt-4.1",
      REPORT_TEMPERATURE: undefined,
    });

    mockCreate.mockRejectedValue(
      new Error("400 Bad Request: unsupported parameter 'temperature'")
    );

    const { generateReport } = require("../lib/report");

    const stream = await generateReport({
      name: "Test User",
      location: "Edmonton, AB",
      researchData: "some data",
    });

    const reader = stream.getReader();
    const chunks: string[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(new TextDecoder().decode(value));
    }

    const allText = chunks.join("");
    // Should contain an error SSE event
    expect(allText).toContain('"error"');
    expect(allText).toContain("400 Bad Request");
  });
});

// ─── Responses API: temperature param tests ───────────────────────────────────

describe("searchWithAzure temperature param", () => {
  let mockResponsesCreate: jest.Mock;
  let mockClient: OpenAI;

  beforeEach(() => {
    jest.clearAllMocks();

    mockGetConfig.mockReturnValue({
      OPENAI_API_KEY: "test-key",
      SEARCH_API_PROVIDER: "azure" as const,
      OPENAI_MODEL: "gpt-4.1",
      SEARCH_MODEL: "gpt-4.1",
      REPORT_MODEL: "gpt-5.4-pro",
      REPORT_TEMPERATURE: undefined,
    });

    mockResponsesCreate = jest.fn().mockResolvedValue({
      output: [
        {
          content: [
            { type: "output_text", text: "Search result text" },
          ],
        },
      ],
    });

    mockClient = {
      responses: { create: mockResponsesCreate },
    } as unknown as OpenAI;
  });

  it("does NOT pass temperature for gpt-5 search models", async () => {
    await searchWithAzure(mockClient, "find info about John Doe", "gpt-5.4-pro");

    expect(mockResponsesCreate).toHaveBeenCalledWith(
      expect.not.objectContaining({ temperature: expect.anything() })
    );
  });

  it("DOES pass temperature for gpt-4 search models", async () => {
    await searchWithAzure(mockClient, "find info about John Doe", "gpt-4.1");

    expect(mockResponsesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ temperature: 0.3 })
    );
  });

  it("returns extracted text from Responses API output", async () => {
    const result = await searchWithAzure(mockClient, "test prompt", "gpt-4.1");
    expect(result).toBe("Search result text");
  });

  it("throws if no text can be extracted", async () => {
    mockResponsesCreate.mockResolvedValue({ output: [] });
    await expect(
      searchWithAzure(mockClient, "test prompt", "gpt-4.1")
    ).rejects.toThrow("no text extracted");
  });
});
