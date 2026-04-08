/**
 * lib/historyStore.ts
 * Persistence helpers for reference-check history stored in localStorage.
 * Runs only in the browser (guards against SSR).
 *
 * Schema: CheckRecord { id, personName, input, markdown, createdAt }
 * refs #12
 */

export interface CheckRecord {
  /** Unique identifier for this check */
  id: string
  /** The subject's name */
  personName: string
  /** Raw inputs collected during the conversation */
  input: {
    name: string
    location?: string
    linkedin?: string
    employers?: string
    usernames?: string
  }
  /** The generated markdown report */
  markdown: string
  /** ISO-8601 creation timestamp */
  createdAt: string
}

const STORAGE_KEY = 'relyapp_history'

function isClient(): boolean {
  return typeof window !== 'undefined'
}

/** Load all records from localStorage, newest first. */
export function loadHistory(): CheckRecord[] {
  if (!isClient()) return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as CheckRecord[]
    if (!Array.isArray(parsed)) return []
    return parsed
  } catch {
    return []
  }
}

/** Append a new record (or update if id already exists). */
export function saveRecord(record: CheckRecord): void {
  if (!isClient()) return
  const existing = loadHistory().filter((r) => r.id !== record.id)
  // Prepend so newest is first
  const updated = [record, ...existing]
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
}

/** Delete a record by id. */
export function deleteRecord(id: string): void {
  if (!isClient()) return
  const updated = loadHistory().filter((r) => r.id !== id)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
}
