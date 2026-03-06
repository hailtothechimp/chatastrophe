import { useState, useRef, useEffect } from 'react'
import { Play, Plus, X, Users, RotateCcw, Sparkles, ChevronDown } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { streamRoundtable, getQuestions, getPersonas } from '../api'
import type { Persona } from '../api'
import type { Conversation, MetaInfo } from '../types'

interface AgentConfig {
  persona: string
  systemPrompt: string
  provider: string
  model: string
}

interface TurnEntry {
  persona: string
  model: string
  idx: number
  content: string
}

interface Props {
  meta: MetaInfo | null
  onConversationCreated: (conv: Conversation) => void
  initialConv?: Conversation | null
}

const COLORS = [
  { dot: 'bg-indigo-500',  bubble: 'bg-indigo-50 border-indigo-200',  label: 'text-indigo-700',  ring: 'ring-indigo-300'  },
  { dot: 'bg-violet-500',  bubble: 'bg-violet-50 border-violet-200',  label: 'text-violet-700',  ring: 'ring-violet-300'  },
  { dot: 'bg-emerald-500', bubble: 'bg-emerald-50 border-emerald-200', label: 'text-emerald-700', ring: 'ring-emerald-300' },
  { dot: 'bg-amber-500',   bubble: 'bg-amber-50 border-amber-200',   label: 'text-amber-700',   ring: 'ring-amber-300'   },
]

function defaultAgent(meta: MetaInfo | null): AgentConfig {
  const provider = 'Groq (free cloud)'
  const model = meta?.model_lists[provider]?.[0] ?? 'llama-3.3-70b-versatile'
  return { persona: '', systemPrompt: '', provider, model }
}

function SliderRow({
  label, leftLabel, rightLabel, value, onChange, min = 0, max = 100, step = 1,
}: {
  label: string; leftLabel: string; rightLabel: string
  value: number; onChange: (v: number) => void
  min?: number; max?: number; step?: number
}) {
  return (
    <div className="flex-1">
      <div className="flex justify-between items-baseline mb-1">
        <span className="text-xs font-medium text-slate-600">{label}</span>
        <span className="text-xs text-slate-400">{value}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-slate-500 whitespace-nowrap">{leftLabel}</span>
        <input
          type="range" min={min} max={max} step={step} value={value}
          onChange={e => onChange(parseInt(e.target.value))}
          className="flex-1 h-1.5 accent-indigo-500"
        />
        <span className="text-[11px] text-slate-500 whitespace-nowrap">{rightLabel}</span>
      </div>
    </div>
  )
}

