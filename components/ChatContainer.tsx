'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import ChatMessage, { Message, MessageRole } from './ChatMessage'
import ChatInput from './ChatInput'
import { useReferenceCheck } from '@/hooks/useReferenceCheck'
import { useCheckHistory } from '@/hooks/useCheckHistory'
import { CheckRecord } from '@/lib/historyStore'
import WelcomeState from './WelcomeState'
import HistorySidebar from './HistorySidebar'

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maximum reasonable length for a name field */
const MAX_NAME_LENGTH = 120
/** Maximum reasonable length for location, employer, etc. */
const MAX_FIELD_LENGTH = 300

// ─── Types ────────────────────────────────────────────────────────────────────

type ConversationStep =
  | 'intro'
  | 'await_name'
  | 'await_location'
  | 'await_linkedin'
  | 'await_employers'
  | 'await_usernames'
  | 'complete'

interface SubjectInfo {
  name?: string
  location?: string
  linkedin?: string
  employers?: string
  usernames?: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeId() {
  return Math.random().toString(36).slice(2)
}

function assistantMsg(content: string): Message {
  return { id: makeId(), role: 'assistant' as MessageRole, content, timestamp: new Date() }
}

function validationMsg(content: string): Message {
  return assistantMsg(content)
}

function getNextPrompt(step: ConversationStep): string {
  switch (step) {
    case 'await_location':
      return "Got it. What city or location are they based in? (This helps narrow the search — type 'skip' to continue.)"
    case 'await_linkedin':
      return "Do you have their LinkedIn profile URL? (Paste the URL or type 'skip'.)"
    case 'await_employers':
      return "Any known employers or organizations? You can list more than one, separated by commas. (Type 'skip' if unknown.)"
    case 'await_usernames':
      return "Finally, any known email addresses or usernames? (Type 'skip' if unknown.)"
    default:
      return ''
  }
}

function getCollectionConfirmation(info: SubjectInfo): string {
  const lines = [`Subject: ${info.name}`]
  if (info.location && info.location.toLowerCase() !== 'skip') lines.push(`Location: ${info.location}`)
  if (info.linkedin && info.linkedin.toLowerCase() !== 'skip') lines.push(`LinkedIn: ${info.linkedin}`)
  if (info.employers && info.employers.toLowerCase() !== 'skip') lines.push(`Employers: ${info.employers}`)
  if (info.usernames && info.usernames.toLowerCase() !== 'skip') lines.push(`Usernames/Emails: ${info.usernames}`)

  return (
    "Thank you. Here's a summary of the information collected:\n\n" +
    lines.join('\n') +
    '\n\nStarting the reference check now…'
  )
}

/**
 * Validate name input — returns an error string or null if valid.
 * Handles empty, too-long, and all-special-characters edge cases.
 */
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

  // Must contain at least one letter (not just numbers/symbols)
  if (!/[a-zA-Z\u00C0-\u024F]/.test(trimmed)) {
    return "Please enter a valid name containing at least one letter."
  }

  return null
}

/**
 * Validate a general optional field — returns an error string or null.
 */
