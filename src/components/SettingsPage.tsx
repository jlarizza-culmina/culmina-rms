'use client'
import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase'
import type { Restaurant, Location, PicklistValue, DishMode, UserRole } from '@/lib/types'
import type { AppContext } from './AppShell'
import AIIngredientImporter from './AIIngredientImporter'
import NutritionEnricher from './NutritionEnricher'
import GlobalIngredientMapper from './GlobalIngredientMapper'
import HACCPEquipmentSettings from './HACCPEquipmentSettings'
import DaypartSettings from './DaypartSettings'
import OperatingHoursSettings from './OperatingHoursSettings'
import StaffModule from './StaffModule'

interface Props {
  ctx: AppContext
  userId: string
  onRestaurantUpdate: (r: Restaurant) => void
  onLocationsUpdate: (l: Location[]) => void
}

type SettingsTab = 'general' | 'locations' | 'picklists' | 'branding' | 'entitlements' | 'team' | 'queue' | 'library_import' | 'nutrition' | 'map_ingredients' | 'haccp_equipment' | 'staff_members' | 'dayparts' | 'operating_hours'

const PICKLIST_NAMES = [
  { value: 'ingredient_unit',     label: 'Ingredient Units' },
  { value: 'prep_method',         label: 'Preparation Methods' },
  { value: 'allergen',            label: 'Allergens' },
  { value: 'dietary',             label: 'Dietary Flags' },
  { value: 'season',              label: 'Seasons' },
  { value: 'recipe_stage',        label: 'Recipe Stages' },
  { value: 'ingredient_category', label: 'Ingredient Categories' },
]

const MODULES = ['recipes','menus','production','schedule','library','analytics','settings']
const ACTIONS = ['view','edit','delete']
const ROLES: UserRole[] = ['chef','manager','foh']
const ROLE_LABELS: Record<string, string> = { chef:'Chef', manager:'Manager', foh:'Front of House' }

const DEFAULT_ENTITLEMENTS: Record<string, Record<string, string[]>> = {
  chef:    { recipes:['view','edit'], production:['view','edit'], schedule:['view','edit'], library:['view','edit'], analytics:['view'], menus:['view'] },
  manager: { recipes:['view'], production:['view','edit'], schedule:['view'], library:['view'], analytics:['view'], menus:['view'] },
  foh:     { recipes:['view'] },
}

