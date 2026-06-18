'use client'
// src/components/StaffModule.tsx
// Gap 7 staff management: staff_members + roles + staff_location_roles.
import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import type { Role, StaffMember, StaffLocationRole, SkillDefinition, SkillLevel, StaffSkill, CertificationDefinition, StaffCertification } from '@/lib/types'

interface Props {
  restaurantId: string
  locationId: string
  currentStaffId?: string
}

type StatusFilter = 'active' | 'inactive' | 'all'
type EditTab = 'profile' | 'access' | 'skills' | 'certifications'

const CAT_LABELS: Record<string, string> = { boh: 'BOH', bar: 'Bar', foh: 'FOH', management: 'Management', general: 'General' }
const LEVEL_DOT: Record<string, string> = { learning: '#9CA3AF', competent: '#2563EB', proficient: '#16A34A', expert: '#D97706' }
function levelDot(name: string): string { return LEVEL_DOT[name.toLowerCase()] ?? '#9CA3AF' }

const CERT_CAT_LABELS: Record<string, string> = { food_safety: 'Food Safety', alcohol: 'Alcohol', health: 'Health', legal: 'Legal', other: 'Other' }
const CERT_BADGE: Record<string, string> = {
  active:        'bg-green-50 text-green-700 border-green-200',
  expiring_soon: 'bg-amber-50 text-amber-700 border-amber-200',
  expired:       'bg-red-50 text-red-700 border-red-200',
  pending:       'bg-[--surface-2] text-[--muted] border-[--border]',
  revoked:       'bg-red-100 text-red-800 border-red-300',
}
function addMonthsStr(dateStr: string, months: number): string {
  const d = new Date(dateStr + 'T12:00:00'); d.setMonth(d.getMonth() + months); return d.toISOString().split('T')[0]
}
function addDaysStr(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00'); d.setDate(d.getDate() + days); return d.toISOString().split('T')[0]
}

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

