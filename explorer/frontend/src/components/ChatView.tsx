import { useEffect, useRef, useState } from 'react'
import { Flame, Lightbulb } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import MessageBubble from './MessageBubble'
import InputBar from './InputBar'
import { streamChat, createConversation, getConversation, getPersonas } from '../api'
import type { Conversation, Message, MetaInfo, SamplingParams } from '../types'
import { DEFAULT_PARAMS } from '../types'

interface Props {
  conversation: Conversation | null
  params: SamplingParams
  provider: string
  model: string
  meta: MetaInfo | null
  systemPrompt: string
  onMessagesUpdated: () => void
  onConversationCreated: (conv: Conversation) => void
}

const ALL_SUGGESTIONS = [
  "What makes this number unique: 8,549,176,320?",
  "A rooster lays an egg on a slanted roof. Which side does it roll down?",
  "If you could add one useless superpower to all of humanity, what would cause the most chaos?",
  "Is it ethical to lie to protect someone's feelings?",
  "What's the most counterintuitive fact you know?",
  "Explain quantum entanglement to a 10-year-old.",
  "If animals could vote, which species would dominate politics and why?",
  "What word in English has the most meanings?",
  "Could a medieval knight beat a UFC champion in a street fight?",
  "What's one invention that made the world worse?",
  "If you had to remove one letter from the alphabet forever, which causes the least damage?",
  "Is cereal a soup? Defend your answer.",
  "What would happen if everyone on Earth jumped at the same time?",
  "Which historical figure would be the most annoying at a dinner party?",
  "Design a sport that combines chess and parkour.",
  "What's the loneliest number other than one?",
]

function pickRandom<T>(arr: T[], n: number): T[] {
  return [...arr].sort(() => Math.random() - 0.5).slice(0, n)
}

const WELCOME_SUGGESTIONS = pickRandom(ALL_SUGGESTIONS, 4)

