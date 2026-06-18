'use client'
// src/components/SkillsLibrarySettings.tsx
// Admin: manage the skill_definitions library (platform defaults + custom).
import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import type { SkillDefinition } from '@/lib/types'

interface Props { restaurantId: string }

const CAT_LABELS: Record<string, string> = { boh: 'BOH', bar: 'Bar', foh: 'FOH', management: 'Management', general: 'General' }
const CAT_ORDER: SkillDefinition['category'][] = ['boh', 'foh', 'bar', 'management', 'general']

const blankSkill = (): Partial<SkillDefinition> => ({ name: '', category: 'general', description: '', is_active: true })

export default function SkillsLibrarySettings({ restaurantId }: Props) {
  const supabase = createClient()
  const [defs, setDefs] = useState<SkillDefinition[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState<Partial<SkillDefinition> | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!restaurantId) { setLoading(false); return }
    setLoading(true)
    const { data: skillDefs } = await supabase.from('skill_definitions').select('*')
      .or(`restaurant_id.is.null,restaurant_id.eq.${restaurantId}`).order('category').order('sort_order')
    setDefs((skillDefs ?? []) as SkillDefinition[])

    const { data: staffRows } = await supabase.from('staff_members').select('id').eq('restaurant_id', restaurantId)
    const ids = (staffRows ?? []).map((s: { id: string }) => s.id)
    const map: Record<string, number> = {}
    if (ids.length) {
      const { data: ss } = await supabase.from('staff_skills').select('skill_id').in('staff_id', ids).eq('is_active', true)
      for (const r of (ss ?? []) as { skill_id: string }[]) map[r.skill_id] = (map[r.skill_id] ?? 0) + 1
    }
    setCounts(map)
    setLoading(false)
  }, [restaurantId, supabase])

  useEffect(() => { load() }, [load])

  async function setActive(d: SkillDefinition, value: boolean) {
    await supabase.from('skill_definitions').update({ is_active: value }).eq('id', d.id)
    load()
  }

  async function save() {
    if (!draft) return
    setError('')
    if (!draft.name?.trim()) { setError('Name is required'); return }
    setSaving(true)
    if (draft.id) {
      await supabase.from('skill_definitions').update({
        name: draft.name!.trim(), category: draft.category, description: draft.description || '', is_active: draft.is_active ?? true,
      }).eq('id', draft.id)
    } else {
      await supabase.from('skill_definitions').insert({
        restaurant_id: restaurantId, name: draft.name!.trim(), category: draft.category ?? 'general',
        description: draft.description || '', is_active: draft.is_active ?? true, sort_order: defs.length + 1,
      })
    }
    setSaving(false)
    setDraft(null)
    load()
  }

  async function remove(d: SkillDefinition) {
    if (d.restaurant_id !== restaurantId) return
    if (!confirm(`Delete skill "${d.name}"?`)) return
    await supabase.from('skill_definitions').delete().eq('id', d.id)
    load()
  }

  if (loading) return <div className="text-sm text-[--muted] py-8">Loading skills…</div>

  const fi = 'text-xs border border-[--border-2] rounded-lg px-2.5 py-1.5 outline-none focus:border-[--accent] w-full'

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h2 className="font-serif text-lg font-medium text-[--text]">Skills Library</h2>
          <p className="text-xs text-[--muted] mt-0.5">Skills available for staff profiles. Platform defaults are shown with a lock icon — editable but not deletable.</p>
        </div>
        {!draft && (
          <button onClick={() => { setError(''); setDraft(blankSkill()) }}
            className="px-3 py-1.5 text-xs font-medium bg-[--accent] text-white rounded-lg hover:bg-[--accent-dark] whitespace-nowrap">+ Add skill</button>
        )}
      </div>

      <div className="bg-white rounded-xl border border-[--border] overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[--border] bg-[--surface-2] text-[10px] uppercase tracking-wide text-[--hint]">
              <th className="text-left px-3 py-2">Name</th><th className="text-left px-3 py-2">Category</th>
              <th className="text-left px-3 py-2">Active</th><th className="text-left px-3 py-2"># Staff</th>
              <th className="text-left px-3 py-2 w-28">Actions</th>
            </tr>
          </thead>
          <tbody>
            {CAT_ORDER.filter(cat => defs.some(d => d.category === cat)).map(cat => (
              <FragmentRow key={cat}>
                <tr className="bg-[--surface-2]/50"><td colSpan={5} className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[--accent]">{CAT_LABELS[cat]}</td></tr>
                {defs.filter(d => d.category === cat).map(d => {
                  const isDefault = d.restaurant_id === null
                  return (
                    <tr key={d.id} className="border-b border-[--border] last:border-0">
                      <td className="px-3 py-2.5 font-medium text-[--text]">{isDefault && <span className="mr-1" title="Platform default">🔒</span>}{d.name}</td>
                      <td className="px-3 py-2.5 text-[--muted]">{CAT_LABELS[d.category]}</td>
                      <td className="px-3 py-2.5">
                        <button onClick={() => setActive(d, !d.is_active)} role="switch" aria-checked={d.is_active}
                          className={`w-9 h-5 rounded-full relative transition-colors ${d.is_active ? 'bg-[--accent]' : 'bg-[--border-2]'}`}>
                          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${d.is_active ? 'left-[18px]' : 'left-0.5'}`} />
                        </button>
                      </td>
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
              </FragmentRow>
            ))}
          </tbody>
        </table>
      </div>

      {draft && (
        <div className="bg-white rounded-xl border border-[--border] p-4 space-y-3">
          <h3 className="font-serif text-sm font-medium text-[--text]">{draft.id ? `Edit: ${draft.name}` : 'Add skill'}</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><label className="block text-[11px] font-medium text-[--muted] mb-1">Name</label>
              <input value={draft.name ?? ''} onChange={e => setDraft(p => ({ ...p!, name: e.target.value }))} className={fi} autoFocus /></div>
            <div><label className="block text-[11px] font-medium text-[--muted] mb-1">Category</label>
              <select value={draft.category ?? 'general'} onChange={e => setDraft(p => ({ ...p!, category: e.target.value as SkillDefinition['category'] }))} className={`${fi} bg-white`}>
                {CAT_ORDER.map(c => <option key={c} value={c}>{CAT_LABELS[c]}</option>)}
              </select></div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="checkbox" checked={draft.is_active ?? true} onChange={e => setDraft(p => ({ ...p!, is_active: e.target.checked }))} className="accent-[--accent]" /> Active
              </label>
            </div>
            <div className="col-span-2"><label className="block text-[11px] font-medium text-[--muted] mb-1">Description</label>
              <textarea rows={2} value={draft.description ?? ''} onChange={e => setDraft(p => ({ ...p!, description: e.target.value }))} className={`${fi} resize-none`} /></div>
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

function FragmentRow({ children }: { children: React.ReactNode }) { return <>{children}</> }