export default function StaffModule({ restaurantId, locationId, currentStaffId }: Props) {
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
  const [editTab,      setEditTab]      = useState<EditTab>('profile')

  // Skills tab
  const [skillDefs,   setSkillDefs]   = useState<SkillDefinition[]>([])
  const [skillLevels, setSkillLevels] = useState<SkillLevel[]>([])
  const [staffSkills, setStaffSkills] = useState<StaffSkill[]>([])
  const [showInactiveSkills, setShowInactiveSkills] = useState(false)
  const [skillDraft, setSkillDraft] = useState<{ id?: string; skill_id: string; level_id: string; achieved_date: string; notes: string } | null>(null)

  // Certifications tab
  const [certDefs, setCertDefs] = useState<CertificationDefinition[]>([])
  const [allCerts, setAllCerts] = useState<StaffCertification[]>([])
  const [certDraft, setCertDraft] = useState<{ id?: string; certification_id: string; issue_date: string; expiry_date: string; certificate_number: string; issuing_body: string; status: 'active' | 'pending' | 'revoked'; document_url: string; notes: string } | null>(null)

  // Inline role-assignment form
  const [asnDraft, setAsnDraft] = useState<{ location_id: string; role_id: string; is_primary_location: boolean; effective_from: string; effective_until: string } | null>(null)

  const load = useCallback(async () => {
    if (!restaurantId) { setLoading(false); return }
    setLoading(true)
    const [{ data: staffData }, { data: roleData }, { data: locData }, { data: defs }, { data: lvls }, { data: cdefs }] = await Promise.all([
      supabase.from('staff_members').select('*').eq('restaurant_id', restaurantId).order('name'),
      supabase.from('roles').select('*').or(`restaurant_id.is.null,restaurant_id.eq.${restaurantId}`).order('name'),
      supabase.from('locations').select('id,name').eq('restaurant_id', restaurantId).order('name'),
      supabase.from('skill_definitions').select('*').or(`restaurant_id.is.null,restaurant_id.eq.${restaurantId}`).eq('is_active', true).order('category').order('sort_order'),
      supabase.from('skill_levels').select('*').is('skill_id', null).order('value'),
      supabase.from('certification_definitions').select('*').or(`restaurant_id.is.null,restaurant_id.eq.${restaurantId}`).eq('is_active', true).order('sort_order'),
    ])
    const staffRows = (staffData ?? []) as StaffMember[]
    setStaff(staffRows)
    setRoles((roleData ?? []) as Role[])
    setLocations((locData ?? []) as { id: string; name: string }[])
    setSkillDefs((defs ?? []) as SkillDefinition[])
    setSkillLevels((lvls ?? []) as SkillLevel[])
    setCertDefs((cdefs ?? []) as CertificationDefinition[])

    const staffIds = staffRows.map(s => s.id)
    if (staffIds.length) {
      const [{ data: asnData }, { data: certData }] = await Promise.all([
        supabase.from('staff_location_roles').select('*').in('staff_id', staffIds),
        supabase.from('staff_certifications').select('*').in('staff_id', staffIds),
      ])
      setAssignments((asnData ?? []) as StaffLocationRole[])
      setAllCerts((certData ?? []) as StaffCertification[])
    } else {
      setAssignments([])
      setAllCerts([])
    }
    setLoading(false)
  }, [restaurantId, supabase])

  useEffect(() => { load() }, [load])

  const loadSkills = useCallback(async (staffId: string) => {
    let q = supabase.from('staff_skills').select('*').eq('staff_id', staffId)
    if (!showInactiveSkills) q = q.eq('is_active', true)
    const { data } = await q
    setStaffSkills((data ?? []) as StaffSkill[])
  }, [supabase, showInactiveSkills])

  useEffect(() => {
    if (draft?.id) loadSkills(draft.id)
    else setStaffSkills([])
  }, [draft?.id, loadSkills])

  function openAddSkill() { setSkillDraft({ skill_id: '', level_id: '', achieved_date: todayStr(), notes: '' }) }
  function openEditSkill(ss: StaffSkill) {
    setSkillDraft({ id: ss.id, skill_id: ss.skill_id, level_id: ss.level_id, achieved_date: ss.achieved_date ?? todayStr(), notes: ss.notes ?? '' })
  }
  async function saveSkill() {
    if (!draft?.id || !skillDraft) return
    if (!skillDraft.skill_id || !skillDraft.level_id) { alert('Pick a skill and a level'); return }
    const verified_by = currentStaffId ?? null
    const verified_at = currentStaffId ? new Date().toISOString() : null
    // Editing an existing skill means a level change — retire the old row to preserve history.
    if (skillDraft.id) {
      await supabase.from('staff_skills').update({ is_active: false, updated_at: new Date().toISOString() }).eq('id', skillDraft.id)
    }
    await supabase.from('staff_skills').insert({
      staff_id: draft.id, skill_id: skillDraft.skill_id, level_id: skillDraft.level_id,
      achieved_date: skillDraft.achieved_date || null, notes: skillDraft.notes || '',
      is_active: true, verified_by, verified_at,
    })
    setSkillDraft(null)
    loadSkills(draft.id)
  }

  // ── Certifications ────────────────────────────────────────────
  function certStatusOf(c: StaffCertification): 'active' | 'expiring_soon' | 'expired' | 'pending' | 'revoked' {
    if (c.status === 'revoked') return 'revoked'
    if (c.status === 'pending') return 'pending'
    const today = todayStr()
    if (c.expiry_date) {
      if (c.expiry_date < today) return 'expired'
      if (c.expiry_date <= addDaysStr(today, 30)) return 'expiring_soon'
    }
    return 'active'
  }
  function staffCertDot(staffId: string): { color: string; label: string } {
    const certs = allCerts.filter(c => c.staff_id === staffId)
    if (!certs.length) return { color: '#D1D5DB', label: 'No certifications' }
    const today = todayStr()
    const soon = addDaysStr(today, 30)
    if (certs.some(c => c.status === 'active' && c.expiry_date && c.expiry_date < today)) return { color: '#DC2626', label: 'Cert expired' }
    if (certs.some(c => c.expiry_date && c.expiry_date >= today && c.expiry_date <= soon)) return { color: '#D97706', label: 'Cert expiring' }
    return { color: '#16A34A', label: 'All current' }
  }

  function openAddCert() { setCertDraft({ certification_id: '', issue_date: '', expiry_date: '', certificate_number: '', issuing_body: '', status: 'active', document_url: '', notes: '' }) }
  function openEditCert(c: StaffCertification) {
    setCertDraft({
      id: c.id, certification_id: c.certification_id, issue_date: c.issue_date ?? '', expiry_date: c.expiry_date ?? '',
      certificate_number: c.certificate_number ?? '', issuing_body: c.issuing_body ?? '',
      status: (c.status === 'expired' ? 'active' : c.status) as 'active' | 'pending' | 'revoked',
      document_url: c.document_url ?? '', notes: c.notes ?? '',
    })
  }
  function openRenewal(c: StaffCertification) {
    const def = certDefs.find(d => d.id === c.certification_id)
    setCertDraft({ certification_id: c.certification_id, issue_date: '', expiry_date: '', certificate_number: '', issuing_body: c.issuing_body || def?.issuing_body || '', status: 'active', document_url: '', notes: '' })
  }
  // Selecting a cert auto-fills issuing body (when blank); setting issue date
  // auto-suggests expiry from the definition's validity period.
  function pickCert(certId: string) {
    const def = certDefs.find(d => d.id === certId)
    setCertDraft(d => {
      if (!d) return d
      const next = { ...d, certification_id: certId, issuing_body: d.issuing_body || def?.issuing_body || '' }
      if (next.issue_date && def?.validity_period_months != null) next.expiry_date = addMonthsStr(next.issue_date, def.validity_period_months)
      return next
    })
  }
  function setIssueDate(val: string) {
    setCertDraft(d => {
      if (!d) return d
      const def = certDefs.find(x => x.id === d.certification_id)
      const next = { ...d, issue_date: val }
      if (val && def?.validity_period_months != null) next.expiry_date = addMonthsStr(val, def.validity_period_months)
      return next
    })
  }
  async function saveCert() {
    if (!draft?.id || !certDraft) return
    if (!certDraft.certification_id) { alert('Pick a certification'); return }
    let status: StaffCertification['status'] = certDraft.status
    if (certDraft.expiry_date && certDraft.expiry_date < todayStr()) status = 'expired'
    const payload = {
      staff_id: draft.id, certification_id: certDraft.certification_id,
      issue_date: certDraft.issue_date || null, expiry_date: certDraft.expiry_date || null,
      certificate_number: certDraft.certificate_number || '', issuing_body: certDraft.issuing_body || '',
      document_url: certDraft.document_url || '', status, notes: certDraft.notes || '',
      verified_by: currentStaffId ?? null, verified_at: currentStaffId ? new Date().toISOString() : null,
    }
    if (certDraft.id) await supabase.from('staff_certifications').update(payload).eq('id', certDraft.id)
    else await supabase.from('staff_certifications').insert(payload)
    setCertDraft(null)
    load()
  }

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
    // Keep the staff record's primary location in sync when this assignment is primary.
    if (asnDraft.is_primary_location) {
      await supabase.from('staff_members').update({ primary_location_id: asnDraft.location_id }).eq('id', draft.id)
    }
    setAsnDraft(null)
    load()
  }

  async function endAssignment(a: StaffLocationRole) {
    await supabase.from('staff_location_roles').update({ effective_until: todayStr() }).eq('id', a.id)
    load()
  }

  if (loading) return <div className="text-sm text-[--muted] py-8">Loading staff…</div>

  const draftAssignments = draft?.id ? assignments.filter(a => a.staff_id === draft.id) : []
  const draftCerts = draft?.id
    ? allCerts.filter(c => c.staff_id === draft.id).slice().sort((a, b) => {
        if (!a.expiry_date && !b.expiry_date) return 0
        if (!a.expiry_date) return 1
        if (!b.expiry_date) return -1
        return a.expiry_date.localeCompare(b.expiry_date)
      })
    : []

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
            <button onClick={() => { setError(''); setEditTab('profile'); setSkillDraft(null); setCertDraft(null); setDraft(blankStaff()) }}
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
                <th className="text-left px-3 py-2">Certs</th>
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
                    {(() => { const dot = staffCertDot(s.id); return (
                      <span className="inline-flex items-center gap-1.5 text-[--muted]" title={dot.label}>
                        <span className="inline-block w-2 h-2 rounded-full" style={{ background: dot.color }} />
                        {dot.label}
                      </span>
                    ) })()}
                  </td>
                  <td className="px-3 py-2.5">
                    <button onClick={() => { setError(''); setAsnDraft(null); setSkillDraft(null); setCertDraft(null); setEditTab('profile'); setDraft({ ...s }) }}
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

          {draft.id && (
            <div className="flex bg-[--surface-2] rounded-lg p-0.5 gap-0.5 w-fit">
              {([['profile', '👤 Profile'], ['access', '🔑 Access'], ['skills', '⭐ Skills'], ['certifications', '📜 Certifications']] as [EditTab, string][]).map(([t, label]) => (
                <button key={t} onClick={() => setEditTab(t)}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${editTab === t ? 'bg-white text-[--text] shadow-sm' : 'text-[--muted]'}`}>{label}</button>
              ))}
            </div>
          )}

          {(!draft.id || editTab === 'profile') && (
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
          )}

          {/* ── Access tab: PIN ── */}
          {draft.id && editTab === 'access' && (
            <div className="flex items-center gap-3">
              <span className="text-[11px] text-[--muted]">PIN: {draft.pin ? '••••' : 'not set'}</span>
              <button onClick={setPin}
                className="px-3 py-1 text-[11px] border border-[--border-2] rounded-lg text-[--muted] hover:bg-[--surface-2]">
                {draft.pin ? 'Reset PIN' : 'Set PIN'}
              </button>
            </div>
          )}

          {/* ── Skills tab ── */}
          {draft.id && editTab === 'skills' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-[11px] font-semibold uppercase tracking-wide text-[--hint]">Skills</h4>
                {!skillDraft && <button onClick={openAddSkill} className="text-[11px] text-[--accent] hover:text-[--accent-dark] font-medium">+ Add skill</button>}
              </div>
              {staffSkills.length === 0 ? (
                <p className="text-xs text-[--muted]">No skills recorded.</p>
              ) : (
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wide text-[--hint] border-b border-[--border]">
                      <th className="text-left py-1.5">Skill</th><th className="text-left py-1.5">Category</th>
                      <th className="text-left py-1.5">Level</th><th className="text-left py-1.5">Achieved</th>
                      <th className="text-left py-1.5">Verified by</th><th className="text-left py-1.5">Notes</th><th className="text-left py-1.5"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {staffSkills.map(ss => {
                      const def = skillDefs.find(d => d.id === ss.skill_id)
                      const lvl = skillLevels.find(l => l.id === ss.level_id)
                      const inactive = !ss.is_active
                      return (
                        <tr key={ss.id} className={`border-b border-[--border] last:border-0 ${inactive ? 'opacity-50' : ''}`}>
                          <td className={`py-1.5 font-medium text-[--text] ${inactive ? 'line-through' : ''}`}>{def?.name ?? '—'}</td>
                          <td className="py-1.5 text-[--muted]">{def ? CAT_LABELS[def.category] : '—'}</td>
                          <td className="py-1.5">
                            <span className="inline-flex items-center gap-1.5 text-[--muted]">
                              <span className="inline-block w-2 h-2 rounded-full" style={{ background: levelDot(lvl?.name ?? '') }} />
                              {lvl?.name ?? '—'}{inactive && <span className="ml-1 text-[9px] text-[--hint]">(Previous level)</span>}
                            </span>
                          </td>
                          <td className="py-1.5 text-[--muted]">{ss.achieved_date ?? '—'}</td>
                          <td className="py-1.5 text-[--muted]">{ss.verified_by ? (staff.find(s => s.id === ss.verified_by)?.name ?? '—') : '—'}</td>
                          <td className="py-1.5 text-[--muted]">{ss.notes}</td>
                          <td className="py-1.5">
                            {ss.is_active && <button onClick={() => openEditSkill(ss)} className="px-2 py-0.5 text-[10px] border border-[--border-2] rounded text-[--muted] hover:text-[--text]">Edit</button>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}

              <label className="flex items-center gap-1.5 text-[11px] text-[--muted] cursor-pointer select-none">
                <input type="checkbox" checked={showInactiveSkills} onChange={e => setShowInactiveSkills(e.target.checked)} className="accent-[--accent]" />
                Show inactive skills
              </label>

              {skillDraft && (
                <div className="bg-[--surface-2] rounded-lg p-3 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <Labeled label="Skill">
                      {skillDraft.id ? (
                        <div className="fi w-full bg-white text-[--muted]">{skillDefs.find(d => d.id === skillDraft.skill_id)?.name ?? '—'}</div>
                      ) : (
                        <select value={skillDraft.skill_id} onChange={e => setSkillDraft(d => ({ ...d!, skill_id: e.target.value }))} className="fi w-full bg-white">
                          <option value="">— select —</option>
                          {(['boh', 'foh', 'bar', 'management', 'general'] as SkillDefinition['category'][]).map(cat => {
                            const opts = skillDefs.filter(d => d.category === cat && !staffSkills.some(ss => ss.is_active && ss.skill_id === d.id))
                            if (!opts.length) return null
                            return <optgroup key={cat} label={CAT_LABELS[cat]}>{opts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</optgroup>
                          })}
                        </select>
                      )}
                    </Labeled>
                    <Labeled label="Level">
                      <select value={skillDraft.level_id} onChange={e => setSkillDraft(d => ({ ...d!, level_id: e.target.value }))} className="fi w-full bg-white">
                        <option value="">— select —</option>
                        {skillLevels.map(l => <option key={l.id} value={l.id}>{l.value} — {l.name}</option>)}
                      </select>
                    </Labeled>
                    <Labeled label="Achieved date">
                      <input type="date" value={skillDraft.achieved_date} onChange={e => setSkillDraft(d => ({ ...d!, achieved_date: e.target.value }))} className="fi w-full" />
                    </Labeled>
                    <Labeled label="Notes">
                      <input value={skillDraft.notes} onChange={e => setSkillDraft(d => ({ ...d!, notes: e.target.value }))} className="fi w-full" />
                    </Labeled>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={saveSkill} className="px-3 py-1 text-[11px] font-medium bg-[--accent] text-white rounded-lg hover:bg-[--accent-dark]">Save</button>
                    <button onClick={() => setSkillDraft(null)} className="px-3 py-1 text-[11px] border border-[--border-2] text-[--muted] rounded-lg hover:bg-white">Cancel</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Certifications tab ── */}
          {draft.id && editTab === 'certifications' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-[11px] font-semibold uppercase tracking-wide text-[--hint]">Certifications</h4>
                {!certDraft && <button onClick={openAddCert} className="text-[11px] text-[--accent] hover:text-[--accent-dark] font-medium">+ Add certification</button>}
              </div>
              {draftCerts.length === 0 ? (
                <p className="text-xs text-[--muted]">No certifications recorded.</p>
              ) : (
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wide text-[--hint] border-b border-[--border]">
                      <th className="text-left py-1.5">Certification</th><th className="text-left py-1.5">Category</th>
                      <th className="text-left py-1.5">Issued</th><th className="text-left py-1.5">Expires</th>
                      <th className="text-left py-1.5">Status</th><th className="text-left py-1.5">Cert #</th>
                      <th className="text-left py-1.5">Document</th><th className="text-left py-1.5">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {draftCerts.map(c => {
                      const def = certDefs.find(d => d.id === c.certification_id)
                      const st = certStatusOf(c)
                      const label = st === 'expiring_soon' ? `Expires ${c.expiry_date}` : st.charAt(0).toUpperCase() + st.slice(1).replace('_', ' ')
                      return (
                        <tr key={c.id} className="border-b border-[--border] last:border-0">
                          <td className="py-1.5 font-medium text-[--text]">{def?.name ?? '—'}</td>
                          <td className="py-1.5 text-[--muted]">{def ? CERT_CAT_LABELS[def.category] : '—'}</td>
                          <td className="py-1.5 text-[--muted]">{c.issue_date ?? '—'}</td>
                          <td className="py-1.5 text-[--muted]">{c.expiry_date ?? '—'}</td>
                          <td className="py-1.5"><span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${CERT_BADGE[st]}`}>{label}</span></td>
                          <td className="py-1.5 text-[--muted]">{c.certificate_number || '—'}</td>
                          <td className="py-1.5">{c.document_url ? <a href={c.document_url} target="_blank" rel="noopener noreferrer" className="text-[--accent] hover:underline">📎 View</a> : <span className="text-[--hint]">—</span>}</td>
                          <td className="py-1.5">
                            <div className="flex gap-1">
                              <button onClick={() => openEditCert(c)} className="px-2 py-0.5 text-[10px] border border-[--border-2] rounded text-[--muted] hover:text-[--text]">Edit</button>
                              {st === 'expired' && <button onClick={() => openRenewal(c)} className="px-2 py-0.5 text-[10px] border border-[--accent] text-[--accent] rounded hover:bg-[--accent-light]">+ Renewal</button>}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}

              {certDraft && (
                <div className="bg-[--surface-2] rounded-lg p-3 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <Labeled label="Certification">
                      {certDraft.id ? (
                        <div className="fi w-full bg-white text-[--muted]">{certDefs.find(d => d.id === certDraft.certification_id)?.name ?? '—'}</div>
                      ) : (
                        <select value={certDraft.certification_id} onChange={e => pickCert(e.target.value)} className="fi w-full bg-white">
                          <option value="">— select —</option>
                          {certDefs.filter(d => !allCerts.some(c => c.staff_id === draft.id && c.certification_id === d.id && (c.status === 'active' || c.status === 'pending')))
                            .map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                        </select>
                      )}
                    </Labeled>
                    <Labeled label="Status">
                      <select value={certDraft.status} onChange={e => setCertDraft(d => ({ ...d!, status: e.target.value as 'active' | 'pending' | 'revoked' }))} className="fi w-full bg-white capitalize">
                        <option value="active">Active</option><option value="pending">Pending</option><option value="revoked">Revoked</option>
                      </select>
                    </Labeled>
                    <Labeled label="Issue date">
                      <input type="date" value={certDraft.issue_date} onChange={e => setIssueDate(e.target.value)} className="fi w-full" />
                    </Labeled>
                    <Labeled label="Expiry date">
                      <input type="date" value={certDraft.expiry_date} onChange={e => setCertDraft(d => ({ ...d!, expiry_date: e.target.value }))} className="fi w-full" />
                    </Labeled>
                    <Labeled label="Certificate #">
                      <input value={certDraft.certificate_number} onChange={e => setCertDraft(d => ({ ...d!, certificate_number: e.target.value }))} className="fi w-full" />
                    </Labeled>
                    <Labeled label="Issuing body">
                      <input value={certDraft.issuing_body} onChange={e => setCertDraft(d => ({ ...d!, issuing_body: e.target.value }))} className="fi w-full" />
                    </Labeled>
                    <Labeled label="Document URL" cls="col-span-2">
                      <input value={certDraft.document_url} onChange={e => setCertDraft(d => ({ ...d!, document_url: e.target.value }))} placeholder="https://… (scan or upload link)" className="fi w-full" />
                    </Labeled>
                    <Labeled label="Notes" cls="col-span-2">
                      <input value={certDraft.notes} onChange={e => setCertDraft(d => ({ ...d!, notes: e.target.value }))} className="fi w-full" />
                    </Labeled>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={saveCert} className="px-3 py-1 text-[11px] font-medium bg-[--accent] text-white rounded-lg hover:bg-[--accent-dark]">Save</button>
                    <button onClick={() => setCertDraft(null)} className="px-3 py-1 text-[11px] border border-[--border-2] text-[--muted] rounded-lg hover:bg-white">Cancel</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {(!draft.id || editTab === 'profile' || editTab === 'access') && (
            <>
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
            </>
          )}

          {/* Role assignments (Access tab) */}
          {draft.id && editTab === 'access' && (
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
