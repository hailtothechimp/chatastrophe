import { useState, useEffect } from 'react'
import { X, Plus, Trash2, Shield, ShieldOff, Key } from 'lucide-react'
import { listUsers, createAdminUser, updateAdminUser, deleteAdminUser } from '../api'
import type { AdminUser } from '../api'

interface Props {
  currentUser: string
  onClose: () => void
}

export default function UserManager({ currentUser, onClose }: Props) {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [newUsername, setNewUsername] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newIsAdmin, setNewIsAdmin] = useState(false)
  const [creating, setCreating] = useState(false)
  const [editingUser, setEditingUser] = useState<string | null>(null)
  const [editPassword, setEditPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const data = await listUsers()
    setUsers(data)
  }

  useEffect(() => { load().catch(console.error) }, [])

  async function handleCreate() {
    if (!newUsername.trim() || !newPassword) return
    setCreating(true)
    setError(null)
    try {
      await createAdminUser(newUsername.trim(), newPassword, newIsAdmin)
      setNewUsername('')
      setNewPassword('')
      setNewIsAdmin(false)
      await load()
    } catch (e: unknown) {
      setError(String(e))
    } finally {
      setCreating(false)
    }
  }

  async function handleUpdatePassword(username: string) {
    if (!editPassword) return
    setError(null)
    try {
      await updateAdminUser(username, { password: editPassword })
      setEditingUser(null)
      setEditPassword('')
    } catch (e: unknown) {
      setError(String(e))
    }
  }

  async function handleToggleAdmin(username: string, currentIsAdmin: boolean) {
    setError(null)
    try {
      await updateAdminUser(username, { is_admin: !currentIsAdmin })
      await load()
    } catch (e: unknown) {
      setError(String(e))
    }
  }

  async function handleDelete(username: string) {
    if (!confirm(`Delete user "${username}"? This cannot be undone.`)) return
    setError(null)
    try {
      await deleteAdminUser(username)
      await load()
    } catch (e: unknown) {
      setError(String(e))
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-[var(--header-bg)] rounded-2xl shadow-2xl w-[560px] max-h-[80vh] flex flex-col border border-[var(--panel-border)]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--panel-border)]">
          <div className="flex items-center gap-2">
            <Shield size={16} className="text-[var(--accent)]" />
            <h2 className="font-semibold text-[var(--text-primary)]">User Management</h2>
            <span className="text-xs text-[var(--text-muted)]">({users.length} users)</span>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X size={16} />
          </button>
        </div>

        {/* Create new user */}
        <div className="px-5 py-4 border-b border-[var(--panel-border)] bg-[var(--panel-bg)]">
          <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">Add New User</p>
          <div className="flex gap-2 mb-2">
            <input
              value={newUsername}
              onChange={e => setNewUsername(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              placeholder="Username"
              className="flex-1 px-3 py-1.5 text-sm rounded-lg border border-[var(--panel-border)] bg-[var(--main-bg)] text-[var(--text-primary)] outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
            <input
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              placeholder="Password"
              className="flex-1 px-3 py-1.5 text-sm rounded-lg border border-[var(--panel-border)] bg-[var(--main-bg)] text-[var(--text-primary)] outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </div>
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={newIsAdmin}
                onChange={e => setNewIsAdmin(e.target.checked)}
                className="accent-[var(--accent)]"
              />
              <span className="text-xs text-[var(--text-secondary)]">Grant admin access</span>
            </label>
            <button
              onClick={handleCreate}
              disabled={creating || !newUsername.trim() || !newPassword}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors"
            >
              <Plus size={13} /> {creating ? 'Creating…' : 'Create User'}
            </button>
          </div>
          {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
        </div>

        {/* User list */}
        <div className="overflow-y-auto flex-1">
          {users.map(u => (
            <div key={u.username} className="flex items-center gap-3 px-5 py-3 border-b border-[var(--panel-border)] hover:bg-[var(--surface)] group">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <p className="text-sm font-medium text-[var(--text-primary)]">{u.username}</p>
                  {u.is_admin && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent-light)] text-[var(--accent-text)] font-medium">admin</span>
                  )}
                  {u.username === currentUser && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--surface)] text-[var(--text-muted)]">you</span>
                  )}
                </div>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  Created {new Date(u.created_at).toLocaleDateString()}
                </p>
                {editingUser === u.username && (
                  <div className="flex items-center gap-2 mt-2">
                    <input
                      type="password"
                      value={editPassword}
                      onChange={e => setEditPassword(e.target.value)}
                      placeholder="New password"
                      autoFocus
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleUpdatePassword(u.username)
                        if (e.key === 'Escape') { setEditingUser(null); setEditPassword('') }
                      }}
                      className="flex-1 px-2 py-1 text-xs rounded border border-[var(--panel-border)] bg-[var(--main-bg)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--accent)]"
                    />
                    <button
                      onClick={() => handleUpdatePassword(u.username)}
                      disabled={!editPassword}
                      className="px-2 py-1 text-xs bg-[var(--accent)] text-white rounded disabled:opacity-40 transition-colors"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => { setEditingUser(null); setEditPassword('') }}
                      className="px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>

              {/* Action buttons — visible on hover */}
              <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-all">
                <button
                  onClick={() => { setEditingUser(u.username); setEditPassword('') }}
                  title="Change password"
                  className="p-1.5 rounded text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent-light)] transition-colors"
                >
                  <Key size={13} />
                </button>
                {u.username !== currentUser && (
                  <>
                    <button
                      onClick={() => handleToggleAdmin(u.username, u.is_admin)}
                      title={u.is_admin ? 'Remove admin' : 'Make admin'}
                      className="p-1.5 rounded text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent-light)] transition-colors"
                    >
                      {u.is_admin ? <ShieldOff size={13} /> : <Shield size={13} />}
                    </button>
                    <button
                      onClick={() => handleDelete(u.username)}
                      title={`Delete ${u.username}`}
                      className="p-1.5 rounded text-[var(--text-muted)] hover:text-red-500 hover:bg-red-50 transition-colors"
                    >
                      <Trash2 size={13} />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
          {users.length === 0 && (
            <p className="px-5 py-8 text-sm text-[var(--text-muted)] text-center">No users found.</p>
          )}
        </div>
      </div>
    </div>
  )
}
