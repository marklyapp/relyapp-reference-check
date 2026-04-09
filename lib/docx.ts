/**
 * lib/docx.ts
 * Converts a markdown background-check report to a professional .docx Blob.
 * Produces government-grade, print-ready document with cover page,
 * headers/footers, summary table, flag boxes, hyperlinked sources, and
 * professional typography.
 *
 * refs #11, #44, #49
 */

import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HeadingLevel,
  LevelFormat,
  PageNumber,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  convertInchesToTwip,
  type INumberingOptions,
} from 'docx'

// ─── Constants ────────────────────────────────────────────────────────────────

const DARK_BLUE = '1B3A5C'
const DARK_GRAY = '4A4A4A'
const WHITE = 'FFFFFF'
const RED_FLAG = 'CC0000'
const AMBER_FLAG = 'FF8C00'
const LIGHT_RED_BG = 'FFF0F0'
const LIGHT_AMBER_BG = 'FFF8F0'
const HYPERLINK_BLUE = '0563C1'

const BULLET_REF = 'bullet-list'
const BODY_FONT = 'Cambria'
const HEADING_FONT = 'Calibri'
const BODY_SIZE = 22  // half-points (11pt)
const H1_SIZE = 36    // 18pt
const H2_SIZE = 28    // 14pt
const H3_SIZE = 24    // 12pt

// ─── Types ────────────────────────────────────────────────────────────────────

type DocChild = Paragraph | Table

interface ParsedSection {
  num: number
  name: string
  hasFindings: boolean
  summary: string
}

interface FlagBox {
  category: string
  finding: string
  url: string
  severity: 'high' | 'medium'
}

// ─── Inline markdown → TextRun[] / hyperlinks ────────────────────────────────

function parseInline(
  text: string,
  opts?: { font?: string; size?: number; color?: string; bold?: boolean }
): (TextRun | ExternalHyperlink)[] {
  const runs: (TextRun | ExternalHyperlink)[] = []
  const font = opts?.font ?? BODY_FONT
  const size = opts?.size ?? BODY_SIZE
  const color = opts?.color
  const baseBold = opts?.bold ?? false

  const pattern =
    /(\[([^\]]+)\]\((https?:\/\/[^)]+)\))|(https?:\/\/[^\s),>\]]+)|(\*\*(.+?)\*\*)|(\*(.+?)\*)|(`(.+?)`)/g

  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      runs.push(new TextRun({ text: text.slice(lastIndex, match.index), font, size, color, bold: baseBold }))
    }

    if (match[1]) {
      // [text](url)
      runs.push(
        new ExternalHyperlink({
          link: match[3],
          children: [new TextRun({ text: match[2], font, size, color: HYPERLINK_BLUE, underline: { type: 'single' } })],
        })
      )
    } else if (match[4]) {
      // bare URL
      runs.push(
        new ExternalHyperlink({
          link: match[4],
          children: [new TextRun({ text: match[4], font, size, color: HYPERLINK_BLUE, underline: { type: 'single' } })],
        })
      )
    } else if (match[5]) {
      // **bold**
      runs.push(new TextRun({ text: match[6], font, size, color, bold: true }))
    } else if (match[7]) {
      // *italic*
      runs.push(new TextRun({ text: match[8], font, size, color, italics: true, bold: baseBold }))
    } else if (match[9]) {
      // `code`
      runs.push(new TextRun({ text: match[10], font: 'Courier New', size: 20, color }))
    }

    lastIndex = pattern.lastIndex
  }

  if (lastIndex < text.length) {
    runs.push(new TextRun({ text: text.slice(lastIndex), font, size, color, bold: baseBold }))
  }

  if (runs.length === 0) {
    runs.push(new TextRun({ text, font, size, color, bold: baseBold }))
  }

  return runs
}

// ─── Markdown parsing utilities ───────────────────────────────────────────────

