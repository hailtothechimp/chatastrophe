import { useEffect, useState, useRef, useCallback } from 'react'
import { Plus, Trash2, MessageSquare, Download, ChevronDown, Pencil, Check, X, Settings } from 'lucide-react'
import { listConversations, createConversation, deleteConversation, updateConversation, getPersonas } from '../api'
import type { Persona } from '../api'
import type { ConversationSummary, Conversation, MetaInfo, SamplingParams } from '../types'
import { DEFAULT_PARAMS } from '../types'
import PersonaManager from './PersonaManager'

interface Props {
  activeId: string | null
  refreshKey: number
  provider: string
  model: string
  params: SamplingParams
  meta: MetaInfo | null
  systemPrompt: string
  onSelect: (id: string) => void
  onCreated: (conv: Conversation) => void
  onDeleted: (id: string) => void
  onProviderChange: (p: string) => void
  onModelChange: (m: string) => void
  onSystemPromptChange: (sp: string) => void
  onConversationUpdated?: () => void
}

function groupByDate(convs: ConversationSummary[]): { label: string; items: ConversationSummary[] }[] {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today.getTime() - 86400000)
  const weekAgo   = new Date(today.getTime() - 7 * 86400000)

  const groups: Record<string, ConversationSummary[]> = {
    Today: [], Yesterday: [], 'This Week': [], Older: [],
  }
  for (const c of convs) {
    const d = new Date(c.updated_at)
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate())
    if (day >= today)        groups.Today.push(c)
    else if (day >= yesterday) groups.Yesterday.push(c)
    else if (day >= weekAgo)   groups['This Week'].push(c)
    else                       groups.Older.push(c)
  }
  return Object.entries(groups)
    .filter(([, items]) => items.length > 0)
    .map(([label, items]) => ({ label, items }))
}

