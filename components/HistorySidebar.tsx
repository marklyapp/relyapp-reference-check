'use client'

/**
 * components/HistorySidebar.tsx
 * Left sidebar showing previous reference checks.
 * Collapsible on smaller screens via a toggle button.
 * refs #12
 */

import { useState } from 'react'
import { CheckRecord } from '@/lib/historyStore'

interface HistorySidebarProps {
  history: CheckRecord[]
  activeId: string | null
  onSelect: (record: CheckRecord) => void
  onNewCheck: () => void
}

export default function HistorySidebar({
  history,
  activeId,
  onSelect,
  onNewCheck,
}: HistorySidebarProps) {
  const [open, setOpen] = useState(true)

  return (
    <>
      {/* Mobile toggle button — visible when sidebar is closed */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed top-4 left-4 z-20 sm:hidden p-2 rounded-lg bg-white border border-gray-200 shadow-sm text-gray-600 hover:bg-gray-50"
          aria-label="Open history sidebar"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h7" />
          </svg>
        </button>
      )}

      {/* Sidebar panel */}
      <aside
        className={`
          flex-shrink-0 flex flex-col bg-white border-r border-gray-200
          transition-all duration-200 overflow-hidden
          ${open ? 'w-64' : 'w-0'}
          /* On small screens collapse to an overlay sheet */
          sm:relative sm:translate-x-0
          ${open ? 'fixed inset-y-0 left-0 z-10 sm:static sm:z-auto' : ''}
        `}
        aria-label="Check history"
      >
        {/* Sidebar header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-shrink-0">
          <span className="text-sm font-semibold text-gray-700">History</span>
          <button
            onClick={() => setOpen(false)}
            className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
            aria-label="Close sidebar"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        </div>

        {/* New Check button */}
        <div className="px-3 py-3 border-b border-gray-100 flex-shrink-0">
          <button
            onClick={onNewCheck}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-blue-700 text-white text-sm font-medium hover:bg-blue-800 transition-colors"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            New Check
          </button>
        </div>

        {/* History list */}
        <div className="flex-1 overflow-y-auto">
          {history.length === 0 ? (
            <div className="px-4 py-6 text-center">
              <p className="text-xs text-gray-400">No previous checks yet.</p>
            </div>
          ) : (
            <ul className="py-2">
              {history.map((record) => {
                const date = new Date(record.createdAt)
                const dateStr = date.toLocaleDateString([], {
                  month: 'short',
                  day: 'numeric',
                  year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
                })
                const isActive = record.id === activeId

                return (
                  <li key={record.id}>
                    <button
                      onClick={() => onSelect(record)}
                      className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors border-l-2 ${
                        isActive
                          ? 'border-blue-600 bg-blue-50'
                          : 'border-transparent'
                      }`}
                    >
                      <p
                        className={`text-sm font-medium truncate ${
                          isActive ? 'text-blue-700' : 'text-gray-800'
                        }`}
                      >
                        {record.personName}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">{dateStr}</p>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </aside>

      {/* Overlay backdrop for mobile */}
      {open && (
        <div
          className="fixed inset-0 z-0 bg-black/20 sm:hidden"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Collapse toggle — shown at left edge when sidebar is closed on desktop */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="hidden sm:flex flex-col items-center justify-center w-6 bg-gray-100 border-r border-gray-200 hover:bg-gray-200 transition-colors text-gray-400 hover:text-gray-600 flex-shrink-0"
          aria-label="Expand history sidebar"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      )}
    </>
  )
}
