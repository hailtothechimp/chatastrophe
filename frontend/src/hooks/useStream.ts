import { useState, useRef, useCallback } from 'react'

interface UseStreamReturn {
  text: string
  streaming: boolean
  error: string | null
  start: (gen: AsyncGenerator<{ type: string; [k: string]: unknown }>) => Promise<{ type: string; [k: string]: unknown } | null>
  stop: () => void
  reset: () => void
}

export function useStream(): UseStreamReturn {
  const [text, setText] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController>(new AbortController())

  const stop = useCallback(() => {
    abortRef.current.abort()
    setStreaming(false)
  }, [])

  const reset = useCallback(() => {
    setText('')
    setError(null)
    setStreaming(false)
    abortRef.current = new AbortController()
  }, [])

  const start = useCallback(async (
    gen: AsyncGenerator<{ type: string; [k: string]: unknown }>
  ) => {
    setText('')
    setError(null)
    setStreaming(true)
    let lastMeta: { type: string; [k: string]: unknown } | null = null

    try {
      for await (const event of gen) {
        if (event.type === 'token') {
          setText(prev => prev + (event.content as string))
        } else if (event.type === 'meta') {
          lastMeta = event
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setError(String(err))
      }
    } finally {
      setStreaming(false)
    }

    return lastMeta
  }, [])

  return { text, streaming, error, start, stop, reset }
}
