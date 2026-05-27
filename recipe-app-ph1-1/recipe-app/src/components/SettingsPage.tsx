'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import type { Restaurant, Location, PicklistValue, DishMode } from '@/lib/types'
import type { AppContext } from './AppShell'

interface Props {
  ctx: AppContext
  userId: string
  onRestaurantUpdate: (r: Restaurant) => void
  onLocationsUpdate: (l: Location[]) => void
}

type SettingsTab = 'general' | 'locations' | 'picklists' | 'team' | 'branding'

const PICKLIST_NAMES = [
  { value: 'ingredient_unit',     label: 'Ingredient Units' },
  { value: 'prep_method',         label: 'Preparation Methods' },
  { value: 'allergen',            label: 'Allergens' },
  { value: 'dietary',             label: 'Dietary Flags' },
  { value: 'season',              label: 'Seasons' },
  { value: 'recipe_stage',        label: 'Recipe Stages' },
  { value: 'menu_status',         label: 'Menu Status' },
  { value: 'ingredient_category', label: 'Ingredient Categories' },
]

export default function SettingsPage({ ctx, userId, onRestaurantUpdate, onLocationsUpdate }: Props) {
  const supabase = createClient()
  const [tab,       setTab]       = useState<SettingsTab>('general')
  const [saving,    setSaving]    = useState(false)
  const [saved,     setSaved]     = useState(false)

  // General tab state
  const [rName,     setRName]     = useState(ctx.restaurant.name)
  const [rDesc,     setRDesc]     = useState(ctx.restaurant.description)
  const [rCuisine,  setRCuisine]  = useState(ctx.restaurant.cuisine_type)
  const [dishMode,  setDishMode]  = useState<DishMode>(ctx.restaurant.dish_mode)

  // Picklist tab state
  const [listName,  setListName]  = useState('ingredient_unit')
  const [picklists, setPicklists] = useState<PicklistValue[]>([])
  const [newLabel,  setNewLabel]  = useState('')
  const [newValue,  setNewValue]  = useState('')

  useEffect(() => {
    if (tab === 'picklists') loadPicklists()
  }, [tab, listName])

  async function loadPicklists() {
    const { data } = await supabase
      .from('picklist_values')
      .select('*')
      .eq('list_name', listName)
      .or(`restaurant_id.is.null,restaurant_id.eq.${ctx.restaurant.id}`)
      .eq('is_active', true)
      .order('sort_order')
    setPicklists(data ?? [])
  }

  async function saveGeneral() {
    setSaving(true)
    const { data } = await supabase
      .from('restaurants')
      .update({ name: rName, description: rDesc, cuisine_type: rCuisine, dish_mode: dishMode })
      .eq('id', ctx.restaurant.id)
      .select()
      .single()
    if (data) onRestaurantUpdate(data as Restaurant)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function addPicklistItem() {
    if (!newLabel.trim()) return
    const val = newValue.trim() || newLabel.trim().toLowerCase().replace(/\s+/g, '_')
    await supabase.from('picklist_values').insert({
      restaurant_id: ctx.restaurant.id,
      list_name: listName,
      value: val,
      label: newLabel.trim(),
      sort_order: picklists.length + 1,
      is_system: false,
    })
    setNewLabel('')
    setNewValue('')
    loadPicklists()
  }

  async function removePicklistItem(id: string, isSystem: boolean) {
    if (isSystem) { alert('System values cannot be removed, but you can add your own.'); return }
    await supabase.from('picklist_values').update({ is_active: false }).eq('id', id)
    loadPicklists()
  }

  const TABS: { key: SettingsTab; label: string }[] = [
    { key: 'general',   label: 'General' },
    { key: 'locations', label: 'Locations' },
    { key: 'picklists', label: 'Picklists' },
    { key: 'branding',  label: 'Branding' },
    { key: 'team',      label: 'Team' },
  ]

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="bg-white border-b border-[--border] px-6 py-4">
        <h1 className="font-serif text-xl font-medium text-[--text] mb-3">Settings</h1>
        <div className="flex gap-0.5">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-4 py-2 text-xs font-medium rounded-md transition-colors ${tab === t.key ? 'bg-[--accent-light] text-[--accent]' : 'text-[--muted] hover:text-[--text] hover:bg-[--surface-2]'}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 max-w-2xl">

        {/* General */}
        {tab === 'general' && (
          <div className="space-y-4">
            <div>
              <label className="block text-[11px] font-medium text-[--muted] mb-1.5">Restaurant name</label>
              <input value={rName} onChange={e => setRName(e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-[--border-2] rounded-lg outline-none focus:border-[--accent]" />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-[--muted] mb-1.5">Description</label>
              <textarea value={rDesc} onChange={e => setRDesc(e.target.value)} rows={3}
                className="w-full px-3 py-2.5 text-sm border border-[--border-2] rounded-lg outline-none focus:border-[--accent] resize-none" />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-[--muted] mb-1.5">Cuisine type</label>
              <input value={rCuisine} onChange={e => setRCuisine(e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-[--border-2] rounded-lg outline-none focus:border-[--accent]" />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-[--muted] mb-2">Dish mode</label>
              <div className="flex gap-2">
                {(['single','composed'] as DishMode[]).map(m => (
                  <button key={m} onClick={() => setDishMode(m)}
                    className={`flex-1 py-2.5 text-xs font-medium rounded-lg border-2 transition-colors capitalize ${dishMode === m ? 'border-[--accent] bg-[--accent-light] text-[--accent]' : 'border-[--border] text-[--muted] hover:border-[--border-2]'}`}>
                    {m === 'single' ? 'Single recipe per dish' : 'Composed dishes'}
                  </button>
                ))}
              </div>
            </div>
            <button onClick={saveGeneral} disabled={saving}
              className="px-5 py-2.5 bg-[--accent] text-white text-sm font-medium rounded-lg hover:bg-[--accent-dark] disabled:opacity-50 flex items-center gap-2 transition-colors">
              {saving ? <><span className="spinner" />Saving…</> : saved ? '✓ Saved' : 'Save changes'}
            </button>
          </div>
        )}

        {/* Locations */}
        {tab === 'locations' && (
          <div>
            <p className="text-xs text-[--muted] mb-4">Manage your restaurant locations. Each location can have its own menus and settings.</p>
            {ctx.locations.map(l => (
              <div key={l.id} className="flex items-start gap-3 p-4 bg-white rounded-xl border border-[--border] mb-3">
                <div className="flex-1">
                  <div className="text-sm font-medium text-[--text]">{l.name} {l.is_primary && <span className="text-[10px] text-[--accent] ml-1">Primary</span>}</div>
                  <div className="text-xs text-[--muted] mt-0.5">{[l.address, l.city, l.state].filter(Boolean).join(', ')}</div>
                  <div className="text-[10px] text-[--hint] mt-0.5">{l.timezone}</div>
                </div>
              </div>
            ))}
            <button className="w-full py-2.5 border-2 border-dashed border-[--border-2] rounded-xl text-xs text-[--muted] hover:border-[--accent] hover:text-[--accent] transition-colors mt-2">
              + Add location
            </button>
          </div>
        )}

        {/* Picklists */}
        {tab === 'picklists' && (
          <div>
            <p className="text-xs text-[--muted] mb-4">Customize dropdown values used across recipes. System values are shown in grey and cannot be removed.</p>
            <div className="mb-4">
              <select value={listName} onChange={e => setListName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-[--border-2] rounded-lg outline-none bg-white">
                {PICKLIST_NAMES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
              </select>
            </div>
            <div className="space-y-1.5 mb-4 max-h-64 overflow-y-auto">
              {picklists.map(p => (
                <div key={p.id} className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${p.is_system ? 'border-[--border] bg-[--surface-2]' : 'border-[--border-2] bg-white'}`}>
                  <span className="text-xs text-[--text] flex-1">{p.label}</span>
                  <span className="text-[10px] text-[--hint]">{p.value}</span>
                  {!p.is_system && (
                    <button onClick={() => removePicklistItem(p.id, p.is_system)} className="text-[10px] text-red-400 hover:text-red-600 ml-1">✕</button>
                  )}
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input value={newLabel} onChange={e => setNewLabel(e.target.value)}
                placeholder="Display label (e.g. Batonnet)"
                className="flex-1 px-3 py-2 text-xs border border-[--border-2] rounded-lg outline-none focus:border-[--accent]"
                onKeyDown={e => e.key === 'Enter' && addPicklistItem()} />
              <button onClick={addPicklistItem} disabled={!newLabel.trim()}
                className="px-3 py-2 bg-[--accent] text-white text-xs rounded-lg hover:bg-[--accent-dark] disabled:opacity-40">
                Add
              </button>
            </div>
          </div>
        )}

        {/* Branding */}
        {tab === 'branding' && (
          <div className="space-y-4">
            <div className="bg-[--surface-2] rounded-xl p-4 text-xs text-[--muted] border border-[--border]">
              <div className="font-medium text-[--text] mb-1">White-label branding</div>
              Full branding customization — logo upload, color scheme, display name — is coming in Phase 5.
              For now you can preview the accent color change here.
            </div>
            <div>
              <label className="block text-[11px] font-medium text-[--muted] mb-1.5">Display name override</label>
              <input
                defaultValue={ctx.restaurant.branding?.displayName ?? ''}
                placeholder={ctx.restaurant.name}
                className="w-full px-3 py-2.5 text-sm border border-[--border-2] rounded-lg outline-none focus:border-[--accent]" />
              <p className="text-[10px] text-[--hint] mt-1">Shown in the app header instead of the restaurant name.</p>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-[--muted] mb-1.5">Primary color</label>
              <div className="flex items-center gap-3">
                <input type="color" defaultValue={ctx.restaurant.branding?.primaryColor ?? '#C05A2A'}
                  className="w-10 h-10 rounded-lg border border-[--border-2] cursor-pointer" />
                <span className="text-xs text-[--muted]">Used for accent color throughout the app</span>
              </div>
            </div>
          </div>
        )}

        {/* Team */}
        {tab === 'team' && (
          <div>
            <p className="text-xs text-[--muted] mb-4">Team management and role-based access control is coming in Phase 5 (Entitlements).</p>
            <div className="bg-[--surface-2] rounded-xl p-4 border border-[--border] text-xs text-[--muted]">
              <div className="font-medium text-[--text] mb-2">Current user</div>
              <div>{ctx.currentUser.display_name}</div>
              <div className="mt-1 capitalize text-[--accent]">{ctx.role} role</div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
