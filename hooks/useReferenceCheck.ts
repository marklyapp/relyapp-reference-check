/**
 * hooks/useReferenceCheck.ts
 * Custom hook that POSTs to /api/check and consumes the SSE stream,
 * appending text chunks to an assistant message in real-time.
 *
 * refs #10, #13
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Message, MessageRole, MessageStatus } from '@/components/ChatMessage'

export interface ReferenceCheckInput {
  name: string
  location?: string
  linkedin?: string
  employers?: string
  usernames?: string
}

export type CheckStatus = 'idle' | 'searching' | 'streaming' | 'done' | 'error'

interface UseReferenceCheckReturn {
  /** Current status of the check */
  status: CheckStatus
  /** Whether a check is in progress (searching or streaming) */
  isRunning: boolean
  /** Run the reference check; calls onChunk for each streamed chunk and onComplete when done */
  runCheck: (
    input: ReferenceCheckInput,
    callbacks: {
      /** Called with a new placeholder message id at the start */
      onStart: (msgId: string, loadingMsg: Message) => void
      /** Called as each text chunk arrives — returns the updated message */
      onChunk: (msgId: string, chunk: string) => void
      /** Called when streaming completes successfully */
      onComplete: (msgId: string) => void
      /** Called on error with a user-friendly message */
      onError: (msgId: string, errorMsg: Message) => void
    }
  ) => Promise<void>
  /** Abort any in-progress check immediately */
  cancel: () => void
}

function makeId() {
  return Math.random().toString(36).slice(2)
}

function assistantMsg(content: string): Message {
  return { id: makeId(), role: 'assistant' as MessageRole, content, timestamp: new Date() }
}

function errorMsg(content: string, retryKey?: string): Message {
  return {
    id: makeId(),
    role: 'assistant' as MessageRole,
    content,
    timestamp: new Date(),
    status: 'error' as MessageStatus,
    retryKey,
  }
}

/**
 * Classify an HTTP status code + body into a user-friendly error message.
 */
function classifyHttpError(status: number, detail: string, retryKey: string): Message {
  if (status === 429) {
    return errorMsg(
      '⚠️ **Rate limit reached.** The search service is temporarily limiting requests.\n\nPlease wait a minute and try again.',
      retryKey
    )
  }
  if (status === 503 || status === 502) {
    return errorMsg(
      '⚠️ **Search service unavailable.** The reference check service is temporarily down.\n\nPlease try again in a few minutes.',
      retryKey
    )
  }
  if (
    status === 500 &&
    (detail.toLowerCase().includes('api key') ||
      detail.toLowerCase().includes('configuration') ||
      detail.toLowerCase().includes('openai'))
  ) {
    return errorMsg(
      '⚠️ **Server configuration error.** The OpenAI API key or search API key is not configured on the server.\n\nPlease contact your administrator.',
      undefined // No retry for config errors — retrying won't help
    )
  }
  if (status === 401 || status === 403) {
    return errorMsg(
      '⚠️ **Authentication error.** The search API key is invalid or missing.\n\nPlease contact your administrator.',
      undefined
    )
  }
  if (status === 400) {
    return errorMsg(
      `⚠️ **Invalid request.** ${detail}\n\nPlease check your input and try again.`,
      retryKey
    )
  }
  return errorMsg(
    `⚠️ **The reference check could not be completed.**\n\n*${detail}*\n\nPlease try again or contact support if the issue persists.`,
    retryKey
  )
}

/**
 * Classify a network/stream error into a user-friendly message.
 */
function classifyNetworkError(err: unknown, retryKey: string): Message {
  const msg = err instanceof Error ? err.message : String(err)

  if (
    msg.toLowerCase().includes('rate limit') ||
    msg.toLowerCase().includes('rate_limit') ||
    msg.toLowerCase().includes('429')
  ) {
    return errorMsg(
      '⚠️ **Rate limit reached.** The search service is temporarily limiting requests.\n\nPlease wait a minute and try again.',
      retryKey
    )
  }

  if (
    msg.toLowerCase().includes('api key') ||
    msg.toLowerCase().includes('apikey') ||
    msg.toLowerCase().includes('unauthorized') ||
    msg.toLowerCase().includes('invalid_api_key')
  ) {
    return errorMsg(
      '⚠️ **API key error.** The search API key is missing or invalid.\n\nPlease contact your administrator.',
      undefined
    )
  }

  if (
    msg.toLowerCase().includes('failed to fetch') ||
    msg.toLowerCase().includes('network') ||
    msg.toLowerCase().includes('econnrefused') ||
    msg.toLowerCase().includes('enotfound')
  ) {
    return errorMsg(
      '⚠️ **Connection error.** Unable to reach the reference check service.\n\nPlease check your internet connection and try again.',
      retryKey
    )
  }

  return errorMsg(
    `⚠️ **An unexpected error occurred.**\n\n*${msg}*\n\nPlease try again or contact support.`,
    retryKey
  )
}

