import { useEffect, useState, useCallback } from 'react'
import type React from 'react'
import ConversationSidebar from './components/ConversationSidebar'
import ParameterPanel from './components/ParameterPanel'
import ChatView from './components/ChatView'
import SweepView from './components/SweepView'
import ReasoningView from './components/ReasoningView'
import ArenaView from './components/ArenaView'
import RoundtableView from './components/RoundtableView'
import ThrowdownView from './components/ThrowdownView'
import LoginPage from './components/LoginPage'
import { getMeta, getConversation, updateConversation, authMe, authLogout } from './api'
import type { AppView, Conversation, MetaInfo, SamplingParams } from './types'
import { DEFAULT_PARAMS } from './types'
import { Flame, Settings2, LogOut, MessageSquare, SlidersHorizontal, Brain, Swords, Users, Trophy, ShieldCheck, PanelLeft } from 'lucide-react'
import ThemeToggle from './components/ThemeToggle'
import UserManager from './components/UserManager'

export default function App() {
  const [authStatus, setAuthStatus] = useState<'loading' | 'ok' | 'none'>('loading')
  const [username, setUsername] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  const [userManagerOpen, setUserManagerOpen] = useState(false)
  const [meta, setMeta] = useState<MetaInfo | null>(null)
  const [activeConvId, setActiveConvId] = useState<string | null>(null)
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [view, setView] = useState<AppView>('chat')
  const [sidebarRefreshKey, setSidebarRefreshKey] = useState(0)
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(true)
  const [rightPanelOpen, setRightPanelOpen] = useState(true)
  const [roundtableConv, setRoundtableConv] = useState<Conversation | null>(null)

  // Params are "live" — kept in sync with the active conversation but editable locally
  const [params, setParams] = useState<SamplingParams>(DEFAULT_PARAMS)
  const [provider, setProvider] = useState('Groq (free cloud)')
  const [model, setModel] = useState('llama-3.3-70b-versatile')
  const [systemPrompt, setSystemPrompt] = useState("You are a helpful, snarky assistant with a great sense of humor.")

  useEffect(() => {
    authMe()
      .then(({ username: u, is_admin }) => { setUsername(u); setIsAdmin(is_admin); setAuthStatus('ok') })
      .catch(() => setAuthStatus('none'))
  }, [])

  useEffect(() => {
    if (authStatus === 'ok') getMeta().then(setMeta).catch(console.error)
  }, [authStatus])

  const refreshSidebar = useCallback(() => {
    setSidebarRefreshKey(k => k + 1)
  }, [])

  const loadConversation = useCallback(async (id: string) => {
    const conv = await getConversation(id)
    setConversation(conv)
    setActiveConvId(id)
    if (conv.system_prompt === '__roundtable__') {
      setRoundtableConv(conv)
      setView('roundtable')
    } else {
      setRoundtableConv(null)
      setParams(conv.params)
      setProvider(conv.provider)
      setModel(conv.model)
      setView('chat')
    }
  }, [])

  const handleConversationCreated = useCallback((conv: Conversation) => {
    setConversation(conv)
    setActiveConvId(conv.id)
    setParams(conv.params)
    setProvider(conv.provider)
    setModel(conv.model)
    setView('chat')
    refreshSidebar()
  }, [refreshSidebar])

  // Like handleConversationCreated but stays on the current view (used by Roundtable)
  const handleConversationSaved = useCallback((_conv: Conversation) => {
    refreshSidebar()
  }, [refreshSidebar])

  const handleConversationDeleted = useCallback((id: string) => {
    if (activeConvId === id) {
      setConversation(null)
      setActiveConvId(null)
    }
    refreshSidebar()
  }, [activeConvId, refreshSidebar])

  const handleMessagesUpdated = useCallback(async () => {
    if (activeConvId) {
      const conv = await getConversation(activeConvId)
      setConversation(conv)
      refreshSidebar()
    }
  }, [activeConvId, refreshSidebar])

  // When provider/model change, also persist to the active conversation if one is open
  const handleProviderChange = useCallback((p: string) => {
    setProvider(p)
    // Reset model to the first available for this provider
    const firstModel = meta?.model_lists[p]?.[0]
    if (firstModel) setModel(firstModel)
    if (activeConvId) {
      const updates: Record<string, string> = { provider: p }
      if (firstModel) updates.model = firstModel
      updateConversation(activeConvId, updates).catch(console.error)
      setConversation(prev => prev ? { ...prev, provider: p, model: firstModel ?? prev.model } : prev)
    }
  }, [activeConvId, meta])

  const handleModelChange = useCallback((m: string) => {
    setModel(m)
    if (activeConvId) {
      updateConversation(activeConvId, { model: m }).catch(console.error)
      setConversation(prev => prev ? { ...prev, model: m } : prev)
    }
  }, [activeConvId])

  async function handleLogout() {
    await authLogout()
    setAuthStatus('none')
    setUsername('')
  }

  const paramSupport = meta?.param_support[provider] ?? {}

  if (authStatus === 'loading') return null
  if (authStatus === 'none') return (
    <LoginPage onLogin={({ username: u, is_admin }) => { setUsername(u); setIsAdmin(is_admin); setAuthStatus('ok') }} />
  )

  const tabs: { id: AppView; label: string; icon: React.ReactNode }[] = [
    { id: 'chat',      label: 'Chat',             icon: <MessageSquare size={14} /> },
    { id: 'sweep',     label: 'Parameter Sweep',  icon: <SlidersHorizontal size={14} /> },
    { id: 'reasoning', label: 'Reasoning Models', icon: <Brain size={14} /> },
    { id: 'arena',     label: 'Arena',            icon: <Swords size={14} /> },
    { id: 'roundtable',label: 'Roundtable',       icon: <Users size={14} /> },
    { id: 'throwdown', label: 'Throwdown',        icon: <Trophy size={14} /> },
  ]

  return (
    <div className="flex h-screen bg-[var(--main-bg)] overflow-hidden font-sans">
      {/* ── Left sidebar ─────────────────────────────────────────── */}
      {leftSidebarOpen && <ConversationSidebar
        activeId={activeConvId}
        refreshKey={sidebarRefreshKey}
        provider={provider}
        model={model}
        params={params}
        meta={meta}
        systemPrompt={systemPrompt}
        onSelect={loadConversation}
        onCreated={handleConversationCreated}
        onDeleted={handleConversationDeleted}
        onProviderChange={handleProviderChange}
        onModelChange={handleModelChange}
        onSystemPromptChange={setSystemPrompt}
        onConversationUpdated={handleMessagesUpdated}
      />}

      {/* ── Main area ─────────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Top nav bar */}
        <header className="flex items-center gap-2 px-4 py-2 border-b border-[var(--header-border)] bg-[var(--header-bg)] z-10 shrink-0">
          <button
            onClick={() => setLeftSidebarOpen(o => !o)}
            className={`p-1.5 rounded-md transition-colors ${
              leftSidebarOpen ? 'bg-[var(--accent-light)] text-[var(--accent-text)]' : 'text-[var(--text-muted)] hover:bg-[var(--surface)]'
            }`}
            title="Toggle conversation sidebar"
          >
            <PanelLeft size={16} />
          </button>
          <Flame size={18} className="text-orange-500" />
          <span className="font-semibold text-[var(--text-primary)] text-sm mr-4">Chatastrophe</span>
          <div className="flex gap-1">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setView(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  view === tab.id
                    ? 'bg-[var(--accent-light)] text-[var(--accent-text)]'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface)]'
                }`}
              >
                {tab.icon}{tab.label}
              </button>
            ))}
          </div>
          <div className="flex-1" />
          <span className="text-xs text-[var(--text-muted)] mr-1">{username}</span>
          {isAdmin && (
            <button
              onClick={() => setUserManagerOpen(true)}
              className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--surface)] transition-colors mr-1"
              title="Manage users"
            >
              <ShieldCheck size={15} />
            </button>
          )}
          <button
            onClick={handleLogout}
            className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-red-500 hover:bg-[var(--surface)] transition-colors mr-1"
            title="Sign out"
          >
            <LogOut size={15} />
          </button>
          <ThemeToggle />
          <button
            onClick={() => setRightPanelOpen(o => !o)}
            className={`p-1.5 rounded-md transition-colors ${
              rightPanelOpen ? 'bg-[var(--accent-light)] text-[var(--accent-text)]' : 'text-[var(--text-muted)] hover:bg-[var(--surface)]'
            }`}
            title="Toggle parameter panel"
          >
            <Settings2 size={16} />
          </button>
        </header>

        {/* Tab content */}
        <div className="flex flex-1 min-h-0">
          <div className="flex-1 min-w-0 flex flex-col">
            {view === 'chat' && (
              <ChatView
                conversation={conversation}
                params={params}
                provider={provider}
                model={model}
                meta={meta}
                systemPrompt={systemPrompt}
                onMessagesUpdated={handleMessagesUpdated}
                onConversationCreated={handleConversationCreated}
              />
            )}
            {view === 'sweep' && (
              <SweepView
                meta={meta}
                defaultProvider={provider}
                defaultModel={model}
                defaultParams={params}
              />
            )}
            {view === 'reasoning' && (
              <ReasoningView
                meta={meta}
                conversation={conversation}
                onMessagesUpdated={handleMessagesUpdated}
                onConversationCreated={handleConversationCreated}
                provider={provider}
                model={model}
              />
            )}
            {view === 'arena' && (
              <ArenaView meta={meta} />
            )}
            {view === 'roundtable' && (
              <RoundtableView meta={meta} onConversationCreated={handleConversationSaved} initialConv={roundtableConv} />
            )}
            {view === 'throwdown' && (
              <ThrowdownView meta={meta} />
            )}
          </div>

          {/* ── Right panel: sampling parameters ────────────────── */}
          {rightPanelOpen && (
            <ParameterPanel
              params={params}
              provider={provider}
              paramSupport={paramSupport}
              conversationId={activeConvId}
              onChange={(p) => {
                setParams(p)
              }}
            />
          )}
        </div>
      </div>

      {userManagerOpen && (
        <UserManager
          currentUser={username}
          onClose={() => setUserManagerOpen(false)}
        />
      )}
    </div>
  )
}
