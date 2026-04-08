'use client'

/**
 * components/HistorySidebar.tsx
 * Left sidebar listing previous reference checks stored in localStorage.
 *
 * refs #12
 */

import { useState } from 'react'
import { HistoryEntry } from '@/hooks/useHistory'

interface HistorySidebarProps {
  history: HistoryEntry[]
  activeId: string | null
  onSelect: (entry: HistoryEntry) => void
  onNewCheck: () => void
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function HistorySidebar({
  history,
  activeId,
  onSelect,
  onNewCheck,
}: HistorySidebarProps) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <>
      {/* Mobile toggle button — visible only on small screens */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        aria-label={collapsed ? 'Expand history sidebar' : 'Collapse history sidebar'}
        className="md:hidden fixed top-4 left-4 z-50 w-9 h-9 rounded-lg bg-white border border-gray-200 shadow flex items-center justify-center text-gray-600 hover:bg-gray-50"
      >
        {collapsed ? (
          // Hamburger icon (show)
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="12" x2="21" y2="12"/>
            <line x1="3" y1="6" x2="21" y2="6"/>
            <line x1="3" y1="18" x2="21" y2="18"/>
          </svg>
        ) : (
          // X icon (hide)
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        )}
      </button>

      {/* Sidebar panel */}
      <aside
        className={`
          flex flex-col bg-white border-r border-gray-200 flex-shrink-0
          transition-all duration-200 ease-in-out overflow-hidden
          ${collapsed
            ? 'w-0 md:w-14'
            : 'w-64'
          }
          /* On mobile: fixed overlay; on md+: inline flex column */
          fixed inset-y-0 left-0 z-40
          md:relative md:inset-auto md:z-auto
        `}
      >
        {/* Sidebar header */}
        <div className="flex items-center justify-between px-3 py-4 border-b border-gray-100 flex-shrink-0">
          {!collapsed && (
            <span className="text-sm font-semibold text-gray-700 truncate">History</span>
          )}
          {/* Desktop collapse toggle */}
          <button
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="hidden md:flex ml-auto w-7 h-7 rounded-md items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100"
          >
            {collapsed ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
            )}
          </button>
        </div>

        {/* New Check button */}
        <div className={`px-3 py-3 flex-shrink-0 ${collapsed ? 'flex justify-center' : ''}`}>
          <button
            onClick={onNewCheck}
            title="New Check"
            className={`
              flex items-center gap-2 rounded-lg bg-blue-700 text-white text-sm font-medium
              hover:bg-blue-800 transition-colors
              ${collapsed ? 'w-8 h-8 justify-center p-0' : 'w-full px-3 py-2'}
            `}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            {!collapsed && <span>New Check</span>}
          </button>
        </div>

        {/* History list */}
        {!collapsed && (
          <div className="flex-1 overflow-y-auto py-1">
            {history.length === 0 ? (
              <p className="text-xs text-gray-400 px-4 py-3 text-center leading-relaxed">
                No previous checks yet.
              </p>
            ) : (
              <ul>
                {history.map((entry) => (
                  <li key={entry.id}>
                    <button
                      onClick={() => onSelect(entry)}
                      className={`w-full text-left px-3 py-2.5 rounded-lg mx-1 my-0.5 transition-colors ${
                        activeId === entry.id
                          ? 'bg-blue-50 text-blue-800'
                          : 'text-gray-700 hover:bg-gray-50'
                      }`}
                      style={{ width: 'calc(100% - 8px)' }}
                    >
                      <div className="text-sm font-medium truncate">{entry.personName}</div>
                      <div className="text-xs text-gray-400 mt-0.5">{formatDate(entry.createdAt)}</div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </aside>

      {/* Mobile backdrop */}
      {!collapsed && (
        <div
          className="md:hidden fixed inset-0 z-30 bg-black/30"
          onClick={() => setCollapsed(true)}
          aria-hidden="true"
        />
      )}
    </>
  )
}