export default function ChatView({
  conversation, params, provider, model, meta, systemPrompt,
  onMessagesUpdated, onConversationCreated,
}: Props) {
  const [personaMap, setPersonaMap] = useState<Map<string, string>>(new Map())
  const [messages, setMessages] = useState<Message[]>([])
  const [streamingContent, setStreamingContent] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getPersonas()
      .then(ps => setPersonaMap(new Map(ps.map((p: { persona: string; system_prompt: string }) => [p.system_prompt, p.persona]))))
      .catch(console.error)
  }, [])

  const bottomRef  = useRef<HTMLDivElement>(null)
  const abortRef   = useRef<AbortController | null>(null)
  const sendingRef = useRef(false)  // suppresses sync-from-prop during an active send

  // Sync messages when switching to a different conversation.
  // Skipped while handleSend owns the state (new-conv creation changes the id mid-send).
  useEffect(() => {
    if (sendingRef.current) return
    setMessages(conversation?.messages ?? [])
    setStreamingContent('')
    setError(null)
  }, [conversation?.id])

  // Scroll to bottom on new content
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])

  const supportsLogprobs = meta?.param_support[provider]?.logprobs ?? false

  // Look up persona name per-message (uses the system_prompt stamped on message meta).
  // Falls back to the conversation's current system_prompt for older messages that
  // predate this feature.
  function personaForMsg(msg: Message): string | null {
    const sp = msg.meta?.system_prompt ?? conversation?.system_prompt ?? ''
    return sp ? (personaMap.get(sp) ?? null) : null
  }

  async function handleSend(text: string, numRuns: number, showLogprobs: boolean) {
    sendingRef.current = true
    setError(null)
    setIsStreaming(true)  // set early so isEmpty stays false during conversation creation

    // If no conversation yet, create one first
    let conv = conversation
    if (!conv) {
      const title = text.length > 60 ? text.slice(0, 57) + '…' : text
      conv = await createConversation({
        title,
        system_prompt: systemPrompt,
        provider,
        model,
        params: { ...DEFAULT_PARAMS, ...params },
      })
      onConversationCreated(conv)
      // Continue with the new conversation immediately (don't return)
    }

    // Optimistic user message
    const optimisticUserMsg: Message = {
      id: 'opt-' + Date.now(),
      conversation_id: conv.id,
      role: 'user',
      content: text,
      meta: null,
      created_at: new Date().toISOString(),
    }
    setMessages(prev => [...prev, optimisticUserMsg])

    // Multiple runs — keep isStreaming=true until messages are refreshed from server
    try {
      for (let run = 0; run < numRuns; run++) {
        setStreamingContent('')

        abortRef.current = new AbortController()
        let accumulated = ''

        try {
          for await (const event of streamChat(conv.id, text, 1, showLogprobs, abortRef.current.signal)) {
            if (event.type === 'token') {
              accumulated += event.content as string
              setStreamingContent(accumulated)
            }
          }
        } catch (err: unknown) {
          if (err instanceof Error && err.name !== 'AbortError') {
            setError(String(err))
          }
        }
        setStreamingContent('')
      }

      // Refresh messages from server (has proper IDs, meta, logprobs)
      const updated = await getConversation(conv.id)
      setMessages(updated.messages)
      onMessagesUpdated()
    } finally {
      // Only clear streaming flag after messages are loaded (prevents isEmpty flash)
      setIsStreaming(false)
      sendingRef.current = false
    }
  }

  function handleStopStream() {
    abortRef.current?.abort()
    setIsStreaming(false)
    setStreamingContent('')
  }

  const isEmpty = (!conversation || messages.length === 0) && !isStreaming

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {isEmpty ? (
        /* ── Welcome / empty state ── */
        <div className="flex-1 flex flex-col items-center justify-center px-8 py-12">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-orange-400 to-red-500 flex items-center justify-center mb-6 shadow-lg">
            <Flame size={24} className="text-white" />
          </div>
          <h1 className="text-2xl font-semibold text-[var(--text-primary)] mb-2">What are we exploring today?</h1>
          <p className="text-[var(--text-secondary)] text-sm mb-8 text-center max-w-sm">
            Ask any question, run experiments with LLM sampling parameters, and save your conversations.
          </p>

          {/* Suggestion chips */}
          <div className="grid grid-cols-2 gap-3 max-w-lg w-full">
            {WELCOME_SUGGESTIONS.map((q, i) => (
              <button
                key={i}
                onClick={() => {
                  // Dispatch a fake send event — handled by InputBar text state is separate,
                  // so we just call handleSend directly
                  handleSend(q, 1, false)
                }}
                className="group flex items-start gap-2 p-3 rounded-xl border border-[var(--panel-border)] hover:border-[var(--accent)] hover:bg-[var(--accent-light)] transition-all text-left"
              >
                <Lightbulb size={14} className="shrink-0 mt-0.5 text-[var(--text-muted)] group-hover:text-[var(--accent)]" />
                <span className="text-xs text-[var(--text-primary)] group-hover:text-[var(--accent-text)] leading-relaxed">{q}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        /* ── Message thread ── */
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {messages.map(msg => (
            <MessageBubble key={msg.id} message={msg} modelName={msg.meta?.model ?? conversation?.model} personaName={personaForMsg(msg)} />
          ))}

          {/* Live streaming bubble */}
          {streamingContent && (
            <div className="flex gap-3">
              <div className="shrink-0 w-7 h-7 rounded-full bg-[var(--sb-l2)] flex items-center justify-center">
                <div className="w-2 h-2 rounded-full bg-[var(--accent)] animate-pulse" />
              </div>
              <div className="bg-[var(--bubble-ai-bg)] border border-[var(--bubble-ai-border)] rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-[var(--bubble-ai-text)] shadow-sm max-w-[80%]">
                <div className="prose-chat">
                  <ReactMarkdownInline>{streamingContent}</ReactMarkdownInline>
                </div>
                <span className="inline-block w-0.5 h-4 bg-[var(--accent)] ml-0.5 animate-pulse" />
              </div>
            </div>
          )}

          {/* "Thinking" pulse when logprobs/waiting */}
          {isStreaming && !streamingContent && (
            <div className="flex gap-3">
              <div className="shrink-0 w-7 h-7 rounded-full bg-[var(--sb-l2)] flex items-center justify-center">
                <div className="w-2 h-2 rounded-full bg-[var(--accent)] animate-pulse" />
              </div>
              <div className="bg-[var(--bubble-ai-bg)] border border-[var(--bubble-ai-border)] rounded-2xl rounded-tl-sm px-4 py-3">
                <div className="flex gap-1.5">
                  {[0, 1, 2].map(i => (
                    <div key={i} className="w-2 h-2 rounded-full bg-[var(--panel-surface)] animate-bounce"
                      style={{ animationDelay: `${i * 0.15}s` }} />
                  ))}
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="flex justify-center">
              <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-xs text-red-600">
                {error}
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      )}

      {/* Input bar */}
      <InputBar
        onSend={handleSend}
        disabled={isStreaming}
        supportsLogprobs={supportsLogprobs}
      />
      {isStreaming && (
        <div className="pb-2 flex justify-center">
          <button
            onClick={handleStopStream}
            className="text-xs text-[var(--text-muted)] hover:text-red-500 transition-colors"
          >
            ✕ Stop generating
          </button>
        </div>
      )}
    </div>
  )
}

function ReactMarkdownInline({ children }: { children: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
}
