import { useState, useEffect } from 'react'
import { X, Plus, Trash2, Users } from 'lucide-react'
import { getPersonas, createPersona, deletePersona } from '../api'
import type { Persona } from '../api'

interface Props {
  onClose: () => void
  onChanged: () => void  // called after create or delete so callers can refresh
}

export default function PersonaManager({ onClose, onChanged }: Props) {
  const [personas, setPersonas] = useState<Persona[]>([])
  const [search, setSearch] = useState('')
  const [newName, setNewName] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [newPrompt, setNewPrompt] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const data = await getPersonas()
    setPersonas(data)
  }

  useEffect(() => { load().catch(console.error) }, [])

  async function handleCreate() {
    if (!newName.trim() || !newPrompt.trim()) return
    setCreating(true)
    setError(null)
    try {
      await createPersona({ persona: newName.trim(), system_prompt: newPrompt.trim(), show: newLabel.trim() || undefined })
      setNewName('')
      setNewLabel('')
      setNewPrompt('')
      await load()
      onChanged()
    } catch (e: unknown) {
      setError(String(e))
    } finally {
      setCreating(false)
    }
  }

  async function handleDelete(name: string) {
    try {
      await deletePersona(name)
      await load()
      onChanged()
    } catch (e: unknown) {
      setError(String(e))
    }
  }

  const filtered = personas.filter(p =>
    p.persona.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-[640px] max-h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <Users size={16} className="text-indigo-600" />
            <h2 className="font-semibold text-slate-800">Manage Personas</h2>
            <span className="text-xs text-slate-400">({personas.length} total)</span>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={16} />
          </button>
        </div>

        {/* Create new */}
        <div className="px-5 py-4 border-b border-slate-100 bg-slate-50">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Add New Persona</p>
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Name (e.g. Ned Flanders)"
            className="w-full px-3 py-1.5 text-sm rounded-lg border border-slate-300 outline-none focus:ring-2 focus:ring-indigo-400 mb-2"
          />
          <input
            value={newLabel}
            onChange={e => setNewLabel(e.target.value)}
            placeholder="Label in parens (e.g. The Simpsons, comedian, musician) — optional"
            className="w-full px-3 py-1.5 text-sm rounded-lg border border-slate-300 outline-none focus:ring-2 focus:ring-indigo-400 mb-2"
          />
          <textarea
            value={newPrompt}
            onChange={e => setNewPrompt(e.target.value)}
            placeholder="System prompt — describe how this persona should speak and behave…"
            rows={3}
            className="w-full px-3 py-1.5 text-sm rounded-lg border border-slate-300 outline-none focus:ring-2 focus:ring-indigo-400 resize-none"
          />
          {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
          <button
            onClick={handleCreate}
            disabled={creating || !newName.trim() || !newPrompt.trim()}
            className="mt-2 flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus size={13} /> {creating ? 'Saving…' : 'Save Persona'}
          </button>
        </div>

        {/* Search + list */}
        <div className="px-5 py-3 border-b border-slate-100">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search personas…"
            className="w-full px-3 py-1.5 text-sm rounded-lg border border-slate-200 outline-none focus:ring-2 focus:ring-indigo-400"
          />
        </div>
        <div className="overflow-y-auto flex-1">
          {filtered.map(p => (
            <div key={p.persona} className="flex items-start gap-3 px-5 py-3 border-b border-slate-50 hover:bg-slate-50 group">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800">{p.persona}</p>
                {(p.author || p.show) && (
                  <p className="text-xs text-slate-400">
                    {p.author ? `${(p as unknown as Record<string,string>).book} — ${p.author}` : p.show}
                  </p>
                )}
                <p className="text-xs text-slate-400 truncate mt-0.5">{p.system_prompt.slice(0, 100)}…</p>
              </div>
              <button
                onClick={() => handleDelete(p.persona)}
                className="shrink-0 opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 transition-all mt-0.5"
                title={`Delete ${p.persona}`}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {filtered.length === 0 && (
            <p className="px-5 py-8 text-sm text-slate-400 text-center">No personas match your search.</p>
          )}
        </div>
      </div>
    </div>
  )
}