function extractH1(markdown: string): string {
  const m = markdown.match(/^#\s+(.+)$/m)
  return m ? m[1].trim() : ''
}

function extractRecommendation(markdown: string): string {
  const m = markdown.match(/recommendation[:\s]+([^\n]+)/i)
  return m ? m[1].trim() : ''
}

function parseSections(markdown: string): ParsedSection[] {
  const lines = markdown.split('\n')
  const sectionStarts: Array<{ num: number; name: string; lineIndex: number }> = []

  lines.forEach((line, idx) => {
    const m = line.match(/^##\s+(\d+)\.\s+(.+)$/)
    if (m) {
      sectionStarts.push({ num: parseInt(m[1], 10), name: m[2].trim(), lineIndex: idx })
    }
  })

  const sections: ParsedSection[] = []

  for (let i = 0; i < sectionStarts.length; i++) {
    const { num, name, lineIndex } = sectionStarts[i]
    const endLine = i + 1 < sectionStarts.length ? sectionStarts[i + 1].lineIndex : lines.length
    const content = lines.slice(lineIndex + 1, endLine).join('\n').trim()

    const hasFindings =
      /found|yes|noted|identified|located|present/i.test(content) &&
      !/none found|not found|no record|no result|nothing found/i.test(content)

    const summaryLine = content
      .split('\n')
      .map((l) => l.replace(/^[-*#]+\s*/, '').trim())
      .find((l) => l.length > 5 && !/^#{1,6}/.test(l))

    sections.push({
      num,
      name,
      hasFindings,
      summary: summaryLine ? (summaryLine.length > 80 ? summaryLine.slice(0, 80) + '…' : summaryLine) : '—',
    })
  }

  return sections
}

function parseFlagBoxes(markdown: string): FlagBox[] {
  const flags: FlagBox[] = []
  const flagSectionMatch = markdown.match(
    /##\s+(?:SENSITIVE TOPICS? FLAGGED?|FLAGS?|FLAGGED? TOPICS?|ALERTS?)[\s\S]*?(?=\n##|$)/i
  )
  if (!flagSectionMatch) return flags

  const lines = flagSectionMatch[0].split('\n')
  let currentCategory = ''
  let currentFinding = ''
  let currentUrl = ''

  const flush = () => {
    if (currentCategory && currentFinding) {
      flags.push({
        category: currentCategory,
        finding: currentFinding.trim(),
        url: currentUrl,
        severity: /high|criminal|fraud|assault|conviction/i.test(currentCategory + currentFinding)
          ? 'high'
          : 'medium',
      })
    }
  }

  for (const line of lines) {
    const l = line.trim()
    if (!l || l.startsWith('##')) continue

    const categoryMatch = l.match(/^\*?\*?([A-Z][A-Z\s/]+)\*?\*?:\s*(.*)$/)
    if (categoryMatch && /^[A-Z\s/]+$/.test(categoryMatch[1]) && categoryMatch[1].length > 3) {
      flush()
      currentCategory = categoryMatch[1].trim()
      currentFinding = categoryMatch[2].trim()
      currentUrl = ''
    } else if (/^https?:\/\//.test(l)) {
      currentUrl = l
    } else if (l.startsWith('-') || l.startsWith('•')) {
      currentFinding += ' ' + l.replace(/^[-•]\s*/, '')
    } else {
      currentFinding += ' ' + l
    }
  }
  flush()

  return flags
}

// ─── Table builders ───────────────────────────────────────────────────────────

function buildSummaryTable(sections: ParsedSection[]): Table {
  const hdrShading = { type: ShadingType.SOLID, color: DARK_BLUE, fill: DARK_BLUE }
  const hdrMargins = { top: 80, bottom: 80, left: 100, right: 100 }

  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      new TableCell({
        shading: hdrShading,
        margins: hdrMargins,
        width: { size: 8, type: WidthType.PERCENTAGE },
        children: [new Paragraph({ children: [new TextRun({ text: '#', font: HEADING_FONT, size: 18, color: WHITE, bold: true })] })],
      }),
      new TableCell({
        shading: hdrShading,
        margins: hdrMargins,
        width: { size: 28, type: WidthType.PERCENTAGE },
        children: [new Paragraph({ children: [new TextRun({ text: 'Source', font: HEADING_FONT, size: 18, color: WHITE, bold: true })] })],
      }),
      new TableCell({
        shading: hdrShading,
        margins: hdrMargins,
        width: { size: 16, type: WidthType.PERCENTAGE },
        children: [new Paragraph({ children: [new TextRun({ text: 'Status', font: HEADING_FONT, size: 18, color: WHITE, bold: true })] })],
      }),
      new TableCell({
        shading: hdrShading,
        margins: hdrMargins,
        width: { size: 48, type: WidthType.PERCENTAGE },
        children: [new Paragraph({ children: [new TextRun({ text: 'Key Findings', font: HEADING_FONT, size: 18, color: WHITE, bold: true })] })],
      }),
    ],
  })

  const cellBorders = {
    top: { style: BorderStyle.SINGLE, size: 1, color: 'D0D8E4' },
    bottom: { style: BorderStyle.SINGLE, size: 1, color: 'D0D8E4' },
    left: { style: BorderStyle.SINGLE, size: 1, color: 'D0D8E4' },
    right: { style: BorderStyle.SINGLE, size: 1, color: 'D0D8E4' },
  }
  const cellMargins = { top: 80, bottom: 80, left: 100, right: 100 }

  const dataRows = sections.map((section, idx) => {
    const rowBg = idx % 2 === 0 ? 'F7F9FC' : WHITE
    const shading = { type: ShadingType.SOLID, color: rowBg, fill: rowBg }

    return new TableRow({
      children: [
        new TableCell({
          shading, borders: cellBorders, margins: cellMargins,
          width: { size: 8, type: WidthType.PERCENTAGE },
          children: [new Paragraph({ children: [new TextRun({ text: String(section.num), font: BODY_FONT, size: 18 })] })],
        }),
        new TableCell({
          shading, borders: cellBorders, margins: cellMargins,
          width: { size: 28, type: WidthType.PERCENTAGE },
          children: [new Paragraph({ children: [new TextRun({ text: section.name, font: BODY_FONT, size: 18, bold: true })] })],
        }),
        new TableCell({
          shading, borders: cellBorders, margins: cellMargins,
          width: { size: 16, type: WidthType.PERCENTAGE },
          children: [new Paragraph({
            children: [new TextRun({
              text: section.hasFindings ? '✅ Found' : '❌ None',
              font: BODY_FONT,
              size: 18,
              color: section.hasFindings ? '006400' : '8B0000',
            })],
          })],
        }),
        new TableCell({
          shading, borders: cellBorders, margins: cellMargins,
          width: { size: 48, type: WidthType.PERCENTAGE },
          children: [new Paragraph({ children: parseInline(section.summary, { font: BODY_FONT, size: 18 }) })],
        }),
      ],
    })
  })

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 2, color: DARK_BLUE },
      bottom: { style: BorderStyle.SINGLE, size: 2, color: DARK_BLUE },
      left: { style: BorderStyle.SINGLE, size: 2, color: DARK_BLUE },
      right: { style: BorderStyle.SINGLE, size: 2, color: DARK_BLUE },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: 'D0D8E4' },
      insideVertical: { style: BorderStyle.SINGLE, size: 1, color: 'D0D8E4' },
    },
    rows: [headerRow, ...dataRows],
  })
}

