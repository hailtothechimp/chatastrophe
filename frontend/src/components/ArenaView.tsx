import { useState, useRef, useEffect } from 'react'
import { Send, RotateCcw, Sparkles, ChevronDown } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { createConversation, streamChat, getConversation, getQuestions, getPersonas } from '../api'
import type { Persona } from '../api'
import type { Message, MetaInfo } from '../types'
import { DEFAULT_PARAMS } from '../types'

interface AgentConfig {
  provider: string
  model: string
  systemPrompt: string
  convId: string | null
}

interface Props {
  meta: MetaInfo | null
}

const COLORS = [
  { dot: 'bg-indigo-500',  bubble: 'bg-indigo-50 border-indigo-200',  label: 'text-indigo-600',  dot2: 'bg-indigo-500'  },
  { dot: 'bg-violet-500',  bubble: 'bg-violet-50 border-violet-200',  label: 'text-violet-600',  dot2: 'bg-violet-500'  },
  { dot: 'bg-emerald-500', bubble: 'bg-emerald-50 border-emerald-200', label: 'text-emerald-600', dot2: 'bg-emerald-500' },
  { dot: 'bg-amber-500',   bubble: 'bg-amber-50 border-amber-200',   label: 'text-amber-600',   dot2: 'bg-amber-500'   },
]

const DEFAULT_SYSTEM = 'You are a helpful, thoughtful assistant.'

function defaultAgents(meta: MetaInfo | null): AgentConfig[] {
  const groq = 'Groq (free cloud)'
  const oai  = 'OpenAI (paid)'
  const ant  = 'Anthropic (paid)'
  const groqModels = meta?.model_lists[groq] ?? []
  const oaiModels  = meta?.model_lists[oai]  ?? []
  const antModels  = meta?.model_lists[ant]  ?? []
  return [
    { provider: groq, model: groqModels[0] ?? '', systemPrompt: DEFAULT_SYSTEM, convId: null },
    { provider: groq, model: groqModels[2] ?? groqModels[1] ?? '', systemPrompt: DEFAULT_SYSTEM, convId: null },
    { provider: oai,  model: oaiModels[1]  ?? oaiModels[0] ?? '', systemPrompt: DEFAULT_SYSTEM, convId: null },
    { provider: ant,  model: antModels[0]  ?? '', systemPrompt: DEFAULT_SYSTEM, convId: null },
  ]
}

