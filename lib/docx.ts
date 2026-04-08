/**
 * lib/docx.ts
 * Converts a markdown background-check report to a .docx Blob using the `docx` package.
 *
 * refs #11
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
} from 'docx'

// ─── Types ────────────────────────────────────────────────────────────────────

type DocxChild = Paragraph

// ─── Inline markdown → TextRun[] ─────────────────────────────────────────────

/**
 * Parse a single line of inline markdown into an array of TextRun objects.
 * Handles **bold**, *italic*, `code`, and plain text.
 */
function parseInline(text: string): TextRun[] {
  const runs: TextRun[] = []

  // Combined regex for **bold**, *italic*, `code`
  const pattern = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`)/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) !== null) {
    // Text before the match
    if (match.index > lastIndex) {
      runs.push(new TextRun({ text: text.slice(lastIndex, match.index) }))
    }

    if (match[2] !== undefined) {
      // **bold**
      runs.push(new TextRun({ text: match[2], bold: true }))
    } else if (match[3] !== undefined) {
      // *italic*
      runs.push(new TextRun({ text: match[3], italics: true }))
    } else if (match[4] !== undefined) {
      // `code`
      runs.push(new TextRun({ text: match[4], font: 'Courier New', size: 20 }))
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

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]

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
