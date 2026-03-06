import { useEffect } from 'react'
import { X, BookOpen } from 'lucide-react'

interface Props {
  onClose: () => void
}

const PARAMS = [
  {
    name: 'Temperature',
    range: '0 – 2 (Anthropic: 0 – 1)',
    effect: 'The primary creativity dial. At 0 the model always picks its most-likely next word — responses are deterministic. Around 0.7–1.0 is good for creative writing; 0.0–0.3 for factual Q&A and code. Above 1 outputs become wilder: unusual word choices, tangents, occasional incoherence.',
  },
  {
    name: 'Top P',
    range: '0 – 1',
    effect: 'A softer creativity dial. Cuts off the long tail of unlikely tokens. At 1.0 (default) nothing is cut. At 0.5 only tokens accounting for 50% of the probability mass are considered. Use either this or Temperature, not both.',
  },
  {
    name: 'Top K',
    range: '0 – 500',
    effect: 'A hard vocabulary limit. At each step the model only considers the K most probable tokens. Low values (e.g. 10) keep output tightly on-topic. 0 = disabled. Anthropic only.',
  },
  {
    name: 'Max Tokens',
    range: '1 – 4096',
    effect: 'Controls response length. The model stops the moment it hits this limit, even mid-sentence. Very low values force extreme brevity and can produce truncated answers.',
  },
  {
    name: 'Frequency Penalty',
    range: '–2 – +2',
    effect: 'Discourages repetition of already-used words. The penalty grows each time a word appears. Positive values (try 0.5–1.0) reduce "As I mentioned…" filler. Negative values push the model to reuse the same words. OpenAI-compatible providers only.',
  },
  {
    name: 'Presence Penalty',
    range: '–2 – +2',
    effect: 'Discourages revisiting any topic already mentioned. Unlike Frequency Penalty, the penalty is flat regardless of how many times a word appeared. Positive values encourage new ideas; useful for brainstorming. OpenAI-compatible providers only.',
  },
  {
    name: 'Seed',
    range: 'any integer',
    effect: 'Makes outputs reproducible. With the same seed, model, and parameters the response will be nearly identical across runs — useful for A/B testing a single parameter change. OpenAI only.',
  },
  {
    name: 'Stop Sequences',
    range: 'comma-separated strings',
    effect: 'Tells the model when to stop. Generation halts the instant the model produces any of these strings. Use \\n\\n to stop after the first paragraph, END for a custom sentinel. The stop string itself is not included in the output.',
  },
]

const IDEAS = [
  'Ask for a creative story and sweep Temperature 0 → 1.5 to see the creativity gradient.',
  'Set Temperature to 1.0 and sweep Top P 0.1 → 1.0 to compare the two randomness controls side-by-side.',
  'Crank Frequency Penalty to 1.5 and ask for a long explanation — watch it hunt for synonyms.',
  'Enable Fix Seed, run the same prompt 3× to confirm determinism, then change the seed to see a different-but-stable output.',
  'Use # Runs (no seed) to measure natural output variance at your current temperature.',
  'Enable Token Probabilities (OpenAI only) to see which words the model was confident vs uncertain about.',
]

export default function ParamReferenceModal({ onClose }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    // Floating panel anchored above the right sidebar — no backdrop so the rest of the app stays interactive
    <div className="fixed bottom-4 right-[19rem] z-50 flex flex-col bg-white rounded-2xl shadow-2xl border border-slate-200"
      style={{ width: 'min(780px, calc(100vw - 22rem))', maxHeight: '80vh' }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-200 shrink-0">
        <BookOpen size={16} className="text-indigo-600" />
        <h2 className="font-semibold text-slate-800 text-sm flex-1">Parameter Reference</h2>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          title="Close (Esc)"
        >
          <X size={14} />
        </button>
      </div>

      {/* Scrollable body */}
      <div className="overflow-y-auto flex-1 px-5 py-4 space-y-5">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b-2 border-slate-200">
              <th className="text-left py-2 pr-4 text-[10px] font-bold text-indigo-600 uppercase tracking-wider w-32">Parameter</th>
              <th className="text-left py-2 pr-4 text-[10px] font-bold text-indigo-600 uppercase tracking-wider w-40">Range</th>
              <th className="text-left py-2 text-[10px] font-bold text-indigo-600 uppercase tracking-wider">Effect on output</th>
            </tr>
          </thead>
          <tbody>
            {PARAMS.map((p, i) => (
              <tr key={p.name} className={`border-b border-slate-100 ${i % 2 === 0 ? '' : 'bg-slate-50/60'}`}>
                <td className="py-2.5 pr-4 align-top">
                  <span className="font-semibold text-slate-800 text-xs">{p.name}</span>
                </td>
                <td className="py-2.5 pr-4 align-top">
                  <code className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-mono">{p.range}</code>
                </td>
                <td className="py-2.5 align-top text-slate-600 leading-relaxed text-xs">{p.effect}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="rounded-xl bg-indigo-50 border border-indigo-100 px-4 py-3">
          <p className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider mb-2">Experiment Ideas</p>
          <ul className="space-y-1.5">
            {IDEAS.map((idea, i) => (
              <li key={i} className="flex gap-2 text-xs text-indigo-900 leading-relaxed">
                <span className="text-indigo-400 shrink-0">→</span>
                {idea}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