function buildMarkdownTable(tableLines: string[]): Table {
  const rows: TableRow[] = []

  for (let i = 0; i < tableLines.length; i++) {
    const cells = tableLines[i].split('|').map((c) => c.trim()).filter(Boolean)
    if (cells.length === 0 || cells.every((c) => /^[-:]+$/.test(c))) continue

    const isHeader = i === 0
    const rowBg = isHeader ? DARK_BLUE : (i % 2 === 0 ? 'F7F9FC' : WHITE)
    const shading = { type: ShadingType.SOLID, color: rowBg, fill: rowBg }

    rows.push(
      new TableRow({
        tableHeader: isHeader,
        children: cells.map(
          (cell) =>
            new TableCell({
              shading,
              margins: { top: 80, bottom: 80, left: 100, right: 100 },
              borders: {
                top: { style: BorderStyle.SINGLE, size: 1, color: 'D0D8E4' },
                bottom: { style: BorderStyle.SINGLE, size: 1, color: 'D0D8E4' },
                left: { style: BorderStyle.SINGLE, size: 1, color: 'D0D8E4' },
                right: { style: BorderStyle.SINGLE, size: 1, color: 'D0D8E4' },
              },
              children: [
                new Paragraph({
                  children: isHeader
                    ? [new TextRun({ text: cell, font: HEADING_FONT, size: 18, color: WHITE, bold: true })]
                    : parseInline(cell, { font: BODY_FONT, size: 18 }),
                }),
              ],
            })
        ),
      })
    )
  }

  if (rows.length === 0) {
    return new Table({
      rows: [new TableRow({ children: [new TableCell({ children: [new Paragraph({})] })] })],
    })
  }

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 2, color: DARK_BLUE },
      bottom: { style: BorderStyle.SINGLE, size: 2, color: DARK_BLUE },
      left: { style: BorderStyle.SINGLE, size: 2, color: DARK_BLUE },
      right: { style: BorderStyle.SINGLE, size: 2, color: DARK_BLUE },
    },
    rows,
  })
}

// ─── Flag box builder ─────────────────────────────────────────────────────────

