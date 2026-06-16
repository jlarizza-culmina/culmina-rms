'use client'
// src/components/StaffModule.tsx
// Gap 7 staff management: staff_members + roles + staff_location_roles.
import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import type { Role, StaffMember, StaffLocationRole } from '@/lib/types'

interface Props {
  restaurantId: string
  locationId: string
}

type StatusFilter = 'active' | 'inactive' | 'all'

const EMPLOYMENT_OPTIONS: { value: NonNullable<StaffMember['employment_type']>; label: string }[] = [
  { value: 'full_time',  label: 'Full-time' },
  { value: 'part_time',  label: 'Part-time' },
  { value: 'seasonal',   label: 'Seasonal' },
  { value: 'contractor', label: 'Contractor' },
]
const EMPLOYMENT_LABELS: Record<string, string> = Object.fromEntries(EMPLOYMENT_OPTIONS.map(o => [o.value, o.label]))

const STATUS_OPTIONS: StaffMember['status'][] = ['active', 'inactive', 'terminated']
const STATUS_BADGE: Record<string, string> = {
  active:     'bg-green-50 text-green-700 border-green-200',
  inactive:   'bg-amber-50 text-amber-700 border-amber-200',
  terminated: 'bg-red-50 text-red-700 border-red-200',
}

function todayStr(): string { return new Date().toISOString().split('T')[0] }

const blankStaff = (): Partial<StaffMember> => ({
  name: '', preferred_name: '', phone: '', email: '',
  employment_type: 'full_time', hire_date: null, status: 'active',
  hourly_rate: null, emergency_contact_name: '', emergency_contact_phone: '',
  notes: '', pin: '',
})

