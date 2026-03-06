import type { Conversation, ConversationSummary, SamplingParams, MetaInfo, SweepResult } from './types'

const BASE = '/api'

// ── Conversations ──────────────────────────────────────────────────────────────

export async function listConversations(): Promise<ConversationSummary[]> {
  const r = await fetch(`${BASE}/conversations`)
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function createConversation(opts: {
  title?: string
  system_prompt?: string
  provider: string
  model: string
  params: SamplingParams
}): Promise<Conversation> {
  const r = await fetch(`${BASE}/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function getConversation(id: string): Promise<Conversation> {
  const r = await fetch(`${BASE}/conversations/${id}`)
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function updateConversation(
  id: string,
  fields: Partial<{ title: string; system_prompt: string; provider: string; model: string; params: SamplingParams }>
): Promise<void> {
  const r = await fetch(`${BASE}/conversations/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  })
  if (!r.ok) throw new Error(await r.text())
}

export async function deleteConversation(id: string): Promise<void> {
  const r = await fetch(`${BASE}/conversations/${id}`, { method: 'DELETE' })
  if (!r.ok) throw new Error(await r.text())
}

// ── Streaming chat ─────────────────────────────────────────────────────────────

export async function* streamChat(
  convId: string,
  userMessage: string,
  numRuns: number,
  showLogprobs: boolean,
  signal?: AbortSignal,
): AsyncGenerator<{ type: string; [key: string]: unknown }> {
  const r = await fetch(`${BASE}/conversations/${convId}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_message: userMessage, num_runs: numRuns, show_logprobs: showLogprobs }),
    signal,
  })
  if (!r.ok) throw new Error(await r.text())
  yield* readSSE(r)
}

export async function* streamReasoning(
  opts: {
    conversation_id: string
    provider: string
    model: string
    user_message: string
    reasoning_effort: string
    budget_tokens: number
    max_tokens: number
  },
  signal?: AbortSignal,
): AsyncGenerator<{ type: string; [key: string]: unknown }> {
  const r = await fetch(`${BASE}/reasoning`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
    signal,
  })
  if (!r.ok) throw new Error(await r.text())
  yield* readSSE(r)
}

// ── Roundtable ────────────────────────────────────────────────────────────────

export async function* streamRoundtable(
  opts: {
    agents: { persona: string; system_prompt: string; provider: string; model: string }[]
    topic: string
    num_turns: number
    mood: number
    seriousness: number
    conv_id?: string
    follow_up?: string
    history?: { persona: string; content: string }[]
  },
  signal?: AbortSignal,
): AsyncGenerator<{ type: string; [key: string]: unknown }> {
  const r = await fetch(`${BASE}/roundtable`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
    signal,
  })
  if (!r.ok) throw new Error(await r.text())
  yield* readSSE(r)
}

// ── Throwdown ─────────────────────────────────────────────────────────────────

export async function createThrowdownSession(opts: {
  judge: { persona: string; system_prompt: string; provider: string; model: string }
  contestants: { persona: string; system_prompt: string; provider: string; model: string }[]
  num_rounds: number
}): Promise<{ session_id: number }> {
  const r = await fetch(`${BASE}/throwdown/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function* streamThrowdownRound(
  opts: { session_id: number; round_num: number; prompt: string },
  signal?: AbortSignal,
): AsyncGenerator<{ type: string; [key: string]: unknown }> {
  const r = await fetch(`${BASE}/throwdown/round`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
    signal,
  })
  if (!r.ok) throw new Error(await r.text())
  yield* readSSE(r)
}

// ── Parameter sweep ────────────────────────────────────────────────────────────

export async function runSweep(opts: {
  provider: string
  model: string
  system_prompt: string
  user_message: string
  sweep_param: string
  values: number[]
  base_params: SamplingParams
}): Promise<SweepResult[]> {
  const r = await fetch(`${BASE}/sweep`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

// ── Questions ─────────────────────────────────────────────────────────────────

export async function getQuestions(): Promise<Record<string, string[]>> {
  const r = await fetch(`${BASE}/questions`)
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function createQuestion(category: string, question: string): Promise<void> {
  const r = await fetch(`${BASE}/questions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ category, question }),
  })
  if (!r.ok) throw new Error(await r.text())
}

export async function deleteQuestion(category: string, idx: number): Promise<void> {
  const r = await fetch(`${BASE}/questions/${encodeURIComponent(category)}/${idx}`, { method: 'DELETE' })
  if (!r.ok) throw new Error(await r.text())
}

// ── Personas ──────────────────────────────────────────────────────────────────

export interface Persona {
  persona: string
  book: string
  author: string
  show: string
  system_prompt: string
}

export async function getPersonas(): Promise<Persona[]> {
  const r = await fetch(`${BASE}/personas`)
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function createPersona(p: { persona: string; system_prompt: string; book?: string; author?: string; show?: string }): Promise<Persona> {
  const r = await fetch(`${BASE}/personas`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(p),
  })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function deletePersona(name: string): Promise<void> {
  const r = await fetch(`${BASE}/personas/${encodeURIComponent(name)}`, { method: 'DELETE' })
  if (!r.ok) throw new Error(await r.text())
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export interface AuthUser {
  username: string
  is_admin: boolean
}

export async function authMe(): Promise<AuthUser> {
  const r = await fetch(`${BASE}/auth/me`)
  if (!r.ok) throw new Error('Not authenticated')
  return r.json()
}

export async function authLogin(username: string, password: string): Promise<AuthUser> {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  if (!r.ok) {
    const err = await r.json().catch(() => ({ detail: 'Login failed' }))
    throw new Error(err.detail ?? 'Login failed')
  }
  return r.json()
}

export async function authLogout(): Promise<void> {
  await fetch(`${BASE}/auth/logout`, { method: 'POST' })
}

// ── Admin / Users ─────────────────────────────────────────────────────────────

export interface AdminUser {
  username: string
  is_admin: boolean
  created_at: string
}

async function _adminFetch(path: string, options?: RequestInit) {
  const r = await fetch(`${BASE}${path}`, options)
  if (!r.ok) {
    const err = await r.json().catch(() => ({ detail: r.statusText }))
    throw new Error(err.detail ?? r.statusText)
  }
  return r
}

export async function listUsers(): Promise<AdminUser[]> {
  return (await _adminFetch('/admin/users')).json()
}

export async function createAdminUser(username: string, password: string, is_admin: boolean): Promise<AdminUser> {
  return (await _adminFetch('/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, is_admin }),
  })).json()
}

export async function updateAdminUser(username: string, updates: { password?: string; is_admin?: boolean }): Promise<void> {
  await _adminFetch(`/admin/users/${encodeURIComponent(username)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  })
}

export async function deleteAdminUser(username: string): Promise<void> {
  await _adminFetch(`/admin/users/${encodeURIComponent(username)}`, { method: 'DELETE' })
}

// ── Meta ──────────────────────────────────────────────────────────────────────

export async function getMeta(): Promise<MetaInfo> {
  const r = await fetch(`${BASE}/meta`)
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

// ── SSE reader ────────────────────────────────────────────────────────────────

async function* readSSE(
  response: Response,
): AsyncGenerator<{ type: string; [key: string]: unknown }> {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const payload = line.slice(6).trim()
      if (payload === '[DONE]') return
      try {
        yield JSON.parse(payload)
      } catch {
        // ignore malformed lines
      }
    }
  }
}
