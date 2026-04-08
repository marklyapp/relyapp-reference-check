/**
 * lib/docx.test.ts
 * Unit tests for markdownToDocx().
 *
 * refs #11
 */

import { markdownToDocx } from './docx'

// The docx package uses JSZip (browser-friendly), but in the Jest/Node environment
// it needs a Blob polyfill. Node 18+ has Blob globally; older versions need it mocked.
// We check and add a minimal polyfill if necessary.
if (typeof Blob === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Blob: NodeBlob } = require('buffer')
  ;(global as Record<string, unknown>).Blob = NodeBlob
}

// ─── Basic sanity tests ───────────────────────────────────────────────────────

test('markdownToDocx returns a Blob', async () => {
  const blob = await markdownToDocx('# Hello\n\nThis is a test.', 'Jane Smith')
  expect(blob).toBeInstanceOf(Blob)
})

test('returned Blob has non-zero size', async () => {
  const blob = await markdownToDocx('Hello world', 'Jane Smith')
  expect(blob.size).toBeGreaterThan(0)
})

test('returned Blob has correct MIME type', async () => {
  const blob = await markdownToDocx('Hello world', 'Jane Smith')
  expect(blob.type).toBe(
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )
})

// ─── Content structure tests ─────────────────────────────────────────────────

test('handles empty string without throwing', async () => {
  await expect(markdownToDocx('', 'Test Person')).resolves.toBeInstanceOf(Blob)
})

test('handles headings', async () => {
  const md = '# Section One\n## Sub-section\n### Detail'
  const blob = await markdownToDocx(md, 'Test Person')
  expect(blob.size).toBeGreaterThan(0)
})

test('handles bold, italic, and code inline', async () => {
  const md = 'This is **bold**, *italic*, and `code`.'
  const blob = await markdownToDocx(md, 'Test Person')
  expect(blob.size).toBeGreaterThan(0)
})

test('handles unordered list items', async () => {
  const md = '- Item one\n- Item two\n- Item three'
  const blob = await markdownToDocx(md, 'Test Person')
  expect(blob.size).toBeGreaterThan(0)
})

test('handles ALL CAPS section headings', async () => {
  const md = 'NOTABLE ITEMS\n\nSOME CONTENT\n\nSOURCES/CHECKLIST'
  const blob = await markdownToDocx(md, 'Test Person')
  expect(blob.size).toBeGreaterThan(0)
})

test('handles checkmark bullets (✓)', async () => {
  const md = '✓ Elections AB\n✓ Elections Canada\n✓ Google'
  const blob = await markdownToDocx(md, 'Test Person')
  expect(blob.size).toBeGreaterThan(0)
})

// ─── Full-report smoke test ───────────────────────────────────────────────────

test('handles a full report-style markdown document', async () => {
  const md = `JOHN DOE BACKGROUND CHECK
Edmonton, AB
Recommendation: Proceed

NOTABLE ITEMS
- No criminal history found
- No notable social media activity

PERSONAL INFORMATION
John Doe is a software engineer based in Edmonton.

DONATIONS
Elections AB: None found
Elections Canada: None found

SOCIAL MEDIA/ONLINE PRESENCE

Facebook:
Account: None
Summary: No activity found

SOURCES/CHECKLIST
✓ Elections AB contributor search
✓ Elections Canada donation database
✓ Google
✓ LinkedIn`

  const blob = await markdownToDocx(md, 'John Doe')
  expect(blob).toBeInstanceOf(Blob)
  expect(blob.size).toBeGreaterThan(500)
})
