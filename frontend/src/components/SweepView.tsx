import { useState, useEffect, useRef } from 'react'
import { Play, ChevronDown, Sparkles } from 'lucide-react'
import { runSweep, getQuestions } from '../api'
import type { MetaInfo, SamplingParams, SweepResult } from '../types'
import { DEFAULT_PARAMS } from '../types'
import PersonaPicker from './PersonaPicker'

interface Props {
  meta: MetaInfo | null
  defaultProvider: string
  defaultModel: string
  defaultParams: SamplingParams
}

export default function SweepView({ meta, defaultProvider, defaultModel, defaultParams }: Props) {
  const [provider, setProvider] = useState(defaultProvider)
  const [model, setModel] = useState(defaultModel)
  const [systemPrompt, setSystemPrompt] = useState("You are a helpful, concise assistant.")
  const [userMessage, setUserMessage] = useState("What makes this number unique: 8,549,176,320?")
  const [sweepParam, setSweepParam] = useState('Temperature')
  const [values, setValues] = useState([0.0, 0.5, 1.0, 1.5])
  const [results, setResults] = useState<SweepResult[] | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
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

  const sweepParams = meta?.sweep_params ?? {}
  const providers   = meta?.providers ?? []
  const models      = meta?.model_lists[provider] ?? []

  useEffect(() => {
    setProvider(defaultProvider)
    setModel(defaultModel)
  }, [defaultProvider, defaultModel])

  useEffect(() => {
    if (sweepParams[sweepParam]) {
      setValues(sweepParams[sweepParam].defaults)
    }
  }, [sweepParam])

  useEffect(() => {
    const ms = meta?.model_lists[provider]
    if (ms && !ms.includes(model)) setModel(ms[0] ?? model)
  }, [provider])

  async function handleRun() {
    if (!userMessage.trim()) return
    setRunning(true)
    setError(null)
    setResults(null)
    try {
      const res = await runSweep({
        provider, model,
        system_prompt: systemPrompt,
        user_message: userMessage,
        sweep_param: sweepParam,
        values,
        base_params: { ...DEFAULT_PARAMS, ...defaultParams },
      })
      setResults(res)
    } catch (err) {
      setError(String(err))
    } finally {
      setRunning(false)
    }
  }

  const cfg = sweepParams[sweepParam]

  return (
    <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold text-slate-800 mb-0.5">Parameter Sweep</h2>
        <p className="text-sm text-slate-500">
          Send the same prompt at four values of any parameter simultaneously to compare outputs.
        </p>
      </div>

      {/* Provider + Model */}
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="block text-xs font-medium text-slate-600 mb-1">Provider</label>
          <select
            value={provider}
            onChange={e => setProvider(e.target.value)}
            className="w-full px-2 py-1.5 text-sm rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-400 outline-none bg-white"
          >
            {providers.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className="flex-1">
          <label className="block text-xs font-medium text-slate-600 mb-1">Model</label>
          <select
            value={model}
            onChange={e => setModel(e.target.value)}
            className="w-full px-2 py-1.5 text-sm rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-400 outline-none bg-white"
          >
            {models.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      </div>

      {/* Prompts */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium text-slate-600">System Prompt</label>
          <PersonaPicker onSelect={prompt => setSystemPrompt(prompt)} />
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
          rows={3}
          className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-400 outline-none resize-none"
        />
      </div>

      {/* Sweep parameter */}
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Parameter to Sweep</label>
        <select
          value={sweepParam}
          onChange={e => setSweepParam(e.target.value)}
          className="w-full px-2 py-1.5 text-sm rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-400 outline-none bg-white max-w-xs"
        >
          {Object.keys(sweepParams).map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      {/* Value sliders */}
      {cfg && (
        <div className="grid grid-cols-4 gap-3">
          {values.map((v, i) => (
            <div key={i} className="space-y-1">
              <div className="flex justify-between items-baseline">
                <label className="text-xs text-slate-600">Value {i + 1}</label>
                <span className="text-xs font-mono text-indigo-600 bg-indigo-50 px-1 rounded">
                  {Number.isInteger(cfg.step) ? v.toFixed(0) : v.toFixed(2)}
                </span>
              </div>
              <input
                type="range"
                min={cfg.minimum} max={cfg.maximum} step={cfg.step}
                value={v}
                onChange={e => {
                  const next = [...values]
                  next[i] = parseFloat(e.target.value)
                  setValues(next)
                }}
                className="w-full h-1.5 accent-indigo-600"
              />
            </div>
          ))}
        </div>
      )}

      {/* Run button */}
      <button
        onClick={handleRun}
        disabled={running || !userMessage.trim()}
        className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-sm font-semibold rounded-lg shadow transition-all disabled:opacity-50"
      >
        <Play size={14} />
        {running ? 'Running sweep…' : 'Run Sweep'}
      </button>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-600">{error}</div>
      )}

      {/* Results grid */}
      {results && (
        <div className="grid grid-cols-2 gap-4">
          {results.map((r, i) => (
            <div key={i} className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
              <div className="px-3 py-2 bg-indigo-50 border-b border-indigo-100 flex justify-between items-center">
                <span className="text-xs font-semibold text-indigo-700">
                  {sweepParam} = {typeof r.value === 'number' && !Number.isInteger(cfg?.step) ? r.value.toFixed(2) : r.value}
                </span>
                {r.latency_s && (
                  <span className="text-[10px] text-slate-400">⏱ {r.latency_s}s · {r.tokens ?? '?'} tokens</span>
                )}
              </div>
              <div className="px-3 py-3 text-sm text-slate-700 whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto">
                {r.error ? (
                  <span className="text-red-500">{r.error}</span>
                ) : (
                  r.text
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
