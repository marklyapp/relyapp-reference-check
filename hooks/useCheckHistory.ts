/**
 * hooks/useCheckHistory.ts
 * React hook wrapping the localStorage history helpers.
 * Exposes a reactive list of CheckRecord entries and mutators.
 * refs #12
 */

import { useCallback, useEffect, useState } from 'react'
import { CheckRecord, deleteRecord, loadHistory, saveRecord } from '@/lib/historyStore'

interface UseCheckHistoryReturn {
  /** All records, newest first */
  history: CheckRecord[]
  /** Persist a new (or updated) record and refresh state */
  addRecord: (record: CheckRecord) => void
  /** Remove a record by id */
  removeRecord: (id: string) => void
}

export function useCheckHistory(): UseCheckHistoryReturn {
  const [history, setHistory] = useState<CheckRecord[]>([])

  // Load on mount (client-only)
  useEffect(() => {
    setHistory(loadHistory())
  }, [])

  const addRecord = useCallback((record: CheckRecord) => {
    saveRecord(record)
    setHistory(loadHistory())
  }, [])

  const removeRecord = useCallback((id: string) => {
    deleteRecord(id)
    setHistory(loadHistory())
  }, [])

  return { history, addRecord, removeRecord }
}
