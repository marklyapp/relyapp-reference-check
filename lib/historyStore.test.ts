/**
 * __tests__/historyStore.test.ts
 * Unit tests for the localStorage history helpers.
 * refs #12
 */

import { CheckRecord, deleteRecord, loadHistory, saveRecord } from '@/lib/historyStore'

// Provide a minimal localStorage mock
class LocalStorageMock {
  private store: Record<string, string> = {}

  clear() {
    this.store = {}
  }

  getItem(key: string): string | null {
    return Object.prototype.hasOwnProperty.call(this.store, key) ? this.store[key] : null
  }

  setItem(key: string, value: string) {
    this.store[key] = value
  }

  removeItem(key: string) {
    delete this.store[key]
  }
}

const localStorageMock = new LocalStorageMock()

Object.defineProperty(global, 'window', {
  value: { localStorage: localStorageMock },
  writable: true,
})
Object.defineProperty(global, 'localStorage', {
  value: localStorageMock,
  writable: true,
})

function makeRecord(id: string, name: string): CheckRecord {
  return {
    id,
    personName: name,
    input: { name },
    markdown: `# Report for ${name}`,
    createdAt: new Date().toISOString(),
  }
}

describe('historyStore', () => {
  beforeEach(() => {
    localStorageMock.clear()
  })

  test('loadHistory returns empty array when nothing stored', () => {
    expect(loadHistory()).toEqual([])
  })

  test('saveRecord persists a record', () => {
    const rec = makeRecord('abc', 'Jane Doe')
    saveRecord(rec)
    const history = loadHistory()
    expect(history).toHaveLength(1)
    expect(history[0].id).toBe('abc')
    expect(history[0].personName).toBe('Jane Doe')
  })

  test('saveRecord prepends new records (newest first)', () => {
    saveRecord(makeRecord('1', 'Alice'))
    saveRecord(makeRecord('2', 'Bob'))
    const history = loadHistory()
    expect(history[0].id).toBe('2')
    expect(history[1].id).toBe('1')
  })

  test('saveRecord updates existing record with same id', () => {
    saveRecord(makeRecord('x', 'Original'))
    const updated: CheckRecord = { ...makeRecord('x', 'Updated'), markdown: '# Updated' }
    saveRecord(updated)
    const history = loadHistory()
    expect(history).toHaveLength(1)
    expect(history[0].personName).toBe('Updated')
  })

  test('deleteRecord removes the correct record', () => {
    saveRecord(makeRecord('1', 'Alice'))
    saveRecord(makeRecord('2', 'Bob'))
    deleteRecord('1')
    const history = loadHistory()
    expect(history).toHaveLength(1)
    expect(history[0].id).toBe('2')
  })

  test('deleteRecord is a no-op for unknown id', () => {
    saveRecord(makeRecord('1', 'Alice'))
    deleteRecord('nonexistent')
    expect(loadHistory()).toHaveLength(1)
  })
})
