'use client'
// src/components/HACCPEquipmentSettings.tsx
// Settings page for managing a location's HACCP equipment.
import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import type { HACCPEquipment } from '@/lib/types'

interface Props {
  locationId?: string
  restaurantId?: string
  locationName?: string
}

const TYPE_OPTIONS: { value: HACCPEquipment['equipment_type']; label: string }[] = [
  { value: 'walk_in',      label: 'Walk-In Cooler' },
  { value: 'reach_in',     label: 'Reach-In Cooler' },
  { value: 'freezer',      label: 'Freezer' },
  { value: 'hot_hold',     label: 'Hot Hold' },
  { value: 'prep_surface', label: 'Prep Surface' },
  { value: 'other',        label: 'Other' },
]
const TYPE_LABELS: Record<string, string> = Object.fromEntries(TYPE_OPTIONS.map(t => [t.value, t.label]))

const LOG_SLOT_OPTIONS = [
  { value: 'opening', label: 'Opening' },
  { value: 'closing', label: 'Closing' },
  { value: 'midday',  label: 'Midday' },
]

const blankEquipment = (): Partial<HACCPEquipment> => ({
  name: '', equipment_type: 'walk_in', physical_location: '',
  target_temp_min: 34, target_temp_max: 41, temp_unit: 'F',
  log_slots: ['opening', 'closing'], is_active: true, notes: '',
})

