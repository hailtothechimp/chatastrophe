import { useState, useEffect, useRef } from 'react'
import { Brain, Play, Sparkles, ChevronDown } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { streamReasoning, createConversation, getQuestions } from '../api'
import type { Conversation, MetaInfo, SamplingParams } from '../types'
import { DEFAULT_PARAMS } from '../types'
import PersonaPicker from './PersonaPicker'

interface Props {
  meta: MetaInfo | null
  conversation: Conversation | null
  provider: string
  model: string
  onMessagesUpdated: () => void
  onConversationCreated: (conv: Conversation) => void
}

export default function ReasoningView({
  meta, conversation, provider: defaultProvider, model: defaultModel,
  onMessagesUpdated, onConversationCreated,
}: Props) {
  const reasoningProviders = meta?.reasoning_providers ?? []
  const [rzProvider, setRzProvider] = useState(reasoningProviders[0] ?? 'OpenAI (paid)')
  const [rzModel, setRzModel] = useState('')
  const [systemPrompt, setSystemPrompt] = useState("You are a helpful, careful reasoning assistant.")
  const [userMessage, setUserMessage] = useState("What makes this number unique: 8,549,176,320?")
  const [effort, setEffort] = useState<'low' | 'medium' | 'high'>('medium')
  const [budget, setBudget] = useState(8000)
  const [maxTokens, setMaxTokens] = useState(4096)

  const [streaming, setStreaming] = useState(false)
  const [streamText, setStreamText] = useState('')
  const [meta2, setMeta2] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const [questions, setQuestions] = useState<Record<string, string[]>>({})
  const [qOpen, setQOpen] = useState(false)
  const qRef = useRef<HTMLDivElement>(null)

  useEffect(() => { getQuestions().then(setQuestions).catch(console.error) }, [])

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (qRef.current && !qRef.current.contains(e.target as Node)) setQOpen(false)
    }
    if (qOpen) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [qOpen])

  const isOpenAI = rzProvider === 'OpenAI (paid)'
  const models = meta?.reasoning_model_lists[rzProvider] ?? []

  useEffect(() => {
    setRzModel(models[0] ?? '')
  }, [rzProvider, models.length])

  async function ensureConversation(): Promise<Conversation> {
    if (conversation) return conversation
    const conv = await createConversation({
      title: userMessage.slice(0, 60) + (userMessage.length > 60 ? '…' : ''),
      system_prompt: systemPrompt,
      provider: rzProvider,
      model: rzModel,
      params: { ...DEFAULT_PARAMS },
    })
    onConversationCreated(conv)
    return conv
  }

  async function handleRun() {
    if (!userMessage.trim()) return
    setError(null)
    setStreamText('')
    setMeta2(null)
    setStreaming(true)

    let convId: string
    try {
      const conv = await ensureConversation()
      convId = conv.id
    } catch (err) {
      setError(String(err))
      setStreaming(false)
      return
    }

    abortRef.current = new AbortController()
    let accumulated = ''

    try {
      for await (const event of streamReasoning(
        {
          conversation_id: convId,
          provider: rzProvider,
          model: rzModel,
          user_message: userMessage.trim(),
          reasoning_effort: effort,
          budget_tokens: budget,
          max_tokens: maxTokens,
        },
        abortRef.current.signal,
      )) {
        if (event.type === 'token') {
          accumulated += event.content as string
          setStreamText(accumulated)
        } else if (event.type === 'meta') {
          setMeta2(event as Record<string, unknown>)
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setError(String(err))
      }
    } finally {
      setStreaming(false)
      onMessagesUpdated()
    }
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
      <div>
        <div className="flex items-center gap-2 mb-0.5">
          <Brain size={18} className="text-purple-600" />
          <h2 className="text-base font-semibold text-slate-800">Reasoning Models</h2>
        </div>
        <p className="text-sm text-slate-500">
          Run models that spend internal compute before responding.{' '}
          OpenAI o-series use <code className="text-xs bg-slate-100 px-1 rounded">reasoning_effort</code>;
          Anthropic uses an explicit token budget.
        </p>
      </div>

      {/* Provider + Model */}
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="block text-xs font-medium text-slate-600 mb-1">Provider</label>
          <select
            value={rzProvider}
            onChange={e => setRzProvider(e.target.value)}
            className="w-full px-2 py-1.5 text-sm rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-400 outline-none bg-white"
          >
            {reasoningProviders.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className="flex-1">
          <label className="block text-xs font-medium text-slate-600 mb-1">Model</label>
          <select
            value={rzModel}
            onChange={e => setRzModel(e.target.value)}
            className="w-full px-2 py-1.5 text-sm rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-400 outline-none bg-white"
          >
            {models.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      </div>

      {/* Reasoning controls */}
      <div className="rounded-xl border border-purple-200 bg-purple-50/50 px-4 py-3 space-y-3">
        <p className="text-xs font-bold text-purple-700 uppercase tracking-wider">Reasoning Control</p>
        {isOpenAI ? (
          <div>
            <label className="block text-xs text-slate-600 mb-1.5">Reasoning Effort</label>
            <div className="flex gap-2">
              {(['low', 'medium', 'high'] as const).map(e => (
                <button
                  key={e}
                  onClick={() => setEffort(e)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${
                    effort === e
                      ? 'bg-purple-600 text-white shadow-sm'
                      : 'bg-white border border-slate-300 text-slate-600 hover:border-purple-300'
                  }`}
                >
                  {e}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-slate-400 mt-1.5">Higher = more thinking tokens, slower but smarter</p>
          </div>
        ) : (
          <div>
            <div className="flex justify-between items-baseline mb-1">
              <label className="text-xs text-slate-600">Thinking Budget (tokens)</label>
              <span className="text-xs font-mono text-purple-600">{budget.toLocaleString()}</span>
            </div>
            <input
              type="range" min={1024} max={32000} step={1024}
              value={budget}
              onChange={e => setBudget(parseInt(e.target.value))}
              className="w-full h-1.5 accent-purple-600"
            />
          </div>
        )}
        <div>
          <div className="flex justify-between items-baseline mb-1">
            <label className="text-xs text-slate-600">Max Output Tokens</label>
            <span className="text-xs font-mono text-purple-600">{maxTokens.toLocaleString()}</span>
          </div>
          <input
            type="range" min={256} max={16000} step={256}
            value={maxTokens}
            onChange={e => setMaxTokens(parseInt(e.target.value))}
            className="w-full h-1.5 accent-purple-600"
          />
        </div>
      </div>

      {/* Prompts */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="block text-xs font-medium text-slate-600">System Prompt</label>
          <PersonaPicker
            onSelect={setSystemPrompt}
            className="text-slate-500 hover:text-slate-800"
          />
        </div>
        <textarea
          value={systemPrompt}
          onChange={e => setSystemPrompt(e.target.value)}
          rows={2}
          className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-400 outline-none resize-none"
        />
      </div>
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium text-slate-600">User Prompt</label>
          <div className="relative" ref={qRef}>
            <button
              onClick={() => setQOpen(o => !o)}
              className="flex items-center gap-1 text-xs text-slate-400 hover:text-indigo-600 transition-colors"
            >
              <Sparkles size={12} />
              Question ideas
              <ChevronDown size={10} className={`transition-transform ${qOpen ? 'rotate-180' : ''}`} />
            </button>
            {qOpen && (
              <div className="absolute top-full mt-1 right-0 w-80 bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-y-auto max-h-[min(480px,60vh)]">
                {Object.entries(questions).map(([cat, qs]) => (
                  <div key={cat}>
                    <p className="px-3 py-2 text-[10px] font-bold text-indigo-600 uppercase tracking-wider bg-slate-50 border-b border-slate-100">
                      {cat}
                    </p>
                    {qs.map((q, i) => (
                      <button
                        key={i}
                        onClick={() => { setUserMessage(q); setQOpen(false) }}
                        className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 transition-colors border-b border-slate-50 last:border-0"
                      >
                        {q.length > 80 ? q.slice(0, 77) + '…' : q}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <textarea
          value={userMessage}
          onChange={e => setUserMessage(e.target.value)}
          rows={4}
          className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-400 outline-none resize-none"
        />
      </div>

      {/* Run button */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleRun}
          disabled={streaming || !userMessage.trim()}
          className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-sm font-semibold rounded-lg shadow transition-all disabled:opacity-50"
        >
          <Play size={14} />
          {streaming ? 'Thinking…' : 'Generate'}
        </button>
        {streaming && (
          <button
            onClick={() => abortRef.current?.abort()}
            className="text-xs text-slate-400 hover:text-red-500 transition-colors"
          >
            ✕ Stop
          </button>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-600">{error}</div>
      )}

      {/* Live output */}
      {(streamText || (streaming && !streamText)) && (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
          <div className="px-3 py-2 bg-slate-50 border-b border-slate-100 flex items-center gap-2">
            <Brain size={13} className="text-purple-500" />
            <span className="text-xs font-medium text-slate-600">{rzModel}</span>
            {streaming && <span className="ml-auto text-xs text-purple-500 animate-pulse">thinking…</span>}
          </div>
          <div className="px-4 py-3 text-sm text-slate-800 leading-relaxed prose-chat">
            {streamText ? (
              <>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamText}</ReactMarkdown>
                {streaming && <span className="inline-block w-0.5 h-4 bg-purple-400 ml-0.5 animate-pulse" />}
              </>
            ) : (
              <div className="flex gap-1.5">
                {[0, 1, 2].map(i => (
                  <div key={i} className="w-2 h-2 rounded-full bg-slate-300 animate-bounce"
                    style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </div>
            )}
          </div>
          {meta2 && (
            <div className="px-4 py-2 border-t border-slate-100 flex flex-wrap gap-3">
              {meta2.latency_s !== undefined && (
                <span className="text-[10px] text-slate-400">⏱ {meta2.latency_s as number}s</span>
              )}
              {meta2.input_tokens !== undefined && (
                <span className="text-[10px] text-slate-400">
                  {meta2.input_tokens as number} in / {meta2.output_tokens as number} out tokens
                </span>
              )}
              {meta2.reasoning_effort !== undefined && (
                <span className="text-[10px] text-purple-500">effort={String(meta2.reasoning_effort)}</span>
              )}
              {meta2.budget_tokens !== undefined && (
                <span className="text-[10px] text-purple-500">budget={(meta2.budget_tokens as number).toLocaleString()} tokens</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