function buildFlagParagraphs(flag: FlagBox): Paragraph[] {
  const isHigh = flag.severity === 'high'
  const borderColor = isHigh ? RED_FLAG : AMBER_FLAG
  const bgColor = isHigh ? LIGHT_RED_BG : LIGHT_AMBER_BG
  const shading = { type: ShadingType.SOLID, color: bgColor, fill: bgColor }
  const leftBorder = { style: BorderStyle.THICK, size: 24, color: borderColor }
  const border = { left: leftBorder }
  const indent = { left: 200 }

  const paragraphs: Paragraph[] = [
    new Paragraph({
      shading,
      border,
      indent,
      spacing: { before: 100, after: 0 },
      children: [
        new TextRun({ text: `⚠ ${flag.category}`, font: HEADING_FONT, size: BODY_SIZE, bold: true, color: borderColor }),
      ],
    }),
    new Paragraph({
      shading,
      border,
      indent,
      spacing: { before: 0, after: flag.url ? 0 : 120 },
      children: parseInline(flag.finding.trim(), { font: BODY_FONT, size: BODY_SIZE }),
    }),
  ]

  if (flag.url) {
    paragraphs.push(
      new Paragraph({
        shading,
        border,
        indent,
        spacing: { before: 0, after: 120 },
        children: [
          new ExternalHyperlink({
            link: flag.url,
            children: [new TextRun({ text: flag.url, font: BODY_FONT, size: 18, color: HYPERLINK_BLUE, underline: { type: 'single' } })],
          }),
        ],
      })
    )
  }

  return paragraphs
}

// ─── Main markdown → DocChild[] ───────────────────────────────────────────────

function markdownToChildren(markdown: string): DocChild[] {
  const lines = markdown.split('\n')
  const children: DocChild[] = []

  let inTable = false
  let tableLines: string[] = []

  function flushTable() {
    if (tableLines.length === 0) return
    children.push(buildMarkdownTable(tableLines))
    children.push(new Paragraph({ text: '', spacing: { after: 120 } }))
    tableLines = []
    inTable = false
  }

  for (const raw of lines) {
    // Detect table rows
    if (/^\s*\|/.test(raw)) {
      inTable = true
      tableLines.push(raw)
      continue
    } else if (inTable) {
      flushTable()
    }

    // ATX headings
    const headingMatch = raw.match(/^(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      const level = headingMatch[1].length
      const headingText = headingMatch[2].trim()
      const headingMap: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
        1: HeadingLevel.HEADING_1,
        2: HeadingLevel.HEADING_2,
        3: HeadingLevel.HEADING_3,
        4: HeadingLevel.HEADING_4,
        5: HeadingLevel.HEADING_5,
        6: HeadingLevel.HEADING_6,
      }
      let fontSize = H3_SIZE
      let fontColor = DARK_GRAY
      if (level === 1) { fontSize = H1_SIZE; fontColor = DARK_BLUE }
      else if (level === 2) { fontSize = H2_SIZE; fontColor = DARK_BLUE }

      children.push(
        new Paragraph({
          heading: headingMap[level] ?? HeadingLevel.HEADING_1,
          spacing: { before: level <= 2 ? 240 : 160, after: 80 },
          children: [new TextRun({ text: headingText, font: HEADING_FONT, size: fontSize, color: fontColor, bold: true })],
        })
      )
      continue
    }

    // ALL-CAPS headings
    if (/^[A-Z][A-Z\s/\-–—]{2,}$/.test(raw.trim()) && raw.trim().length > 2) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 200, after: 80 },
          children: [new TextRun({ text: raw.trim(), font: HEADING_FONT, size: H2_SIZE, color: DARK_BLUE, bold: true })],
        })
      )
      continue
    }

    // Horizontal rule
    if (/^(\*{3,}|-{3,}|_{3,})$/.test(raw.trim())) {
      children.push(new Paragraph({ text: '', spacing: { before: 120, after: 120 } }))
      continue
    }

    // Unordered list item
    const bulletMatch = raw.match(/^(\s*)([-*•✓])\s+(.+)$/)
    if (bulletMatch) {
      children.push(
        new Paragraph({
          numbering: { reference: BULLET_REF, level: 0 },
          spacing: { before: 40, after: 40 },
          children: parseInline(bulletMatch[3], { font: BODY_FONT, size: BODY_SIZE }),
        })
      )
      continue
    }

    // Empty line
    if (raw.trim() === '') {
      children.push(new Paragraph({ text: '', spacing: { before: 60, after: 60 } }))
      continue
    }

    // Regular paragraph with 1.15 line spacing
    children.push(
      new Paragraph({
        spacing: { before: 60, after: 60, line: 276, lineRule: 'auto' },
        children: parseInline(raw, { font: BODY_FONT, size: BODY_SIZE }),
      })
    )
  }

  if (inTable) flushTable()

  return children
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
                indent: { left: convertInchesToTwip(0.5), hanging: convertInchesToTwip(0.25) },
              },
              run: { font: BODY_FONT, size: BODY_SIZE },
            },
          },
        ],
      },
    ],
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Convert a markdown report string to a professional .docx Blob.
 *
 * @param markdown   - The full markdown text of the background-check report
 * @param personName - The subject's name (used for document metadata)
 * @returns A Blob containing the .docx file binary
 */
