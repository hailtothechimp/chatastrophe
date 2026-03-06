import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { BookOpen, Info } from 'lucide-react'
import { updateConversation } from '../api'
import type { SamplingParams } from '../types'
import ParamReferenceModal from './ParamReferenceModal'

interface Props {
  params: SamplingParams
  provider: string
  paramSupport: Record<string, boolean>
  conversationId: string | null
  onChange: (p: SamplingParams) => void
}

interface SliderProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  disabled?: boolean
  onChange: (v: number) => void
  hint?: string
  tooltip?: string
}

function InfoTooltip({ text }: { text: string }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const ref = useRef<HTMLSpanElement>(null)

  return (
    <span
      ref={ref}
      className="inline-flex items-center"
      onMouseEnter={() => {
        if (ref.current) {
          const r = ref.current.getBoundingClientRect()
          setPos({ x: r.left, y: r.top + r.height / 2 })
        }
      }}
      onMouseLeave={() => setPos(null)}
    >
      <Info size={11} className="text-[var(--text-muted)] cursor-help ml-1 hover:text-[var(--accent)] transition-colors" />
      {pos && createPortal(
        <div
          style={{
            position: 'fixed',
            right: window.innerWidth - pos.x + 8,
            top: pos.y,
            transform: 'translateY(-50%)',
            zIndex: 9999,
          }}
          className="w-64 rounded-lg bg-slate-800 text-white text-xs leading-relaxed px-3 py-2.5 shadow-lg pointer-events-none"
        >
          {text}
        </div>,
        document.body
      )}
    </span>
  )
}

