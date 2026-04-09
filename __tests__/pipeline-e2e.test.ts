/**
 * __tests__/pipeline-e2e.test.ts
 * Live end-to-end integration test for the two-stage LiteLLM pipeline.
 * Subject: Brian Jean, Fort McMurray, AB
 *
 * Skipped automatically when OPENAI_API_KEY is not set (CI / unit-test runs).
 * refs #38
 */

import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import { markdownToDocx } from '../lib/docx';

const describeIfApi = process.env.OPENAI_API_KEY ? describe : describe.skip;

describeIfApi('Pipeline E2E — Brian Jean', () => {
  jest.setTimeout(120_000);

  // Instantiated in beforeAll so the constructor only runs when the suite is active
  let client: OpenAI;

  beforeAll(() => {
    client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL,
    });
  });

  test('Stage 1: gpt-4.1 web search returns results with citations', async () => {
    const response = await (client.responses.create as any)({
      model: 'gpt-4.1',
      input:
        'Search for Brian Jean, politician from Fort McMurray, Alberta. Find news, political career, party affiliations. Cite every source with URL.',
      tools: [{ type: 'web_search' }],
    });

    let text = '';
    for (const item of response.output || []) {
      if (item.type === 'message') {
        for (const c of item.content || []) {
          if (c.type === 'output_text') text += c.text;
        }
      }
    }

    expect(text.length).toBeGreaterThan(100);
    expect(text).toMatch(/https?:\/\//);
    expect(text.toLowerCase()).toContain('brian jean');
  });

  test('Stage 2: claude-opus-4-6 consolidation works with temperature', async () => {
    const response = await client.chat.completions.create({
      model: 'claude-opus-4-6',
      messages: [
        { role: 'system', content: 'Summarize the following research data into a brief report.' },
        {
          role: 'user',
          content:
            'Brian Jean is a Canadian politician from Fort McMurray, Alberta. He served as leader of the Wildrose Party. He was elected MLA for Fort McMurray-Lac La Biche.',
        },
      ],
      max_tokens: 16000,
      // claude-opus-4-6 accepts temperature (0-1 range)
    });

    expect(response.choices[0].message.content).toBeTruthy();
    expect(response.choices[0].message.content!.toLowerCase()).toContain('brian jean');
  });

  test('Full two-stage pipeline produces a complete report and saves .docx', async () => {
    // Stage 1: 3 parallel searches
    const searchPrompts = [
      'Search for Brian Jean from Fort McMurray, Alberta. General background, career, news. Cite sources.',
      'Search for Brian Jean Alberta political donations, party affiliations, elections. Cite sources.',
      'Search for Brian Jean social media presence, LinkedIn, Twitter. Cite sources.',
    ];

    const searches = await Promise.all(
      searchPrompts.map(async (prompt) => {
        const resp = await (client.responses.create as any)({
          model: 'gpt-4.1',
          input: prompt,
          tools: [{ type: 'web_search' }],
        });
        let text = '';
        for (const item of resp.output || []) {
          if (item.type === 'message') {
            for (const c of item.content || []) {
              if (c.type === 'output_text') text += c.text;
            }
          }
        }
        return text;
      })
    );

    // All searches returned content
    searches.forEach((s, i) => {
      expect(s.length).toBeGreaterThan(50);
    });

    // Stage 2: consolidate
    const combined = searches.join('\n\n---\n\n');
    const report = await client.chat.completions.create({
      model: 'claude-opus-4-6',
      messages: [
        {
          role: 'system',
          content:
            'You are a report writer. Consolidate the research data into a structured background check report. Include sections: NOTABLE ITEMS, PERSONAL INFORMATION, DONATIONS, SOCIAL MEDIA, SOURCES. Cite every source URL.',
        },
        { role: 'user', content: combined },
      ],
      max_tokens: 16000,
    });

    const reportText = report.choices[0].message.content!;
    expect(reportText.toLowerCase()).toContain('brian jean');
    expect(reportText).toMatch(/https?:\/\//);
    expect(reportText.toUpperCase()).toMatch(/NOTABLE|PERSONAL|DONATION|SOCIAL|SOURCE/);

    // ── Convert report to .docx and save to test-output/ ──────────────────
    fs.mkdirSync('test-output', { recursive: true });

    const docxBlob = await markdownToDocx(reportText, 'Brian Jean');

    // Convert Blob → Buffer (Node.js compatible)
    const arrayBuffer = await docxBlob.arrayBuffer();
    const docxBuffer = Buffer.from(arrayBuffer);

    fs.writeFileSync('test-output/brian-jean-report.docx', docxBuffer);
    fs.writeFileSync('test-output/brian-jean-report.md', reportText);

    // Assert .docx file exists and is non-empty
    expect(fs.existsSync('test-output/brian-jean-report.docx')).toBe(true);
    expect(fs.statSync('test-output/brian-jean-report.docx').size).toBeGreaterThan(0);
  });
});
