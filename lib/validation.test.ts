/**
 * lib/validation.test.ts
 * Tests for input validation helpers used in ChatContainer.
 * refs #13
 */

// ─── Inline copies of the validators (same logic as ChatContainer) ─────────────
// We extract and test the pure functions independently.

const MAX_NAME_LENGTH = 120
const MAX_FIELD_LENGTH = 300

function validateName(text: string): string | null {
  const trimmed = text.trim()

  if (!trimmed) {
    return "The subject's full name is required — please enter a name to continue."
  }

  if (/^skip$/i.test(trimmed)) {
    return "The subject's full name is required — please enter a name to continue."
  }

  if (trimmed.length > MAX_NAME_LENGTH) {
    return `That name is too long (${trimmed.length} characters). Please enter a name under ${MAX_NAME_LENGTH} characters.`
  }

  if (!/[a-zA-Z\u00C0-\u024F]/.test(trimmed)) {
    return 'Please enter a valid name containing at least one letter.'
  }

  return null
}

function validateOptionalField(text: string, fieldName: string): string | null {
  const trimmed = text.trim()

  if (/^skip$/i.test(trimmed)) return null
  if (!trimmed) return null

  if (trimmed.length > MAX_FIELD_LENGTH) {
    return `That entry is too long (${trimmed.length} characters). Please keep ${fieldName} under ${MAX_FIELD_LENGTH} characters.`
  }

  return null
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('validateName', () => {
  it('accepts a normal full name', () => {
    expect(validateName('Jane Smith')).toBeNull()
  })

  it('accepts a name with accented characters', () => {
    expect(validateName('Émile Trudeau')).toBeNull()
  })

  it('accepts a single name (some cultures use one name)', () => {
    expect(validateName('Cher')).toBeNull()
  })

  it('rejects empty string', () => {
    expect(validateName('')).not.toBeNull()
  })

  it('rejects whitespace-only string', () => {
    expect(validateName('   ')).not.toBeNull()
  })

  it('rejects "skip" (case-insensitive)', () => {
    expect(validateName('skip')).not.toBeNull()
    expect(validateName('SKIP')).not.toBeNull()
    expect(validateName('Skip')).not.toBeNull()
  })

  it('rejects names over MAX_NAME_LENGTH', () => {
    const longName = 'A'.repeat(MAX_NAME_LENGTH + 1)
    const result = validateName(longName)
    expect(result).not.toBeNull()
    expect(result).toContain('too long')
  })

  it('accepts names exactly at MAX_NAME_LENGTH', () => {
    // 120 letters is valid
    const name = 'A' + ' B'.repeat(59) // "A B B B..." = 119 chars + space
    expect(validateName('A'.repeat(MAX_NAME_LENGTH))).toBeNull()
  })

  it('rejects names with only numbers', () => {
    expect(validateName('12345')).not.toBeNull()
  })

  it('rejects names with only special characters', () => {
    expect(validateName('!@#$%')).not.toBeNull()
    expect(validateName('---')).not.toBeNull()
  })

  it('accepts hyphenated surnames', () => {
    expect(validateName('Mary-Anne O\'Brien')).toBeNull()
  })

  it('accepts names with apostrophes', () => {
    expect(validateName("O'Connor Brian")).toBeNull()
  })

  it('trims whitespace before validating', () => {
    expect(validateName('  Jane Smith  ')).toBeNull()
  })
})

describe('validateOptionalField', () => {
  it('accepts "skip" (any case)', () => {
    expect(validateOptionalField('skip', 'location')).toBeNull()
    expect(validateOptionalField('SKIP', 'location')).toBeNull()
  })

  it('accepts empty string', () => {
    expect(validateOptionalField('', 'location')).toBeNull()
  })

  it('accepts whitespace-only string', () => {
    expect(validateOptionalField('   ', 'location')).toBeNull()
  })

  it('accepts a normal location', () => {
    expect(validateOptionalField('Calgary, AB', 'location')).toBeNull()
  })

  it('accepts a normal employer list', () => {
    expect(validateOptionalField('Acme Corp, Global Inc', 'employers')).toBeNull()
  })

  it('rejects entries over MAX_FIELD_LENGTH', () => {
    const longEntry = 'x'.repeat(MAX_FIELD_LENGTH + 1)
    const result = validateOptionalField(longEntry, 'location')
    expect(result).not.toBeNull()
    expect(result).toContain('too long')
  })

  it('accepts entries exactly at MAX_FIELD_LENGTH', () => {
    const entry = 'a'.repeat(MAX_FIELD_LENGTH)
    expect(validateOptionalField(entry, 'location')).toBeNull()
  })
})
