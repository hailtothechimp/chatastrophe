import { useState } from 'react'
import { Palette } from 'lucide-react'

export type Theme = 'indigo' | 'dark' | 'ocean' | 'amber' | 'rose'

const THEMES: { id: Theme; label: string; color: string }[] = [
  { id: 'indigo', label: 'Indigo', color: '#4f46e5' },
  { id: 'dark',   label: 'Dark',   color: '#7c3aed' },
  { id: 'ocean',  label: 'Ocean',  color: '#0891b2' },
  { id: 'amber',  label: 'Amber',  color: '#d97706' },
  { id: 'rose',   label: 'Rose',   color: '#e11d48' },
]

const STORAGE_KEY = 'chatastrophe-theme'

export function getTheme(): Theme {
  return (localStorage.getItem(STORAGE_KEY) as Theme) ?? 'indigo'
}

export function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme)
  localStorage.setItem(STORAGE_KEY, theme)
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(getTheme)
  const [open, setOpen] = useState(false)

  function pick(t: Theme) {
    setTheme(t)
    applyTheme(t)
    setOpen(false)
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={`p-1.5 rounded-md transition-colors ${
          open
            ? 'bg-[var(--accent-light)] text-[var(--accent-text)]'
            : 'text-[var(--text-muted)] hover:bg-[var(--surface)]'
        }`}
        title="Choose theme"
      >
        <Palette size={15} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-50 bg-[var(--header-bg)] border border-[var(--header-border)] rounded-xl shadow-lg p-1.5 flex flex-col gap-0.5 min-w-[130px]">
            {THEMES.map(t => (
              <button
                key={t.id}
                onClick={() => pick(t.id)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs transition-colors w-full text-left ${
                  t.id === theme
                    ? 'bg-[var(--accent-light)] text-[var(--accent-text)] font-medium'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--surface)]'
                }`}
              >
                <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                {t.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
