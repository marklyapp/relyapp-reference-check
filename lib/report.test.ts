/**
 * lib/report.test.ts
 * Unit tests for generateReport() and ApplicantInput types.
 *
 * refs #6, #30
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

/** Creates an async generator mimicking an OpenAI Responses API stream */
async function* fakeResponsesStream(chunks: string[]) {
  for (let i = 0; i < chunks.length; i++) {
    yield {
      type: "response.output_text.delta",
      delta: chunks[i],
    };
  }
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

test("generateReport uses gpt-4o by default (serp path)", async () => {
  mockCreate.mockResolvedValueOnce(fakeStream(["Done"]));

  await generateReport(MINIMAL_INPUT);

  expect(mockCreate).toHaveBeenCalledWith(
    expect.objectContaining({ model: "gpt-4o" })
  );
});

test("generateReport accepts custom model option (serp path)", async () => {
  mockCreate.mockResolvedValueOnce(fakeStream(["Done"]));

  await generateReport(MINIMAL_INPUT, { model: "gpt-4o-mini" });

  expect(mockCreate).toHaveBeenCalledWith(
    expect.objectContaining({ model: "gpt-4o-mini" })
  );
});

test("generateReport uses temperature 0.3 by default (serp path)", async () => {
  mockCreate.mockResolvedValueOnce(fakeStream(["Done"]));

  await generateReport(MINIMAL_INPUT);

  expect(mockCreate).toHaveBeenCalledWith(
    expect.objectContaining({ temperature: 0.3 })
  );
});

test("generateReport uses streaming mode (serp path)", async () => {
  mockCreate.mockResolvedValueOnce(fakeStream(["Done"]));

  await generateReport(MINIMAL_INPUT);

  expect(mockCreate).toHaveBeenCalledWith(
    expect.objectContaining({ stream: true })
  );
});

// ─── Azure path: Responses API ────────────────────────────────────────────────

test("generateReport uses Responses API when provider is azure", async () => {
  mockedGetConfig.mockReturnValue({
    OPENAI_API_KEY: "sk-test-mock",
    SEARCH_API_PROVIDER: "azure",
  });

  mockResponsesCreate.mockResolvedValueOnce(
    fakeResponsesStream(["HOMER SIMPSON BACKGROUND CHECK\n", "Recommendation: Proceed"])
  );

  const stream = await generateReport(MINIMAL_INPUT);
  expect(stream).toBeInstanceOf(ReadableStream);

  // Should NOT have called chat completions
  expect(mockCreate).not.toHaveBeenCalled();
  // Should have called responses.create
  expect(mockResponsesCreate).toHaveBeenCalled();
});

test("generateReport Responses API call includes web_search tool", async () => {
  mockedGetConfig.mockReturnValue({
    OPENAI_API_KEY: "sk-test-mock",
    SEARCH_API_PROVIDER: "azure",
  });

  mockResponsesCreate.mockResolvedValueOnce(fakeResponsesStream(["Done"]));

  await generateReport(MINIMAL_INPUT);

  expect(mockResponsesCreate).toHaveBeenCalledWith(
    expect.objectContaining({
      tools: expect.arrayContaining([
        expect.objectContaining({ type: "web_search" }),
      ]),
      stream: true,
    })
  );
});

test("generateReport azure path emits SSE chunks from Responses API stream", async () => {
  mockedGetConfig.mockReturnValue({
    OPENAI_API_KEY: "sk-test-mock",
    SEARCH_API_PROVIDER: "azure",
  });

  mockResponsesCreate.mockResolvedValueOnce(
    fakeResponsesStream(["Hello", " World"])
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

test("generateReport azure path includes applicant name in prompt", async () => {
  mockedGetConfig.mockReturnValue({
    OPENAI_API_KEY: "sk-test-mock",
    SEARCH_API_PROVIDER: "azure",
  });

  mockResponsesCreate.mockResolvedValueOnce(fakeResponsesStream(["Done"]));

  await generateReport(FULL_INPUT);

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