export async function markdownToDocx(markdown: string, personName: string): Promise<Blob> {
  const today = new Date()
  const dateStr = today.toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  const h1Title = extractH1(markdown)
  const parsedSections = parseSections(markdown)
  const flagBoxes = parseFlagBoxes(markdown)

  // displayTitle used for document metadata only
  const displayTitle = h1Title || `${personName} — Background Check Report`

  // ── Main Body Content ──────────────────────────────────────────────────────

  const bodyChildren: DocChild[] = []

  // Section heading: Executive Summary Table
  bodyChildren.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 240, after: 160 },
      children: [
        new TextRun({
          text: 'Source Check Summary',
          font: HEADING_FONT,
          size: H1_SIZE,
          color: DARK_BLUE,
          bold: true,
        }),
      ],
    })
  )

  // Summary table (only if sections were found)
  if (parsedSections.length > 0) {
    bodyChildren.push(buildSummaryTable(parsedSections))
    bodyChildren.push(new Paragraph({ text: '', spacing: { after: 240 } }))
  }

  // Flag boxes section
  if (flagBoxes.length > 0) {
    bodyChildren.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 240, after: 160 },
        children: [
          new TextRun({ text: 'Sensitive Topics Flagged', font: HEADING_FONT, size: H1_SIZE, color: RED_FLAG, bold: true }),
        ],
      })
    )
    for (const flag of flagBoxes) {
      for (const p of buildFlagParagraphs(flag)) {
        bodyChildren.push(p)
      }
    }
    bodyChildren.push(new Paragraph({ text: '', spacing: { after: 240 } }))
  }

  // Full report content
  bodyChildren.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 240, after: 160 },
      children: [
        new TextRun({ text: 'Full Report', font: HEADING_FONT, size: H1_SIZE, color: DARK_BLUE, bold: true }),
      ],
    })
  )

  const reportChildren = markdownToChildren(markdown)
  for (const child of reportChildren) {
    bodyChildren.push(child)
  }

  // ── Headers & Footers ──────────────────────────────────────────────────────

  const defaultHeader = new Header({
    children: [
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [
          new TextRun({
            text: 'CONFIDENTIAL — Board Applicant Background Check',
            font: HEADING_FONT,
            size: 16,
            color: DARK_GRAY,
          }),
        ],
      }),
    ],
  })
  const defaultFooter = new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: 'Page ', font: BODY_FONT, size: 18, color: DARK_GRAY }),
          new TextRun({ children: [PageNumber.CURRENT], font: BODY_FONT, size: 18, color: DARK_GRAY }),
          new TextRun({ text: ' of ', font: BODY_FONT, size: 18, color: DARK_GRAY }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], font: BODY_FONT, size: 18, color: DARK_GRAY }),
        ],
      }),
      new Paragraph({
        alignment: AlignmentType.LEFT,
        children: [
          new TextRun({
            text: `Prepared by Board Applicant Research Assistant — ${dateStr}`,
            font: BODY_FONT,
            size: 16,
            color: DARK_GRAY,
            italics: true,
          }),
        ],
      }),
    ],
  })

  // ── Page margins ──────────────────────────────────────────────────────────

  const pageMargin = {
    top: convertInchesToTwip(1),
    right: convertInchesToTwip(1),
    bottom: convertInchesToTwip(1),
    left: convertInchesToTwip(1),
    header: convertInchesToTwip(0.5),
    footer: convertInchesToTwip(0.5),
  }

  // ── Assemble document ─────────────────────────────────────────────────────

  const doc = new Document({
    numbering: buildNumbering(),
    creator: 'Board Applicant Research Assistant',
    title: displayTitle,
    description: `Background check report for ${personName}`,
    styles: {
      default: {
        document: {
          run: { font: BODY_FONT, size: BODY_SIZE },
        },
      },
    },
    sections: [
      // Single section: Body with headers/footers (no cover page)
      {
        headers: {
          default: defaultHeader,
        },
        footers: {
          default: defaultFooter,
        },
        properties: {
          page: { margin: pageMargin },
        },
        children: bodyChildren,
      },
    ],
  })

  const buffer = await Packer.toBlob(doc)
  return buffer
}
