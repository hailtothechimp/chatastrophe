import { useState, useEffect } from 'react'
import { getPersonas } from '../api'
import type { Persona } from '../api'

interface Props {
  onSelect: (systemPrompt: string) => void
}

export default function PersonaPicker({ onSelect }: Props) {
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
    <select
      value={value}
      onChange={handleChange}
      className="text-xs px-2 py-0.5 rounded border border-slate-300 bg-white text-slate-600 outline-none focus:ring-1 focus:ring-indigo-400 cursor-pointer"
    >
      <option value="">Persona</option>
      {[...personas].sort((a, b) => a.persona.localeCompare(b.persona)).map(p => (
        <option key={p.persona} value={p.persona}>
          {p.persona}{p.author ? ` (${p.book} — ${p.author.split(' ').at(-1)})` : p.show ? ` (${p.show})` : ''}
        </option>
      ))}
    </select>
  )
}