function Slider({ label, value, min, max, step, disabled, onChange, hint, tooltip }: SliderProps) {
  return (
    <div className={`space-y-1 ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
      <div className="flex justify-between items-center">
        <span className="flex items-center">
          <label className="text-xs font-medium text-[var(--text-secondary)]">{label}</label>
          {tooltip && <InfoTooltip text={tooltip} />}
        </span>
        <span className="text-xs font-mono text-[var(--accent-text)] bg-[var(--accent-light)] px-1.5 rounded">
          {Number.isInteger(step) ? value.toFixed(0) : value.toFixed(2)}
        </span>
      </div>
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        disabled={disabled}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full h-1.5 bg-[var(--panel-surface)] rounded-full appearance-none cursor-pointer accent-[var(--accent)]"
      />
      {hint && <p className="text-[10px] text-[var(--text-muted)] leading-tight">{hint}</p>}
    </div>
  )
}

export default function ParameterPanel({ params, provider, paramSupport, conversationId, onChange }: Props) {
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [refOpen, setRefOpen] = useState(false)

  function update(field: keyof SamplingParams, value: unknown) {
    const next = { ...params, [field]: value } as SamplingParams
    onChange(next)
    // Debounced save to DB
    if (conversationId) {
      if (saveTimeout.current) clearTimeout(saveTimeout.current)
      saveTimeout.current = setTimeout(() => {
        updateConversation(conversationId, { params: next }).catch(console.error)
      }, 600)
    }
  }

  // Cleanup timeout on unmount
  useEffect(() => () => { if (saveTimeout.current) clearTimeout(saveTimeout.current) }, [])

  const isOAI = provider === 'OpenAI (paid)'
  const isAnthropic = provider === 'Anthropic (paid)'

  return (
    <aside className="w-72 shrink-0 bg-[var(--panel-bg)] border-l border-[var(--panel-border)] flex flex-col h-full overflow-y-auto">
      <div className="px-4 py-3 border-b border-[var(--panel-border)] shrink-0">
        <h2 className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider">Sampling Parameters</h2>
        <p className="text-[10px] text-[var(--text-muted)] mt-0.5">{provider}</p>
      </div>

      <div className="flex-1 px-4 py-3 space-y-4 overflow-y-auto">
        {/* Sampling: Temperature / Top P */}
        <div>
          <p className="text-[10px] font-bold text-[var(--accent)] uppercase tracking-wider mb-2">Sampling</p>
          <div className="space-y-3">
            <Slider
              label="Temperature"
              value={params.temperature}
              min={0} max={isAnthropic ? 1 : 2} step={0.01}
              onChange={v => update('temperature', v)}
              hint={params.top_p < 1.0 ? 'Ignored — Top P active' : 'Primary creativity dial'}
              tooltip="Affects creativity. Set low for focused, predictable responses. Set high for more creative, surprising responses. 0.7 is a good starting point."
            />
            <Slider
              label="Top P"
              value={params.top_p}
              min={0} max={1} step={0.01}
              onChange={v => update('top_p', v)}
              hint={params.top_p < 1.0 ? '✓ Active — temperature ignored' : 'Slide below 1.0 to activate'}
              tooltip="Affects creativity. Set low for more robotic, predictable responses. Set high for more creative responses. No impact at 1.0."
            />
            <Slider
              label="Top K"
              value={params.top_k}
              min={0} max={500} step={1}
              disabled={!paramSupport.top_k}
              onChange={v => update('top_k', v)}
              hint="Anthropic only. 0 = disabled"
              tooltip="Affects response variety. Set low for more focused, repetitive responses. Set high for more varied responses. 0 = disabled. Anthropic only."
            />
          </div>
        </div>

        {/* Output */}
        <div>
          <p className="text-[10px] font-bold text-[var(--accent)] uppercase tracking-wider mb-2">Output</p>
          <Slider
            label="Max Tokens"
            value={params.max_tokens}
            min={1} max={4096} step={1}
            onChange={v => update('max_tokens', v)}
            tooltip="Controls maximum response length. Set low for shorter responses. Set high to allow longer responses. Increase if responses are getting cut off."
          />
        </div>

        {/* Repetition */}
        <div>
          <p className="text-[10px] font-bold text-[var(--accent)] uppercase tracking-wider mb-2">Repetition</p>
          <div className="space-y-3">
            <Slider
              label="Frequency Penalty"
              value={params.freq_penalty}
              min={-2} max={2} step={0.01}
              disabled={!paramSupport.freq_penalty}
              onChange={v => update('freq_penalty', v)}
              hint="Penalises tokens by how often they've appeared"
              tooltip="Affects repetition. Set low to allow repeated words and phrases. Set high to discourage repetition. Above 1.5 responses may start to feel stilted."
            />
            <Slider
              label="Presence Penalty"
              value={params.pres_penalty}
              min={-2} max={2} step={0.01}
              disabled={!paramSupport.pres_penalty}
              onChange={v => update('pres_penalty', v)}
              hint="Flat penalty for any previously-used token"
              tooltip="Affects topic variety. Set low to keep responses focused on the subject. Set high for more wide-ranging, topic-hopping responses."
            />
          </div>
        </div>

        {/* Reproducibility */}
        <div>
          <p className="text-[10px] font-bold text-[var(--accent)] uppercase tracking-wider mb-2">Reproducibility</p>
          <div className="space-y-2">
            <label className={`flex items-center gap-2 cursor-pointer ${!paramSupport.seed ? 'opacity-40 pointer-events-none' : ''}`}>
              <input
                type="checkbox"
                checked={params.use_seed}
                onChange={e => update('use_seed', e.target.checked)}
                className="accent-indigo-600"
              />
              <span className="flex items-center text-xs text-[var(--text-secondary)]">
                Fix Seed {!paramSupport.seed && '(OpenAI only)'}
                <InfoTooltip text="Same prompt, same response every time. Good for comparing results when you change other settings. OpenAI only." />
              </span>
            </label>
            {params.use_seed && (
              <input
                type="number"
                value={params.seed}
                onChange={e => update('seed', parseInt(e.target.value))}
                disabled={!paramSupport.seed}
                className="w-full px-2 py-1 text-xs rounded border border-[var(--panel-border)] bg-[var(--main-bg)] text-[var(--text-primary)] focus:ring-1 focus:ring-[var(--accent)] outline-none"
                placeholder="42"
              />
            )}
          </div>
        </div>

        {/* Stop sequences */}
        <div>
          <span className="flex items-center gap-0.5 mb-2">
            <p className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider">Stop Sequences</p>
            <InfoTooltip text="The model stops the moment it outputs one of these strings. Comma-separate multiple values." />
          </span>
          <input
            type="text"
            value={params.stop_sequences}
            onChange={e => update('stop_sequences', e.target.value)}
            className="w-full px-2 py-1.5 text-xs rounded border border-[var(--panel-border)] bg-[var(--main-bg)] text-[var(--text-primary)] focus:ring-1 focus:ring-[var(--accent)] outline-none"
            placeholder="e.g.  END, \n\n"
          />
          <p className="text-[10px] text-[var(--text-muted)] mt-1">Comma-separated. Generation halts on match.</p>
        </div>

        {/* Logprobs note */}
        {isOAI && (
          <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2">
            <p className="text-[10px] text-amber-700 font-medium">Token Heatmap</p>
            <p className="text-[10px] text-amber-600 mt-0.5">
              Enable per-message in the chat input bar. OpenAI only, disables streaming.
            </p>
          </div>
        )}
      </div>

      {/* Parameter reference button */}
      <div className="px-4 py-3 border-t border-[var(--panel-border)] shrink-0">
        <button
          onClick={() => setRefOpen(true)}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs text-[var(--text-secondary)] hover:text-[var(--accent)] hover:bg-[var(--accent-light)] transition-colors"
        >
          <BookOpen size={13} />
          Parameter Reference
        </button>
      </div>

      {refOpen && <ParamReferenceModal onClose={() => setRefOpen(false)} />}
    </aside>
  )
}
