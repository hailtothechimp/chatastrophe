import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Message } from '../types'
import { User, Bot, AlertCircle } from 'lucide-react'

interface Props {
  message: Message
  modelName?: string
  personaName?: string | null
}

function logprobColor(logprob: number): string {
  const t = Math.max(0, Math.min(1, (logprob + 4.0) / 4.0))
  const hue = Math.round(t * 120)
  return `hsl(${hue},70%,82%)`
}

function LogprobHeatmap({ tokens }: { tokens: { token: string; logprob: number }[] }) {
  return (
    <div className="font-mono text-sm leading-relaxed flex flex-wrap gap-0">
      {tokens.map((t, i) => {
        const prob = Math.round(Math.exp(t.logprob) * 1000) / 10
        return (
          <span
            key={i}
            className="logprob-token"
            style={{ background: logprobColor(t.logprob) }}
            title={`logprob=${t.logprob.toFixed(3)}  prob≈${prob}%`}
          >
            {t.token}
          </span>
        )
      })}
      <div className="w-full mt-2 text-[11px] text-[var(--text-muted)] flex items-center gap-2">
        Confidence:
        {[0, 60, 120].map(hue => (
          <span
            key={hue}
            className="px-2 py-0.5 rounded text-slate-700"
            style={{ background: `hsl(${hue},70%,82%)` }}
          >
            {hue === 0 ? 'low' : hue === 60 ? 'medium' : 'high'}
          </span>
        ))}
        <span className="ml-1 italic">(hover for exact probability)</span>
      </div>
    </div>
  )
}

export default function MessageBubble({ message, modelName, personaName }: Props) {
  const isUser = message.role === 'user'
  const logprobTokens = message.meta?.logprobs_tokens

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      {/* Avatar */}
      <div className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-white text-xs ${
        isUser ? 'bg-[var(--accent)]' : 'bg-[var(--sb-l2)]'
      }`}>
        {isUser ? <User size={14} /> : <Bot size={14} />}
      </div>

      <div className={`flex flex-col max-w-[80%] ${isUser ? 'items-end' : 'items-start'}`}>
        {/* Name */}
        <span className="text-[11px] text-[var(--text-muted)] mb-1 px-1">
          {isUser ? 'You' : (
            personaName
              ? <><span className="text-[var(--text-secondary)] font-medium">{personaName}</span><span className="text-[var(--panel-surface)] mx-1">·</span>{modelName ?? 'Assistant'}</>
              : (modelName ?? 'Assistant')
          )}
        </span>

        {/* Bubble */}
        <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
          isUser
            ? 'bg-[var(--bubble-user-bg)] text-[var(--bubble-user-text)] rounded-tr-sm'
            : 'bg-[var(--bubble-ai-bg)] border border-[var(--bubble-ai-border)] text-[var(--bubble-ai-text)] rounded-tl-sm shadow-sm'
        }`}>
          {message.content.startsWith('❌') ? (
            <div className="flex items-start gap-2 text-red-600">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <span>{message.content.slice(2)}</span>
            </div>
          ) : logprobTokens && logprobTokens.length > 0 ? (
            <LogprobHeatmap tokens={logprobTokens} />
          ) : isUser ? (
            <span className="whitespace-pre-wrap">{message.content}</span>
          ) : (
            <div className="prose-chat">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {message.content}
              </ReactMarkdown>
            </div>
          )}
        </div>

        {/* Meta footer for assistant */}
        {!isUser && message.meta && (
          <div className="flex flex-wrap gap-2 mt-1 px-1">
            {message.meta.latency_s !== undefined && (
              <span className="text-[10px] text-[var(--text-muted)]">⏱ {message.meta.latency_s}s</span>
            )}
            {(message.meta.prompt_tokens || message.meta.input_tokens) && (
              <span className="text-[10px] text-[var(--text-muted)]">
                {message.meta.prompt_tokens ?? message.meta.input_tokens} in /{' '}
                {message.meta.completion_tokens ?? message.meta.output_tokens} out tokens
              </span>
            )}
            {message.meta.sampling && (
              <span className="text-[10px] text-[var(--text-muted)] font-mono">{message.meta.sampling}</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
