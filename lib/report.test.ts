/**
 * lib/report.test.ts
 * Unit tests for generateReport() and ApplicantInput types.
 *
 * refs #6, #30, #36, #46
 */

// ─── Mock OpenAI before imports ───────────────────────────────────────────────

const mockCreate = jest.fn();
const mockResponsesCreate = jest.fn();

jest.mock("openai", () => {
  return jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: mockCreate,
      },
    },
    responses: {
      create: mockResponsesCreate,
    },
  }));
});

// Mock getConfig so we can control SEARCH_API_PROVIDER per-test
jest.mock("./config", () => ({
  getConfig: jest.fn(),
}));

import { generateReport, ApplicantInput } from "./report";
import { getConfig } from "./config";

const mockedGetConfig = getConfig as jest.Mock;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MINIMAL_INPUT: ApplicantInput = {
  name: "Homer Simpson",
  location: "Springfield, AB",
  researchData: "No significant findings.",
};

const FULL_INPUT: ApplicantInput = {
  name: "Homer Jay Simpson",
  location: "Calgary, AB",
  role: "Board Member – Alberta Gaming Commission",
  employers: ["Springfield Nuclear Power Plant"],
  businesses: ["H.J. Simpson Enterprises"],
  organizations: ["Stonecutters Lodge"],
  emails: ["homer@springfield.gov"],
  phones: ["403-555-0100"],
  addresses: ["742 Evergreen Terrace, Calgary, AB T2P 0A1"],
  researchData: `
    Facebook: https://facebook.com/homer.simpson — Posts about donuts, Duff beer. 
    Notable post: shared pro-NDP meme on 2024-01-15.
    LinkedIn: https://linkedin.com/in/homer-simpson — Nuclear Safety Inspector at SNPP since 1989.
    Twitter: https://twitter.com/homerjsimpson — Mostly complains about Flanders.
    Instagram: None found.
    Elections Canada: Donated $500 to Liberal Party in 2023.
    Elections AB: None found.
    CanLii: Assault charge 1993 (dropped).
  `,
};

/** Creates an async generator mimicking an OpenAI Chat Completions stream */
async function* fakeStream(chunks: string[]) {
  for (let i = 0; i < chunks.length; i++) {
    yield {
      choices: [
        {
          delta: { content: chunks[i] },
          finish_reason: i === chunks.length - 1 ? "stop" : null,
        },
      ],
    };
  }
}

/**
 * Creates a non-streaming Responses API response object.
 * The actual code uses stream: false and parses response.output[].content[].text
 */
function fakeResponsesObject(text: string) {
  return {
    output: [
      {
        content: [
          { type: "output_text", text },
        ],
      },
    ],
  };
}

// ─── Test isolation guards ────────────────────────────────────────────────────

beforeEach(() => {
  mockCreate.mockClear();
  mockResponsesCreate.mockClear();
  mockedGetConfig.mockClear();
  process.env.OPENAI_API_KEY = "sk-test-mock";
  // Default to serp for Chat Completions tests unless overridden
  mockedGetConfig.mockReturnValue({
    OPENAI_API_KEY: "sk-test-mock",
    SEARCH_API_KEY: "test-search-key",
    SEARCH_API_PROVIDER: "serp",
    OPENAI_MODEL: "gpt-4.1",
    SEARCH_MODEL: "gpt-4.1",
    REPORT_MODEL: "gpt-5.4-pro",
    REPORT_TEMPERATURE: undefined,
  });
});

afterEach(() => {
  delete process.env.OPENAI_API_KEY;
});

// ─── API key guard ────────────────────────────────────────────────────────────

test("generateReport throws if OPENAI_API_KEY is not set", async () => {
  delete process.env.OPENAI_API_KEY;

  await expect(generateReport(MINIMAL_INPUT)).rejects.toThrow(
    "OPENAI_API_KEY environment variable is not set"
  );
});

// ─── Return type (serp path) ──────────────────────────────────────────────────

test("generateReport returns a ReadableStream (serp path)", async () => {
  mockCreate.mockResolvedValueOnce(
    fakeStream(["HOMER SIMPSON BACKGROUND CHECK\n", "Springfield, AB\n", "Recommendation: Proceed"])
  );

  const stream = await generateReport(MINIMAL_INPUT);
  expect(stream).toBeInstanceOf(ReadableStream);
});

