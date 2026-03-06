import { useState, useEffect, useRef, KeyboardEvent } from 'react'
import { Send, ChevronDown, Sparkles, Zap, Settings } from 'lucide-react'
import { getQuestions } from '../api'
import QuestionManager from './QuestionManager'

interface Props {
  onSend: (text: string, numRuns: number, showLogprobs: boolean) => void
  disabled?: boolean
  supportsLogprobs?: boolean
}

export default function InputBar({ onSend, disabled, supportsLogprobs }: Props) {
  const [text, setText] = useState('')
  const [numRuns, setNumRuns] = useState(1)
  const [showLogprobs, setShowLogprobs] = useState(false)
  const [questions, setQuestions] = useState<Record<string, string[]>>({})
  const [qOpen, setQOpen] = useState(false)
  const [managerOpen, setManagerOpen] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const qRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    getQuestions().then(setQuestions).catch(console.error)
  }, [refreshKey])

  // Close question picker on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (qRef.current && !qRef.current.contains(e.target as Node)) setQOpen(false)
    }
    if (qOpen) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [qOpen])

  function handleSend() {
    if (!text.trim() || disabled) return
    onSend(text.trim(), numRuns, showLogprobs)
    setText('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  function autoResize(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setText(e.target.value)
    const ta = e.target
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px'
  }

  return (
    <div className="px-4 pb-4 pt-2 bg-[var(--main-bg)] shrink-0">
      {/* Options bar */}
      <div className="flex items-center gap-3 mb-2 px-1">
        {/* Question picker */}
        <div className="relative" ref={qRef}>
          <button
            onClick={() => setQOpen(o => !o)}
            className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
          >
            <Sparkles size={13} />
            Question ideas
            <ChevronDown size={11} className={`transition-transform ${qOpen ? 'rotate-180' : ''}`} />
          </button>
          <button
            onClick={() => { setQOpen(false); setManagerOpen(true) }}
            className="text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
            title="Manage question bank"
          >
            <Settings size={12} />
          </button>
          {qOpen && (
            <div className="absolute bottom-full mb-2 left-0 w-80 bg-[var(--header-bg)] border border-[var(--panel-border)] rounded-xl shadow-xl z-50 overflow-y-auto max-h-[min(480px,70vh)]">
              {Object.entries(questions).map(([cat, qs]) => (
                <div key={cat}>
                  <p className="px-3 py-2 text-[10px] font-bold text-[var(--accent)] uppercase tracking-wider bg-[var(--surface)] border-b border-[var(--panel-border)]">
                    {cat}
                  </p>
                  {qs.map((q, i) => (
                    <button
                      key={i}
                      onClick={() => { setText(q); setQOpen(false); textareaRef.current?.focus() }}
                      className="w-full text-left px-3 py-2 text-xs text-[var(--text-primary)] hover:bg-[var(--accent-light)] hover:text-[var(--accent-text)] transition-colors border-b border-[var(--panel-border)] last:border-0"
                    >
                      {q.length > 80 ? q.slice(0, 77) + '…' : q}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1" />

        {/* Num runs */}
        <div className="flex items-center gap-1.5">
          <Zap size={12} className="text-[var(--text-muted)]" />
          <label className="text-xs text-[var(--text-muted)]">Runs:</label>
          <select
            value={numRuns}
            onChange={e => setNumRuns(parseInt(e.target.value))}
            className="text-xs border border-[var(--panel-border)] rounded px-1 py-0.5 bg-[var(--main-bg)] text-[var(--text-primary)] focus:ring-1 focus:ring-[var(--accent)] outline-none"
          >
            {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>

        {/* Logprobs */}
        {supportsLogprobs && (
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={showLogprobs}
              onChange={e => setShowLogprobs(e.target.checked)}
              className="accent-[var(--accent)]"
            />
            <span className="text-xs text-[var(--text-muted)]">Token heatmap</span>
          </label>
        )}
      </div>

      {/* Textarea + send */}
      <div className={`flex items-end gap-2 bg-[var(--main-bg)] border-2 rounded-2xl px-3 py-2 transition-colors ${
        disabled ? 'border-[var(--panel-border)]' : 'border-[var(--panel-surface)] focus-within:border-[var(--accent)]'
      }`}>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={autoResize}
          onKeyDown={handleKeyDown}
          rows={1}
          disabled={disabled}
          placeholder={disabled ? 'Generating…' : 'Ask anything… (Enter to send, Shift+Enter for new line)'}
          className="flex-1 resize-none bg-transparent text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none max-h-48 leading-relaxed"
          style={{ height: 'auto' }}
        />
        <button
          onClick={handleSend}
          disabled={disabled || !text.trim()}
          className={`shrink-0 w-8 h-8 rounded-xl flex items-center justify-center transition-all ${
            disabled || !text.trim()
              ? 'bg-[var(--surface)] text-[var(--text-muted)]'
              : 'bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] shadow-sm'
          }`}
        >
          <Send size={14} />
        </button>
      </div>
      <p className="text-[10px] text-[var(--text-muted)] text-center mt-1.5">
        Enter ↵ sends · Shift+Enter for new line
      </p>
      {managerOpen && (
        <QuestionManager
          onClose={() => setManagerOpen(false)}
          onChanged={() => setRefreshKey(k => k + 1)}
        />
      )}
    </div>
  )
}
