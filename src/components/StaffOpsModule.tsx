'use client'
// src/components/StaffOpsModule.tsx
// Build 1: Staff management + custom roles with entitlement matrix

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase'

// ── Types ─────────────────────────────────────────────────────
interface Role {
  id: string
  name: string
  color: string
  description: string
  is_system: boolean
  sort_order: number
}

interface Entitlement {
  module: string
  can_view: boolean
  can_edit: boolean
  can_admin: boolean
}

interface StaffMember {
  id: string
  name: string
  role_id: string | null
  pin: string | null
  email: string
  phone: string
  is_active: boolean
  role?: Role
}

type OpsTab = 'staff' | 'roles'

const MODULES = [
  { key: 'recipes',    label: 'Recipes' },
  { key: 'library',   label: 'Library' },
  { key: 'menus',     label: 'Menus' },
  { key: 'production',label: 'Production' },
  { key: 'analytics', label: 'Analytics' },
  { key: 'waitlist',  label: 'Waitlist' },
  { key: 'tasks',     label: 'Tasks' },
  { key: 'labels',    label: 'Labels' },
  { key: 'settings',  label: 'Settings' },
]

const ROLE_COLORS = [
  '#C05A2A','#2E6B25','#2A61A0','#7C3AED',
  '#D97706','#6B7280','#DC2626','#0891B2',
]

interface Props {
  userId: string
  restaurantId?: string
}