// ─── SSE chunk format (serp path) ────────────────────────────────────────────

test("generateReport emits SSE-formatted chunks with text key (serp path)", async () => {
  mockCreate.mockResolvedValueOnce(
    fakeStream(["Hello", " World"])
  );

  const stream = await generateReport(MINIMAL_INPUT);
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const collected: string[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    collected.push(decoder.decode(value));
  }

  const combined = collected.join("");
  expect(combined).toContain("data:");
  expect(combined).toContain('"text"');
  expect(combined).toContain("[DONE]");
});

// ─── Options (serp path) ──────────────────────────────────────────────────────

test("generateReport uses OPENAI_MODEL from config by default (serp path)", async () => {
  mockCreate.mockResolvedValueOnce(fakeStream(["Done"]));

  await generateReport(MINIMAL_INPUT);

  expect(mockCreate).toHaveBeenCalledWith(
    expect.objectContaining({ model: "gpt-4.1" })
  );
});

test("generateReport accepts custom model option (serp path)", async () => {
  mockCreate.mockResolvedValueOnce(fakeStream(["Done"]));

  await generateReport(MINIMAL_INPUT, { model: "gpt-4o-mini" });

  expect(mockCreate).toHaveBeenCalledWith(
    expect.objectContaining({ model: "gpt-4o-mini" })
  );
});

test("generateReport uses temperature 0.3 by default for gpt-4 models (serp path)", async () => {
  mockCreate.mockResolvedValueOnce(fakeStream(["Done"]));

  await generateReport(MINIMAL_INPUT);

  expect(mockCreate).toHaveBeenCalledWith(
    expect.objectContaining({ temperature: 0.3 })
  );
});

test("generateReport omits temperature for gpt-5 models (serp path)", async () => {
  mockedGetConfig.mockReturnValue({
    OPENAI_API_KEY: "sk-test-mock",
    SEARCH_API_KEY: "test-search-key",
    SEARCH_API_PROVIDER: "serp",
    OPENAI_MODEL: "gpt-5.4-pro",
    SEARCH_MODEL: "gpt-4.1",
    REPORT_MODEL: "gpt-5.4-pro",
    REPORT_TEMPERATURE: undefined,
  });

  mockCreate.mockResolvedValueOnce(fakeStream(["Done"]));

  await generateReport(MINIMAL_INPUT);

  const callArgs = mockCreate.mock.calls[0][0];
  expect(callArgs).not.toHaveProperty("temperature");
  expect(callArgs.model).toBe("gpt-5.4-pro");
});

test("generateReport uses streaming mode (serp path)", async () => {
  mockCreate.mockResolvedValueOnce(fakeStream(["Done"]));

  await generateReport(MINIMAL_INPUT);

  expect(mockCreate).toHaveBeenCalledWith(
    expect.objectContaining({ stream: true })
  );
});

// ─── Azure path: Two-stage pipeline ──────────────────────────────────────────

test("generateReport uses Responses API when provider is azure", async () => {
  mockedGetConfig.mockReturnValue({
    OPENAI_API_KEY: "sk-test-mock",
    SEARCH_API_PROVIDER: "azure",
    SEARCH_MODEL: "gpt-4.1",
    REPORT_MODEL: "gpt-5.4-pro",
    REPORT_TEMPERATURE: undefined,
  });

  // Stage 1: 5 parallel Responses API calls
  const stageOneResponse = fakeResponsesObject("Search results here");
  mockResponsesCreate.mockResolvedValue(stageOneResponse);

  // Stage 2: Chat Completions
  mockCreate.mockResolvedValueOnce(
    fakeStream(["HOMER SIMPSON BACKGROUND CHECK\n", "Recommendation: Proceed"])
  );

  const stream = await generateReport(MINIMAL_INPUT);
  expect(stream).toBeInstanceOf(ReadableStream);

  // Must have called responses.create for Stage 1 (5 parallel searches)
  expect(mockResponsesCreate).toHaveBeenCalledTimes(5);
  // Stage 2 consolidates via chat completions
  expect(mockCreate).toHaveBeenCalled();
});

