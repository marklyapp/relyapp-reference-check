/**
 * lib/docx.ts
 * Converts a markdown background-check report to a .docx Blob using the `docx` package.
 *
 * refs #11, #44
 */

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  LevelFormat,
  convertInchesToTwip,
  INumberingOptions,
  ExternalHyperlink,
} from 'docx'

// ─── Types ────────────────────────────────────────────────────────────────────

type DocxChild = Paragraph

// ─── Inline markdown → TextRun[] / hyperlinks ────────────────────────────────

/**
 * Parse a single line of inline markdown into an array of TextRun / ExternalHyperlink objects.
 * Handles **bold**, *italic*, `code`, [text](url), bare https:// URLs, and plain text.
 */
function parseInline(text: string): (TextRun | ExternalHyperlink)[] {
  const runs: (TextRun | ExternalHyperlink)[] = []

  // Combined regex:
  // 1. [text](url)  — markdown link
  // 2. bare https?://... URL
  // 3. **bold**
  // 4. *italic*
  // 5. `code`
  const pattern =
    /(\[([^\]]+)\]\((https?:\/\/[^\)]+)\))|(https?:\/\/[^\s\)\],>]+)|(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`)/g

  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) !== null) {
    // Text before the match
    if (match.index > lastIndex) {
      runs.push(new TextRun({ text: text.slice(lastIndex, match.index) }))
    }

    if (match[1]) {
      // [text](url) — markdown link
      const linkText = match[2]
      const linkUrl = match[3]
      runs.push(
        new ExternalHyperlink({
          link: linkUrl,
          children: [
            new TextRun({
              text: linkText,
              style: 'Hyperlink',
            }),
          ],
        })
      )
    } else if (match[4]) {
      // bare URL
      const url = match[4]
      runs.push(
        new ExternalHyperlink({
          link: url,
          children: [
            new TextRun({
              text: url,
              style: 'Hyperlink',
            }),
          ],
        })
      )
    } else if (match[6] !== undefined) {
      // **bold**
      runs.push(new TextRun({ text: match[6], bold: true }))
    } else if (match[7] !== undefined) {
      // *italic*
      runs.push(new TextRun({ text: match[7], italics: true }))
    } else if (match[8] !== undefined) {
      // `code`
      runs.push(new TextRun({ text: match[8], font: 'Courier New', size: 20 }))
    }

    lastIndex = pattern.lastIndex
  }

  // Remaining text
  if (lastIndex < text.length) {
    runs.push(new TextRun({ text: text.slice(lastIndex) }))
  }

  if (runs.length === 0) {
    runs.push(new TextRun({ text }))
  }

  return runs
}

// ─── Markdown → Paragraph[] ──────────────────────────────────────────────────

const BULLET_REF = 'bullet-list'

/**
 * Tokenise a markdown string into Paragraph / heading / list-item nodes.
 */
function markdownToParagraphs(markdown: string): DocxChild[] {
  const lines = markdown.split('\n')
  const paragraphs: DocxChild[] = []

  // Simple table detection state
  let inTable = false
  let tableLines: string[] = []

  function flushTable() {
    if (tableLines.length === 0) return
    // Render table rows as plain paragraphs (one per row, cells tab-separated)
    for (const row of tableLines) {
      const cells = row
        .split('|')
        .map((c) => c.trim())
        .filter(Boolean)
      if (cells.length === 0) continue
      // Skip separator rows like |---|---|
      if (cells.every((c) => /^[-:]+$/.test(c))) continue
      paragraphs.push(
        new Paragraph({
          children: cells.flatMap((cell, i) => {
            const runs: (TextRun | ExternalHyperlink)[] = parseInline(cell)
            if (i < cells.length - 1) {
              runs.push(new TextRun({ text: '\t' }))
            }
            return runs
          }),
        })
      )
    }
    tableLines = []
    inTable = false
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]

    // Table row detection
    if (/^\s*\|/.test(raw)) {
      inTable = true
      tableLines.push(raw)
      continue
    } else if (inTable) {
      flushTable()
    }

    // ATX headings: # ## ###
    const headingMatch = raw.match(/^(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      const level = headingMatch[1].length
      const headingMap: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
        1: HeadingLevel.HEADING_1,
        2: HeadingLevel.HEADING_2,
        3: HeadingLevel.HEADING_3,
        4: HeadingLevel.HEADING_4,
        5: HeadingLevel.HEADING_5,
        6: HeadingLevel.HEADING_6,
      }
      paragraphs.push(
        new Paragraph({
          text: headingMatch[2],
          heading: headingMap[level] ?? HeadingLevel.HEADING_1,
        })
      )
      continue
    }

    // SETEXT-style ALL-CAPS headings (e.g. "NOTABLE ITEMS") — treat as Heading 2
    if (/^[A-Z][A-Z\s\/\-–—]+$/.test(raw.trim()) && raw.trim().length > 2) {
      paragraphs.push(
        new Paragraph({
          text: raw.trim(),
          heading: HeadingLevel.HEADING_2,
        })
      )
      continue
    }

    // Horizontal rule --- / ***
    if (/^(\*{3,}|-{3,}|_{3,})$/.test(raw.trim())) {
      paragraphs.push(new Paragraph({ text: '' }))
      continue
    }

    // Unordered list item: - or * or •
    const bulletMatch = raw.match(/^(\s*)([-*•✓])\s+(.+)$/)
    if (bulletMatch) {
      paragraphs.push(
        new Paragraph({
          numbering: { reference: BULLET_REF, level: 0 },
          children: parseInline(bulletMatch[3]),
        })
      )
      continue
    }

    // Empty line → blank paragraph (spacing)
    if (raw.trim() === '') {
      paragraphs.push(new Paragraph({ text: '' }))
      continue
    }

    // Regular paragraph with inline formatting
    paragraphs.push(
      new Paragraph({
        children: parseInline(raw),
      })
    )
  }

  // Flush any trailing table
  if (inTable) flushTable()

  return paragraphs
}

// ─── Numbering config ─────────────────────────────────────────────────────────

function buildNumbering(): INumberingOptions {
  return {
    config: [
      {
        reference: BULLET_REF,
        levels: [
          {
            level: 0,
            format: LevelFormat.BULLET,
            text: '•',
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: {
                indent: {
                  left: convertInchesToTwip(0.5),
                  hanging: convertInchesToTwip(0.25),
                },
              },
            },
          },
        ],
      },
    ],
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Convert a markdown report string to a .docx Blob.
 *
 * @param markdown   - The full markdown text of the reference-check report
 * @param personName - The subject's name (used for document metadata)
 * @returns A Blob containing the .docx file binary
 *
 * @example
 * const blob = await markdownToDocx(reportMarkdown, 'Jane Smith')
 * const url = URL.createObjectURL(blob)
 */
export async function markdownToDocx(markdown: string, personName: string): Promise<Blob> {
  const children = markdownToParagraphs(markdown)

  const doc = new Document({
    numbering: buildNumbering(),
    creator: 'RelyApp Reference Check',
    title: `Reference Check — ${personName}`,
    description: `Background check report for ${personName}`,
    sections: [
      {
        children,
      },
    ],
  })

  const buffer = await Packer.toBlob(doc)
  return buffer
}
