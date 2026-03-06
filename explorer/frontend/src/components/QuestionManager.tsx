import { useState, useEffect } from 'react'
import { X, Plus, Trash2, Sparkles } from 'lucide-react'
import { getQuestions, createQuestion, deleteQuestion } from '../api'

interface Props {
  onClose: () => void
  onChanged: () => void
}

export default function QuestionManager({ onClose, onChanged }: Props) {
  const [questions, setQuestions] = useState<Record<string, string[]>>({})
  const [selectedCat, setSelectedCat] = useState('')
  const [newCat, setNewCat] = useState('')
  const [newQ, setNewQ] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const data = await getQuestions()
    setQuestions(data)
    if (!selectedCat || !(selectedCat in data)) {
      setSelectedCat(Object.keys(data)[0] ?? '')
    }
  }

  useEffect(() => { load().catch(console.error) }, [])

  const categories = Object.keys(questions)
  const activeCat = newCat.trim() || selectedCat
  const activeQuestions = questions[selectedCat] ?? []

  async function handleAdd() {
    const cat = activeCat.trim()
    const q = newQ.trim()
    if (!cat || !q) return
    setSaving(true)
    setError(null)
    try {
      await createQuestion(cat, q)
      setNewQ('')
      setNewCat('')
      await load()
      onChanged()
    } catch (e: unknown) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(cat: string, idx: number) {
    try {
      await deleteQuestion(cat, idx)
      await load()
      onChanged()
    } catch (e: unknown) {
      setError(String(e))
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-[700px] max-h-[82vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-indigo-600" />
            <h2 className="font-semibold text-slate-800">Manage Question Bank</h2>
            <span className="text-xs text-slate-400">
              ({Object.values(questions).reduce((s, qs) => s + qs.length, 0)} questions)
            </span>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={16} /></button>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* Category sidebar */}
          <div className="w-44 border-r border-slate-100 overflow-y-auto shrink-0">
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setSelectedCat(cat)}
                className={`w-full text-left px-3 py-2.5 text-xs font-medium transition-colors border-b border-slate-50 ${
                  selectedCat === cat
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <div>{cat}</div>
                <div className="text-[10px] text-slate-400 font-normal">{questions[cat]?.length ?? 0} questions</div>
              </button>
            ))}
          </div>

          {/* Question list */}
          <div className="flex-1 overflow-y-auto min-w-0">
            {activeQuestions.map((q, i) => (
              <div key={i} className="flex items-start gap-2 px-4 py-2.5 border-b border-slate-50 hover:bg-slate-50 group">
                <span className="flex-1 text-xs text-slate-700 leading-relaxed">{q}</span>
                <button
                  onClick={() => handleDelete(selectedCat, i)}
                  className="shrink-0 opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 transition-all mt-0.5"
                  title="Delete question"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
            {activeQuestions.length === 0 && selectedCat && (
              <p className="px-4 py-6 text-xs text-slate-400 text-center">No questions in this category yet.</p>
            )}
          </div>
        </div>

        {/* Add new */}
        <div className="px-5 py-4 border-t border-slate-200 bg-slate-50">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Add Question</p>
          <div className="flex gap-2 mb-2">
            <select
              value={newCat || selectedCat}
              onChange={e => { setNewCat(''); setSelectedCat(e.target.value) }}
              className="px-2 py-1.5 text-xs rounded-lg border border-slate-300 outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
            >
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <input
              value={newCat}
              onChange={e => setNewCat(e.target.value)}
              placeholder="…or type a new category name"
              className="flex-1 px-2 py-1.5 text-xs rounded-lg border border-slate-300 outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>
          <div className="flex gap-2">
            <input
              value={newQ}
              onChange={e => setNewQ(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd() }}
              placeholder="New question text…"
              className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-slate-300 outline-none focus:ring-2 focus:ring-indigo-400"
            />
            <button
              onClick={handleAdd}
              disabled={saving || !newQ.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-medium rounded-lg transition-colors"
            >
              <Plus size={13} /> {saving ? 'Saving…' : 'Add'}
            </button>
          </div>
          {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
        </div>
      </div>
    </div>
  )
}