test("generateReport Responses API call includes web_search tool (azure path)", async () => {
  mockedGetConfig.mockReturnValue({
    OPENAI_API_KEY: "sk-test-mock",
    SEARCH_API_PROVIDER: "azure",
    SEARCH_MODEL: "gpt-4.1",
    REPORT_MODEL: "gpt-5.4-pro",
    REPORT_TEMPERATURE: undefined,
  });

  mockResponsesCreate.mockResolvedValue(fakeResponsesObject("results"));
  mockCreate.mockResolvedValueOnce(fakeStream(["Done"]));

  await generateReport(MINIMAL_INPUT);

  expect(mockResponsesCreate).toHaveBeenCalledWith(
    expect.objectContaining({
      tools: expect.arrayContaining([
        expect.objectContaining({ type: "web_search" }),
      ]),
      stream: false,
    })
  );
});

test("generateReport azure path emits SSE chunks from Chat Completions stream", async () => {
  mockedGetConfig.mockReturnValue({
    OPENAI_API_KEY: "sk-test-mock",
    SEARCH_API_PROVIDER: "azure",
    SEARCH_MODEL: "gpt-4.1",
    REPORT_MODEL: "gpt-5.4-pro",
    REPORT_TEMPERATURE: undefined,
  });

  mockResponsesCreate.mockResolvedValue(fakeResponsesObject("Search data"));
  mockCreate.mockResolvedValueOnce(fakeStream(["Hello", " World"]));

  const stream = await generateReport(MINIMAL_INPUT);
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const collected: string[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    collected.push(decoder.decode(value));
  }

  const combined = collected.join("");
  expect(combined).toContain("data:");
  expect(combined).toContain('"text"');
  expect(combined).toContain("[DONE]");
});

test("generateReport azure path includes applicant name in search prompt", async () => {
  mockedGetConfig.mockReturnValue({
    OPENAI_API_KEY: "sk-test-mock",
    SEARCH_API_PROVIDER: "azure",
    SEARCH_MODEL: "gpt-4.1",
    REPORT_MODEL: "gpt-5.4-pro",
    REPORT_TEMPERATURE: undefined,
  });

  mockResponsesCreate.mockResolvedValue(fakeResponsesObject("results"));
  mockCreate.mockResolvedValueOnce(fakeStream(["Done"]));

  await generateReport(FULL_INPUT);

  // Check that at least one responses.create call includes the applicant name
  const callArgs = mockResponsesCreate.mock.calls[0][0];
  expect(callArgs.input).toContain("Homer Jay Simpson");
  expect(callArgs.input).toContain("Calgary, AB");
});

// ─── ApplicantInput types ─────────────────────────────────────────────────────

test("ApplicantInput accepts minimal required fields", () => {
  const input: ApplicantInput = {
    name: "Jane Doe",
    location: "Edmonton, AB",
    researchData: "No data found.",
  };
  expect(input.name).toBe("Jane Doe");
  expect(input.location).toBe("Edmonton, AB");
  expect(input.researchData).toBe("No data found.");
});

test("ApplicantInput accepts all optional fields", () => {
  const input: ApplicantInput = FULL_INPUT;
  expect(input.role).toBe("Board Member – Alberta Gaming Commission");
  expect(input.employers).toContain("Springfield Nuclear Power Plant");
  expect(input.businesses).toContain("H.J. Simpson Enterprises");
  expect(input.organizations).toContain("Stonecutters Lodge");
  expect(input.emails).toContain("homer@springfield.gov");
  expect(input.phones).toContain("403-555-0100");
  expect(input.addresses?.length).toBeGreaterThan(0);
});

// ─── Prompt includes all report sections (serp path) ─────────────────────────

test("generateReport prompt includes applicant name (serp path)", async () => {
  mockCreate.mockResolvedValueOnce(fakeStream(["Done"]));

  await generateReport(FULL_INPUT);

  const callArgs = mockCreate.mock.calls[mockCreate.mock.calls.length - 1][0];
  const userMessage = callArgs.messages.find((m: { role: string }) => m.role === "user");
  expect(userMessage.content).toContain("Homer Jay Simpson");
  expect(userMessage.content).toContain("Calgary, AB");
});

