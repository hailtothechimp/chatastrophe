import { useState, useCallback } from 'react'
import { listConversations, deleteConversation } from '../api'
import type { ConversationSummary } from '../types'

export function useConversations() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const data = await listConversations()
      setConversations(data)
    } finally {
      setLoading(false)
    }
  }, [])

  const remove = useCallback(async (id: string) => {
    await deleteConversation(id)
    setConversations(prev => prev.filter(c => c.id !== id))
  }, [])

  return { conversations, loading, refresh, remove }
}