function validateOptionalField(text: string, fieldName: string): string | null {
  const trimmed = text.trim()

  if (/^skip$/i.test(trimmed)) return null // skip is always valid for optional fields
  if (!trimmed) return null // empty is treated as skip

  if (trimmed.length > MAX_FIELD_LENGTH) {
    return `That entry is too long (${trimmed.length} characters). Please keep ${fieldName} under ${MAX_FIELD_LENGTH} characters.`
  }

  return null
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ChatContainer() {
  const [messages, setMessages] = useState<Message[]>([])
  const [step, setStep] = useState<ConversationStep>('intro')
  const [info, setInfo] = useState<SubjectInfo>({})
  const [hasStarted, setHasStarted] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Store the last check input so retry can replay it
  const lastCheckInputRef = useRef<SubjectInfo | null>(null)

  // Accumulate streamed markdown so we can save the full report on complete
  const reportBufferRef = useRef<string>('')
  // Track the current check record id for history
  const currentCheckIdRef = useRef<string | null>(null)

  const { isRunning, runCheck, cancel } = useReferenceCheck()
  const { history, addRecord } = useCheckHistory()

  useEffect(() => {
    return () => {
      cancel()
    }
  }, [cancel])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const addMessage = useCallback((msg: Message) => {
    setMessages((prev) => [...prev, msg])
  }, [])

  /**
   * Reset all chat state for a new check.
   */
  const resetChat = useCallback(() => {
    cancel()
    setMessages([])
    setStep('intro')
    setInfo({})
    setHasStarted(false)
    setActiveId(null)
    lastCheckInputRef.current = null
    reportBufferRef.current = ''
    currentCheckIdRef.current = null
  }, [cancel])

  /**
   * Load a history record into the chat view.
   */
  const handleSelectHistory = useCallback((record: CheckRecord) => {
    cancel()
    setActiveId(record.id)
    setHasStarted(true)
    setStep('complete')
    setInfo(record.input)
    lastCheckInputRef.current = record.input
    reportBufferRef.current = record.markdown
    currentCheckIdRef.current = record.id

    // Reconstruct the message list from the saved record
    const summaryLines = [`Subject: ${record.input.name}`]
    if (record.input.location && record.input.location.toLowerCase() !== 'skip')
      summaryLines.push(`Location: ${record.input.location}`)
    if (record.input.linkedin && record.input.linkedin.toLowerCase() !== 'skip')
      summaryLines.push(`LinkedIn: ${record.input.linkedin}`)
    if (record.input.employers && record.input.employers.toLowerCase() !== 'skip')
      summaryLines.push(`Employers: ${record.input.employers}`)
    if (record.input.usernames && record.input.usernames.toLowerCase() !== 'skip')
      summaryLines.push(`Usernames/Emails: ${record.input.usernames}`)

    setMessages([
      assistantMsg(
        "Welcome to RelyApp Reference Check.\n\nI'll help you run a background reference check. Please provide details about the person you'd like to check — the more information you share, the more accurate the results."
      ),
      assistantMsg("Let's start with the subject's full name."),
      { id: makeId(), role: 'user' as MessageRole, content: record.input.name, timestamp: new Date(record.createdAt) },
      assistantMsg(
        "Thank you. Here's a summary of the information collected:\n\n" +
          summaryLines.join('\n') +
          '\n\nStarting the reference check now…'
      ),
      assistantMsg(record.markdown),
    ])
  }, [cancel])

  const triggerCheck = useCallback(
    (collectedInfo: SubjectInfo) => {
      lastCheckInputRef.current = collectedInfo
      reportBufferRef.current = ''

      // Generate a stable id for this check record
      const checkId = makeId()
      currentCheckIdRef.current = checkId

      runCheck(
        {
          name: collectedInfo.name ?? '',
          location: collectedInfo.location,
          linkedin: collectedInfo.linkedin,
          employers: collectedInfo.employers,
          usernames: collectedInfo.usernames,
        },
        {
          onStart: (msgId, loadingMsg) => {
            setMessages((prev) => [...prev, { ...loadingMsg, id: msgId }])
          },
          onChunk: (msgId, chunk) => {
            reportBufferRef.current += chunk
            setMessages((prev) => {
              const idx = prev.findIndex((m) => m.id === msgId)
              if (idx === -1) return prev
              const current = prev[idx]
              const isLoading = current.content.startsWith('🔍')
              const next = [...prev]
              next[idx] = {
                ...current,
                content: isLoading ? chunk : current.content + chunk,
              }
              return next
            })
          },
          onComplete: (_msgId) => {
            // Save completed check to history
            if (collectedInfo.name && reportBufferRef.current) {
              const record: CheckRecord = {
                id: checkId,
                personName: collectedInfo.name,
                input: {
                  name: collectedInfo.name,
                  location: collectedInfo.location,
                  linkedin: collectedInfo.linkedin,
                  employers: collectedInfo.employers,
                  usernames: collectedInfo.usernames,
                },
                markdown: reportBufferRef.current,
                createdAt: new Date().toISOString(),
              }
              addRecord(record)
              setActiveId(checkId)
            }
          },
          onError: (msgId, errorMsg) => {
            setMessages((prev) => {
              const idx = prev.findIndex((m) => m.id === msgId)
              if (idx === -1) return [...prev, errorMsg]
              const next = [...prev]
              next[idx] = { ...errorMsg, id: msgId }
              return next
            })
          },
        }
      )
    },
    [runCheck, addRecord]
  )

  /**
   * Handle retry — re-runs the last check using the stored input.
   * Appends a new loading message rather than modifying the old error.
   */
  const handleRetry = useCallback(
    (_retryKey: string) => {
      if (isRunning || !lastCheckInputRef.current) return
      triggerCheck(lastCheckInputRef.current)
    },
    [isRunning, triggerCheck]
  )

  /**
   * Called when the user clicks "Start a check" on the welcome state.
   */
  const handleStart = useCallback(() => {
    setHasStarted(true)
    setMessages([
      assistantMsg(
        "Welcome to RelyApp Reference Check.\n\nI'll help you run a background reference check. Please provide details about the person you'd like to check — the more information you share, the more accurate the results."
      ),
      assistantMsg("Let's start with the subject's full name."),
    ])
    setStep('await_name')
  }, [])

  const handleSend = useCallback(
    (text: string) => {
      if (isRunning) return

      // Defensive: strip null bytes and control characters to avoid crashes
      const safeText = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim()

      if (!safeText) return

      // Add user message
      const userMsg: Message = {
        id: makeId(),
        role: 'user',
        content: safeText,
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, userMsg])

      let nextStep: ConversationStep = step
      const updatedInfo = { ...info }

      switch (step) {
        case 'await_name': {
          const nameError = validateName(safeText)
          if (nameError) {
            setTimeout(() => addMessage(validationMsg(nameError)), 400)
            return
          }
          updatedInfo.name = safeText
          nextStep = 'await_location'
          break
        }

        case 'await_location': {
          const locError = validateOptionalField(safeText, 'location')
          if (locError) {
            setTimeout(() => addMessage(validationMsg(locError)), 400)
            return
          }
          updatedInfo.location = safeText
          nextStep = 'await_linkedin'
          break
        }

        case 'await_linkedin': {
          const liError = validateOptionalField(safeText, 'LinkedIn URL')
          if (liError) {
            setTimeout(() => addMessage(validationMsg(liError)), 400)
            return
          }
          updatedInfo.linkedin = safeText
          nextStep = 'await_employers'
          break
        }

        case 'await_employers': {
          const empError = validateOptionalField(safeText, 'employers')
          if (empError) {
            setTimeout(() => addMessage(validationMsg(empError)), 400)
            return
          }
          updatedInfo.employers = safeText
          nextStep = 'await_usernames'
          break
        }

        case 'await_usernames': {
          const unError = validateOptionalField(safeText, 'usernames/emails')
          if (unError) {
            setTimeout(() => addMessage(validationMsg(unError)), 400)
            return
          }
          updatedInfo.usernames = safeText
          nextStep = 'complete'
          break
        }

        default:
          break
      }

      setInfo(updatedInfo)
      setStep(nextStep)

      setTimeout(() => {
        if (nextStep === 'complete') {
          addMessage(assistantMsg(getCollectionConfirmation(updatedInfo)))
          setTimeout(() => triggerCheck(updatedInfo), 600)
        } else {
          const prompt = getNextPrompt(nextStep)
          if (prompt) addMessage(assistantMsg(prompt))
        }
      }, 400)
    },
    [isRunning, step, info, addMessage, triggerCheck]
  )

  const isComplete = step === 'complete'
  const inputDisabled = isComplete || isRunning

  // ─── Welcome / empty state ────────────────────────────────────────────────
  if (!hasStarted) {
    return (
      <div className="flex h-screen">
        <HistorySidebar
          history={history}
          activeId={activeId}
          onSelect={handleSelectHistory}
          onNewCheck={resetChat}
        />
        <div className="flex-1 min-w-0">
          <WelcomeState onStart={handleStart} />
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <HistorySidebar
        history={history}
        activeId={activeId}
        onSelect={handleSelectHistory}
        onNewCheck={resetChat}
      />

      {/* Main chat area */}
      <div className="flex flex-col flex-1 min-w-0 bg-gray-50">
        {/* Header */}
        <header className="flex-shrink-0 bg-white border-b border-gray-200 px-6 py-4 shadow-sm">
          <div className="max-w-3xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-blue-700 flex items-center justify-center">
                <span className="text-white text-sm font-bold">RA</span>
              </div>
              <div>
                <h1 className="text-base font-semibold text-gray-900 leading-tight">
                  RelyApp Reference Check
                </h1>
                <p className="text-xs text-gray-500">Government of Alberta</p>
              </div>
            </div>
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${
                isRunning
                  ? 'bg-yellow-50 text-yellow-700 border-yellow-200'
                  : 'bg-green-50 text-green-700 border-green-200'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full inline-block ${
                  isRunning ? 'bg-yellow-500 animate-pulse' : 'bg-green-500'
                }`}
              />
              {isRunning ? 'Checking…' : 'Online'}
            </span>
          </div>
        </header>

        {/* Message area */}
        <div className="flex-1 overflow-y-auto px-4 py-6">
          <div className="max-w-3xl mx-auto">
            {messages.map((msg) => (
              <ChatMessage key={msg.id} message={msg} onRetry={handleRetry} />
            ))}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* Input */}
        <div className="flex-shrink-0">
          <ChatInput
            onSend={handleSend}
            disabled={inputDisabled}
            placeholder={
              isRunning
                ? 'Reference check in progress…'
                : isComplete
                ? 'Reference check complete.'
                : step === 'await_name'
                ? "Enter the subject's full name…"
                : 'Type your response… (Enter to send, Shift+Enter for newline)'
            }
          />
        </div>
      </div>
    </div>
  )
}