export default function ArenaView({ meta }: Props) {
  const [agents, setAgents] = useState<AgentConfig[]>(() => defaultAgents(meta))
  const [agentMessages, setAgentMessages] = useState<Message[][]>([[], [], [], []])
  const [streaming, setStreaming] = useState(['', '', '', ''])
  const [isStreaming, setIsStreaming] = useState(false)
  const [errors, setErrors] = useState<(string | null)[]>([null, null, null, null])
  const [input, setInput] = useState('')
  const [questions, setQuestions] = useState<Record<string, string[]>>({})
  const [personas, setPersonas] = useState<Persona[]>([])
  const [selectedPersonas, setSelectedPersonas] = useState(['', '', '', ''])
  const [qOpen, setQOpen] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const qRef = useRef<HTMLDivElement>(null)

  // Individual bottom refs (rules-of-hooks safe)
  const b0 = useRef<HTMLDivElement>(null)
  const b1 = useRef<HTMLDivElement>(null)
  const b2 = useRef<HTMLDivElement>(null)
  const b3 = useRef<HTMLDivElement>(null)
  const bottomRefs = [b0, b1, b2, b3]

  // Re-initialise agent defaults when meta loads
  useEffect(() => {
    if (meta) setAgents(defaultAgents(meta))
  }, [!!meta]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load question bank + personas from API
  useEffect(() => {
    getQuestions().then(setQuestions).catch(console.error)
    getPersonas().then(setPersonas).catch(console.error)
  }, [])

  // Close question picker on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (qRef.current && !qRef.current.contains(e.target as Node)) setQOpen(false)
    }
    if (qOpen) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [qOpen])

  // Scroll columns to bottom
  useEffect(() => {
    bottomRefs.forEach(r => r.current?.scrollIntoView({ behavior: 'smooth' }))
  }, [agentMessages, streaming])

  const hasStarted = agentMessages.some(msgs => msgs.length > 0)

  function setAgent(i: number, patch: Partial<AgentConfig>) {
    setAgents(prev => prev.map((a, idx) => idx === i ? { ...a, ...patch } : a))
  }

  async function streamOne(idx: number, convId: string, text: string, signal: AbortSignal) {
    try {
      for await (const ev of streamChat(convId, text, 1, false, signal)) {
        if (ev.type === 'token') {
          setStreaming(prev => {
            const next = [...prev]
            next[idx] += ev.content as string
            return next
          })
        } else if (ev.type === 'error') {
          setErrors(prev => { const n = [...prev]; n[idx] = ev.content as string; return n })
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setErrors(prev => { const n = [...prev]; n[idx] = String(err); return n })
      }
    }
  }

  async function handleSend() {
    if (!input.trim() || isStreaming) return
    const text = input.trim()
    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    setIsStreaming(true)
    setErrors([null, null, null, null])
    setStreaming(['', '', '', ''])

    try {
      // Create conversations on first send
      let ids = agents.map(a => a.convId)
      if (ids.some(id => !id)) {
        const title = text.length > 60 ? text.slice(0, 57) + '…' : text
        const created = await Promise.all(
          agents.map(a => createConversation({
            title,
            system_prompt: a.systemPrompt,
            provider: a.provider,
            model: a.model,
            params: DEFAULT_PARAMS,
          }))
        )
        ids = created.map(c => c.id)
        setAgents(prev => prev.map((a, i) => ({ ...a, convId: ids[i] })))
      }

      // Optimistic user messages
      const now = new Date().toISOString()
      setAgentMessages(prev => prev.map((msgs, i) => [
        ...msgs,
        { id: `opt-${Date.now()}-${i}`, conversation_id: ids[i]!, role: 'user' as const, content: text, meta: null, created_at: now },
      ]))

      // Stream all 4 in parallel
      const abort = new AbortController()
      abortRef.current = abort
      await Promise.all(ids.map((id, i) => streamOne(i, id!, text, abort.signal)))

      // Refresh all from server
      const updated = await Promise.all(ids.map(id => getConversation(id!)))
      setAgentMessages(updated.map(c => c?.messages ?? []))
      setStreaming(['', '', '', ''])
    } finally {
      setIsStreaming(false)
    }
  }

  function handleStop() {
    abortRef.current?.abort()
    setIsStreaming(false)
    setStreaming(['', '', '', ''])
  }

  function handleReset() {
    setAgents(prev => prev.map(a => ({ ...a, convId: null })))
    setAgentMessages([[], [], [], []])
    setStreaming(['', '', '', ''])
    setErrors([null, null, null, null])
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">

      {/* ── Agent config headers ───────────────────────────────────── */}
      <div className="grid grid-cols-4 divide-x divide-slate-200 border-b border-slate-200 shrink-0 bg-slate-50">
        {agents.map((agent, i) => {
          const c = COLORS[i]
          const models = meta?.model_lists[agent.provider] ?? []
          return (
            <div key={i} className="p-3 space-y-1.5">
              <div className="flex items-center gap-1.5 mb-2">
                <div className={`w-2 h-2 rounded-full ${c.dot}`} />
                <span className={`text-[10px] font-bold uppercase tracking-wider ${c.label}`}>Agent {i + 1}</span>
              </div>

              {/* Provider */}
              <select
                value={agent.provider}
                disabled={hasStarted}
                onChange={e => {
                  const p = e.target.value
                  const m = meta?.model_lists[p]?.[0] ?? ''
                  setAgent(i, { provider: p, model: m })
                }}
                className="w-full text-xs px-1.5 py-1 border border-slate-200 rounded bg-white text-slate-700 outline-none focus:ring-1 focus:ring-indigo-300 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {(meta?.providers ?? []).map(p => <option key={p} value={p}>{p}</option>)}
              </select>

              {/* Model */}
              <select
                value={agent.model}
                disabled={hasStarted}
                onChange={e => setAgent(i, { model: e.target.value })}
                className="w-full text-xs px-1.5 py-1 border border-slate-200 rounded bg-white text-slate-700 outline-none focus:ring-1 focus:ring-indigo-300 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {models.map(m => <option key={m} value={m}>{m}</option>)}
              </select>

              {/* Persona picker */}
              <select
                disabled={hasStarted}
                value={selectedPersonas[i]}
                onChange={e => {
                  const name = e.target.value
                  setSelectedPersonas(prev => { const n = [...prev]; n[i] = name; return n })
                  const p = personas.find(p => p.persona === name)
                  if (p) setAgent(i, { systemPrompt: p.system_prompt })
                }}
                className="w-full text-xs px-1.5 py-1 border border-slate-200 rounded bg-white text-slate-700 outline-none focus:ring-1 focus:ring-indigo-300 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <option value="">— Choose persona —</option>
                {[...personas].sort((a, b) => a.persona.localeCompare(b.persona)).map(p => (
                  <option key={p.persona} value={p.persona}>
                    {p.persona}{p.author ? ` (${p.book} — ${p.author.split(' ').at(-1)})` : p.show ? ` (${p.show})` : ''}
                  </option>
                ))}
              </select>

              {/* System prompt */}
              <textarea
                value={agent.systemPrompt}
                disabled={hasStarted}
                onChange={e => setAgent(i, { systemPrompt: e.target.value })}
                rows={2}
                placeholder="System prompt…"
                className="w-full text-xs px-1.5 py-1 border border-slate-200 rounded bg-white text-slate-600 resize-none outline-none focus:ring-1 focus:ring-indigo-300 leading-relaxed disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </div>
          )
        })}
      </div>

      {/* ── Message columns ───────────────────────────────────────── */}
      <div className="grid grid-cols-4 divide-x divide-slate-200 flex-1 min-h-0 overflow-hidden">
        {agents.map((_, i) => {
          const c = COLORS[i]
          const msgs = agentMessages[i]
          const stream = streaming[i]
          const err = errors[i]
          const waitingForResponse = isStreaming && !stream && msgs.length > 0 && msgs[msgs.length - 1].role === 'user'

          return (
            <div key={i} className="overflow-y-auto px-3 py-3 space-y-2.5">
              {msgs.length === 0 && !stream && (
                <p className="text-xs text-slate-400 italic text-center mt-8">
                  Agent {i + 1} will respond here
                </p>
              )}

              {msgs.map(msg => (
                <div key={msg.id}>
                  {msg.role === 'user' ? (
                    <div className="flex justify-end">
                      <div className="bg-indigo-600 text-white rounded-2xl rounded-tr-sm px-3 py-2 text-xs max-w-[95%] leading-relaxed">
                        {msg.content}
                      </div>
                    </div>
                  ) : (
                    <div className={`border rounded-2xl rounded-tl-sm px-3 py-2 text-xs text-slate-800 leading-relaxed ${c.bubble} prose-chat`}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                    </div>
                  )}
                </div>
              ))}

              {/* Live streaming */}
              {stream && (
                <div className={`border rounded-2xl rounded-tl-sm px-3 py-2 text-xs text-slate-800 leading-relaxed ${c.bubble}`}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{stream}</ReactMarkdown>
                  <span className="inline-block w-0.5 h-3 bg-slate-400 ml-0.5 animate-pulse" />
                </div>
              )}

              {/* Thinking dots */}
              {waitingForResponse && (
                <div className={`border rounded-2xl rounded-tl-sm px-3 py-2 ${c.bubble}`}>
                  <div className="flex gap-1">
                    {[0, 1, 2].map(j => (
                      <div key={j} className={`w-1.5 h-1.5 rounded-full ${c.dot2} animate-bounce opacity-70`}
                        style={{ animationDelay: `${j * 0.15}s` }} />
                    ))}
                  </div>
                </div>
              )}

              {err && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-2 py-1 text-[10px] text-red-600 break-words">
                  {err}
                </div>
              )}

              <div ref={bottomRefs[i]} />
            </div>
          )
        })}
      </div>

      {/* ── Shared input bar ──────────────────────────────────────── */}
      <div className="border-t border-slate-200 px-4 py-3 shrink-0 bg-white">
        {/* Question picker */}
        <div className="flex items-center mb-2 px-1">
          <div className="relative" ref={qRef}>
            <button
              onClick={() => setQOpen(o => !o)}
              className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-indigo-600 transition-colors"
            >
              <Sparkles size={13} />
              Question ideas
              <ChevronDown size={11} className={`transition-transform ${qOpen ? 'rotate-180' : ''}`} />
            </button>
            {qOpen && (
              <div className="absolute bottom-full mb-2 left-0 w-80 bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-y-auto max-h-[min(480px,70vh)]">
                {Object.entries(questions).map(([cat, qs]) => (
                  <div key={cat}>
                    <p className="px-3 py-2 text-[10px] font-bold text-indigo-600 uppercase tracking-wider bg-slate-50 border-b border-slate-100">
                      {cat}
                    </p>
                    {qs.map((q, i) => (
                      <button
                        key={i}
                        onClick={() => { setInput(q); setQOpen(false); textareaRef.current?.focus() }}
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
        <div className="flex items-end gap-2">
          {hasStarted && (
            <button
              onClick={handleReset}
              title="Start new session (resets all conversations)"
              className="shrink-0 p-2 rounded-xl text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
            >
              <RotateCcw size={15} />
            </button>
          )}

          <div className={`flex-1 flex items-end gap-2 border-2 rounded-2xl px-3 py-2 transition-colors ${
            isStreaming ? 'border-slate-200' : 'border-slate-300 focus-within:border-indigo-400'
          }`}>
            <textarea
              ref={textareaRef}
              value={input}
              disabled={isStreaming}
              onChange={e => {
                setInput(e.target.value)
                e.target.style.height = 'auto'
                e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px'
              }}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
              rows={1}
              placeholder={isStreaming ? 'Agents are responding…' : 'Message all 4 agents… (Enter to send, Shift+Enter for new line)'}
              className="flex-1 resize-none bg-transparent text-sm text-slate-800 placeholder:text-slate-400 outline-none leading-relaxed max-h-40"
              style={{ height: 'auto' }}
            />
            <button
              onClick={isStreaming ? handleStop : handleSend}
              disabled={!isStreaming && !input.trim()}
              className={`shrink-0 w-8 h-8 rounded-xl flex items-center justify-center transition-all ${
                isStreaming
                  ? 'bg-red-100 text-red-500 hover:bg-red-200'
                  : !input.trim()
                    ? 'bg-slate-100 text-slate-300'
                    : 'bg-indigo-600 text-white hover:bg-indigo-500 shadow-sm'
              }`}
            >
              {isStreaming
                ? <span className="text-xs font-bold leading-none">■</span>
                : <Send size={14} />
              }
            </button>
          </div>
        </div>
        <p className="text-[10px] text-slate-400 text-center mt-1.5">
          Configure agents above before first send · ✦ Question ideas · Enter ↵ sends · Shift+Enter for new line
        </p>
      </div>
    </div>
  )
}
