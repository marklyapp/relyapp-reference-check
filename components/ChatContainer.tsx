'use client'

import { useState, useEffect, useRef } from 'react'
import ChatMessage, { Message, MessageRole } from './ChatMessage'
import ChatInput from './ChatInput'

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

function makeId() {
  return Math.random().toString(36).slice(2)
}

function assistantMsg(content: string): Message {
  return { id: makeId(), role: 'assistant' as MessageRole, content, timestamp: new Date() }
}

const INTRO_MESSAGES: Message[] = [
  assistantMsg(
    "Welcome to RelyApp Reference Check.\n\nI'll help you run a background reference check. Please provide details about the person you'd like to check — the more information you share, the more accurate the results."
  ),
  assistantMsg("Let's start with the subject's full name."),
]

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

function getSummary(info: SubjectInfo): string {
  const lines = [`**Subject:** ${info.name}`]
  if (info.location && info.location.toLowerCase() !== 'skip') lines.push(`**Location:** ${info.location}`)
  if (info.linkedin && info.linkedin.toLowerCase() !== 'skip') lines.push(`**LinkedIn:** ${info.linkedin}`)
  if (info.employers && info.employers.toLowerCase() !== 'skip') lines.push(`**Employers:** ${info.employers}`)
  if (info.usernames && info.usernames.toLowerCase() !== 'skip') lines.push(`**Usernames/Emails:** ${info.usernames}`)

  return (
    "Thank you. Here's a summary of the information collected:\n\n" +
    lines.join('\n') +
    '\n\nA reference check report will be generated shortly. (API integration coming in a future release.)'
  )
}

export default function ChatContainer() {
  const [messages, setMessages] = useState<Message[]>(INTRO_MESSAGES)
  const [step, setStep] = useState<ConversationStep>('await_name')
  const [info, setInfo] = useState<SubjectInfo>({})
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const addMessage = (msg: Message) => setMessages((prev) => [...prev, msg])

  const handleSend = (text: string) => {
    // Add user message
    const userMsg: Message = { id: makeId(), role: 'user', content: text, timestamp: new Date() }
    setMessages((prev) => [...prev, userMsg])

    // Process step
    let nextStep: ConversationStep = step
    const updatedInfo = { ...info }

    switch (step) {
      case 'await_name':
        updatedInfo.name = text
        nextStep = 'await_location'
        break
      case 'await_location':
        updatedInfo.location = text
        nextStep = 'await_linkedin'
        break
      case 'await_linkedin':
        updatedInfo.linkedin = text
        nextStep = 'await_employers'
        break
      case 'await_employers':
        updatedInfo.employers = text
        nextStep = 'await_usernames'
        break
      case 'await_usernames':
        updatedInfo.usernames = text
        nextStep = 'complete'
        break
      default:
        break
    }

    setInfo(updatedInfo)
    setStep(nextStep)

    // Schedule assistant response
    setTimeout(() => {
      if (nextStep === 'complete') {
        addMessage(assistantMsg(getSummary(updatedInfo)))
      } else {
        const prompt = getNextPrompt(nextStep)
        if (prompt) addMessage(assistantMsg(prompt))
      }
    }, 400)
  }

  const isComplete = step === 'complete'

  return (
    <div className="flex flex-col h-screen bg-gray-50">
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
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-50 text-green-700 text-xs font-medium border border-green-200">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
            Online
          </span>
        </div>
      </header>

      {/* Message area */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-3xl mx-auto">
          {messages.map((msg) => (
            <ChatMessage key={msg.id} message={msg} />
          ))}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input */}
      <div className="flex-shrink-0">
        <ChatInput
          onSend={handleSend}
          disabled={isComplete}
          placeholder={
            isComplete
              ? 'Reference check complete.'
              : step === 'await_name'
              ? "Enter the subject's full name…"
              : 'Type your response… (Enter to send, Shift+Enter for newline)'
          }
        />
      </div>
    </div>
  )
}