const LOC_SEASONS = ['year-round','spring','summer','fall','winter']
const US_TIMEZONES = [
  { value: 'America/New_York',    label: 'Eastern Time (ET)' },
  { value: 'America/Chicago',     label: 'Central Time (CT)' },
  { value: 'America/Denver',      label: 'Mountain Time (MT)' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (PT)' },
  { value: 'America/Phoenix',     label: 'Mountain Time — Arizona (no DST)' },
  { value: 'America/Anchorage',   label: 'Alaska Time (AKT)' },
  { value: 'Pacific/Honolulu',    label: 'Hawaii Time (HT)' },
]

function darkenHex(hex: string, pct = 15): string {
  const n = parseInt(hex.slice(1), 16)
  const r = Math.max(0, (n >> 16) - Math.round(2.55 * pct))
  const g = Math.max(0, ((n >> 8) & 0xff) - Math.round(2.55 * pct))
  const b = Math.max(0, (n & 0xff) - Math.round(2.55 * pct))
  return '#' + [r,g,b].map(x => x.toString(16).padStart(2,'0')).join('')
}

export default function SettingsPage({ ctx, userId, onRestaurantUpdate, onLocationsUpdate }: Props) {
  const supabase = createClient()
  const [tab,    setTab]    = useState<SettingsTab>('general')
  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── General ──────────────────────────────────────────────────
  const [rName,    setRName]    = useState(ctx.restaurant.name)
  const [rDesc,    setRDesc]    = useState(ctx.restaurant.description)
  const [rCuisine, setRCuisine] = useState(ctx.restaurant.cuisine_type)
  const [dishMode, setDishMode] = useState<DishMode>(ctx.restaurant.dish_mode)

  // ── Branding ──────────────────────────────────────────────────
  const [logoUrl,      setLogoUrl]      = useState(ctx.restaurant.branding?.logoUrl ?? '')
  const [displayName,  setDisplayName]  = useState(ctx.restaurant.branding?.displayName ?? '')
  const [primaryColor, setPrimaryColor] = useState(ctx.restaurant.branding?.primaryColor ?? '#C05A2A')
  const [secondaryColor, setSecondaryColor] = useState(ctx.restaurant.branding?.secondaryColor ?? '#7A4F6D')
  const [uploadingLogo, setUploadingLogo] = useState(false)

  // ── Locations ─────────────────────────────────────────────────
  const [locations,    setLocations]    = useState<Location[]>(ctx.locations)
  const [editingLocId, setEditingLocId] = useState<string | null>(null)
  const [locDraft,     setLocDraft]     = useState<Partial<Location>>({})

  // ── Queue settings
  const [queueLocId,   setQueueLocId]   = useState(ctx.locations[0]?.id ?? '')
  const [tosText,      setTosText]      = useState('')
  const [tosUrl,       setTosUrl]       = useState('')
  const [walkMins,     setWalkMins]     = useState(2)
  const [maxParty,     setMaxParty]     = useState(10)
  const [queueLoaded,  setQueueLoaded]  = useState(false)

  // ── Picklists ─────────────────────────────────────────────────
  const [listName,  setListName]  = useState('ingredient_unit')
  const [picklists, setPicklists] = useState<PicklistValue[]>([])
  const [newLabel,  setNewLabel]  = useState('')

  // ── Entitlements ─────────────────────────────────────────────
  const [entitlements, setEntitlements] = useState<Record<string, Record<string, string[]>>>(
    (ctx.restaurant.settings as Record<string, Record<string, Record<string, string[]>>>)?.entitlements ?? DEFAULT_ENTITLEMENTS
  )

  useEffect(() => { if (tab === 'picklists') loadPicklists() }, [tab, listName])
  useEffect(() => {
    if (tab === 'queue' && queueLocId && !queueLoaded) {
      supabase.from('location_waitlist_settings').select('*').eq('location_id', queueLocId).single()
        .then(({ data }) => {
          if (data) {
            setTosText(data.tos_text ?? ''); setTosUrl(data.tos_url ?? '')
            setWalkMins(data.walk_time_minutes ?? 2); setMaxParty(data.max_party_size ?? 10)
          }
          setQueueLoaded(true)
        })
    }
  }, [tab, queueLocId])

  async function loadPicklists() {
    const { data } = await supabase.from('picklist_values').select('*')
      .eq('list_name', listName)
      .or(`restaurant_id.is.null,restaurant_id.eq.${ctx.restaurant.id}`)
      .eq('is_active', true).order('sort_order')
    setPicklists(data ?? [])
  }

  function flash(msg: string) { setSaved(msg); setTimeout(() => setSaved(''), 2500) }

  async function saveQueueSettings() {
    setSaving(true)
    await supabase.from('location_waitlist_settings').upsert({
      location_id: queueLocId, tos_text: tosText, tos_url: tosUrl,
      walk_time_minutes: walkMins, max_party_size: maxParty,
    }, { onConflict: 'location_id' })
    setSaving(false); flash('Queue settings saved')
  }

  async function saveGeneral() {
    setSaving(true)
    const { data } = await supabase.from('restaurants')
      .update({ name: rName, description: rDesc, cuisine_type: rCuisine, dish_mode: dishMode })
      .eq('id', ctx.restaurant.id).select().single()
    if (data) onRestaurantUpdate(data as Restaurant)
    setSaving(false); flash('Saved')
  }

  async function saveBranding() {
    setSaving(true)
    const branding = { ...ctx.restaurant.branding, logoUrl, displayName, primaryColor, secondaryColor }
    const { data } = await supabase.from('restaurants')
      .update({ branding }).eq('id', ctx.restaurant.id).select().single()
    if (data) onRestaurantUpdate(data as Restaurant)
    setSaving(false); flash('Branding saved')
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingLogo(true)
    try {
      const ext = file.name.split('.').pop()
      const path = `${ctx.restaurant.id}/logo.${ext}`
      const { error } = await supabase.storage.from('branding').upload(path, file, { upsert: true })
      if (error) throw error
      const { data: { publicUrl } } = supabase.storage.from('branding').getPublicUrl(path)
      setLogoUrl(publicUrl)
      flash('Logo uploaded — click Save Branding to apply')
    } catch (err) {
      flash(`Upload failed: ${String(err)}`)
    } finally {
      setUploadingLogo(false)
    }
  }

  function startEditLoc(loc: Location) {
    setEditingLocId(loc.id)
    setLocDraft({ ...loc })
  }

  async function saveLocation() {
    if (!editingLocId) return
    setSaving(true)
    const { data } = await supabase.from('locations')
      .update(locDraft).eq('id', editingLocId).select().single()
    if (data) {
      const updated = locations.map(l => l.id === editingLocId ? (data as Location) : l)
      setLocations(updated)
      onLocationsUpdate(updated)
    }
    setEditingLocId(null)
    setSaving(false); flash('Location saved')
  }

  function toggleLocSeason(s: string) {
    const cur = locDraft.seasons ?? []
    setLocDraft(prev => ({ ...prev, seasons: cur.includes(s) ? cur.filter(x => x !== s) : [...cur, s] }))
  }

  async function addPicklistItem() {
    if (!newLabel.trim()) return
    const val = newLabel.trim().toLowerCase().replace(/\s+/g, '_')
    await supabase.from('picklist_values').insert({
      restaurant_id: ctx.restaurant.id, list_name: listName,
      value: val, label: newLabel.trim(), sort_order: picklists.length + 1, is_system: false,
    })
    setNewLabel(''); loadPicklists()
  }

  async function removePicklistItem(id: string, isSystem: boolean) {
    if (isSystem) { flash('System values cannot be removed'); return }
    await supabase.from('picklist_values').update({ is_active: false }).eq('id', id)
    loadPicklists()
  }

  async function saveEntitlements() {
    setSaving(true)
    const settings = { ...(ctx.restaurant.settings as object ?? {}), entitlements }
    const { data } = await supabase.from('restaurants')
      .update({ settings }).eq('id', ctx.restaurant.id).select().single()
    if (data) onRestaurantUpdate(data as Restaurant)
    setSaving(false); flash('Entitlements saved')
  }

  function toggleAction(role: string, mod: string, action: string) {
    setEntitlements(prev => {
      const rolePerms = prev[role] ?? {}
      const modPerms  = rolePerms[mod] ?? []
      const updated   = modPerms.includes(action) ? modPerms.filter(a => a !== action) : [...modPerms, action]
      return { ...prev, [role]: { ...rolePerms, [mod]: updated } }
    })
  }

  const [importSuccess, setImportSuccess] = useState<number | null>(null)

  const TABS: { key: SettingsTab; label: string }[] = [
    { key: 'general',      label: 'General' },
    { key: 'locations',    label: 'Locations' },
    { key: 'branding',     label: 'Branding' },
    { key: 'staff_members', label: '👥 Staff' },
    { key: 'dayparts',     label: '⏱ Dayparts' },
    { key: 'operating_hours', label: '🕐 Hours' },
    { key: 'haccp_equipment', label: '🌡 HACCP Equipment' },
    { key: 'queue',          label: 'Queue' },
    { key: 'library_import', label: '✨ AI Library Import' },
    { key: 'nutrition',       label: '🥦 Nutrition' },
    { key: 'map_ingredients', label: '🔗 Map Ingredients' },
    { key: 'picklists',    label: 'Picklists' },
    { key: 'entitlements', label: 'Entitlements' },
    { key: 'team',         label: 'Team' },
  ]

  return (
    <div className="h-full flex flex-col overflow-hidden">

      {/* Header */}
      <div className="bg-white border-b border-[--border] px-6 py-4 flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <h1 className="font-serif text-xl font-medium text-[--text]">Settings</h1>
          {saved && <span className="text-xs text-[--green] font-medium">✓ {saved}</span>}
        </div>
        <div className="flex gap-0.5 flex-wrap">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-4 py-2 text-xs font-medium rounded-md transition-colors ${tab === t.key ? 'bg-[--accent-light] text-[--accent]' : 'text-[--muted] hover:text-[--text] hover:bg-[--surface-2]'}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 max-w-4xl">

        {/* ── General ── */}
        {tab === 'general' && (
          <div className="space-y-4">
            <Field label="Restaurant name">
              <input value={rName} onChange={e => setRName(e.target.value)} className="input" />
            </Field>
            <Field label="Description">
              <textarea value={rDesc} onChange={e => setRDesc(e.target.value)} rows={3} className="input resize-none" />
            </Field>
            <Field label="Cuisine type">
              <input value={rCuisine} onChange={e => setRCuisine(e.target.value)} className="input" />
            </Field>
            <Field label="Dish mode">
              <div className="flex gap-2">
                {(['single','composed'] as DishMode[]).map(m => (
                  <button key={m} onClick={() => setDishMode(m)}
                    className={`flex-1 py-2.5 text-xs font-medium rounded-lg border-2 transition-colors capitalize ${dishMode === m ? 'border-[--accent] bg-[--accent-light] text-[--accent]' : 'border-[--border] text-[--muted] hover:border-[--border-2]'}`}>
                    {m === 'single' ? 'Single recipe per dish' : 'Composed dishes'}
                  </button>
                ))}
              </div>
            </Field>
            <SaveBtn onClick={saveGeneral} saving={saving} />
          </div>
        )}

        {/* ── Branding ── */}
        {tab === 'branding' && (
          <div className="space-y-5">

            {/* Logo */}
            <div>
              <label className="block text-[11px] font-medium text-[--muted] mb-2">Logo (520 × 520 px recommended)</label>
              <div className="flex items-start gap-4">
                <div className="w-20 h-20 rounded-xl border-2 border-[--border-2] flex items-center justify-center flex-shrink-0 overflow-hidden bg-[--surface-2]">
                  {logoUrl ? (
                    <img src={logoUrl} alt="Logo" className="w-full h-full object-contain" />
                  ) : (
                    <div className="text-2xl font-bold text-[--hint]">{(displayName || ctx.restaurant.name).charAt(0)}</div>
                  )}
                </div>
                <div className="flex-1 space-y-2">
                  <button onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingLogo}
                    className="px-3 py-2 text-xs border border-[--border-2] rounded-lg hover:bg-[--surface-2] transition-colors w-full text-left">
                    {uploadingLogo ? '⏳ Uploading…' : '📁 Upload logo image'}
                  </button>
                  <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
                  <input value={logoUrl} onChange={e => setLogoUrl(e.target.value)}
                    placeholder="or paste an image URL…"
                    className="input text-xs" />
                  <p className="text-[10px] text-[--hint]">JPG, PNG, SVG. Displayed in the top-left of the app.</p>
                </div>
              </div>
            </div>

            {/* Display name */}
            <Field label="Display name">
              <input value={displayName} onChange={e => setDisplayName(e.target.value)}
                placeholder={ctx.restaurant.name} className="input" />
              <p className="text-[10px] text-[--hint] mt-1">Shown in app header instead of restaurant name</p>
            </Field>

            {/* Colors */}
            <div className="grid grid-cols-2 gap-4">
              <Field label="Primary color">
                <div className="flex items-center gap-2">
                  <input type="color" value={primaryColor}
                    onChange={e => setPrimaryColor(e.target.value)}
                    className="w-10 h-10 rounded-lg border border-[--border-2] cursor-pointer flex-shrink-0" />
                  <input value={primaryColor} onChange={e => setPrimaryColor(e.target.value)}
                    className="input font-mono text-xs" maxLength={7} />
                </div>
              </Field>
              <Field label="Secondary color">
                <div className="flex items-center gap-2">
                  <input type="color" value={secondaryColor}
                    onChange={e => setSecondaryColor(e.target.value)}
                    className="w-10 h-10 rounded-lg border border-[--border-2] cursor-pointer flex-shrink-0" />
                  <input value={secondaryColor} onChange={e => setSecondaryColor(e.target.value)}
                    className="input font-mono text-xs" maxLength={7} />
                </div>
              </Field>
            </div>

            {/* Live preview */}
            <div className="p-4 rounded-xl border border-[--border] bg-[--surface-2]">
              <div className="text-[10px] font-medium text-[--muted] mb-2">Preview</div>
              <div className="h-10 rounded-lg flex items-center px-3 gap-2 bg-white border border-[--border]">
                {logoUrl ? (
                  <img src={logoUrl} alt="" className="h-6 w-6 object-contain rounded" />
                ) : (
                  <div className="w-6 h-6 rounded flex items-center justify-center text-white text-[10px] font-bold" style={{ background: primaryColor }}>
                    {(displayName || ctx.restaurant.name).charAt(0)}
                  </div>
                )}
                <span className="text-sm font-medium" style={{ fontFamily: 'Georgia, serif' }}>
                  {displayName || ctx.restaurant.name}
                </span>
                <div className="ml-auto flex gap-1">
                  <div className="px-2 py-0.5 rounded text-[10px] text-white" style={{ background: primaryColor }}>Save</div>
                  <div className="px-2 py-0.5 rounded text-[10px] border" style={{ borderColor: primaryColor, color: primaryColor }}>Cancel</div>
                </div>
              </div>
              <p className="text-[10px] text-[--hint] mt-2">Powered by CulminaRMS</p>
            </div>

            <SaveBtn onClick={saveBranding} saving={saving} label="Save Branding" />
          </div>
        )}

        {/* ── Locations ── */}
        {tab === 'locations' && (
          <div>
            <p className="text-xs text-[--muted] mb-4">Manage your restaurant locations.</p>
            <div className="space-y-3">
              {locations.map(l => (
                <div key={l.id} className="bg-white rounded-xl border border-[--border] p-4">
                  {editingLocId === l.id ? (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Location name">
                          <input value={locDraft.name ?? ''} onChange={e => setLocDraft(p => ({ ...p, name: e.target.value }))} className="input" />
                        </Field>
                        <Field label="Timezone">
                          <select value={locDraft.timezone ?? 'America/New_York'}
                            onChange={e => setLocDraft(p => ({ ...p, timezone: e.target.value }))}
                            className="input bg-white">
                            {US_TIMEZONES.map(tz => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
                          </select>
                        </Field>
                        <Field label="Street address" cls="col-span-2">
                          <input value={locDraft.address ?? ''} onChange={e => setLocDraft(p => ({ ...p, address: e.target.value }))} className="input" />
                        </Field>
                        <Field label="City">
                          <input value={locDraft.city ?? ''} onChange={e => setLocDraft(p => ({ ...p, city: e.target.value }))} className="input" />
                        </Field>
                        <Field label="State">
                          <input value={locDraft.state ?? ''} onChange={e => setLocDraft(p => ({ ...p, state: e.target.value }))} maxLength={2} className="input" />
                        </Field>
                        <Field label="ZIP">
                          <input value={locDraft.zip ?? ''} onChange={e => setLocDraft(p => ({ ...p, zip: e.target.value }))} className="input" />
                        </Field>
                        <Field label="Phone">
                          <input value={locDraft.phone ?? ''} onChange={e => setLocDraft(p => ({ ...p, phone: e.target.value }))} className="input" />
                        </Field>
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                        <Field label="Acquired date">
                          <input type="date" value={locDraft.acquired_date ?? ''} onChange={e => setLocDraft(p => ({ ...p, acquired_date: e.target.value }))} className="input" />
                        </Field>
                        <Field label="Opened date">
                          <input type="date" value={locDraft.opened_date ?? ''} onChange={e => setLocDraft(p => ({ ...p, opened_date: e.target.value }))} className="input" />
                        </Field>
                        <Field label="End date">
                          <input type="date" value={locDraft.end_date ?? ''} onChange={e => setLocDraft(p => ({ ...p, end_date: e.target.value }))} className="input" />
                        </Field>
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-[--muted] mb-1.5">Seasons</label>
                        <div className="flex gap-2 flex-wrap">
                          {LOC_SEASONS.map(s => (
                            <button key={s} onClick={() => toggleLocSeason(s)}
                              className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors capitalize ${(locDraft.seasons ?? []).includes(s) ? 'bg-[--accent-light] border-[--accent] text-[--accent] font-medium' : 'border-[--border-2] text-[--muted] hover:bg-[--surface-2]'}`}>
                              {s}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={saveLocation} disabled={saving}
                          className="px-4 py-2 text-xs bg-[--accent] text-white rounded-lg hover:bg-[--accent-dark] disabled:opacity-50 font-medium">
                          {saving ? 'Saving…' : 'Save location'}
                        </button>
                        <button onClick={() => setEditingLocId(null)}
                          className="px-4 py-2 text-xs border border-[--border-2] rounded-lg text-[--muted] hover:bg-[--surface-2]">
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-3">
                      <div className="flex-1">
                        <div className="text-sm font-medium text-[--text]">
                          {l.name}
                          {l.is_primary && <span className="text-[10px] text-[--accent] ml-1.5 bg-[--accent-light] px-1.5 py-0.5 rounded-full">Primary</span>}
                        </div>
                        <div className="text-xs text-[--muted] mt-0.5">{[l.address, l.city, l.state].filter(Boolean).join(', ')}</div>
                        <div className="text-[10px] text-[--hint] mt-0.5 flex gap-3">
                          <span>{l.timezone}</span>
                          {l.opened_date && <span>Opened: {l.opened_date}</span>}
                          {(l.seasons ?? []).length > 0 && <span>{l.seasons?.join(', ')}</span>}
                        </div>
                      </div>
                      <button onClick={() => startEditLoc(l)}
                        className="text-xs text-[--muted] hover:text-[--accent] border border-[--border-2] px-2.5 py-1 rounded-lg flex-shrink-0 transition-colors">
                        Edit
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <button className="w-full mt-3 py-2.5 border-2 border-dashed border-[--border-2] rounded-xl text-xs text-[--muted] hover:border-[--accent] hover:text-[--accent] transition-colors">
              + Add location
            </button>
          </div>
        )}

        {/* ── Picklists ── */}
        {tab === 'picklists' && (
          <div>
            <p className="text-xs text-[--muted] mb-4">Customize dropdown values. System values (grey) cannot be removed.</p>
            <div className="mb-4">
              <select value={listName} onChange={e => setListName(e.target.value)} className="input w-full bg-white">
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
                className="flex-1 input text-xs"
                onKeyDown={e => e.key === 'Enter' && addPicklistItem()} />
              <button onClick={addPicklistItem} disabled={!newLabel.trim()}
                className="px-3 py-2 bg-[--accent] text-white text-xs rounded-lg hover:bg-[--accent-dark] disabled:opacity-40">
                Add
              </button>
            </div>
          </div>
        )}

        {/* ── Entitlements ── */}
        {tab === 'entitlements' && (
          <div>
            <p className="text-xs text-[--muted] mb-4">
              Control what each role can do in each module. Admin always has full access.
              Changes apply to all users with that role in this restaurant.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border border-[--border] rounded-xl overflow-hidden">
                <thead>
                  <tr className="bg-[--surface-2] border-b border-[--border]">
                    <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-[--hint] uppercase tracking-wide w-28">Module</th>
                    {ROLES.map(role => (
                      <th key={role} className="px-3 py-2.5 text-center text-[10px] font-semibold text-[--hint] uppercase tracking-wide">
                        {ROLE_LABELS[role]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {MODULES.map((mod, i) => (
                    <tr key={mod} className={`border-b border-[--border] last:border-0 ${i % 2 === 0 ? 'bg-white' : 'bg-[--surface-2]/30'}`}>
                      <td className="px-3 py-2.5 font-medium text-[--text] capitalize">{mod}</td>
                      {ROLES.map(role => {
                        const perms = entitlements[role]?.[mod] ?? []
                        return (
                          <td key={role} className="px-3 py-2.5 text-center">
                            <div className="flex gap-1 justify-center flex-wrap">
                              {ACTIONS.map(action => (
                                <button key={action} onClick={() => toggleAction(role, mod, action)}
                                  className={`text-[10px] px-1.5 py-0.5 rounded-full border transition-colors ${perms.includes(action) ? 'bg-[--accent-light] border-[--accent] text-[--accent] font-medium' : 'border-[--border-2] text-[--hint] hover:bg-[--surface-2]'}`}>
                                  {action}
                                </button>
                              ))}
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-[--hint] mt-2">Admin and Super Admin roles always have full access to all modules.</p>
            <div className="mt-3">
              <button onClick={() => setEntitlements(DEFAULT_ENTITLEMENTS)}
                className="text-xs text-[--muted] underline hover:text-[--text] mr-4">Reset to defaults</button>
              <SaveBtn onClick={saveEntitlements} saving={saving} label="Save Entitlements" />
            </div>
          </div>
        )}

        {/* ── Queue ── */}
        {tab === 'queue' && (
          <div className="space-y-5">
            <p className="text-xs text-[--muted]">Settings for the guest-facing waitlist form at each location.</p>
            {ctx.locations.length > 1 && (
              <Field label="Location">
                <select value={queueLocId} onChange={e => { setQueueLocId(e.target.value); setQueueLoaded(false) }} className="input bg-white">
                  {ctx.locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </Field>
            )}
            <div className="grid grid-cols-2 gap-4">
              <Field label="Walk time from station (minutes)">
                <input type="number" min="1" max="30" value={walkMins}
                  onChange={e => setWalkMins(parseInt(e.target.value) || 2)} className="input" />
                <p className="text-[10px] text-[--hint] mt-1">Used for MTA smart notification timing (Phase 9B-2)</p>
              </Field>
              <Field label="Max party size">
                <input type="number" min="1" max="50" value={maxParty}
                  onChange={e => setMaxParty(parseInt(e.target.value) || 10)} className="input" />
              </Field>
            </div>
            <Field label="Terms of Service URL">
              <input value={tosUrl} onChange={e => setTosUrl(e.target.value)}
                placeholder="https://yoursite.com/waitlist-tos  (leave blank to show text inline)"
                className="input" />
            </Field>
            <div>
              <label className="block text-[11px] font-medium text-[--muted] mb-1.5">
                Terms of Service text
                <span className="ml-2 font-normal text-[--hint]">— HTML or plain text. Shown inline on the join form. Leave blank to hide the ToS checkbox.</span>
              </label>
              <textarea value={tosText} onChange={e => setTosText(e.target.value)}
                rows={8} placeholder="By joining this waitlist, you agree to receive SMS messages from us. Message and data rates may apply..."
                className="w-full px-3 py-2 text-xs border border-[--border-2] rounded-xl outline-none focus:border-[--accent] resize-y font-mono" />
            </div>
            <SaveBtn onClick={saveQueueSettings} saving={saving} label="Save Queue Settings" />
          </div>
        )}

        {/* ── Team ── */}
        {tab === 'team' && (
          <div className="space-y-3">
            <p className="text-xs text-[--muted]">Team management and user invitations coming in a future release.</p>
            <div className="bg-white rounded-xl border border-[--border] p-4">
              <div className="text-xs font-medium text-[--text] mb-1">Current user</div>
              <div className="text-xs text-[--muted]">{ctx.currentUser.display_name}</div>
              <div className="text-[11px] text-[--accent] mt-1 capitalize">{ctx.role} role</div>
            </div>
          </div>
        )}

        {tab === 'nutrition' && (
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-medium text-[--text] mb-1">Nutrition Data</h3>
              <p className="text-xs text-[--muted]">
                Enrich your ingredient library with nutrition data from the USDA FoodData Central database.
                Select items and click USDA Lookup, or enter values manually.
                Once enriched, the Nutrition tab on every recipe calculates automatically.
              </p>
            </div>
            <NutritionEnricher userId={userId} restaurantId={ctx.restaurant.id} />
          </div>
        )}
        {tab === 'map_ingredients' && (
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-medium text-[--text] mb-1">Global Ingredient Mapping</h3>
              <p className="text-xs text-[--muted]">
                Every unique ingredient name found across all recipes is listed once.
                Map it to a library item and every recipe using that name updates simultaneously.
              </p>
            </div>
            <GlobalIngredientMapper userId={userId} restaurantId={ctx.restaurant.id} />
          </div>
        )}
        {tab === 'library_import' && (
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-medium text-[--text] mb-1">AI Ingredient Library Import</h3>
              <p className="text-xs text-[--muted]">
                Enter a food or beverage category and the AI generates a list of ingredients for your library.
                Review and edit the grid, then import only the items you need.
                Items already in your library are shown greyed out and will not be re-imported.
              </p>
            </div>
            {importSuccess !== null && (
              <div className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2 flex items-center gap-2">
                ✓ {importSuccess} ingredient{importSuccess !== 1 ? 's' : ''} added to your library.
                <button onClick={() => setImportSuccess(null)} className="ml-auto text-green-500 hover:text-green-700">✕</button>
              </div>
            )}
            <AIIngredientImporter
              userId={userId}
              restaurantId={ctx.restaurant.id}
              onImported={count => setImportSuccess(count)}
            />
          </div>
        )}

        {/* ── Staff (Gap 7) tab ── */}
        {tab === 'staff_members' && (
          <StaffModule
            restaurantId={ctx.restaurant.id}
            locationId={ctx.locations?.[0]?.id ?? ''}
          />
        )}

        {/* ── Dayparts tab ── */}
        {tab === 'dayparts' && (
          <DaypartSettings
            locationId={ctx.locations?.[0]?.id}
            locationName={ctx.locations?.[0]?.name}
          />
        )}

        {/* ── Operating Hours tab ── */}
        {tab === 'operating_hours' && (
          <OperatingHoursSettings
            locationId={ctx.locations?.[0]?.id}
            locationName={ctx.locations?.[0]?.name}
          />
        )}

        {/* ── HACCP Equipment tab ── */}
        {tab === 'haccp_equipment' && (
          <HACCPEquipmentSettings
            locationId={ctx.locations?.[0]?.id}
            restaurantId={ctx.restaurant.id}
            locationName={ctx.locations?.[0]?.name}
          />
        )}
      </div>
    </div>
  )
}

// ── Shared sub-components ─────────────────────────────────────
function Field({ label, children, cls = '' }: { label: string; children?: React.ReactNode; cls?: string }) {
  return (
    <div className={cls}>
      <label className="block text-[11px] font-medium text-[--muted] mb-1.5">{label}</label>
      {children}
    </div>
  )
}

function SaveBtn({ onClick, saving, label = 'Save changes' }: { onClick: () => void; saving: boolean; label?: string }) {
  return (
    <button onClick={onClick} disabled={saving}
      className="px-5 py-2.5 bg-[--accent] text-white text-sm font-medium rounded-lg hover:bg-[--accent-dark] disabled:opacity-50 flex items-center gap-2 transition-colors">
      {saving ? <><span className="spinner" />{label.replace('Save', 'Saving')}…</> : label}
    </button>
  )
}
