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
  status: CheckStatus
  isRunning: boolean
  runCheck: (
    input: ReferenceCheckInput,
    callbacks: {
      onStart: (msgId: string, loadingMsg: Message) => void
      onChunk: (msgId: string, chunk: string) => void
      onComplete: (msgId: string) => void
      onError: (msgId: string, errorMsg: Message) => void
    }
  ) => Promise<void>
  cancel: () => void
}

function makeId() {
  return Math.random().toString(36).slice(2)
}

function assistantMsg(content: string, status?: MessageStatus): Message {
  return { id: makeId(), role: 'assistant' as MessageRole, content, timestamp: new Date(), status }
}

/**
 * Maps an HTTP status code or error message to a user-friendly error string.
 */
function classifyError(httpStatus?: number, detail?: string): string {
  if (httpStatus === 401 || httpStatus === 403) {
    return '**Authentication error** The service API key is missing or invalid. Please contact your system administrator to verify the configuration.'
  }

  if (httpStatus === 429 || (detail && /rate.?limit|too many requests/i.test(detail))) {
    return '**Rate limit reached** The search service is temporarily rate-limited. Please wait a few minutes and try again.'
  }

  if (
    httpStatus === 500 ||
    (detail && /OPENAI_API_KEY|configuration error|api key not set/i.test(detail))
  ) {
    return '**Server configuration error** The AI report service is not properly configured. Please contact your system administrator.'
  }

  if (httpStatus === 502 || httpStatus === 503 || httpStatus === 504) {
    return '**Search service unavailable** The background search service is temporarily down. Please try again in a few minutes.'
  }

  if (httpStatus === 400) {
    return `**Invalid request** ${detail ?? 'The request was malformed. Please try again.'}`
  }

  if (detail) {
    return `**Reference check failed** ${detail}`
  }

  return '**Reference check failed** An unexpected error occurred. Please try again or contact support if the issue persists.'
}

/**
 * Normalise the collected SubjectInfo into a CheckRequestBody.
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
      const controller = new AbortController()
      controllerRef.current = controller

      setStatus('searching')
      callbacks.onStart(
        msgId,
        assistantMsg('Searching public records this may take a moment.')
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
        callbacks.onError(
          msgId,
          assistantMsg(
            '**Unable to connect** Could not reach the reference check service. Please check your internet connection and try again.',
            'error'
          )
        )
        return
      }

      if (!response.ok) {
        setStatus('error')
        let detail: string | undefined
        let httpStatus = response.status
        try {
          const json = (await response.json()) as { error?: string }
          if (json.error) detail = json.error
          if (detail && /rate.?limit|too many requests/i.test(detail)) {
            httpStatus = 429
          }
        } catch {
          // ignore parse failure
        }
        callbacks.onError(
          msgId,
          assistantMsg(classifyError(httpStatus, detail), 'error')
        )
        return
      }

      setStatus('streaming')

      const reader = response.body?.getReader()
      if (!reader) {
        setStatus('error')
        callbacks.onError(
          msgId,
          assistantMsg('**Unexpected response** The server returned an empty response. Please try again.', 'error')
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
              const isRateLimit = /rate.?limit|too many requests/i.test(parsed.error)
              const isApiKey = /api.?key|OPENAI_API_KEY|configuration/i.test(parsed.error)
              let errorContent: string
              if (isRateLimit) {
                errorContent = classifyError(429)
              } else if (isApiKey) {
                errorContent = classifyError(500, parsed.error)
              } else {
                errorContent = classifyError(undefined, parsed.error)
              }
              callbacks.onError(msgId, assistantMsg(errorContent, 'error'))
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
        callbacks.onError(
          msgId,
          assistantMsg(
            '**Stream interrupted** The report stream was cut short. Partial results may be shown above. Please try again.',
            'error'
          )
        )
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