export default function HACCPEquipmentSettings({ locationId, locationName }: Props) {
  const supabase = createClient()
  const [equipment, setEquipment] = useState<HACCPEquipment[]>([])
  const [loading, setLoading] = useState(true)
  const [draft,   setDraft]   = useState<Partial<HACCPEquipment> | null>(null)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')

  const load = useCallback(async () => {
    if (!locationId) { setLoading(false); return }
    setLoading(true)
    const { data } = await supabase.from('haccp_equipment').select('*')
      .eq('location_id', locationId).order('sort_order')
    setEquipment((data ?? []) as HACCPEquipment[])
    setLoading(false)
  }, [locationId, supabase])

  useEffect(() => { load() }, [load])

  function toggleSlot(slot: string) {
    setDraft(p => {
      const cur = p?.log_slots ?? []
      return { ...p!, log_slots: cur.includes(slot) ? cur.filter(s => s !== slot) : [...cur, slot] }
    })
  }

  async function save() {
    if (!draft || !locationId) return
    setError('')
    if (!draft.name?.trim())   { setError('Name is required'); return }
    if (!draft.equipment_type) { setError('Type is required'); return }
    if (draft.target_temp_min == null || isNaN(Number(draft.target_temp_min))) { setError('Temp min is required'); return }
    if (draft.target_temp_max == null || isNaN(Number(draft.target_temp_max))) { setError('Temp max is required'); return }
    if (Number(draft.target_temp_min) >= Number(draft.target_temp_max)) { setError('Temp min must be less than temp max'); return }
    if (!(draft.log_slots ?? []).length) { setError('Select at least one log slot'); return }

    setSaving(true)
    const payload = {
      location_id:       locationId,
      name:              draft.name!.trim(),
      equipment_type:    draft.equipment_type,
      physical_location: draft.physical_location || null,
      target_temp_min:   Number(draft.target_temp_min),
      target_temp_max:   Number(draft.target_temp_max),
      temp_unit:         draft.temp_unit ?? 'F',
      log_slots:         draft.log_slots ?? [],
      notes:             draft.notes || '',
      is_active:         draft.is_active ?? true,
    }
    if (draft.id) {
      await supabase.from('haccp_equipment').update(payload).eq('id', draft.id)
    } else {
      await supabase.from('haccp_equipment').insert({ ...payload, sort_order: equipment.length + 1 })
    }
    setSaving(false)
    setDraft(null)
    load()
  }

  async function setActive(eq: HACCPEquipment, value: boolean) {
    await supabase.from('haccp_equipment').update({ is_active: value }).eq('id', eq.id)
    load()
  }

  if (loading) return <div className="text-sm text-[--muted] py-8">Loading equipment…</div>
  if (!locationId) return <p className="text-sm text-[--muted]">No location selected.</p>

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-serif text-lg font-medium text-[--text]">{locationName ? `${locationName} — ` : ''}HACCP Equipment</h2>
        <p className="text-xs text-[--muted] mt-0.5">Configure the refrigeration units and equipment monitored at this location.</p>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-[--muted]">
          Manage the refrigeration and hot-hold units logged in the HACCP module. Equipment is deactivated, never deleted — historical temperature logs reference it.
        </p>
        {!draft && (
          <button onClick={() => { setError(''); setDraft(blankEquipment()) }}
            className="px-3 py-1.5 text-xs font-medium bg-[--accent] text-white rounded-lg hover:bg-[--accent-dark] whitespace-nowrap">
            + Add Equipment
          </button>
        )}
      </div>

      {/* Equipment table */}
      {equipment.length === 0 ? (
        <p className="text-sm text-[--muted] py-6 text-center">No equipment yet. Add your first unit.</p>
      ) : (
        <div className="bg-white rounded-xl border border-[--border] overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[--border] bg-[--surface-2] text-[10px] uppercase tracking-wide text-[--hint]">
                <th className="text-left px-3 py-2">Name</th>
                <th className="text-left px-3 py-2">Type</th>
                <th className="text-left px-3 py-2">Location</th>
                <th className="text-left px-3 py-2">Min °F</th>
                <th className="text-left px-3 py-2">Max °F</th>
                <th className="text-left px-3 py-2">Active</th>
                <th className="text-left px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {equipment.map(eq => (
                <tr key={eq.id} className={`border-b border-[--border] last:border-0 ${eq.is_active ? '' : 'opacity-50'}`}>
                  <td className="px-3 py-2.5 font-medium text-[--text]">
                    {eq.name}
                    {!eq.is_active && <span className="ml-2 text-[9px] px-1.5 py-0.5 rounded-full bg-[--surface-2] text-[--hint] border border-[--border]">Inactive</span>}
                  </td>
                  <td className="px-3 py-2.5 text-[--muted]">{TYPE_LABELS[eq.equipment_type] ?? eq.equipment_type}</td>
                  <td className="px-3 py-2.5 text-[--muted]">{eq.physical_location || '—'}</td>
                  <td className="px-3 py-2.5 text-[--muted]">{eq.target_temp_min}</td>
                  <td className="px-3 py-2.5 text-[--muted]">{eq.target_temp_max}</td>
                  <td className="px-3 py-2.5">
                    <button onClick={() => setActive(eq, !eq.is_active)}
                      role="switch" aria-checked={eq.is_active}
                      className={`w-9 h-5 rounded-full relative transition-colors ${eq.is_active ? 'bg-[--accent]' : 'bg-[--border-2]'}`}>
                      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${eq.is_active ? 'left-[18px]' : 'left-0.5'}`} />
                    </button>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex gap-1">
                      <button onClick={() => { setError(''); setDraft({ ...eq }) }}
                        className="px-2 py-0.5 text-[10px] border border-[--border-2] rounded text-[--muted] hover:text-[--text]" title="Edit">✎</button>
                      {eq.is_active && (
                        <button onClick={() => setActive(eq, false)}
                          className="px-2 py-0.5 text-[10px] border border-red-200 rounded text-red-400 hover:text-red-600" title="Deactivate">Deactivate</button>
                      )}
                    </div>
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
          <h3 className="font-serif text-sm font-medium text-[--text]">{draft.id ? 'Edit Equipment' : 'Add Equipment'}</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-[11px] font-medium text-[--muted] mb-1">Nickname</label>
              <input value={draft.name ?? ''} onChange={e => setDraft(p => ({ ...p!, name: e.target.value }))}
                placeholder='e.g. "Walk-In Cooler", "Bar Back Cooler"'
                className="w-full text-xs border border-[--border-2] rounded-lg px-2.5 py-1.5 outline-none focus:border-[--accent]" autoFocus />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-[--muted] mb-1">Type of unit</label>
              <select value={draft.equipment_type ?? 'walk_in'}
                onChange={e => setDraft(p => ({ ...p!, equipment_type: e.target.value as HACCPEquipment['equipment_type'] }))}
                className="w-full text-xs border border-[--border-2] rounded-lg px-2.5 py-1.5 outline-none focus:border-[--accent] bg-white">
                {TYPE_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-[--muted] mb-1">Location</label>
              <input value={draft.physical_location ?? ''} onChange={e => setDraft(p => ({ ...p!, physical_location: e.target.value }))}
                placeholder="e.g. Back of house, Bar area, Main line"
                className="w-full text-xs border border-[--border-2] rounded-lg px-2.5 py-1.5 outline-none focus:border-[--accent]" />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-[--muted] mb-1">Temp min (°F)</label>
              <input type="number" step="1" value={draft.target_temp_min ?? ''}
                onChange={e => setDraft(p => ({ ...p!, target_temp_min: e.target.value === '' ? undefined : parseFloat(e.target.value) }))}
                className="w-full text-xs border border-[--border-2] rounded-lg px-2.5 py-1.5 outline-none focus:border-[--accent]" />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-[--muted] mb-1">Temp max (°F)</label>
              <input type="number" step="1" value={draft.target_temp_max ?? ''}
                onChange={e => setDraft(p => ({ ...p!, target_temp_max: e.target.value === '' ? undefined : parseFloat(e.target.value) }))}
                className="w-full text-xs border border-[--border-2] rounded-lg px-2.5 py-1.5 outline-none focus:border-[--accent]" />
            </div>
            <div className="col-span-2">
              <label className="block text-[11px] font-medium text-[--muted] mb-1.5">Log slots</label>
              <div className="flex gap-3">
                {LOG_SLOT_OPTIONS.map(s => (
                  <label key={s.value} className="flex items-center gap-1.5 text-xs cursor-pointer">
                    <input type="checkbox" checked={(draft.log_slots ?? []).includes(s.value)}
                      onChange={() => toggleSlot(s.value)} className="accent-[--accent]" />
                    {s.label}
                  </label>
                ))}
              </div>
            </div>
            <div className="col-span-2">
              <label className="block text-[11px] font-medium text-[--muted] mb-1">Notes</label>
              <input value={draft.notes ?? ''} onChange={e => setDraft(p => ({ ...p!, notes: e.target.value }))}
                className="w-full text-xs border border-[--border-2] rounded-lg px-2.5 py-1.5 outline-none focus:border-[--accent]" />
            </div>
            {draft.id && (
              <div className="col-span-2">
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input type="checkbox" checked={draft.is_active ?? true}
                    onChange={e => setDraft(p => ({ ...p!, is_active: e.target.checked }))} className="accent-[--accent]" />
                  Active
                </label>
              </div>
            )}
          </div>

          {error && <p className="text-[11px] text-red-500">{error}</p>}

          <div className="flex gap-2">
            <button onClick={save} disabled={saving}
              className="px-4 py-1.5 text-xs font-medium bg-[--accent] text-white rounded-lg hover:bg-[--accent-dark] disabled:opacity-50">
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button onClick={() => { setDraft(null); setError('') }}
              className="px-4 py-1.5 text-xs border border-[--border-2] text-[--muted] rounded-lg hover:bg-[--surface-2]">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