/**
 * Normalise the collected SubjectInfo into a CheckRequestBody.
 * Fields containing only "skip" (case-insensitive) are omitted.
 */
function buildRequestBody(input: ReferenceCheckInput): Record<string, unknown> {
  const isSkip = (v?: string) => !v || /^skip$/i.test(v.trim())

  const body: Record<string, unknown> = {
    name: input.name,
  }

  if (input.linkedin && !isSkip(input.linkedin)) {
    body.linkedinUrl = input.linkedin
  }

  if (!isSkip(input.location)) body.location = input.location
  if (!isSkip(input.employers)) {
    body.employers = input.employers!
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }
  if (!isSkip(input.usernames)) {
    body.usernames = input.usernames!
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }

  return body
}

export function useReferenceCheck(): UseReferenceCheckReturn {
  const [status, setStatus] = useState<CheckStatus>('idle')

  const controllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => {
      controllerRef.current?.abort()
    }
  }, [])

  const cancel = useCallback(() => {
    controllerRef.current?.abort()
    controllerRef.current = null
    setStatus('idle')
  }, [])

  const runCheck = useCallback(
    async (
      input: ReferenceCheckInput,
      callbacks: {
        onStart: (msgId: string, loadingMsg: Message) => void
        onChunk: (msgId: string, chunk: string) => void
        onComplete: (msgId: string) => void
        onError: (msgId: string, errorMsg: Message) => void
      }
    ) => {
      const msgId = makeId()
      // retryKey is stable across retries — used by the UI to identify which check to retry
      const retryKey = makeId()

      const controller = new AbortController()
      controllerRef.current = controller

      setStatus('searching')
      callbacks.onStart(
        msgId,
        assistantMsg('🔍 Searching public records… this may take a moment.')
      )

      let response: Response
      try {
        response = await fetch('/api/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildRequestBody(input)),
          signal: controller.signal,
        })
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return
        setStatus('error')
        callbacks.onError(msgId, classifyNetworkError(err, retryKey))
        return
      }

      if (!response.ok) {
        setStatus('error')
        let detail = `HTTP ${response.status}`
        try {
          const json = (await response.json()) as { error?: string }
          if (json.error) detail = json.error
        } catch {
          // ignore parse failure
        }
        callbacks.onError(msgId, classifyHttpError(response.status, detail, retryKey))
        return
      }

      setStatus('streaming')

      const reader = response.body?.getReader()
      if (!reader) {
        setStatus('error')
        callbacks.onError(
          msgId,
          errorMsg(
            '⚠️ **Unexpected server response.** No data stream was returned.\n\nPlease try again.',
            retryKey
          )
        )
        return
      }

      controller.signal.addEventListener('abort', () => {
        reader.cancel().catch(() => {})
      })

      const decoder = new TextDecoder()
      let buffer = ''

      function processBuffer(): boolean {
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const payload = line.slice(6).trim()

          if (payload === '[DONE]') {
            setStatus('done')
            callbacks.onComplete(msgId)
            return true
          }

          try {
            const parsed = JSON.parse(payload) as { text?: string; error?: string }

            if (parsed.error) {
              setStatus('error')
              // Classify stream-level errors too
              const streamErr = classifyNetworkError(new Error(parsed.error), retryKey)
              callbacks.onError(msgId, streamErr)
              return true
            }

            if (parsed.text) {
              callbacks.onChunk(msgId, parsed.text)
            }
          } catch {
            // Non-JSON SSE data — ignore
          }
        }

        return false
      }

      try {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read()

          if (done) {
            if (buffer.trim()) {
              processBuffer()
            }
            break
          }

          buffer += decoder.decode(value, { stream: true })

          if (processBuffer()) return
        }

        setStatus('done')
        callbacks.onComplete(msgId)
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return
        setStatus('error')
        callbacks.onError(msgId, classifyNetworkError(err, retryKey))
      } finally {
        if (controllerRef.current === controller) {
          controllerRef.current = null
        }
      }
    },
    []
  )

  return {
    status,
    isRunning: status === 'searching' || status === 'streaming',
    runCheck,
    cancel,
  }
}