export default function RoundtableView({ meta, onConversationCreated, initialConv }: Props) {
  const [agents, setAgents] = useState<AgentConfig[]>(() => [
    defaultAgent(meta), defaultAgent(meta),
  ])
  const [topic, setTopic] = useState('')
  const [numTurns, setNumTurns] = useState(4)
  const [mood, setMood] = useState(50)
  const [seriousness, setSeriousness] = useState(50)

  const [turns, setTurns] = useState<TurnEntry[]>([])
  const [activeTurn, setActiveTurn] = useState<TurnEntry | null>(null)
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [convId, setConvId] = useState<string | null>(null)
  const [followUp, setFollowUp] = useState('')
  const [questions, setQuestions] = useState<Record<string, string[]>>({})
  const [qOpen, setQOpen] = useState(false)
  const [personas, setPersonas] = useState<Persona[]>([])
  const qRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    getQuestions().then(setQuestions).catch(console.error)
    getPersonas().then(setPersonas).catch(console.error)
  }, [])

  // Load an existing roundtable conversation from the sidebar
  useEffect(() => {
    if (!initialConv) return
    // Reconstruct topic from the first user message
    const msgs = initialConv.messages ?? []
    const firstUser = msgs.find(m => m.role === 'user')
    if (firstUser) setTopic(firstUser.content)
    setConvId(initialConv.id)
    setFollowUp('')
    setError(null)
    setActiveTurn(null)

    // Rebuild turn list; assign color idx by order of persona first appearance
    const personaOrder: string[] = []
    const rebuilt: TurnEntry[] = []
    let isFirst = true
    for (const msg of msgs) {
      if (msg.role === 'user') {
        if (isFirst) { isFirst = false; continue }  // skip opening topic message
        rebuilt.push({ persona: 'You', model: '', idx: -1, content: msg.content })
      } else if (msg.role === 'assistant') {
        const meta = msg.meta as Record<string, string> | null
        const persona = meta?.persona ?? 'Unknown'
        const model = meta?.model ?? ''
        if (!personaOrder.includes(persona)) personaOrder.push(persona)
        rebuilt.push({ persona, model, idx: personaOrder.indexOf(persona), content: msg.content })
      }
    }
    setTurns(rebuilt)
  }, [initialConv?.id])

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (qRef.current && !qRef.current.contains(e.target as Node)) setQOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [turns, activeTurn?.content])

  function setAgent(i: number, patch: Partial<AgentConfig>) {
    setAgents(prev => prev.map((a, idx) => idx === i ? { ...a, ...patch } : a))
  }

  function addAgent() {
    if (agents.length >= 4) return
    setAgents(prev => [...prev, defaultAgent(meta)])
  }

  function removeAgent(i: number) {
    if (agents.length <= 2) return
    setAgents(prev => prev.filter((_, idx) => idx !== i))
  }

  async function handleRun(isFollowUp = false) {
    if (!topic.trim() || agents.some(a => !a.systemPrompt)) {
      setError('Please set a topic and pick a persona for each agent.')
      return
    }
    if (isFollowUp && !followUp.trim()) return
    setError(null)
    if (!isFollowUp) {
      setTurns([])
      setConvId(null)
    }
    setActiveTurn(null)
    setStreaming(true)

    const abort = new AbortController()
    abortRef.current = abort

    const currentTurns = isFollowUp ? turns : []

    try {
      for await (const event of streamRoundtable(
        {
          agents: agents.map(a => ({
            persona: a.persona || 'Assistant',
            system_prompt: a.systemPrompt,
            provider: a.provider,
            model: a.model,
          })),
          topic: topic.trim(),
          num_turns: numTurns,
          mood,
          seriousness,
          ...(isFollowUp && convId ? {
            conv_id: convId,
            follow_up: followUp.trim(),
            history: currentTurns.map(t => ({ persona: t.persona, content: t.content })),
          } : {}),
        },
        abort.signal,
      )) {
        if (event.type === 'conv_id') {
          const id = event.conv_id as string
          setConvId(id)
          if (isFollowUp) {
            // Add follow-up as a visible user turn divider
            setTurns(prev => [...prev, { persona: 'You', model: '', idx: -1, content: followUp.trim() }])
            setFollowUp('')
          }
          // Register new conversation in sidebar
          onConversationCreated({
            id: event.conv_id as string,
            title: topic.slice(0, 60),
            provider: agents[0].provider,
            model: agents[0].model,
            system_prompt: '',
            params: {} as never,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            messages: [],
          })
        } else if (event.type === 'speaker') {
          setActiveTurn({
            persona: event.persona as string,
            model: event.model as string,
            idx: event.idx as number,
            content: '',
          })
        } else if (event.type === 'token') {
          setActiveTurn(prev => prev ? { ...prev, content: prev.content + (event.content as string) } : prev)
        } else if (event.type === 'turn_end') {
          setActiveTurn(prev => {
            if (prev?.content) setTurns(t => [...t, prev])
            return null
          })
        } else if (event.type === 'error') {
          setError(event.content as string)
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setError(String(err))
      }
    } finally {
      setStreaming(false)
      setActiveTurn(null)
    }
  }

  function handleStop() {
    abortRef.current?.abort()
    setStreaming(false)
    setActiveTurn(null)
  }

  const hasOutput = turns.length > 0 || activeTurn !== null || (streaming && !activeTurn)
  const followUpRef = useRef<HTMLTextAreaElement>(null)

  // Auto-focus follow-up when conversation finishes
  useEffect(() => {
    if (!streaming && convId) followUpRef.current?.focus()
  }, [streaming, convId])

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
    <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-0.5">
          <Users size={18} className="text-indigo-600" />
          <h2 className="text-base font-semibold text-slate-800">Roundtable</h2>
        </div>
        <p className="text-sm text-slate-500">
          Pick 2–4 personas and a topic. They'll have a conversation — you just watch.
        </p>
      </div>

      {/* Agent cards */}
      <div className="flex gap-3 flex-wrap">
        {agents.map((agent, i) => {
          const c = COLORS[i]
          const models = meta?.model_lists[agent.provider] ?? []
          return (
            <div key={i} className={`flex-1 min-w-[180px] rounded-xl border-2 p-3 space-y-2 ${c.bubble}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className={`w-2.5 h-2.5 rounded-full ${c.dot}`} />
                  <span className={`text-xs font-semibold ${c.label}`}>
                    {agent.persona || `Agent ${i + 1}`}
                  </span>
                </div>
                {agents.length > 2 && (
                  <button onClick={() => removeAgent(i)} className="text-slate-400 hover:text-red-400">
                    <X size={12} />
                  </button>
                )}
              </div>

              {/* Persona picker */}
              <select
                value={agent.persona}
                onChange={e => {
                  const p = personas.find(p => p.persona === e.target.value)
                  setAgent(i, {
                    persona: e.target.value,
                    systemPrompt: p?.system_prompt ?? '',
                  })
                }}
                className="w-full px-2 py-1 text-xs rounded-lg border border-slate-300 bg-white outline-none focus:ring-1 focus:ring-indigo-400"
              >
                <option value="">— Pick a persona —</option>
                {[...personas].sort((a, b) => a.persona.localeCompare(b.persona)).map(p => (
                  <option key={p.persona} value={p.persona}>
                    {p.persona}{p.author ? ` (${p.book} — ${p.author.split(' ').at(-1)})` : p.show ? ` (${p.show})` : ''}
                  </option>
                ))}
              </select>

              {/* Editable system prompt */}
              <textarea
                value={agent.systemPrompt}
                onChange={e => setAgent(i, { systemPrompt: e.target.value })}
                rows={3}
                placeholder="System prompt (auto-filled from persona)"
                className="w-full px-2 py-1 text-xs rounded-lg border border-slate-300 bg-white outline-none focus:ring-1 focus:ring-indigo-400 resize-y"
              />

              {/* Provider */}
              <select
                value={agent.provider}
                onChange={e => {
                  const newProvider = e.target.value
                  const firstModel = meta?.model_lists[newProvider]?.[0] ?? ''
                  setAgent(i, { provider: newProvider, model: firstModel })
                }}
                className="w-full px-2 py-1 text-xs rounded-lg border border-slate-300 bg-white outline-none focus:ring-1 focus:ring-indigo-400"
              >
                {(meta?.providers ?? []).map(p => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>

              {/* Model */}
              <select
                value={agent.model}
                onChange={e => setAgent(i, { model: e.target.value })}
                className="w-full px-2 py-1 text-xs rounded-lg border border-slate-300 bg-white outline-none focus:ring-1 focus:ring-indigo-400"
              >
                {models.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          )
        })}

        {agents.length < 4 && (
          <button
            onClick={addAgent}
            className="flex flex-col items-center justify-center min-w-[80px] rounded-xl border-2 border-dashed border-slate-300 hover:border-indigo-400 hover:bg-indigo-50 text-slate-400 hover:text-indigo-500 transition-colors p-3 gap-1"
          >
            <Plus size={18} />
            <span className="text-xs font-medium">Add</span>
          </button>
        )}
      </div>

      {/* Topic */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium text-slate-600">Topic / Opening prompt</label>
          <div className="relative" ref={qRef}>
            <button
              onClick={() => setQOpen(o => !o)}
              className="flex items-center gap-1 text-xs text-slate-500 hover:text-indigo-600 transition-colors"
            >
              <Sparkles size={12} />
              Question ideas
              <ChevronDown size={10} className={`transition-transform ${qOpen ? 'rotate-180' : ''}`} />
            </button>
            {qOpen && (
              <div className="absolute top-full mt-1 right-0 w-80 bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-y-auto max-h-[min(480px,70vh)]">
                {Object.entries(questions).map(([cat, qs]) => (
                  <div key={cat}>
                    <p className="px-3 py-2 text-[10px] font-bold text-indigo-600 uppercase tracking-wider bg-slate-50 border-b border-slate-100">
                      {cat}
                    </p>
                    {qs.map((q, i) => (
                      <button
                        key={i}
                        onClick={() => { setTopic(q); setQOpen(false) }}
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
          value={topic}
          onChange={e => setTopic(e.target.value)}
          rows={3}
          placeholder="e.g. Does the button at the crosswalk actually do anything, or is it a placebo?"
          className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-400 outline-none resize-none"
        />
      </div>

      {/* Controls */}
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 flex gap-6 flex-wrap">
        <SliderRow
          label="Turns" leftLabel="3" rightLabel="16"
          value={numTurns} onChange={setNumTurns} min={3} max={16}
        />
        <SliderRow
          label="Mood" leftLabel="😔 Gloomy" rightLabel="😄 Cheerful"
          value={mood} onChange={setMood}
        />
        <SliderRow
          label="Tone" leftLabel="🎓 Serious" rightLabel="😂 Hilarious"
          value={seriousness} onChange={setSeriousness}
        />
      </div>

      {/* Run / Stop / Reset */}
      <div className="flex items-center gap-3">
        <button
          onClick={streaming ? handleStop : () => handleRun(false)}
          disabled={!streaming && (!topic.trim() || agents.some(a => !a.systemPrompt))}
          className={`flex items-center gap-2 px-4 py-2 text-white text-sm font-semibold rounded-lg shadow transition-all disabled:opacity-50 ${
            streaming
              ? 'bg-red-500 hover:bg-red-400'
              : 'bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500'
          }`}
        >
          {streaming ? (
            <><X size={14} /> Stop</>
          ) : (
            <><Play size={14} /> Start Roundtable</>
          )}
        </button>
        {streaming && (
          <span className="text-xs text-slate-400 animate-pulse">Conversation in progress…</span>
        )}
        {!streaming && (turns.length > 0 || topic || convId) && (
          <button
            onClick={() => {
              setTurns([])
              setActiveTurn(null)
              setConvId(null)
              setFollowUp('')
              setTopic('')
              setError(null)
            }}
            className="flex items-center gap-1.5 px-3 py-2 text-slate-500 hover:text-slate-800 text-sm rounded-lg hover:bg-slate-100 transition-colors"
            title="Reset everything"
          >
            <RotateCcw size={13} /> Reset
          </button>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-600">{error}</div>
      )}

      {/* Output */}
      {hasOutput && (
        <div className="space-y-3">
          <div className="border-t border-slate-200 pt-4">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Conversation</p>

            {turns.map((turn, i) => {
              // "You" divider for follow-up questions
              if (turn.idx === -1) {
                return (
                  <div key={i} className="flex items-center gap-3 my-4">
                    <div className="flex-1 h-px bg-slate-200" />
                    <span className="text-xs font-semibold text-slate-500 bg-white px-2">
                      You: {turn.content}
                    </span>
                    <div className="flex-1 h-px bg-slate-200" />
                  </div>
                )
              }
              const c = COLORS[turn.idx % COLORS.length]
              return (
                <div key={i} className="flex gap-3 mb-4">
                  <div className={`shrink-0 w-7 h-7 rounded-full ${c.dot} flex items-center justify-center`}>
                    <span className="text-white text-[10px] font-bold">
                      {(turn.persona[0] ?? '?').toUpperCase()}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-1.5 mb-1">
                      <span className={`text-xs font-semibold ${c.label}`}>{turn.persona}</span>
                      <span className="text-[10px] text-slate-400 font-mono">{turn.model}</span>
                    </div>
                    <div className={`rounded-2xl rounded-tl-sm px-4 py-3 border text-sm text-slate-800 leading-relaxed ${c.bubble}`}>
                      <div className="prose-chat">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{turn.content}</ReactMarkdown>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}

            {/* Active (streaming) turn */}
            {activeTurn && (() => {
              const c = COLORS[activeTurn.idx % COLORS.length]
              return (
                <div className="flex gap-3 mb-4">
                  <div className={`shrink-0 w-7 h-7 rounded-full ${c.dot} flex items-center justify-center`}>
                    <span className="text-white text-[10px] font-bold">
                      {(activeTurn.persona[0] ?? '?').toUpperCase()}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-1.5 mb-1">
                      <span className={`text-xs font-semibold ${c.label}`}>{activeTurn.persona}</span>
                      <span className="text-[10px] text-slate-400 font-mono">{activeTurn.model}</span>
                    </div>
                    <div className={`rounded-2xl rounded-tl-sm px-4 py-3 border text-sm text-slate-800 leading-relaxed ${c.bubble}`}>
                      {activeTurn.content ? (
                        <div className="prose-chat">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{activeTurn.content}</ReactMarkdown>
                          <span className="inline-block w-0.5 h-4 bg-indigo-400 ml-0.5 animate-pulse" />
                        </div>
                      ) : (
                        <div className="flex gap-1.5">
                          {[0, 1, 2].map(j => (
                            <div key={j} className="w-2 h-2 rounded-full bg-slate-300 animate-bounce"
                              style={{ animationDelay: `${j * 0.15}s` }} />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })()}

            {/* Waiting for next speaker */}
            {streaming && !activeTurn && turns.length > 0 && (
              <div className="flex gap-3 mb-4">
                <div className="shrink-0 w-7 h-7 rounded-full bg-slate-300 flex items-center justify-center">
                  <div className="w-2 h-2 rounded-full bg-slate-500 animate-pulse" />
                </div>
                <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-sm px-4 py-3">
                  <div className="flex gap-1.5">
                    {[0, 1, 2].map(j => (
                      <div key={j} className="w-2 h-2 rounded-full bg-slate-300 animate-bounce"
                        style={{ animationDelay: `${j * 0.15}s` }} />
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>

    {/* ── Sticky follow-up bar ─────────────────────────────────── */}
    {!streaming && convId && (
      <div className="shrink-0 border-t border-slate-200 px-4 py-3 bg-white">
        <div className="flex gap-2 items-end">
          <textarea
            ref={followUpRef}
            value={followUp}
            onChange={e => setFollowUp(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleRun(true) } }}
            rows={2}
            placeholder="Ask a follow-up question… (Enter to send, Shift+Enter for new line)"
            className="flex-1 px-3 py-2 text-sm rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-400 outline-none resize-none"
          />
          <button
            onClick={() => handleRun(true)}
            disabled={!followUp.trim()}
            className="shrink-0 w-9 h-9 flex items-center justify-center bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-xl shadow transition-all"
          >
            <Play size={14} />
          </button>
        </div>
        <p className="text-[10px] text-slate-400 text-center mt-1">
          Enter ↵ sends · Shift+Enter for new line
        </p>
      </div>
    )}
    </div>
  )
}
