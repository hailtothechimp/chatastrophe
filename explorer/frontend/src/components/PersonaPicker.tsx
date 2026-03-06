import { useState, useEffect } from 'react'
import { UserCircle, ChevronDown } from 'lucide-react'
import { getPersonas } from '../api'
import type { Persona } from '../api'

interface Props {
  onSelect: (systemPrompt: string) => void
  /** Tailwind classes to pass to the trigger button (e.g. for dark vs light backgrounds) */
  className?: string
}

export default function PersonaPicker({ onSelect, className = '' }: Props) {
  const [value, setValue] = useState('')
  const [personas, setPersonas] = useState<Persona[]>([])

  useEffect(() => {
    getPersonas().then(setPersonas).catch(console.error)
  }, [])

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const name = e.target.value
    setValue(name)
    const found = personas.find(p => p.persona === name)
    if (found) onSelect(found.system_prompt)
  }

  return (
    <div className="relative flex items-center gap-1">
      <UserCircle size={12} className="shrink-0 text-slate-400" />
      <div className="relative flex-1">
        <select
          value={value}
          onChange={handleChange}
          className={`w-full appearance-none pr-5 text-[11px] bg-transparent outline-none truncate cursor-pointer ${className}`}
        >
          <option value="" style={{ color: '#1e293b' }}>— Persona —</option>
          {personas.map(p => (
            <option key={p.persona} value={p.persona} style={{ color: '#1e293b' }}>
              {p.persona}{p.author ? ` (${p.author})` : ''}
            </option>
          ))}
        </select>
        <ChevronDown size={10} className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 text-slate-400" />
      </div>
    </div>
  )
}
