import { useState, useRef, useEffect } from 'react'
import { Play, X, RotateCcw, Scale, Trophy, Sparkles, ChevronDown } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { createThrowdownSession, streamThrowdownRound, getQuestions, getPersonas } from '../api'
import type { Persona } from '../api'
import type { MetaInfo } from '../types'

interface AgentConfig {
  persona: string
  systemPrompt: string
  provider: string
  model: string
}

interface RoundEntry {
  roundNum: number
  prompt: string
  responses: { persona: string; content: string }[]
  judgeContent: string
  winner: string | null      // display label of winner
  winnerIdx: number | null   // slot index (for column highlighting)
}

interface ActiveRound {
  roundNum: number
  prompt: string
  responses: { persona: string; content: string }[]
  judgeContent: string
  activeContestantIdx: number | null
  judgeStreaming: boolean
}

interface Props {
  meta: MetaInfo | null
}

// Agent card colors by slot index (0-3)
const SLOT_COLORS = [
  { dot: 'bg-indigo-500',  bubble: 'bg-indigo-50 border-indigo-200',  label: 'text-indigo-700'  },
  { dot: 'bg-violet-500',  bubble: 'bg-violet-50 border-violet-200',  label: 'text-violet-700'  },
  { dot: 'bg-emerald-500', bubble: 'bg-emerald-50 border-emerald-200', label: 'text-emerald-700' },
  { dot: 'bg-amber-500',   bubble: 'bg-amber-50 border-amber-200',   label: 'text-amber-700'   },
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

export default function ThrowdownView({ meta }: Props) {
  const [phase, setPhase] = useState<'setup' | 'playing' | 'complete'>('setup')
  const [judgeIdx, setJudgeIdx] = useState(0)
  const [agents, setAgents] = useState<AgentConfig[]>(() => [
    defaultAgent(meta), defaultAgent(meta), defaultAgent(meta), defaultAgent(meta),
  ])
  const [numRounds, setNumRounds] = useState(5)
  const [sessionId, setSessionId] = useState<number | null>(null)
  const [currentRound, setCurrentRound] = useState(1)
  const [scores, setScores] = useState<Record<string, number>>({})
  const [prompt, setPrompt] = useState('')
  const [rounds, setRounds] = useState<RoundEntry[]>([])
  const [activeRound, setActiveRound] = useState<ActiveRound | null>(null)
  const [streaming, setStreaming] = useState(false)
  const [champion, setChampion] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [personas, setPersonas] = useState<Persona[]>([])
  const [questions, setQuestions] = useState<Record<string, string[]>>({})
  const [qOpen, setQOpen] = useState(false)

  const streamPhaseRef = useRef<'contestant' | 'judge'>('contestant')
  const activeContestantIdxRef = useRef(0)
  const queuedPromptsRef = useRef<string[]>([])
  const abortRef = useRef<AbortController | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const qRef = useRef<HTMLDivElement>(null)
  const promptRef = useRef<HTMLTextAreaElement>(null)

  // Derived: contestants are the 3 non-judge agents, in slot order
  const contestants = agents.filter((_, i) => i !== judgeIdx)
  const contestantSlotIndices = agents.map((_, i) => i).filter(i => i !== judgeIdx)
  const judge = agents[judgeIdx]

  // Display labels — append short model name when two contestants share a persona
  const personaCounts = contestants.reduce((acc, c) => {
    acc[c.persona] = (acc[c.persona] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)
  function shortModel(m: string) {
    const parts = m.replace(/-/g, ' ').split(' ')
    return parts.slice(0, 3).join(' ')
  }
  const displayLabels = contestants.map(c =>
    (personaCounts[c.persona] ?? 0) > 1 ? `${c.persona} (${shortModel(c.model)})` : c.persona
  )

  useEffect(() => {
    getQuestions().then(setQuestions).catch(console.error)
    getPersonas().then(setPersonas).catch(console.error)
  }, [])

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (qRef.current && !qRef.current.contains(e.target as Node)) setQOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [rounds, activeRound?.responses, activeRound?.judgeContent])

  function setAgent(i: number, patch: Partial<AgentConfig>) {
    setAgents(prev => prev.map((a, idx) => idx === i ? { ...a, ...patch } : a))
  }

  async function handleStartSession() {
    if (agents.some(a => !a.persona || !a.systemPrompt)) {
      setError('Please pick a persona for all 4 agents.')
      return
    }
    setError(null)
    try {
      const result = await createThrowdownSession({
        judge: { persona: judge.persona, system_prompt: judge.systemPrompt, provider: judge.provider, model: judge.model },
        contestants: contestants.map(c => ({ persona: c.persona, system_prompt: c.systemPrompt, provider: c.provider, model: c.model })),
        num_rounds: numRounds,
      })

      // Sample numRounds questions from the bank, shuffle, queue them up
      const allQ = Object.values(questions).flat()
      const shuffled = [...allQ].sort(() => Math.random() - 0.5)
      queuedPromptsRef.current = shuffled.slice(0, numRounds)

      setSessionId(result.session_id)
      setCurrentRound(1)
      setScores({})
      setRounds([])
      setActiveRound(null)
      setChampion(null)
      setPrompt(queuedPromptsRef.current[0] ?? '')
      setPhase('playing')
      setTimeout(() => promptRef.current?.focus(), 50)
    } catch (err) {
      setError(String(err))
    }
  }

  async function handleRunRound() {
    if (!prompt.trim() || !sessionId) return
    setError(null)
    setStreaming(true)
    streamPhaseRef.current = 'contestant'

    setActiveRound({
      roundNum: currentRound,
      prompt: prompt.trim(),
      responses: contestants.map(c => ({ persona: c.persona, content: '' })),
      judgeContent: '',
      activeContestantIdx: null,
      judgeStreaming: false,
    })

    const abort = new AbortController()
    abortRef.current = abort

    try {
      for await (const event of streamThrowdownRound(
        { session_id: sessionId, round_num: currentRound, prompt: prompt.trim() },
        abort.signal,
      )) {
        if (event.type === 'contestant_start') {
          const idx = event.idx as number
          activeContestantIdxRef.current = idx
          setActiveRound(prev => prev ? { ...prev, activeContestantIdx: idx } : prev)
        } else if (event.type === 'token') {
          if (streamPhaseRef.current === 'contestant') {
            const idx = activeContestantIdxRef.current
            setActiveRound(prev => {
              if (!prev) return prev
              const responses = prev.responses.map((r, i) =>
                i === idx ? { ...r, content: r.content + (event.content as string) } : r
              )
              return { ...prev, responses }
            })
          } else {
            setActiveRound(prev =>
              prev ? { ...prev, judgeContent: prev.judgeContent + (event.content as string) } : prev
            )
          }
        } else if (event.type === 'contestant_end') {
          setActiveRound(prev => prev ? { ...prev, activeContestantIdx: null } : prev)
        } else if (event.type === 'judge_start') {
          streamPhaseRef.current = 'judge'
          setActiveRound(prev => prev ? { ...prev, judgeStreaming: true } : prev)
        } else if (event.type === 'judge_end') {
          setActiveRound(prev => prev ? { ...prev, judgeStreaming: false } : prev)
        } else if (event.type === 'result') {
          const winnerIdx = event.winner_idx as number | null
          const winner = event.winner as string | null
          const newScores = event.scores as Record<string, number>
          setScores(newScores)
          setActiveRound(prev => {
            if (prev) {
              setRounds(r => [...r, {
                roundNum: prev.roundNum,
                prompt: prev.prompt,
                responses: prev.responses,
                judgeContent: prev.judgeContent,
                winner,
                winnerIdx,
              }])
            }
            return null
          })
          // currentRound (captured) = round that just finished; next prompt is at that same index
          setPrompt(queuedPromptsRef.current[currentRound] ?? '')
          setCurrentRound(r => r + 1)
          setTimeout(() => promptRef.current?.focus(), 50)
        } else if (event.type === 'session_complete') {
          setChampion(event.champion as string | null)
          setPhase('complete')
        } else if (event.type === 'error') {
          setError(event.content as string)
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') setError(String(err))
    } finally {
      setStreaming(false)
      setActiveRound(null)
    }
  }

  function handleStop() {
    abortRef.current?.abort()
    setStreaming(false)
    setActiveRound(null)
  }

  function handleReset() {
    setPhase('setup')
    setSessionId(null)
    setCurrentRound(1)
    setScores({})
    setRounds([])
    setActiveRound(null)
    setChampion(null)
    setPrompt('')
    setError(null)
  }

  // ── Setup phase ────────────────────────────────────────────────────────────
  if (phase === 'setup') {
    return (
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
        {/* Header */}
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <Scale size={18} className="text-indigo-600" />
            <h2 className="text-base font-semibold text-slate-800">Throwdown</h2>
          </div>
          <p className="text-sm text-slate-500">
            Pick 4 personas. Designate one as Judge — they score each round. The other 3 compete for points.
          </p>
        </div>

        {/* Agent cards */}
        <div className="flex gap-3 flex-wrap">
          {agents.map((agent, i) => {
            const isJudge = i === judgeIdx
            const c = SLOT_COLORS[i]
            const models = meta?.model_lists[agent.provider] ?? []
            const contIdx = contestantSlotIndices.indexOf(i)
            const roleLabel = isJudge ? 'Judge' : `Contestant ${contIdx + 1}`
            return (
              <div
                key={i}
                className={`flex-1 min-w-[180px] rounded-xl border-2 p-3 space-y-2 transition-colors ${
                  isJudge
                    ? 'bg-amber-50 border-amber-400'
                    : `${c.bubble}`
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className={`w-2.5 h-2.5 rounded-full ${isJudge ? 'bg-amber-500' : c.dot}`} />
                    <span className={`text-xs font-semibold ${isJudge ? 'text-amber-700' : c.label}`}>
                      {agent.persona || roleLabel}
                    </span>
                  </div>
                  {!isJudge && (
                    <button
                      onClick={() => setJudgeIdx(i)}
                      title="Make this persona the Judge"
                      className="text-slate-300 hover:text-amber-500 transition-colors"
                    >
                      <Scale size={12} />
                    </button>
                  )}
                  {isJudge && (
                    <span className="text-[10px] font-bold text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded-full">
                      JUDGE
                    </span>
                  )}
                </div>

                {/* Persona picker */}
                <select
                  value={agent.persona}
                  onChange={e => {
                    const p = personas.find(p => p.persona === e.target.value)
                    setAgent(i, { persona: e.target.value, systemPrompt: p?.system_prompt ?? '' })
                  }}
                  className="w-full px-2 py-1 text-xs rounded-lg border border-slate-300 bg-white outline-none focus:ring-1 focus:ring-indigo-400"
                >
                  <option value="">— Pick a persona —</option>
                  {personas.map(p => (
                    <option key={p.persona} value={p.persona}>{p.persona}</option>
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
        </div>

        {/* Rounds slider */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 max-w-sm">
          <SliderRow label="Rounds" leftLabel="3" rightLabel="10" value={numRounds} onChange={setNumRounds} min={3} max={10} />
        </div>

        {/* Start button */}
        <button
          onClick={handleStartSession}
          disabled={agents.some(a => !a.persona || !a.systemPrompt)}
          className="flex items-center gap-2 px-4 py-2 text-white text-sm font-semibold rounded-lg shadow transition-all disabled:opacity-50 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500"
        >
          <Play size={14} /> Start Throwdown
        </button>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-600">{error}</div>
        )}
      </div>
    )
  }

  // ── Complete phase ─────────────────────────────────────────────────────────
  if (phase === 'complete') {
    const sortedEntries = contestants
      .map((c, i) => ({ c, i, wins: scores[String(i)] ?? 0, label: displayLabels[i] }))
      .sort((a, b) => b.wins - a.wins)
    return (
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
        <div className="rounded-2xl border-2 border-amber-400 bg-amber-50 p-6 text-center space-y-2">
          <Trophy size={32} className="text-amber-500 mx-auto" />
          <h2 className="text-xl font-bold text-slate-800">Throwdown Complete!</h2>
          {champion && sortedEntries.length > 0 && (
            <p className="text-sm text-slate-600">
              Champion: <span className="font-bold text-amber-700">{champion}</span>
              {' '}with {sortedEntries[0].wins} win{sortedEntries[0].wins !== 1 ? 's' : ''}
            </p>
          )}
        </div>

        {/* Final scoreboard */}
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-2 bg-slate-50 border-b border-slate-200">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Final Scores</span>
          </div>
          {sortedEntries.map(({ i, wins, label }, rank) => {
            const slotIdx = contestantSlotIndices[i]
            const col = SLOT_COLORS[slotIdx >= 0 ? slotIdx : i]
            return (
              <div key={i} className="flex items-center justify-between px-4 py-3 border-b border-slate-100 last:border-0">
                <div className="flex items-center gap-2">
                  {rank === 0 && <Trophy size={14} className="text-amber-500" />}
                  <span className={`w-2.5 h-2.5 rounded-full ${col.dot}`} />
                  <span className="text-sm font-medium text-slate-700">{label}</span>
                </div>
                <span className={`text-sm font-bold ${rank === 0 ? 'text-amber-600' : 'text-slate-500'}`}>
                  {wins} win{wins !== 1 ? 's' : ''}
                </span>
              </div>
            )
          })}
        </div>

        {/* Round history */}
        {rounds.length > 0 && (
          <RoundHistory rounds={rounds} judge={judge} contestants={contestants} contestantSlotIndices={contestantSlotIndices} displayLabels={displayLabels} />
        )}

        <button
          onClick={handleReset}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 rounded-lg hover:bg-slate-100 transition-colors"
        >
          <RotateCcw size={14} /> New Session
        </button>
      </div>
    )
  }

  // ── Playing phase ──────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">

      {/* Sticky header: round indicator + scoreboard */}
      <div className="shrink-0 border-b border-slate-200 px-6 py-2.5 bg-slate-50 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <span className="text-sm font-semibold text-slate-700">
            Round {Math.min(currentRound, numRounds)} of {numRounds}
          </span>
          <div className="flex gap-4">
            {contestants.map((c, i) => {
              const slotIdx = contestantSlotIndices[i]
              const col = SLOT_COLORS[slotIdx]
              const wins = scores[String(i)] ?? 0
              return (
                <div key={i} className="flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${col.dot}`} />
                  <span className={`text-xs font-semibold ${col.label}`}>{displayLabels[i]}</span>
                  <span className="text-xs font-bold text-slate-600 tabular-nums">{wins}</span>
                </div>
              )
            })}
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          <span className="w-2 h-2 rounded-full bg-amber-400" />
          <span>Judge: {judge.persona}</span>
        </div>
      </div>

      {/* Prompt input bar */}
      <div className="shrink-0 border-b border-slate-100 px-6 py-3 bg-white">
        <div className="flex items-end gap-2">
          <div className="flex-1 flex items-end gap-2 border-2 border-slate-300 focus-within:border-indigo-400 rounded-2xl px-3 py-2 transition-colors">
            <textarea
              ref={promptRef}
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleRunRound() } }}
              disabled={streaming}
              rows={2}
              placeholder={streaming ? 'Round in progress…' : `Round ${currentRound}: Enter a prompt for the contestants… (Enter to send)`}
              className="flex-1 resize-none bg-transparent text-sm text-slate-800 placeholder:text-slate-400 outline-none leading-relaxed"
            />
          </div>

          {/* Question ideas */}
          <div className="relative shrink-0" ref={qRef}>
            <button
              onClick={() => setQOpen(o => !o)}
              className="flex items-center gap-1 text-xs text-slate-500 hover:text-indigo-600 transition-colors px-2 py-2"
            >
              <Sparkles size={13} />
              <ChevronDown size={10} className={`transition-transform ${qOpen ? 'rotate-180' : ''}`} />
            </button>
            {qOpen && (
              <div className="absolute bottom-full mb-2 right-0 w-80 bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-y-auto max-h-[min(480px,70vh)]">
                {Object.entries(questions).map(([cat, qs]) => (
                  <div key={cat}>
                    <p className="px-3 py-2 text-[10px] font-bold text-indigo-600 uppercase tracking-wider bg-slate-50 border-b border-slate-100">
                      {cat}
                    </p>
                    {qs.map((q, i) => (
                      <button
                        key={i}
                        onClick={() => { setPrompt(q); setQOpen(false); promptRef.current?.focus() }}
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

          <button
            onClick={streaming ? handleStop : handleRunRound}
            disabled={!streaming && !prompt.trim()}
            className={`shrink-0 flex items-center gap-1.5 px-3 py-2 text-white text-sm font-semibold rounded-xl shadow transition-all disabled:opacity-50 ${
              streaming
                ? 'bg-red-500 hover:bg-red-400'
                : 'bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500'
            }`}
          >
            {streaming ? <><X size={13} /> Stop</> : <><Play size={13} /> Run</>}
          </button>

          <button
            onClick={handleReset}
            title="Reset session"
            className="shrink-0 p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
          >
            <RotateCcw size={14} />
          </button>
        </div>
      </div>

      {/* Scrollable rounds output */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-600">{error}</div>
        )}

        {rounds.length === 0 && !activeRound && !streaming && (
          <p className="text-sm text-slate-400 italic text-center mt-10">
            Enter a prompt above to start Round 1.
          </p>
        )}

        {/* Completed rounds */}
        {rounds.map(round => (
          <CompletedRoundCard
            key={round.roundNum}
            round={round}
            judge={judge}
            contestants={contestants}
            contestantSlotIndices={contestantSlotIndices}
            displayLabels={displayLabels}
          />
        ))}

        {/* Active (streaming) round */}
        {activeRound && (
          <ActiveRoundCard
            round={activeRound}
            judge={judge}
            contestants={contestants}
            contestantSlotIndices={contestantSlotIndices}
            displayLabels={displayLabels}
          />
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function CompletedRoundCard({
  round, judge, contestants, contestantSlotIndices, displayLabels,
}: {
  round: RoundEntry
  judge: AgentConfig
  contestants: AgentConfig[]
  contestantSlotIndices: number[]
  displayLabels: string[]
}) {
  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden">
      {/* Round header */}
      <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 flex items-center gap-3">
        <span className="text-xs font-bold text-slate-500">Round {round.roundNum}</span>
        <span className="text-xs text-slate-500 italic flex-1 truncate">"{round.prompt}"</span>
        {round.winner && (
          <span className="text-xs font-semibold text-amber-600 flex items-center gap-1 shrink-0">
            <Trophy size={11} /> {round.winner}
          </span>
        )}
        {round.winner === null && (
          <span className="text-xs text-slate-400 shrink-0">No verdict</span>
        )}
      </div>

      {/* 3-column contestant responses */}
      <div className="grid grid-cols-3 divide-x divide-slate-200">
        {round.responses.map((r, i) => {
          const slotIdx = contestantSlotIndices[i]
          const col = SLOT_COLORS[slotIdx]
          const isWinner = i === round.winnerIdx
          return (
            <div key={i} className={`p-3 ${isWinner ? 'bg-amber-50' : 'bg-white'}`}>
              <div className="flex items-center gap-1.5 mb-2">
                <span className={`w-2 h-2 rounded-full ${col.dot}`} />
                <span className={`text-xs font-semibold ${col.label} flex-1`}>{displayLabels[i]}</span>
                {isWinner && <Trophy size={11} className="text-amber-500 shrink-0" />}
              </div>
              <div className="text-xs text-slate-700 leading-relaxed prose-chat">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{r.content}</ReactMarkdown>
              </div>
            </div>
          )
        })}
      </div>

      {/* Judge verdict */}
      {round.judgeContent && (
        <div className="border-t border-amber-200 px-4 py-3 bg-amber-50">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="w-2 h-2 rounded-full bg-amber-500" />
            <span className="text-xs font-semibold text-amber-700">{judge.persona} (Judge)</span>
          </div>
          <div className="text-xs text-slate-700 leading-relaxed">{round.judgeContent}</div>
        </div>
      )}
    </div>
  )
}

function ActiveRoundCard({
  round, judge, contestants, contestantSlotIndices, displayLabels,
}: {
  round: ActiveRound
  judge: AgentConfig
  contestants: AgentConfig[]
  contestantSlotIndices: number[]
  displayLabels: string[]
}) {
  return (
    <div className="rounded-xl border-2 border-indigo-200 overflow-hidden">
      {/* Round header */}
      <div className="px-4 py-2 bg-indigo-50 border-b border-indigo-200 flex items-center gap-3">
        <span className="text-xs font-bold text-indigo-600">Round {round.roundNum}</span>
        <span className="text-xs text-slate-500 italic flex-1 truncate">"{round.prompt}"</span>
        <span className="text-xs text-indigo-400 animate-pulse">In progress…</span>
      </div>

      {/* 3-column responses */}
      <div className="grid grid-cols-3 divide-x divide-slate-200">
        {round.responses.map((r, i) => {
          const slotIdx = contestantSlotIndices[i]
          const col = SLOT_COLORS[slotIdx]
          const isActive = round.activeContestantIdx === i
          const isDone = !isActive && r.content.length > 0
          const isWaiting = !isActive && !isDone && (round.activeContestantIdx !== null ? i > (round.activeContestantIdx ?? -1) : true)
          return (
            <div key={i} className="p-3 bg-white">
              <div className="flex items-center gap-1.5 mb-2">
                <span className={`w-2 h-2 rounded-full ${col.dot} ${isActive ? 'animate-pulse' : ''}`} />
                <span className={`text-xs font-semibold ${col.label}`}>{displayLabels[i]}</span>
              </div>
              {r.content ? (
                <div className="text-xs text-slate-700 leading-relaxed prose-chat">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{r.content}</ReactMarkdown>
                  {isActive && <span className="inline-block w-0.5 h-3 bg-indigo-400 ml-0.5 animate-pulse" />}
                </div>
              ) : isActive ? (
                <div className="flex gap-1.5">
                  {[0, 1, 2].map(j => (
                    <div key={j} className={`w-1.5 h-1.5 rounded-full ${col.dot} animate-bounce`}
                      style={{ animationDelay: `${j * 0.15}s` }} />
                  ))}
                </div>
              ) : isWaiting ? (
                <span className="text-xs text-slate-300">Waiting…</span>
              ) : null}
            </div>
          )
        })}
      </div>

      {/* Judge streaming */}
      {(round.judgeStreaming || round.judgeContent) && (
        <div className="border-t border-amber-200 px-4 py-3 bg-amber-50">
          <div className="flex items-center gap-1.5 mb-1">
            <span className={`w-2 h-2 rounded-full bg-amber-500 ${round.judgeStreaming ? 'animate-pulse' : ''}`} />
            <span className="text-xs font-semibold text-amber-700">{judge.persona} (Judge)</span>
          </div>
          {round.judgeContent ? (
            <div className="text-xs text-slate-700 leading-relaxed">
              {round.judgeContent}
              {round.judgeStreaming && <span className="inline-block w-0.5 h-3 bg-amber-500 ml-0.5 animate-pulse" />}
            </div>
          ) : (
            <div className="flex gap-1.5">
              {[0, 1, 2].map(j => (
                <div key={j} className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-bounce"
                  style={{ animationDelay: `${j * 0.15}s` }} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function RoundHistory({
  rounds, judge, contestants, contestantSlotIndices, displayLabels,
}: {
  rounds: RoundEntry[]
  judge: AgentConfig
  contestants: AgentConfig[]
  contestantSlotIndices: number[]
  displayLabels: string[]
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors"
      >
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
          Round History ({rounds.length} rounds)
        </span>
        <ChevronDown size={14} className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="space-y-4 p-4">
          {rounds.map(round => (
            <CompletedRoundCard
              key={round.roundNum}
              round={round}
              judge={judge}
              contestants={contestants}
              contestantSlotIndices={contestantSlotIndices}
              displayLabels={displayLabels}
            />
          ))}
        </div>
      )}
    </div>
  )
}
