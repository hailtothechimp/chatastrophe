export interface SamplingParams {
  temperature: number
  top_p: number
  top_k: number
  max_tokens: number
  freq_penalty: number
  pres_penalty: number
  use_seed: boolean
  seed: number
  stop_sequences: string
}

export const DEFAULT_PARAMS: SamplingParams = {
  temperature: 0.7,
  top_p: 1.0,
  top_k: 0,
  max_tokens: 512,
  freq_penalty: 0.0,
  pres_penalty: 0.0,
  use_seed: false,
  seed: 42,
  stop_sequences: '',
}

export interface MessageMeta {
  provider?: string
  model?: string
  latency_s?: number
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  input_tokens?: number
  output_tokens?: number
  finish_reason?: string
  stop_reason?: string
  sampling?: string
  logprobs_tokens?: LogprobToken[]
  system_prompt?: string
}

export interface LogprobToken {
  token: string
  logprob: number
}

export interface Message {
  id: string
  conversation_id: string
  role: 'user' | 'assistant'
  content: string
  meta: MessageMeta | null
  created_at: string
}

export interface ConversationSummary {
  id: string
  title: string
  provider: string
  model: string
  system_prompt: string
  updated_at: string
}

export interface Conversation extends ConversationSummary {
  system_prompt: string
  params: SamplingParams
  created_at: string
  messages: Message[]
}

export type AppView = 'chat' | 'sweep' | 'reasoning' | 'arena' | 'roundtable' | 'throwdown'

export interface SweepResult {
  value: number
  text?: string
  error?: string
  latency_s?: number
  tokens?: number
}

export interface MetaInfo {
  providers: string[]
  model_lists: Record<string, string[]>
  param_support: Record<string, Record<string, boolean>>
  reasoning_providers: string[]
  reasoning_model_lists: Record<string, string[]>
  sweep_params: Record<string, { minimum: number; maximum: number; step: number; defaults: number[] }>
}