export default function ConversationSidebar({
  activeId, refreshKey, provider, model, params, meta,
  systemPrompt, onSystemPromptChange,
  onSelect, onCreated, onDeleted, onProviderChange, onModelChange, onConversationUpdated,
}: Props) {
  const [convs, setConvs] = useState<ConversationSummary[]>([])
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [providerOpen, setProviderOpen] = useState(false)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)
  const [managerOpen, setManagerOpen] = useState(false)
  const [personaRefreshKey, setPersonaRefreshKey] = useState(0)
  const [personas, setPersonas] = useState<Persona[]>([])
  const editRef = useRef<HTMLInputElement>(null)
  const [width, setWidth] = useState(400)
  const dragState = useRef<{ startX: number; startWidth: number } | null>(null)

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    dragState.current = { startX: e.clientX, startWidth: width }
    e.preventDefault()
  }, [width])

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!dragState.current) return
      const delta = e.clientX - dragState.current.startX
      setWidth(Math.max(160, Math.min(400, dragState.current.startWidth + delta)))
    }
    function onMouseUp() {
      dragState.current = null
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  useEffect(() => {
    listConversations().then(setConvs).catch(console.error)
  }, [refreshKey])

  useEffect(() => {
    getPersonas().then(setPersonas).catch(console.error)
  }, [personaRefreshKey])

  useEffect(() => {
    if (editingId && editRef.current) editRef.current.focus()
  }, [editingId])

  async function handleCreate() {
    setCreating(true)
    try {
      const models = meta?.model_lists[provider] ?? []
      const m = models.includes(model) ? model : models[0] ?? model
      const conv = await createConversation({
        title: 'New conversation',
        system_prompt: systemPrompt,
        provider,
        model: m,
        params: { ...DEFAULT_PARAMS, ...params },
      })
      onCreated(conv as Conversation)
    } finally {
      setCreating(false)
    }
  }

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation()
    if (!confirm('Delete this conversation?')) return
    await deleteConversation(id)
    onDeleted(id)
  }

  function toggleSelectMode() {
    setSelectMode(m => !m)
    setSelected(new Set())
    setEditingId(null)
  }

  function toggleOne(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleAll() {
    const allIds = convs.map(c => c.id)
    setSelected(prev => prev.size === allIds.length ? new Set() : new Set(allIds))
  }

  async function handleBulkDelete() {
    if (selected.size === 0) return
    if (!confirm(`Delete ${selected.size} conversation${selected.size > 1 ? 's' : ''}?`)) return
    setDeleting(true)
    try {
      await Promise.all([...selected].map(id => deleteConversation(id)))
      selected.forEach(id => onDeleted(id))
      setSelected(new Set())
      setSelectMode(false)
    } finally {
      setDeleting(false)
    }
  }

  async function commitRename(id: string) {
    if (!editTitle.trim()) { setEditingId(null); return }
    await updateConversation(id, { title: editTitle.trim() })
    setConvs(cs => cs.map(c => c.id === id ? { ...c, title: editTitle.trim() } : c))
    setEditingId(null)
  }

  function startEdit(e: React.MouseEvent, c: ConversationSummary) {
    e.stopPropagation()
    setEditTitle(c.title)
    setEditingId(c.id)
  }

  const groups = groupByDate(convs)
  const models = meta?.model_lists[provider] ?? []
  const personaByPrompt = new Map(personas.map(p => [p.system_prompt, p.persona]))

  return (
    <aside
      className="shrink-0 bg-[var(--sb-bg)] text-[var(--sb-text)] flex flex-col h-full border-r border-[var(--sb-border)] relative select-none"
      style={{ width }}
    >
      {/* Header */}
      <div className="px-3 pt-4 pb-2 shrink-0">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-sm font-semibold text-[var(--sb-text)] flex-1">Conversations</span>
          <button
            onClick={toggleSelectMode}
            className={`px-2 py-1 rounded-md text-xs font-medium transition-colors ${
              selectMode
                ? 'bg-[var(--sb-l3)] hover:bg-[var(--sb-l4)] text-[var(--sb-text)]'
                : 'bg-[var(--sb-l2)] hover:bg-[var(--sb-l3)] text-[var(--sb-text-muted)]'
            }`}
          >
            {selectMode ? 'Done' : 'Select'}
          </button>
          {!selectMode && (
            <button
              onClick={handleCreate}
              disabled={creating}
              className="flex items-center gap-1 px-2 py-1 bg-[var(--accent)] hover:bg-[var(--accent-hover)] rounded-md text-xs font-medium text-white transition-colors disabled:opacity-50"
            >
              <Plus size={13} />
              New
            </button>
          )}
        </div>

        {/* Provider/Model selectors */}
        <div className="space-y-1.5">
          <div className="relative">
            <button
              onClick={() => setProviderOpen(o => !o)}
              className="w-full flex items-center justify-between px-2 py-1.5 bg-[var(--sb-surface)] hover:bg-[var(--sb-l2)] rounded text-xs transition-colors"
            >
              <span className="truncate text-[var(--sb-text-muted)]">{provider}</span>
              <ChevronDown size={11} className="shrink-0 ml-1 text-[var(--sb-text-muted)]" />
            </button>
            {providerOpen && (
              <div className="absolute z-50 top-full left-0 right-0 mt-0.5 bg-[var(--sb-surface)] border border-[var(--sb-l2)] rounded shadow-lg">
                {(meta?.providers ?? []).map(p => (
                  <button
                    key={p}
                    onClick={() => {
                      onProviderChange(p)
                      setProviderOpen(false)
                    }}
                    className={`w-full text-left px-2 py-1.5 text-xs hover:bg-[var(--sb-l2)] transition-colors ${
                      p === provider ? 'text-[var(--accent-sb)] font-medium' : 'text-[var(--sb-text-muted)]'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            )}
          </div>

          <select
            value={model}
            onChange={e => onModelChange(e.target.value)}
            className="w-full px-2 py-1.5 bg-[var(--sb-surface)] text-[var(--sb-text-muted)] rounded text-xs border-0 focus:ring-1 focus:ring-[var(--accent)] outline-none"
          >
            {models.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>

        {/* System prompt */}
        <div className="mt-2 space-y-1.5">
          <label className="text-xs text-[var(--sb-text-muted)] font-medium">System prompt</label>
          <textarea
            value={systemPrompt}
            onChange={e => onSystemPromptChange(e.target.value)}
            rows={3}
            className="w-full px-2 py-1.5 bg-[var(--sb-surface)] text-[var(--sb-text-muted)] rounded text-xs resize-none focus:ring-1 focus:ring-[var(--accent)] outline-none border-0 leading-relaxed"
            placeholder="System prompt for new conversations…"
          />

          {/* Persona picker */}
          <div className="flex items-center justify-between">
            <label className="text-xs text-[var(--sb-text-muted)] font-medium">Persona</label>
            <button
              onClick={() => setManagerOpen(true)}
              title="Manage personas"
              className="text-[var(--sb-text-muted)] hover:text-[var(--sb-text)] transition-colors"
            >
              <Settings size={11} />
            </button>
          </div>
          <select
            value=""
            onChange={e => {
              const found = personas.find(p => p.persona === e.target.value)
              if (!found) return
              onSystemPromptChange(found.system_prompt)
              if (activeId) {
                updateConversation(activeId, { system_prompt: found.system_prompt })
                  .then(onConversationUpdated)
                  .catch(console.error)
              }
            }}
            className="w-full px-2 py-1.5 bg-[var(--sb-surface)] text-[var(--sb-text-muted)] rounded text-xs border-0 focus:ring-1 focus:ring-[var(--accent)] outline-none"
          >
            <option value="">Select a persona…</option>
            {[...personas].sort((a, b) => a.persona.localeCompare(b.persona)).map(p => (
              <option key={p.persona} value={p.persona}>
                {p.persona}{p.author
                  ? ` (${(p as unknown as Record<string,string>).book} — ${p.author.split(' ').at(-1)})`
                  : p.show ? ` (${p.show})` : ''}
              </option>
            ))}
          </select>

          {managerOpen && (
            <PersonaManager
              onClose={() => setManagerOpen(false)}
              onChanged={() => setPersonaRefreshKey(k => k + 1)}
            />
          )}
        </div>
      </div>

      {/* Select-mode toolbar */}
      {selectMode && (
        <div className="px-3 pb-2 shrink-0 flex items-center gap-2 border-b border-[var(--sb-border)]">
          <label className="flex items-center gap-1.5 cursor-pointer flex-1">
            <input
              type="checkbox"
              checked={selected.size === convs.length && convs.length > 0}
              onChange={toggleAll}
              className="w-3.5 h-3.5"
            />
            <span className="text-xs text-[var(--sb-text-muted)]">
              {selected.size === 0 ? 'Select all' : `${selected.size} selected`}
            </span>
          </label>
          {selected.size > 0 && (
            <button
              onClick={handleBulkDelete}
              disabled={deleting}
              className="flex items-center gap-1 px-2 py-1 bg-red-700 hover:bg-red-600 rounded text-xs text-white font-medium transition-colors disabled:opacity-50"
            >
              <Trash2 size={11} />
              Delete ({selected.size})
            </button>
          )}
        </div>
      )}

      {/* Conversation list */}
      <nav className="flex-1 overflow-y-auto px-2 py-1 space-y-3">
        {groups.length === 0 && (
          <p className="text-xs text-[var(--sb-text-muted)] italic text-center mt-8 px-2">
            No conversations yet.<br />Click New to start.
          </p>
        )}
        {groups.map(({ label, items }) => (
          <div key={label}>
            <p className="text-xs text-[var(--sb-text-muted)] uppercase tracking-wider font-semibold px-1 mb-1">{label}</p>
            <ul className="space-y-0.5">
              {items.map(c => (
                <li key={c.id}>
                  {selectMode ? (
                    <label className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-xs transition-colors ${
                      selected.has(c.id) ? 'bg-[var(--sb-accent)] text-[var(--sb-text)]' : 'hover:bg-[var(--sb-surface)] text-[var(--sb-text-muted)]'
                    }`}>
                      <input
                        type="checkbox"
                        checked={selected.has(c.id)}
                        onChange={() => toggleOne(c.id)}
                        className="w-3.5 h-3.5 shrink-0"
                      />
                      <span className="flex-1 min-w-0">
                        <span className="block truncate">{c.title}</span>
                        <span className="block truncate text-[10px] text-[var(--sb-text-muted)] font-mono">{c.model}</span>
                        {personaByPrompt.get(c.system_prompt) && (
                          <span className="block truncate text-[10px] text-[var(--accent-sb)]">{personaByPrompt.get(c.system_prompt)}</span>
                        )}
                      </span>
                    </label>
                  ) : editingId === c.id ? (
                    <div className="flex items-center gap-1 px-1">
                      <input
                        ref={editRef}
                        value={editTitle}
                        onChange={e => setEditTitle(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') commitRename(c.id)
                          if (e.key === 'Escape') setEditingId(null)
                        }}
                        className="flex-1 bg-[var(--sb-l2)] text-[var(--sb-text)] text-xs rounded px-1.5 py-1 outline-none focus:ring-1 focus:ring-[var(--accent)]"
                      />
                      <button onClick={() => commitRename(c.id)} className="text-green-400 hover:text-green-300"><Check size={12} /></button>
                      <button onClick={() => setEditingId(null)} className="text-[var(--sb-text-muted)] hover:text-[var(--sb-text)]"><X size={12} /></button>
                    </div>
                  ) : (
                    <button
                      onClick={() => onSelect(c.id)}
                      className={`group w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-xs transition-colors ${
                        c.id === activeId
                          ? 'bg-[var(--sb-accent)] text-[var(--sb-text)]'
                          : 'hover:bg-[var(--sb-surface)] text-[var(--sb-text-muted)]'
                      }`}
                    >
                      <MessageSquare size={12} className="shrink-0 text-[var(--sb-text-muted)] mt-0.5" />
                      <span className="flex-1 min-w-0">
                        <span className="block truncate">{c.title}</span>
                        <span className="block truncate text-[10px] text-[var(--sb-text-muted)] font-mono">{c.model}</span>
                        {personaByPrompt.get(c.system_prompt) && (
                          <span className="block truncate text-[10px] text-[var(--accent-sb)]">{personaByPrompt.get(c.system_prompt)}</span>
                        )}
                      </span>
                      <span className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                        <span
                          onClick={e => startEdit(e, c)}
                          className="p-0.5 hover:text-[var(--accent-sb)] text-[var(--sb-text-muted)]"
                        >
                          <Pencil size={10} />
                        </span>
                        <span
                          onClick={e => handleDelete(e, c.id)}
                          className="p-0.5 hover:text-red-400 text-[var(--sb-text-muted)]"
                        >
                          <Trash2 size={10} />
                        </span>
                      </span>
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {/* Drag-to-resize handle */}
      <div
        onMouseDown={handleDragStart}
        className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-[var(--accent)] opacity-40 transition-colors"
        title="Drag to resize"
      />

      {/* Export footer */}
      {activeId && (
        <div className="px-3 py-2 border-t border-[var(--sb-border)] shrink-0 flex gap-2">
          <a
            href={`/api/conversations/${activeId}/export/json`}
            download
            className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-[var(--sb-surface)] hover:bg-[var(--sb-l2)] rounded text-xs text-[var(--sb-text-muted)] transition-colors"
          >
            <Download size={11} /> JSON
          </a>
          <a
            href={`/api/conversations/${activeId}/export/pdf`}
            download
            className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-[var(--sb-surface)] hover:bg-[var(--sb-l2)] rounded text-xs text-[var(--sb-text-muted)] transition-colors"
          >
            <Download size={11} /> PDF
          </a>
        </div>
      )}
    </aside>
  )
}
