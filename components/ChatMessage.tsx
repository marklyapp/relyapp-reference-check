'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export type MessageRole = 'user' | 'assistant'
export type MessageStatus = 'default' | 'error' | 'loading'

export interface Message {
  id: string
  role: MessageRole
  content: string
  timestamp: Date
  status?: MessageStatus
  /** If set, a retry button is shown for error messages */
  onRetry?: () => void
}

interface ChatMessageProps {
  message: Message
}

export default function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user'
  const isError = message.status === 'error'

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
              : isError
              ? 'bg-red-50 text-red-800 rounded-bl-sm border border-red-200'
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
            <div className="prose prose-sm max-w-none prose-a:text-blue-600 prose-code:bg-gray-200 prose-code:px-1 prose-code:rounded prose-pre:bg-gray-200">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
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

        {isError && message.onRetry && (
          <button
            onClick={message.onRetry}
            className="mt-2 ml-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-100 hover:bg-red-200 text-red-700 text-xs font-medium transition-colors border border-red-200"
            aria-label="Retry reference check"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="w-3.5 h-3.5"
            >
              <path
                fillRule="evenodd"
                d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.433a.75.75 0 000-1.5H3.989a.75.75 0 00-.75.75v4.242a.75.75 0 001.5 0v-2.43l.31.31a7 7 0 0011.712-3.138.75.75 0 00-1.449-.39zm1.23-3.723a.75.75 0 00.219-.53V2.929a.75.75 0 00-1.5 0V5.36l-.31-.31A7 7 0 003.239 8.188a.75.75 0 101.448.389A5.5 5.5 0 0113.89 6.11l.311.31h-2.432a.75.75 0 000 1.5h4.243a.75.75 0 00.53-.219z"
                clipRule="evenodd"
              />
            </svg>
            Retry
          </button>
        )}

        <span className="text-xs text-gray-400 mt-1 px-1">
          {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      {isUser && (
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-300 flex items-center justify-center ml-2 mt-1">
          <span className="text-gray-600 text-xs font-semibold">You</span>
        </div>
      )}
    </div>
  )
}
