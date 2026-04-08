/**
 * lib/report.test.ts
 * Unit tests for generateReport() and ApplicantInput types.
 *
 * refs #6
 */

// ─── Mock OpenAI before imports ───────────────────────────────────────────────

const mockCreate = jest.fn();

jest.mock("openai", () => {
  return jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: mockCreate,
      },
    },
  }));
});

import { generateReport, ApplicantInput } from "./report";

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

/** Creates an async generator mimicking an OpenAI stream */
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

// ─── Test isolation guards ────────────────────────────────────────────────────

beforeEach(() => {
  mockCreate.mockClear();
  process.env.OPENAI_API_KEY = "sk-test-mock";
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

// ─── Return type ──────────────────────────────────────────────────────────────

test("generateReport returns a ReadableStream", async () => {
  mockCreate.mockResolvedValueOnce(
    fakeStream(["HOMER SIMPSON BACKGROUND CHECK\n", "Springfield, AB\n", "Recommendation: Proceed"])
  );

  const stream = await generateReport(MINIMAL_INPUT);
  expect(stream).toBeInstanceOf(ReadableStream);
});

// ─── SSE chunk format ─────────────────────────────────────────────────────────

test("generateReport emits SSE-formatted chunks with text key", async () => {
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
  // Should contain SSE data: prefix
  expect(combined).toContain("data:");
  // Should contain the text in JSON
  expect(combined).toContain('"text"');
  // Should end with [DONE]
  expect(combined).toContain("[DONE]");
});

// ─── Options ──────────────────────────────────────────────────────────────────

test("generateReport uses gpt-4o by default", async () => {
  mockCreate.mockResolvedValueOnce(fakeStream(["Done"]));

  await generateReport(MINIMAL_INPUT);

  expect(mockCreate).toHaveBeenCalledWith(
    expect.objectContaining({ model: "gpt-4o" })
  );
});

test("generateReport accepts custom model option", async () => {
  mockCreate.mockResolvedValueOnce(fakeStream(["Done"]));

  await generateReport(MINIMAL_INPUT, { model: "gpt-4o-mini" });

  expect(mockCreate).toHaveBeenCalledWith(
    expect.objectContaining({ model: "gpt-4o-mini" })
  );
});

test("generateReport uses temperature 0.3 by default", async () => {
  mockCreate.mockResolvedValueOnce(fakeStream(["Done"]));

  await generateReport(MINIMAL_INPUT);

  expect(mockCreate).toHaveBeenCalledWith(
    expect.objectContaining({ temperature: 0.3 })
  );
});

test("generateReport uses streaming mode", async () => {
  mockCreate.mockResolvedValueOnce(fakeStream(["Done"]));

  await generateReport(MINIMAL_INPUT);

  expect(mockCreate).toHaveBeenCalledWith(
    expect.objectContaining({ stream: true })
  );
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

// ─── Prompt includes all report sections ─────────────────────────────────────

test("generateReport prompt includes applicant name", async () => {
  mockCreate.mockResolvedValueOnce(fakeStream(["Done"]));

  await generateReport(FULL_INPUT);

  const callArgs = mockCreate.mock.calls[mockCreate.mock.calls.length - 1][0];
  const userMessage = callArgs.messages.find((m: { role: string }) => m.role === "user");
  expect(userMessage.content).toContain("Homer Jay Simpson");
  expect(userMessage.content).toContain("Calgary, AB");
});

test("generateReport prompt includes SCHEDULES section", async () => {
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

test("generateReport prompt includes SOURCES/CHECKLIST section", async () => {
  mockCreate.mockResolvedValueOnce(fakeStream(["Done"]));

  await generateReport(MINIMAL_INPUT);

  const callArgs = mockCreate.mock.calls[mockCreate.mock.calls.length - 1][0];
  const userMessage = callArgs.messages.find((m: { role: string }) => m.role === "user");
  expect(userMessage.content).toContain("SOURCES/CHECKLIST");
  expect(userMessage.content).toContain("Elections AB");
  expect(userMessage.content).toContain("Elections Canada");
  expect(userMessage.content).toContain("CanLii");
});

test("generateReport prompt includes SEARCH TERMS with OR operators", async () => {
  mockCreate.mockResolvedValueOnce(fakeStream(["Done"]));

  await generateReport(MINIMAL_INPUT);

  const callArgs = mockCreate.mock.calls[mockCreate.mock.calls.length - 1][0];
  const userMessage = callArgs.messages.find((m: { role: string }) => m.role === "user");
  expect(userMessage.content).toContain("SEARCH TERMS");
  expect(userMessage.content).toContain("OR");
});

test("generateReport prompt includes employer in search terms", async () => {
  mockCreate.mockResolvedValueOnce(fakeStream(["Done"]));

  await generateReport(FULL_INPUT);

  const callArgs = mockCreate.mock.calls[mockCreate.mock.calls.length - 1][0];
  const userMessage = callArgs.messages.find((m: { role: string }) => m.role === "user");
  expect(userMessage.content).toContain("Springfield Nuclear Power Plant");
});