// ── Component ─────────────────────────────────────────────────
export default function StaffOpsModule({ userId, restaurantId }: Props) {
  const supabase = createClient()
  const [tab,     setTab]     = useState<OpsTab>('staff')
  const [roles,   setRoles]   = useState<Role[]>([])
  const [staff,   setStaff]   = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!restaurantId) return
    setLoading(true)
    const [{ data: r }, { data: s }] = await Promise.all([
      supabase.from('app_roles').select('*').eq('restaurant_id', restaurantId).order('sort_order'),
      supabase.from('staff_members').select('*').eq('restaurant_id', restaurantId).order('name'),
    ])
    const roleList = r ?? []
    setRoles(roleList)
    setStaff((s ?? []).map((m: any) => ({ ...m, role: roleList.find((rl: Role) => rl.id === m.role_id) })))
    setLoading(false)
  }, [restaurantId])

  useEffect(() => { load() }, [load])

  if (loading) return (
    <div className="flex items-center justify-center h-full text-[--hint] text-sm">
      Loading staff & operations…
    </div>
  )

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="bg-white border-b border-[--border] px-6 py-4 flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <h1 className="font-serif text-xl font-medium text-[--text]">Staff & Operations</h1>
        </div>
        <div className="flex bg-[--surface-2] rounded-lg p-0.5 gap-0.5 w-fit">
          {([['staff','👥 Staff'], ['roles','🔐 Roles']] as [OpsTab, string][]).map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)}
              className={`px-4 py-1.5 text-xs font-medium rounded-md transition-all ${tab === key ? 'bg-white text-[--text] shadow-sm' : 'text-[--muted]'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {tab === 'staff'  && <StaffTab   staff={staff} roles={roles} restaurantId={restaurantId!} userId={userId} onRefresh={load} supabase={supabase} />}
        {tab === 'roles'  && <RolesTab   roles={roles} restaurantId={restaurantId!} onRefresh={load} supabase={supabase} />}
      </div>
    </div>
  )
}

// ── Staff Tab ─────────────────────────────────────────────────
function StaffTab({ staff, roles, restaurantId, userId, onRefresh, supabase }: {
  staff: StaffMember[]; roles: Role[]; restaurantId: string
  userId: string; onRefresh: () => void; supabase: any
}) {
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState<StaffMember | null>(null)
  const [form, setForm]       = useState({ name: '', role_id: '', pin: '', email: '', phone: '' })
  const [saving, setSaving]   = useState(false)

  function openAdd()          { setForm({ name: '', role_id: roles[0]?.id ?? '', pin: '', email: '', phone: '' }); setEditing(null); setShowAdd(true) }
  function openEdit(m: StaffMember) { setForm({ name: m.name, role_id: m.role_id ?? '', pin: m.pin ?? '', email: m.email, phone: m.phone }); setEditing(m); setShowAdd(true) }

  async function save() {
    setSaving(true)
    if (editing) {
      await supabase.from('staff_members').update({ ...form, role_id: form.role_id || null }).eq('id', editing.id)
    } else {
      await supabase.from('staff_members').insert({ ...form, restaurant_id: restaurantId, role_id: form.role_id || null })
    }
    setSaving(false)
    setShowAdd(false)
    onRefresh()
  }

  async function toggleActive(m: StaffMember) {
    await supabase.from('staff_members').update({ is_active: !m.is_active }).eq('id', m.id)
    onRefresh()
  }

  const active   = staff.filter(m => m.is_active)
  const inactive = staff.filter(m => !m.is_active)

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-sm font-medium text-[--text]">
          Team Members <span className="font-sans text-[--hint] font-normal ml-1">({active.length} active)</span>
        </h2>
        <button onClick={openAdd}
          className="px-3 py-1.5 bg-[--accent] text-white text-xs font-medium rounded-lg hover:bg-[--accent-dark]">
          + Add staff
        </button>
      </div>

      {/* Add / Edit form */}
      {showAdd && (
        <div className="bg-[--accent-light]/20 border border-[--accent]/30 rounded-xl p-4 space-y-3">
          <h3 className="text-xs font-medium text-[--text]">{editing ? 'Edit' : 'New'} team member</h3>
          <div className="grid grid-cols-2 gap-3">
            {[
              { key: 'name',  label: 'Full name',  placeholder: 'Maria Rossi' },
              { key: 'email', label: 'Email',       placeholder: 'maria@corretto.com' },
              { key: 'phone', label: 'Phone',       placeholder: '+1 203 555 0100' },
              { key: 'pin',   label: 'PIN (4 digits)', placeholder: '----', maxLength: 4 },
            ].map(f => (
              <div key={f.key}>
                <label className="block text-[10px] text-[--muted] mb-1">{f.label}</label>
                <input value={(form as any)[f.key]} placeholder={f.placeholder}
                  maxLength={(f as any).maxLength}
                  onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                  className="w-full text-xs border border-[--border-2] rounded-lg px-2.5 py-1.5 bg-white outline-none focus:border-[--accent]" />
              </div>
            ))}
            <div>
              <label className="block text-[10px] text-[--muted] mb-1">Role</label>
              <select value={form.role_id} onChange={e => setForm(p => ({ ...p, role_id: e.target.value }))}
                className="w-full text-xs border border-[--border-2] rounded-lg px-2.5 py-1.5 bg-white outline-none focus:border-[--accent]">
                <option value="">— No role —</option>
                {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={save} disabled={!form.name || saving}
              className="px-4 py-1.5 bg-[--accent] text-white text-xs rounded-lg hover:bg-[--accent-dark] disabled:opacity-50">
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button onClick={() => setShowAdd(false)}
              className="px-4 py-1.5 border border-[--border-2] text-[--muted] text-xs rounded-lg hover:bg-[--surface-2]">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Staff list */}
      <div className="space-y-1.5">
        {active.map(m => (
          <div key={m.id} className="bg-white rounded-xl border border-[--border] flex items-center px-4 py-3 gap-3">
            {/* Avatar */}
            <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold text-white flex-shrink-0"
              style={{ background: m.role?.color ?? '#6B7280' }}>
              {m.name.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-[--text]">{m.name}</div>
              <div className="text-[10px] text-[--muted] flex items-center gap-2">
                {m.role && (
                  <span className="px-1.5 py-0.5 rounded-full text-white text-[9px]"
                    style={{ background: m.role.color }}>{m.role.name}</span>
                )}
                {m.email && <span>{m.email}</span>}
                {m.pin && <span>PIN: {'•'.repeat(4)}</span>}
              </div>
            </div>
            <div className="flex gap-1.5">
              <button onClick={() => openEdit(m)}
                className="text-[11px] px-2 py-1 border border-[--border-2] text-[--muted] rounded-lg hover:bg-[--surface-2]">
                ✎
              </button>
              <button onClick={() => toggleActive(m)}
                className="text-[11px] px-2 py-1 border border-[--border-2] text-[--muted] rounded-lg hover:bg-red-50 hover:text-red-500 hover:border-red-200">
                Archive
              </button>
            </div>
          </div>
        ))}
        {active.length === 0 && (
          <div className="text-center py-12 text-[--muted]">
            <div className="text-4xl opacity-20 mb-3">👥</div>
            <p className="text-sm">No staff yet. Add your first team member.</p>
          </div>
        )}
      </div>

      {/* Archived */}
      {inactive.length > 0 && (
        <details className="group">
          <summary className="text-[11px] text-[--hint] cursor-pointer hover:text-[--muted] list-none flex items-center gap-1">
            <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
            {inactive.length} archived
          </summary>
          <div className="mt-2 space-y-1 opacity-60">
            {inactive.map(m => (
              <div key={m.id} className="bg-white rounded-xl border border-[--border] flex items-center px-4 py-2.5 gap-3">
                <div className="w-7 h-7 rounded-full bg-[--surface-2] flex items-center justify-center text-xs text-[--muted] flex-shrink-0">
                  {m.name[0]}
                </div>
                <span className="text-xs text-[--muted] flex-1 line-through">{m.name}</span>
                <button onClick={() => toggleActive(m)}
                  className="text-[10px] text-[--accent] hover:underline">Restore</button>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

// ── Roles Tab ─────────────────────────────────────────────────
function RolesTab({ roles, restaurantId, onRefresh, supabase }: {
  roles: Role[]; restaurantId: string; onRefresh: () => void; supabase: any
}) {
  const [selected,    setSelected]    = useState<Role | null>(roles[0] ?? null)
  const [entitlements, setEntitlements] = useState<Record<string, Entitlement>>({})
  const [showAddRole, setShowAddRole] = useState(false)
  const [newRole, setNewRole]         = useState({ name: '', color: ROLE_COLORS[0], description: '' })
  const [saving, setSaving]           = useState(false)

  // Load entitlements for selected role
  useEffect(() => {
    if (!selected) return
    supabase.from('role_entitlements').select('*').eq('role_id', selected.id)
      .then(({ data }: any) => {
        const map: Record<string, Entitlement> = {}
        for (const m of MODULES) {
          const found = (data ?? []).find((e: any) => e.module === m.key)
          map[m.key] = found ?? { module: m.key, can_view: false, can_edit: false, can_admin: false }
        }
        setEntitlements(map)
      })
  }, [selected?.id])

  async function saveEntitlements() {
    if (!selected) return
    setSaving(true)
    for (const [mod, ent] of Object.entries(entitlements)) {
      await supabase.from('role_entitlements').upsert(
        { role_id: selected.id, module: mod, can_view: ent.can_view, can_edit: ent.can_edit, can_admin: ent.can_admin },
        { onConflict: 'role_id,module' }
      )
    }
    setSaving(false)
  }

  async function addRole() {
    if (!newRole.name.trim()) return
    setSaving(true)
    await supabase.from('app_roles').insert({
      restaurant_id: restaurantId, ...newRole, sort_order: roles.length + 1,
    })
    setSaving(false)
    setShowAddRole(false)
    setNewRole({ name: '', color: ROLE_COLORS[0], description: '' })
    onRefresh()
  }

  async function deleteRole(role: Role) {
    if (role.is_system) return
    if (!confirm(`Delete role "${role.name}"? Staff assigned to this role will be unassigned.`)) return
    await supabase.from('app_roles').delete().eq('id', role.id)
    setSelected(roles.find(r => r.id !== role.id) ?? null)
    onRefresh()
  }

  function setLevel(module: string, level: 'none' | 'view' | 'edit' | 'admin') {
    setEntitlements(prev => ({
      ...prev,
      [module]: {
        module,
        can_view:  level !== 'none',
        can_edit:  level === 'edit' || level === 'admin',
        can_admin: level === 'admin',
      }
    }))
  }

  function getLevel(module: string): 'none' | 'view' | 'edit' | 'admin' {
    const e = entitlements[module]
    if (!e) return 'none'
    if (e.can_admin) return 'admin'
    if (e.can_edit)  return 'edit'
    if (e.can_view)  return 'view'
    return 'none'
  }

  const LEVELS = [
    { key: 'none',  label: 'None',  bg: 'bg-[--surface-2] text-[--hint]' },
    { key: 'view',  label: 'View',  bg: 'bg-blue-50 text-blue-700 border border-blue-200' },
    { key: 'edit',  label: 'Edit',  bg: 'bg-amber-50 text-amber-700 border border-amber-200' },
    { key: 'admin', label: 'Admin', bg: 'bg-red-50 text-red-700 border border-red-200' },
  ] as const

  return (
    <div className="flex gap-5 max-w-5xl">
      {/* Role list sidebar */}
      <div className="w-48 flex-shrink-0 space-y-1.5">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-[--hint] mb-2">Roles</div>
        {roles.map(role => (
          <button key={role.id}
            onClick={() => setSelected(role)}
            className={`w-full text-left px-3 py-2.5 rounded-xl border text-xs font-medium transition-colors ${selected?.id === role.id ? 'border-[--accent] bg-[--accent-light]/20 text-[--accent]' : 'border-[--border] bg-white text-[--text] hover:bg-[--surface-2]'}`}>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: role.color }} />
              {role.name}
            </div>
            {role.is_system && <div className="text-[9px] text-[--hint] mt-0.5 ml-4">system</div>}
          </button>
        ))}
        <button onClick={() => setShowAddRole(true)}
          className="w-full text-left px-3 py-2 rounded-xl border border-dashed border-[--border-2] text-[11px] text-[--hint] hover:border-[--accent] hover:text-[--accent] transition-colors">
          + New role
        </button>

        {/* Add role form */}
        {showAddRole && (
          <div className="bg-white border border-[--accent]/40 rounded-xl p-3 space-y-2">
            <input value={newRole.name} onChange={e => setNewRole(p => ({ ...p, name: e.target.value }))}
              placeholder="Role name" className="w-full text-xs border border-[--border-2] rounded-lg px-2 py-1.5 outline-none focus:border-[--accent]" />
            <input value={newRole.description} onChange={e => setNewRole(p => ({ ...p, description: e.target.value }))}
              placeholder="Description" className="w-full text-xs border border-[--border-2] rounded-lg px-2 py-1.5 outline-none focus:border-[--accent]" />
            {/* Color picker */}
            <div className="flex flex-wrap gap-1">
              {ROLE_COLORS.map(c => (
                <button key={c} onClick={() => setNewRole(p => ({ ...p, color: c }))}
                  className={`w-5 h-5 rounded-full transition-all ${newRole.color === c ? 'ring-2 ring-offset-1 ring-[--accent]' : ''}`}
                  style={{ background: c }} />
              ))}
            </div>
            <div className="flex gap-1.5">
              <button onClick={addRole} disabled={!newRole.name || saving}
                className="flex-1 py-1 bg-[--accent] text-white text-[11px] rounded-lg disabled:opacity-50">
                {saving ? '…' : 'Add'}
              </button>
              <button onClick={() => setShowAddRole(false)}
                className="flex-1 py-1 border border-[--border-2] text-[--muted] text-[11px] rounded-lg">
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Entitlement matrix */}
      {selected ? (
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full" style={{ background: selected.color }} />
                <h2 className="font-serif text-base font-medium text-[--text]">{selected.name}</h2>
                {selected.is_system && <span className="text-[9px] bg-[--surface-2] text-[--hint] px-1.5 py-0.5 rounded">system</span>}
              </div>
              {selected.description && <p className="text-xs text-[--muted] mt-0.5 ml-5">{selected.description}</p>}
            </div>
            <div className="flex gap-2">
              <button onClick={saveEntitlements} disabled={saving}
                className="px-4 py-1.5 bg-[--accent] text-white text-xs rounded-lg hover:bg-[--accent-dark] disabled:opacity-50">
                {saving ? 'Saving…' : '✓ Save permissions'}
              </button>
              {!selected.is_system && (
                <button onClick={() => deleteRole(selected)}
                  className="px-3 py-1.5 border border-red-200 text-red-500 text-xs rounded-lg hover:bg-red-50">
                  Delete role
                </button>
              )}
            </div>
          </div>

          {/* Permission table */}
          <div className="bg-white rounded-xl border border-[--border] overflow-hidden">
            <div className="grid grid-cols-[1fr_repeat(4,auto)] bg-[--surface-2] border-b border-[--border]">
              <div className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-[--hint]">Module</div>
              {LEVELS.map(l => (
                <div key={l.key} className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-[--hint] text-center w-20">{l.label}</div>
              ))}
            </div>
            {MODULES.map((m, i) => {
              const current = getLevel(m.key)
              return (
                <div key={m.key} className={`grid grid-cols-[1fr_repeat(4,auto)] border-b border-[--border] last:border-0 ${i%2===0?'bg-white':'bg-[--surface-2]/30'}`}>
                  <div className="px-4 py-3 text-xs font-medium text-[--text]">{m.label}</div>
                  {LEVELS.map(l => (
                    <div key={l.key} className="flex items-center justify-center w-20 py-3">
                      <button
                        onClick={() => setLevel(m.key, l.key)}
                        className={`w-5 h-5 rounded-full border-2 transition-all flex items-center justify-center ${current === l.key ? 'border-transparent ' + l.bg + ' scale-110' : 'border-[--border-2] hover:border-[--accent]/40'}`}>
                        {current === l.key && <span className="text-[8px] font-bold">✓</span>}
                      </button>
                    </div>
                  ))}
                </div>
              )
            })}
          </div>

          <p className="text-[10px] text-[--hint] mt-3">
            <strong>None</strong> — hidden · <strong>View</strong> — read-only · <strong>Edit</strong> — create &amp; modify · <strong>Admin</strong> — full access including delete &amp; settings
          </p>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-[--muted] text-sm">
          Select a role to configure permissions
        </div>
      )}
    </div>
  )
}
