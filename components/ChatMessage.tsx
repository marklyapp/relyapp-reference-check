'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { markdownToDocx } from '@/lib/docx'

export type MessageRole = 'user' | 'assistant'

export interface Message {
  id: string
  role: MessageRole
  content: string
  timestamp: Date
}

interface ChatMessageProps {
  message: Message
  /** If true, shows the "Download .docx" button (completed assistant reports only) */
  isCompleted?: boolean
  /** Subject's name — used to generate the download filename */
  personName?: string
}

/**
 * Trigger a client-side download of a Blob as a named file.
 */
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/**
 * Format a Date as YYYY-MM-DD for use in filenames.
 */
function formatDateForFilename(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/**
 * Sanitise a person's name for use in a filename.
 * Lowercase, spaces → hyphens, strip non-alphanumeric except hyphens.
 */
function sanitiseName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
}

export default function ChatMessage({ message, isCompleted, personName }: ChatMessageProps) {
  const isUser = message.role === 'user'
  const showDownload = !isUser && isCompleted && !!personName

  const handleDownload = async () => {
    try {
      const blob = await markdownToDocx(message.content, personName!)
      const dateStr = formatDateForFilename(message.timestamp)
      const nameStr = sanitiseName(personName!)
      const filename = `reference-check-${nameStr}-${dateStr}.docx`
      downloadBlob(blob, filename)
    } catch (err) {
      console.error('Failed to generate .docx:', err)
    }
  }

  return (
    <div className={`flex w-full ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      {!isUser && (
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-700 flex items-center justify-center mr-2 mt-1">
          <span className="text-white text-xs font-semibold">RA</span>
        </div>
      )}
      <div className={`max-w-[70%] ${isUser ? 'items-end' : 'items-start'} flex flex-col`}>
        <div
          className={`px-4 py-3 rounded-2xl text-sm leading-relaxed ${
            isUser
              ? 'bg-blue-700 text-white rounded-br-sm'
              : 'bg-gray-100 text-gray-800 rounded-bl-sm border border-gray-200'
          }`}
        >
          {isUser ? (
            message.content.split('\n').map((line, i, arr) => (
              <span key={i}>
                {line}
                {i < arr.length - 1 && <br />}
              </span>
            ))
          ) : (
            <div className="prose prose-sm prose-gray max-w-none prose-a:text-blue-600 prose-code:bg-gray-200 prose-code:px-1 prose-code:rounded prose-pre:bg-gray-200">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  a: ({ href, children }) => (
                    <a href={href} target="_blank" rel="noopener noreferrer">
                      {children}
                    </a>
                  ),
                }}
              >
                {message.content}
              </ReactMarkdown>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3 mt-1 px-1">
          <span className="text-xs text-gray-400">
            {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
          {showDownload && (
            <button
              onClick={handleDownload}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 transition-colors"
              title="Download report as .docx"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="w-3.5 h-3.5"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
              Download .docx
            </button>
          )}
        </div>
      </div>
      {isUser && (
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-300 flex items-center justify-center ml-2 mt-1">
          <span className="text-gray-600 text-xs font-semibold">You</span>
        </div>
      )}
    </div>
  )
}