export default function StaffModule({ restaurantId, locationId }: Props) {
  const supabase = createClient()
  const [staff,       setStaff]       = useState<StaffMember[]>([])
  const [roles,       setRoles]       = useState<Role[]>([])
  const [assignments, setAssignments] = useState<StaffLocationRole[]>([])
  const [locations,   setLocations]   = useState<{ id: string; name: string }[]>([])
  const [loading,     setLoading]     = useState(true)

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active')
  const [search,       setSearch]       = useState('')
  const [draft,        setDraft]        = useState<Partial<StaffMember> | null>(null)
  const [saving,       setSaving]       = useState(false)
  const [error,        setError]        = useState('')

  // Inline role-assignment form
  const [asnDraft, setAsnDraft] = useState<{ location_id: string; role_id: string; is_primary_location: boolean; effective_from: string; effective_until: string } | null>(null)

  const load = useCallback(async () => {
    if (!restaurantId) { setLoading(false); return }
    setLoading(true)
    const [{ data: staffData }, { data: roleData }, { data: locData }] = await Promise.all([
      supabase.from('staff_members').select('*').eq('restaurant_id', restaurantId).order('name'),
      supabase.from('roles').select('*').or(`restaurant_id.is.null,restaurant_id.eq.${restaurantId}`).order('name'),
      supabase.from('locations').select('id,name').eq('restaurant_id', restaurantId).order('name'),
    ])
    const staffRows = (staffData ?? []) as StaffMember[]
    setStaff(staffRows)
    setRoles((roleData ?? []) as Role[])
    setLocations((locData ?? []) as { id: string; name: string }[])

    const staffIds = staffRows.map(s => s.id)
    if (staffIds.length) {
      const { data: asnData } = await supabase.from('staff_location_roles').select('*').in('staff_id', staffIds)
      setAssignments((asnData ?? []) as StaffLocationRole[])
    } else {
      setAssignments([])
    }
    setLoading(false)
  }, [restaurantId, supabase])

  useEffect(() => { load() }, [load])

  function roleNames(staffId: string): string {
    const names = assignments
      .filter(a => a.staff_id === staffId && (!a.effective_until || a.effective_until >= todayStr()))
      .map(a => roles.find(r => r.id === a.role_id)?.name)
      .filter(Boolean) as string[]
    return names.length ? Array.from(new Set(names)).join(', ') : '—'
  }

  const filtered = staff.filter(s => {
    const matchStatus = statusFilter === 'all' ? true : s.status === statusFilter
    const matchSearch = !search || `${s.name} ${s.preferred_name}`.toLowerCase().includes(search.toLowerCase())
    return matchStatus && matchSearch
  })

  function setPin() {
    const v = prompt('Enter new 4-digit PIN:')
    if (v === null) return
    if (!/^\d{4}$/.test(v)) { alert('PIN must be exactly 4 digits'); return }
    // Stored as plain text for now — PIN hashing lands with the PIN login flow (Phase 1b).
    setDraft(p => ({ ...p!, pin: v }))
  }

  async function saveStaff() {
    if (!draft) return
    setError('')
    if (!draft.name?.trim()) { setError('Name is required'); return }
    setSaving(true)
    const payload = {
      restaurant_id:           restaurantId,
      name:                    draft.name!.trim(),
      preferred_name:          draft.preferred_name || '',
      phone:                   draft.phone || '',
      email:                   draft.email || '',
      employment_type:         draft.employment_type ?? null,
      hire_date:               draft.hire_date || null,
      status:                  draft.status ?? 'active',
      hourly_rate:             draft.hourly_rate ?? null,
      emergency_contact_name:  draft.emergency_contact_name || '',
      emergency_contact_phone: draft.emergency_contact_phone || '',
      notes:                   draft.notes || '',
      pin:                     draft.pin || '',
    }
    if (draft.id) {
      await supabase.from('staff_members').update(payload).eq('id', draft.id)
    } else {
      await supabase.from('staff_members').insert(payload)
    }
    setSaving(false)
    setDraft(null)
    load()
  }

  async function addAssignment() {
    if (!draft?.id || !asnDraft) return
    if (!asnDraft.location_id || !asnDraft.role_id) { alert('Select a location and a role'); return }
    await supabase.from('staff_location_roles').insert({
      staff_id:            draft.id,
      location_id:         asnDraft.location_id,
      role_id:             asnDraft.role_id,
      is_primary_location: asnDraft.is_primary_location,
      effective_from:      asnDraft.effective_from || todayStr(),
      effective_until:     asnDraft.effective_until || null,
    })
    setAsnDraft(null)
    load()
  }

  async function endAssignment(a: StaffLocationRole) {
    await supabase.from('staff_location_roles').update({ effective_until: todayStr() }).eq('id', a.id)
    load()
  }

  if (loading) return <div className="text-sm text-[--muted] py-8">Loading staff…</div>

  const draftAssignments = draft?.id ? assignments.filter(a => a.staff_id === draft.id) : []

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-1">
          {(['active', 'inactive', 'all'] as StatusFilter[]).map(f => (
            <button key={f} onClick={() => setStatusFilter(f)}
              className={`text-[11px] px-3 py-1 rounded-full border capitalize transition-colors ${statusFilter === f ? 'bg-[--accent] text-white border-[--accent]' : 'border-[--border-2] text-[--muted] hover:bg-[--surface-2]'}`}>
              {f}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name…"
            className="text-xs border border-[--border-2] rounded-lg px-2.5 py-1.5 outline-none focus:border-[--accent] w-44" />
          {!draft && (
            <button onClick={() => { setError(''); setDraft(blankStaff()) }}
              className="px-3 py-1.5 text-xs font-medium bg-[--accent] text-white rounded-lg hover:bg-[--accent-dark] whitespace-nowrap">
              + Add Staff Member
            </button>
          )}
        </div>
      </div>

      {/* Staff list */}
      {filtered.length === 0 ? (
        <p className="text-sm text-[--muted] py-6 text-center">No staff members{statusFilter !== 'all' ? ` (${statusFilter})` : ''}.</p>
      ) : (
        <div className="bg-white rounded-xl border border-[--border] overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[--border] bg-[--surface-2] text-[10px] uppercase tracking-wide text-[--hint]">
                <th className="text-left px-3 py-2">Name</th>
                <th className="text-left px-3 py-2">Employment Type</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-left px-3 py-2">Role(s)</th>
                <th className="text-left px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(s => (
                <tr key={s.id} className="border-b border-[--border] last:border-0 hover:bg-[--surface-2]/40">
                  <td className="px-3 py-2.5 font-medium text-[--text]">
                    {s.name}
                    {s.preferred_name && s.preferred_name !== s.name && <span className="text-[--hint] font-normal"> ({s.preferred_name})</span>}
                  </td>
                  <td className="px-3 py-2.5 text-[--muted]">{s.employment_type ? EMPLOYMENT_LABELS[s.employment_type] : '—'}</td>
                  <td className="px-3 py-2.5">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium capitalize ${STATUS_BADGE[s.status] ?? ''}`}>{s.status}</span>
                  </td>
                  <td className="px-3 py-2.5 text-[--muted]">{roleNames(s.id)}</td>
                  <td className="px-3 py-2.5">
                    <button onClick={() => { setError(''); setAsnDraft(null); setDraft({ ...s }) }}
                      className="px-2 py-0.5 text-[10px] border border-[--border-2] rounded text-[--muted] hover:text-[--text]">Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add / edit form */}
      {draft && (
        <div className="bg-white rounded-xl border border-[--border] p-4 space-y-3">
          <h3 className="font-serif text-sm font-medium text-[--text]">{draft.id ? `Edit: ${draft.name}` : 'Add Staff Member'}</h3>

          <div className="grid grid-cols-2 gap-3">
            <Labeled label="Name *">
              <input value={draft.name ?? ''} onChange={e => setDraft(p => ({ ...p!, name: e.target.value }))} className="fi w-full" autoFocus />
            </Labeled>
            <Labeled label="Preferred name">
              <input value={draft.preferred_name ?? ''} onChange={e => setDraft(p => ({ ...p!, preferred_name: e.target.value }))} className="fi w-full" />
            </Labeled>
            <Labeled label="Phone">
              <input value={draft.phone ?? ''} onChange={e => setDraft(p => ({ ...p!, phone: e.target.value }))} className="fi w-full" />
            </Labeled>
            <Labeled label="Email">
              <input value={draft.email ?? ''} onChange={e => setDraft(p => ({ ...p!, email: e.target.value }))} className="fi w-full" />
            </Labeled>
            <Labeled label="Employment type">
              <select value={draft.employment_type ?? 'full_time'}
                onChange={e => setDraft(p => ({ ...p!, employment_type: e.target.value as StaffMember['employment_type'] }))}
                className="fi w-full bg-white">
                {EMPLOYMENT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Labeled>
            <Labeled label="Hire date">
              <input type="date" value={draft.hire_date ?? ''} onChange={e => setDraft(p => ({ ...p!, hire_date: e.target.value || null }))} className="fi w-full" />
            </Labeled>
            <Labeled label="Status">
              <select value={draft.status ?? 'active'}
                onChange={e => setDraft(p => ({ ...p!, status: e.target.value as StaffMember['status'] }))}
                className="fi w-full bg-white capitalize">
                {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Labeled>
            <Labeled label="Hourly rate ($)">
              <input type="number" step="0.01" value={draft.hourly_rate ?? ''}
                onChange={e => setDraft(p => ({ ...p!, hourly_rate: e.target.value === '' ? null : parseFloat(e.target.value) }))} className="fi w-full" />
            </Labeled>
            <Labeled label="Emergency contact">
              <input value={draft.emergency_contact_name ?? ''} onChange={e => setDraft(p => ({ ...p!, emergency_contact_name: e.target.value }))} className="fi w-full" />
            </Labeled>
            <Labeled label="Emergency phone">
              <input value={draft.emergency_contact_phone ?? ''} onChange={e => setDraft(p => ({ ...p!, emergency_contact_phone: e.target.value }))} className="fi w-full" />
            </Labeled>
            <Labeled label="Notes" cls="col-span-2">
              <textarea rows={2} value={draft.notes ?? ''} onChange={e => setDraft(p => ({ ...p!, notes: e.target.value }))} className="fi w-full resize-none" />
            </Labeled>
          </div>

          {/* PIN section (editing only) */}
          {draft.id && (
            <div className="flex items-center gap-3 border-t border-[--border] pt-3">
              <span className="text-[11px] text-[--muted]">PIN: {draft.pin ? '••••' : 'not set'}</span>
              <button onClick={setPin}
                className="px-3 py-1 text-[11px] border border-[--border-2] rounded-lg text-[--muted] hover:bg-[--surface-2]">
                {draft.pin ? 'Reset PIN' : 'Set PIN'}
              </button>
            </div>
          )}

          {error && <p className="text-[11px] text-red-500">{error}</p>}

          <div className="flex gap-2">
            <button onClick={saveStaff} disabled={saving}
              className="px-4 py-1.5 text-xs font-medium bg-[--accent] text-white rounded-lg hover:bg-[--accent-dark] disabled:opacity-50">
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button onClick={() => { setDraft(null); setAsnDraft(null); setError('') }}
              className="px-4 py-1.5 text-xs border border-[--border-2] text-[--muted] rounded-lg hover:bg-[--surface-2]">
              Cancel
            </button>
          </div>

          {/* Role assignments (editing only) */}
          {draft.id && (
            <div className="border-t border-[--border] pt-3">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-[11px] font-semibold uppercase tracking-wide text-[--hint]">Role assignments</h4>
                {!asnDraft && (
                  <button onClick={() => setAsnDraft({ location_id: locationId ?? '', role_id: '', is_primary_location: false, effective_from: todayStr(), effective_until: '' })}
                    className="text-[11px] text-[--accent] hover:text-[--accent-dark] font-medium">+ Add assignment</button>
                )}
              </div>

              {draftAssignments.length > 0 && (
                <table className="w-full text-[11px] mb-2">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wide text-[--hint] border-b border-[--border]">
                      <th className="text-left py-1.5">Location</th>
                      <th className="text-left py-1.5">Role</th>
                      <th className="text-left py-1.5">Primary</th>
                      <th className="text-left py-1.5">From</th>
                      <th className="text-left py-1.5">Until</th>
                      <th className="text-left py-1.5">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {draftAssignments.map(a => (
                      <tr key={a.id} className="border-b border-[--border] last:border-0">
                        <td className="py-1.5 text-[--muted]">{locations.find(l => l.id === a.location_id)?.name ?? '—'}</td>
                        <td className="py-1.5 text-[--muted]">{roles.find(r => r.id === a.role_id)?.name ?? '—'}</td>
                        <td className="py-1.5 text-[--muted]">{a.is_primary_location ? '✓' : ''}</td>
                        <td className="py-1.5 text-[--muted]">{a.effective_from}</td>
                        <td className="py-1.5 text-[--muted]">{a.effective_until ?? '—'}</td>
                        <td className="py-1.5">
                          {!a.effective_until && (
                            <button onClick={() => endAssignment(a)}
                              className="px-2 py-0.5 text-[10px] border border-red-200 rounded text-red-400 hover:text-red-600">End</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {asnDraft && (
                <div className="bg-[--surface-2] rounded-lg p-3 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <Labeled label="Location">
                      <select value={asnDraft.location_id} onChange={e => setAsnDraft(d => ({ ...d!, location_id: e.target.value }))} className="fi w-full bg-white">
                        <option value="">— select —</option>
                        {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                      </select>
                    </Labeled>
                    <Labeled label="Role">
                      <select value={asnDraft.role_id} onChange={e => setAsnDraft(d => ({ ...d!, role_id: e.target.value }))} className="fi w-full bg-white">
                        <option value="">— select —</option>
                        {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </select>
                    </Labeled>
                    <Labeled label="Effective from">
                      <input type="date" value={asnDraft.effective_from} onChange={e => setAsnDraft(d => ({ ...d!, effective_from: e.target.value }))} className="fi w-full" />
                    </Labeled>
                    <Labeled label="Effective until (optional)">
                      <input type="date" value={asnDraft.effective_until} onChange={e => setAsnDraft(d => ({ ...d!, effective_until: e.target.value }))} className="fi w-full" />
                    </Labeled>
                  </div>
                  <label className="flex items-center gap-2 text-[11px] cursor-pointer">
                    <input type="checkbox" checked={asnDraft.is_primary_location}
                      onChange={e => setAsnDraft(d => ({ ...d!, is_primary_location: e.target.checked }))} className="accent-[--accent]" />
                    Primary location
                  </label>
                  <div className="flex gap-2">
                    <button onClick={addAssignment}
                      className="px-3 py-1 text-[11px] font-medium bg-[--accent] text-white rounded-lg hover:bg-[--accent-dark]">Save</button>
                    <button onClick={() => setAsnDraft(null)}
                      className="px-3 py-1 text-[11px] border border-[--border-2] text-[--muted] rounded-lg hover:bg-white">Cancel</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Labeled({ label, children, cls = '' }: { label: string; children?: React.ReactNode; cls?: string }) {
  return (
    <div className={cls}>
      <label className="block text-[11px] font-medium text-[--muted] mb-1">{label}</label>
      {children}
    </div>
  )
}
