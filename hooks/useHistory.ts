'use client'

/**
 * hooks/useHistory.ts
 * Manages reference check history stored in localStorage.
 *
 * refs #12
 */

import { useState, useCallback, useEffect } from 'react'

export interface HistoryEntry {
  id: string
  personName: string
  input: string
  markdown: string
  createdAt: string // ISO string
}

const STORAGE_KEY = 'relyapp_history'

function loadFromStorage(): HistoryEntry[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    return JSON.parse(raw) as HistoryEntry[]
  } catch {
    return []
  }
}

function saveToStorage(entries: HistoryEntry[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {
    // quota exceeded or private mode — silently ignore
  }
}

interface UseHistoryReturn {
  history: HistoryEntry[]
  addEntry: (entry: Omit<HistoryEntry, 'id' | 'createdAt'>) => HistoryEntry
  clearEntry: (id: string) => void
}

export function useHistory(): UseHistoryReturn {
  const [history, setHistory] = useState<HistoryEntry[]>([])

  // Load on mount (client-only)
  useEffect(() => {
    setHistory(loadFromStorage())
  }, [])

  const addEntry = useCallback(
    (entry: Omit<HistoryEntry, 'id' | 'createdAt'>): HistoryEntry => {
      const newEntry: HistoryEntry = {
        ...entry,
        id: Math.random().toString(36).slice(2),
        createdAt: new Date().toISOString(),
      }
      setHistory((prev) => {
        const updated = [newEntry, ...prev]
        saveToStorage(updated)
        return updated
      })
      return newEntry
    },
    []
  )

  const clearEntry = useCallback((id: string) => {
    setHistory((prev) => {
      const updated = prev.filter((e) => e.id !== id)
      saveToStorage(updated)
      return updated
    })
  }, [])

  return { history, addEntry, clearEntry }
}
