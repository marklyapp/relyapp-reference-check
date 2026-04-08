/**
 * hooks/useReferenceCheck.ts
 * Custom hook that POSTs to /api/check and consumes the SSE stream,
 * appending text chunks to an assistant message in real-time.
 *
 * refs #10
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Message, MessageRole } from '@/components/ChatMessage'

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

/**
 * Normalise the collected SubjectInfo into a CheckRequestBody.
 * Fields containing only "skip" (case-insensitive) are omitted.
 * Uses separate named fields for name and linkedinUrl to avoid ambiguity.
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
    // Could be emails or usernames — pass as usernames
    body.usernames = input.usernames!
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }

  return body
}

export function useReferenceCheck(): UseReferenceCheckReturn {
  const [status, setStatus] = useState<CheckStatus>('idle')

  // Persists the active AbortController across renders so unmount can abort it
  const controllerRef = useRef<AbortController | null>(null)

  // Abort any in-progress fetch/stream when the component unmounts
  useEffect(() => {
    return () => {
      controllerRef.current?.abort()
    }
  }, [])

  /** Imperatively cancel any active check */
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

      // Create a new controller and store it in the ref so unmount can abort it
      const controller = new AbortController()
      controllerRef.current = controller

      // --- Search phase: show loading indicator ---
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
        const errDetail = err instanceof Error ? err.message : 'Network error'
        callbacks.onError(
          msgId,
          assistantMsg(
            `⚠️ Unable to connect to the reference check service. Please check your connection and try again.\n\n*Details: ${errDetail}*`
          )
        )
        return
      }

      // Non-2xx → parse error body and surface message
      if (!response.ok) {
        setStatus('error')
        let detail = `HTTP ${response.status}`
        try {
          const json = (await response.json()) as { error?: string }
          if (json.error) detail = json.error
        } catch {
          // ignore parse failure
        }
        callbacks.onError(
          msgId,
          assistantMsg(
            `⚠️ The reference check could not be completed.\n\n*${detail}*\n\nPlease try again or contact support if the issue persists.`
          )
        )
        return
      }

      // --- Streaming phase ---
      setStatus('streaming')

      const reader = response.body?.getReader()
      if (!reader) {
        setStatus('error')
        callbacks.onError(
          msgId,
          assistantMsg('⚠️ Unexpected response from the server. Please try again.')
        )
        return
      }

      // Cancel the stream reader when the AbortController fires (component unmount)
      controller.signal.addEventListener('abort', () => {
        reader.cancel().catch(() => {})
      })

      const decoder = new TextDecoder()
      let buffer = ''

      /**
       * Process all complete SSE lines currently in `buffer`.
       * Returns true if [DONE] was received (caller should stop the loop).
       */
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
              callbacks.onError(
                msgId,
                assistantMsg(
                  `⚠️ An error occurred while generating the report.\n\n*${parsed.error}*`
                )
              )
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
            // Flush any remaining content in the buffer before completing
            if (buffer.trim()) {
              processBuffer()
            }
            break
          }

          buffer += decoder.decode(value, { stream: true })

          if (processBuffer()) return
        }

        // Stream ended without [DONE] — treat as complete
        setStatus('done')
        callbacks.onComplete(msgId)
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return
        setStatus('error')
        const errDetail = err instanceof Error ? err.message : 'Stream read error'
        callbacks.onError(
          msgId,
          assistantMsg(
            `⚠️ The report stream was interrupted.\n\n*${errDetail}*\n\nPartial results may be shown above.`
          )
        )
      } finally {
        // Clear the ref once this check is fully resolved
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