test("generateReport prompt includes SCHEDULES section (serp path)", async () => {
  mockCreate.mockResolvedValueOnce(fakeStream(["Done"]));

  await generateReport(MINIMAL_INPUT);

  const callArgs = mockCreate.mock.calls[mockCreate.mock.calls.length - 1][0];
  const userMessage = callArgs.messages.find((m: { role: string }) => m.role === "user");
  expect(userMessage.content).toContain("SCHEDULE A");
  expect(userMessage.content).toContain("SCHEDULE B");
  expect(userMessage.content).toContain("SCHEDULE C");
  expect(userMessage.content).toContain("SCHEDULE D");
  expect(userMessage.content).toContain("SCHEDULE E");
});

test("generateReport prompt includes SOURCES/CHECKLIST section (serp path)", async () => {
  mockCreate.mockResolvedValueOnce(fakeStream(["Done"]));

  await generateReport(MINIMAL_INPUT);

  const callArgs = mockCreate.mock.calls[mockCreate.mock.calls.length - 1][0];
  const userMessage = callArgs.messages.find((m: { role: string }) => m.role === "user");
  expect(userMessage.content).toContain("SOURCES/CHECKLIST");
  expect(userMessage.content).toContain("Elections AB");
  expect(userMessage.content).toContain("Elections Canada");
  expect(userMessage.content).toContain("CanLii");
});

test("generateReport prompt includes SEARCH TERMS with OR operators (serp path)", async () => {
  mockCreate.mockResolvedValueOnce(fakeStream(["Done"]));

  await generateReport(MINIMAL_INPUT);

  const callArgs = mockCreate.mock.calls[mockCreate.mock.calls.length - 1][0];
  const userMessage = callArgs.messages.find((m: { role: string }) => m.role === "user");
  expect(userMessage.content).toContain("SEARCH TERMS");
  expect(userMessage.content).toContain("OR");
});

test("generateReport prompt includes employer in search terms (serp path)", async () => {
  mockCreate.mockResolvedValueOnce(fakeStream(["Done"]));

  await generateReport(FULL_INPUT);

  const callArgs = mockCreate.mock.calls[mockCreate.mock.calls.length - 1][0];
  const userMessage = callArgs.messages.find((m: { role: string }) => m.role === "user");
  expect(userMessage.content).toContain("Springfield Nuclear Power Plant");
});

// ─── Issue #46: 5 parallel searches and 10-source sections ───────────────────

test("azure path makes exactly 5 Responses API calls (5 parallel searches)", async () => {
  mockedGetConfig.mockReturnValue({
    OPENAI_API_KEY: "sk-test-mock",
    SEARCH_API_PROVIDER: "azure",
    SEARCH_MODEL: "gpt-4.1",
    REPORT_MODEL: "gpt-5.4-pro",
    REPORT_TEMPERATURE: undefined,
  });

  mockResponsesCreate.mockResolvedValue(fakeResponsesObject("results"));
  mockCreate.mockResolvedValueOnce(fakeStream(["Done"]));

  await generateReport(MINIMAL_INPUT);

  expect(mockResponsesCreate).toHaveBeenCalledTimes(5);
});

test("azure path search prompts include retrieval-only instruction", async () => {
  mockedGetConfig.mockReturnValue({
    OPENAI_API_KEY: "sk-test-mock",
    SEARCH_API_PROVIDER: "azure",
    SEARCH_MODEL: "gpt-4.1",
    REPORT_MODEL: "gpt-5.4-pro",
    REPORT_TEMPERATURE: undefined,
  });

  mockResponsesCreate.mockResolvedValue(fakeResponsesObject("results"));
  mockCreate.mockResolvedValueOnce(fakeStream(["Done"]));

  await generateReport(MINIMAL_INPUT);

  // Every search prompt must include "Do not analyze or summarize"
  for (const call of mockResponsesCreate.mock.calls) {
    expect(call[0].input).toContain("Do not analyze or summarize");
  }
});

