'use client'
// src/components/CertificationsLibrarySettings.tsx
// Admin: manage the certification_definitions library (platform defaults + custom).
import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import type { CertificationDefinition } from '@/lib/types'

interface Props { restaurantId: string }

const CAT_LABELS: Record<string, string> = { food_safety: 'Food Safety', alcohol: 'Alcohol', health: 'Health', legal: 'Legal', other: 'Other' }
const CAT_ORDER: CertificationDefinition['category'][] = ['food_safety', 'alcohol', 'health', 'legal', 'other']
const ROLE_OPTIONS = ['prep_cook', 'bartender', 'foh', 'chef', 'manager', 'restaurant_admin']
const ROLE_LABELS: Record<string, string> = {
  prep_cook: 'Prep cook', bartender: 'Bartender', foh: 'FOH', chef: 'Chef', manager: 'Manager', restaurant_admin: 'Restaurant admin',
}

const blankCert = (): Partial<CertificationDefinition> => ({
  name: '', category: 'food_safety', issuing_body: '', validity_period_months: null,
  is_required: false, required_for_roles: [], description: '', is_active: true,
})

export default function CertificationsLibrarySettings({ restaurantId }: Props) {
  const supabase = createClient()
  const [defs, setDefs] = useState<CertificationDefinition[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState<Partial<CertificationDefinition> | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!restaurantId) { setLoading(false); return }
    setLoading(true)
    const { data: certDefs } = await supabase.from('certification_definitions').select('*')
      .or(`restaurant_id.is.null,restaurant_id.eq.${restaurantId}`).order('sort_order')
    setDefs((certDefs ?? []) as CertificationDefinition[])

    const { data: staffRows } = await supabase.from('staff_members').select('id').eq('restaurant_id', restaurantId)
    const ids = (staffRows ?? []).map((s: { id: string }) => s.id)
    const map: Record<string, number> = {}
    if (ids.length) {
      const { data: sc } = await supabase.from('staff_certifications').select('certification_id').in('staff_id', ids).eq('status', 'active')
      for (const r of (sc ?? []) as { certification_id: string }[]) map[r.certification_id] = (map[r.certification_id] ?? 0) + 1
    }
    setCounts(map)
    setLoading(false)
  }, [restaurantId, supabase])

  useEffect(() => { load() }, [load])

  function toggleRole(role: string) {
    setDraft(p => {
      const cur = p?.required_for_roles ?? []
      return { ...p!, required_for_roles: cur.includes(role) ? cur.filter(r => r !== role) : [...cur, role] }
    })
  }

  async function save() {
    if (!draft) return
    setError('')
    if (!draft.name?.trim()) { setError('Name is required'); return }
    setSaving(true)
    const fields = {
      name: draft.name!.trim(), category: draft.category, issuing_body: draft.issuing_body || '',
      validity_period_months: draft.validity_period_months ?? null,
      is_required: draft.is_required ?? false,
      required_for_roles: draft.is_required ? (draft.required_for_roles ?? []) : [],
      description: draft.description || '', is_active: draft.is_active ?? true,
    }
    if (draft.id) {
      await supabase.from('certification_definitions').update(fields).eq('id', draft.id)
    } else {
      await supabase.from('certification_definitions').insert({ ...fields, restaurant_id: restaurantId, sort_order: defs.length + 1 })
    }
    setSaving(false)
    setDraft(null)
    load()
  }

  async function remove(d: CertificationDefinition) {
    if (d.restaurant_id !== restaurantId) return
    if (!confirm(`Delete certification "${d.name}"?`)) return
    await supabase.from('certification_definitions').delete().eq('id', d.id)
    load()
  }

  if (loading) return <div className="text-sm text-[--muted] py-8">Loading certifications…</div>

  const fi = 'text-xs border border-[--border-2] rounded-lg px-2.5 py-1.5 outline-none focus:border-[--accent] w-full'

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h2 className="font-serif text-lg font-medium text-[--text]">Certifications Library</h2>
          <p className="text-xs text-[--muted] mt-0.5">Legal and compliance certifications tracked for staff. Required certifications trigger expiry alerts.</p>
        </div>
        {!draft && (
          <button onClick={() => { setError(''); setDraft(blankCert()) }}
            className="px-3 py-1.5 text-xs font-medium bg-[--accent] text-white rounded-lg hover:bg-[--accent-dark] whitespace-nowrap">+ Add certification</button>
        )}
      </div>

      <div className="bg-white rounded-xl border border-[--border] overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[--border] bg-[--surface-2] text-[10px] uppercase tracking-wide text-[--hint]">
              <th className="text-left px-3 py-2">Name</th><th className="text-left px-3 py-2">Category</th>
              <th className="text-left px-3 py-2">Issuing Body</th><th className="text-left px-3 py-2">Valid (mo)</th>
              <th className="text-left px-3 py-2">Required</th><th className="text-left px-3 py-2"># Staff</th>
              <th className="text-left px-3 py-2 w-28">Actions</th>
            </tr>
          </thead>
          <tbody>
            {defs.map(d => {
              const isDefault = d.restaurant_id === null
              return (
                <tr key={d.id} className="border-b border-[--border] last:border-0">
                  <td className="px-3 py-2.5 font-medium text-[--text]">{isDefault && <span className="mr-1" title="Platform default">🔒</span>}{d.name}</td>
                  <td className="px-3 py-2.5 text-[--muted]">{CAT_LABELS[d.category]}</td>
                  <td className="px-3 py-2.5 text-[--muted]">{d.issuing_body || '—'}</td>
                  <td className="px-3 py-2.5 text-[--muted]">{d.validity_period_months ?? '—'}</td>
                  <td className="px-3 py-2.5">{d.is_required ? <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200 font-medium">Required</span> : <span className="text-[--hint]">—</span>}</td>
                  <td className="px-3 py-2.5 text-[--muted]">{counts[d.id] ?? 0}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex gap-1">
                      <button onClick={() => { setError(''); setDraft({ ...d }) }} className="px-2 py-0.5 text-[10px] border border-[--border-2] rounded text-[--muted] hover:text-[--text]">Edit</button>
                      {!isDefault && <button onClick={() => remove(d)} className="px-2 py-0.5 text-[10px] border border-red-200 rounded text-red-400 hover:text-red-600">Delete</button>}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {draft && (
        <div className="bg-white rounded-xl border border-[--border] p-4 space-y-3">
          <h3 className="font-serif text-sm font-medium text-[--text]">{draft.id ? `Edit: ${draft.name}` : 'Add certification'}</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><label className="block text-[11px] font-medium text-[--muted] mb-1">Name</label>
              <input value={draft.name ?? ''} onChange={e => setDraft(p => ({ ...p!, name: e.target.value }))} className={fi} autoFocus /></div>
            <div><label className="block text-[11px] font-medium text-[--muted] mb-1">Category</label>
              <select value={draft.category ?? 'food_safety'} onChange={e => setDraft(p => ({ ...p!, category: e.target.value as CertificationDefinition['category'] }))} className={`${fi} bg-white`}>
                {CAT_ORDER.map(c => <option key={c} value={c}>{CAT_LABELS[c]}</option>)}
              </select></div>
            <div><label className="block text-[11px] font-medium text-[--muted] mb-1">Issuing body</label>
              <input value={draft.issuing_body ?? ''} onChange={e => setDraft(p => ({ ...p!, issuing_body: e.target.value }))} className={fi} /></div>
            <div><label className="block text-[11px] font-medium text-[--muted] mb-1">Valid (months)</label>
              <input type="number" value={draft.validity_period_months ?? ''} placeholder="blank = no expiry"
                onChange={e => setDraft(p => ({ ...p!, validity_period_months: e.target.value === '' ? null : parseInt(e.target.value) }))} className={fi} /></div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="checkbox" checked={draft.is_required ?? false} onChange={e => setDraft(p => ({ ...p!, is_required: e.target.checked }))} className="accent-[--accent]" /> Required
              </label>
            </div>
            {draft.is_required && (
              <div className="col-span-2">
                <label className="block text-[11px] font-medium text-[--muted] mb-1.5">Required for roles</label>
                <div className="flex flex-wrap gap-3">
                  {ROLE_OPTIONS.map(role => (
                    <label key={role} className="flex items-center gap-1.5 text-[11px] cursor-pointer">
                      <input type="checkbox" checked={(draft.required_for_roles ?? []).includes(role)} onChange={() => toggleRole(role)} className="accent-[--accent]" />
                      {ROLE_LABELS[role]}
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div className="col-span-2"><label className="block text-[11px] font-medium text-[--muted] mb-1">Description</label>
              <textarea rows={2} value={draft.description ?? ''} onChange={e => setDraft(p => ({ ...p!, description: e.target.value }))} className={`${fi} resize-none`} /></div>
            <div className="flex items-center">
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="checkbox" checked={draft.is_active ?? true} onChange={e => setDraft(p => ({ ...p!, is_active: e.target.checked }))} className="accent-[--accent]" /> Active
              </label>
            </div>
          </div>
          {error && <p className="text-[11px] text-red-500">{error}</p>}
          <div className="flex gap-2">
            <button onClick={save} disabled={saving} className="px-4 py-1.5 text-xs font-medium bg-[--accent] text-white rounded-lg hover:bg-[--accent-dark] disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
            <button onClick={() => { setDraft(null); setError('') }} className="px-4 py-1.5 text-xs border border-[--border-2] text-[--muted] rounded-lg hover:bg-[--surface-2]">Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