test("azure path search prompts cover all required sources", async () => {
  mockedGetConfig.mockReturnValue({
    OPENAI_API_KEY: "sk-test-mock",
    SEARCH_API_PROVIDER: "azure",
    SEARCH_MODEL: "gpt-4.1",
    REPORT_MODEL: "gpt-5.4-pro",
    REPORT_TEMPERATURE: undefined,
  });

  mockResponsesCreate.mockResolvedValue(fakeResponsesObject("results"));
  mockCreate.mockResolvedValueOnce(fakeStream(["Done"]));

  await generateReport(MINIMAL_INPUT);

  const allInputs = mockResponsesCreate.mock.calls.map((c) => c[0].input).join(" ");
  // Search 1: professional & legal
  expect(allInputs).toContain("lsa.ca");
  expect(allInputs).toContain("reca.ca");
  expect(allInputs).toContain("canlii.org");
  // Search 2: political donations
  expect(allInputs).toContain("efpublic.elections.ab.ca");
  expect(allInputs).toContain("elections.ca");
  // Search 3: general web
  expect(allInputs).toContain("news articles");
  // Search 4: LinkedIn
  expect(allInputs).toContain("LinkedIn");
  // Search 5: social media
  expect(allInputs).toContain("Twitter");
  expect(allInputs).toContain("Facebook");
  expect(allInputs).toContain("Instagram");
  expect(allInputs).toContain("YouTube");
});

test("azure path consolidation prompt requires all 10 source sections", async () => {
  mockedGetConfig.mockReturnValue({
    OPENAI_API_KEY: "sk-test-mock",
    SEARCH_API_PROVIDER: "azure",
    SEARCH_MODEL: "gpt-4.1",
    REPORT_MODEL: "gpt-5.4-pro",
    REPORT_TEMPERATURE: undefined,
  });

  mockResponsesCreate.mockResolvedValue(fakeResponsesObject("results"));
  mockCreate.mockResolvedValueOnce(fakeStream(["Done"]));

  await generateReport(MINIMAL_INPUT);

  const callArgs = mockCreate.mock.calls[0][0];
  const userMsg = callArgs.messages.find((m: { role: string }) => m.role === "user").content;

  // All 10 mandatory sections must be in the consolidation prompt
  expect(userMsg).toContain("## 1. PROFESSIONAL DISCIPLINE");
  expect(userMsg).toContain("## 2. ELECTIONS ALBERTA");
  expect(userMsg).toContain("## 3. ELECTIONS CANADA");
  expect(userMsg).toContain("## 4. GOOGLE SEARCH RESULTS");
  expect(userMsg).toContain("## 5. LINKEDIN");
  expect(userMsg).toContain("## 6. TWITTER/X");
  expect(userMsg).toContain("## 7. FACEBOOK");
  expect(userMsg).toContain("## 8. INSTAGRAM");
  expect(userMsg).toContain("## 9. YOUTUBE");
  expect(userMsg).toContain("## 10. CANLII");
});

test("ApplicantInput accepts optional usernames field", () => {
  const input: ApplicantInput = {
    name: "Jane Doe",
    location: "Edmonton, AB",
    researchData: "",
    usernames: ["janedoe99", "jdoe_ab"],
  };
  expect(input.usernames).toContain("janedoe99");
  expect(input.usernames).toContain("jdoe_ab");
});

test("azure path includes known usernames in applicant context when provided", async () => {
  mockedGetConfig.mockReturnValue({
    OPENAI_API_KEY: "sk-test-mock",
    SEARCH_API_PROVIDER: "azure",
    SEARCH_MODEL: "gpt-4.1",
    REPORT_MODEL: "gpt-5.4-pro",
    REPORT_TEMPERATURE: undefined,
  });

  mockResponsesCreate.mockResolvedValue(fakeResponsesObject("results"));
  mockCreate.mockResolvedValueOnce(fakeStream(["Done"]));

  const inputWithUsernames: ApplicantInput = {
    ...MINIMAL_INPUT,
    usernames: ["homer_d", "donut_king"],
  };

  await generateReport(inputWithUsernames);

  const allInputs = mockResponsesCreate.mock.calls.map((c) => c[0].input).join(" ");
  expect(allInputs).toContain("homer_d");
  expect(allInputs).toContain("donut_king");
});
