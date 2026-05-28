'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase'
import type { LibraryIngredient, Vendor, ServiceWareItem, ServiceWareInventory, ServiceWareCategory, Location } from '@/lib/types'

interface Props {
  userId: string
  restaurantId?: string
  locations: Location[]
}

type LibTab = 'ingredients' | 'vendors' | 'plateware' | 'glassware' | 'flatware' | 'boh_utensils' | 'equipment'

const TABS: { key: LibTab; label: string; icon: string; singular: string }[] = [
  { key: 'ingredients',  label: 'Ingredients',  icon: '🥬', singular: 'Ingredient' },
  { key: 'vendors',      label: 'Vendors',       icon: '🚚', singular: 'Vendor' },
  { key: 'plateware',    label: 'Plateware',     icon: '🍽', singular: 'Plateware item' },
  { key: 'glassware',    label: 'Glassware',     icon: '🥂', singular: 'Glassware item' },
  { key: 'flatware',     label: 'Flatware',      icon: '🍴', singular: 'Flatware item' },
  { key: 'boh_utensils', label: 'BOH Utensils',  icon: '🔪', singular: 'BOH Utensil' },
  { key: 'equipment',    label: 'Equipment',     icon: '⚙️', singular: 'Equipment item' },
]

const ING_CATEGORIES = ['produce','meat','seafood','dairy','bakery','pantry','spices','spirits','mixers','frozen','beverages','other']
const SW_CATEGORIES: LibTab[] = ['plateware','glassware','flatware','boh_utensils','equipment']

const fmt$ = (n: number | null) => n != null ? `$${n.toFixed(2)}` : '—'

export default function LibraryModule({ userId, restaurantId, locations }: Props) {
  const supabase = createClient()
  const [tab,       setTab]      = useState<LibTab>('ingredients')
  const [search,    setSearch]   = useState('')
  const [filter,    setFilter]   = useState('all')
  const [loading,   setLoading]  = useState(true)
  const [showModal, setShowModal]= useState(false)
  const [editing,   setEditing]  = useState<string | null>(null) // id of item being edited

  // Data
  const [ingredients, setIngredients] = useState<LibraryIngredient[]>([])
  const [vendors,     setVendors]     = useState<Vendor[]>([])
  const [swItems,     setSwItems]     = useState<ServiceWareItem[]>([])
  const [swInventory, setSwInventory] = useState<Record<string, ServiceWareInventory[]>>({})

  const isSwTab = SW_CATEGORIES.includes(tab as LibTab)

  // ── Load data ─────────────────────────────────────────────
  const loadIngredients = useCallback(async () => {
    const { data } = await supabase.from('ingredient_library').select('*').eq('user_id', userId).eq('is_active', true).order('name')
    setIngredients(data ?? [])
  }, [userId, supabase])

  const loadVendors = useCallback(async () => {
    const { data } = await supabase.from('vendors').select('*').eq('user_id', userId).eq('is_active', true).order('name')
    setVendors(data ?? [])
  }, [userId, supabase])

  const loadSwItems = useCallback(async (cat: ServiceWareCategory) => {
    let q = supabase.from('service_ware_items').select('*').eq('category', cat).eq('is_active', true).order('name')
    if (restaurantId) q = q.or(`restaurant_id.eq.${restaurantId},restaurant_id.is.null`)
    const { data } = await q
    setSwItems(data ?? [])
    return data ?? []
  }, [restaurantId, supabase])

  const loadSwInventory = useCallback(async (itemId: string) => {
    const { data } = await supabase.from('service_ware_inventory').select('*').eq('service_ware_item_id', itemId)
    const rows = data ?? []
    const filled = locations.map(loc => rows.find(r => r.location_id === loc.id) ?? {
      id: `new-${loc.id}`, service_ware_item_id: itemId, location_id: loc.id, quantity_on_hand: 0, notes: '',
    } as ServiceWareInventory)
    setSwInventory(prev => ({ ...prev, [itemId]: filled }))
  }, [locations, supabase])

  useEffect(() => {
    setLoading(true)
    setSearch(''); setFilter('all')
    if (tab === 'ingredients') loadIngredients().finally(() => setLoading(false))
    else if (tab === 'vendors') loadVendors().finally(() => setLoading(false))
    else {
      loadSwItems(tab as ServiceWareCategory).then(async (items) => {
        // Bulk load inventory for all items in this tab
        if (items && items.length > 0) {
          const ids = items.map((i: ServiceWareItem) => i.id)
          const { data } = await supabase
            .from('service_ware_inventory')
            .select('*')
            .in('service_ware_item_id', ids)
          const grouped: Record<string, ServiceWareInventory[]> = {}
          items.forEach((item: ServiceWareItem) => {
            grouped[item.id] = locations.map(loc => {
              const existing = (data ?? []).find((r: ServiceWareInventory) => r.service_ware_item_id === item.id && r.location_id === loc.id)
              return existing ?? { id: `new-${loc.id}`, service_ware_item_id: item.id, location_id: loc.id, quantity_on_hand: 0, notes: '' } as ServiceWareInventory
            })
          })
          setSwInventory(prev => ({ ...prev, ...grouped }))
        }
      }).finally(() => setLoading(false))
    }
  }, [tab])

  // ── Filtered rows ──────────────────────────────────────────
  const ingFiltered = useMemo(() => ingredients.filter(i => {
    const matchSearch = !search || i.name.toLowerCase().includes(search.toLowerCase())
    const matchFilter = filter === 'all' || i.category === filter
    return matchSearch && matchFilter
  }), [ingredients, search, filter])

  const venFiltered = useMemo(() => vendors.filter(v =>
    !search || v.name.toLowerCase().includes(search.toLowerCase())
  ), [vendors, search])

  const swFiltered = useMemo(() => swItems.filter(i => {
    const matchSearch = !search || i.name.toLowerCase().includes(search.toLowerCase()) || i.brand?.toLowerCase().includes(search.toLowerCase())
    const matchFilter = filter === 'all' || i.brand === filter
    return matchSearch && matchFilter
  }), [swItems, search, filter])

  // ── Open modal ─────────────────────────────────────────────
  function openAdd() { setEditing(null); setShowModal(true) }
  function openEdit(id: string) {
    setEditing(id)
    setShowModal(true)
    if (isSwTab) loadSwInventory(id)
  }

  const primaryLoc = locations[0]

  function getSwQoh(item: ServiceWareItem) {
    const inv = swInventory[item.id]
    if (!inv) return '—'
    const total = inv.reduce((s, r) => s + (r.quantity_on_hand ?? 0), 0)
    return total
  }

  const tabLabel = TABS.find(t => t.key === tab)?.label ?? ''

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Tab bar ── */}
      <div className="bg-white border-b border-[--border] flex-shrink-0 overflow-x-auto">
        <div className="flex min-w-max px-2">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-4 py-3 text-xs font-medium whitespace-nowrap border-b-2 transition-colors flex items-center gap-1.5 ${tab === t.key ? 'border-[--accent] text-[--accent]' : 'border-transparent text-[--muted] hover:text-[--text]'}`}>
              <span>{t.icon}</span>{t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Search + filter + add ── */}
      <div className="bg-white border-b border-[--border] px-4 py-2.5 flex items-center gap-2 flex-shrink-0">
        <div className="relative flex-1 max-w-sm">
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder={`Search ${tabLabel.toLowerCase()}…`}
            className="w-full pl-7 pr-3 py-1.5 text-xs border border-[--border-2] rounded-lg outline-none focus:border-[--accent]" />
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[--hint] text-xs">🔍</span>
        </div>

        {/* Contextual filter */}
        {tab === 'ingredients' && (
          <select value={filter} onChange={e => setFilter(e.target.value)}
            className="text-xs border border-[--border-2] rounded-lg px-2.5 py-1.5 bg-white outline-none capitalize">
            <option value="all">All categories</option>
            {ING_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        {tab === 'ingredients' && (
          <select value={filter === 'all' || ING_CATEGORIES.includes(filter) ? 'all' : filter}
            onChange={e => setFilter(e.target.value)}
            className="text-xs border border-[--border-2] rounded-lg px-2.5 py-1.5 bg-white outline-none">
            <option value="all">All vendors</option>
            {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        )}

        <div className="ml-auto">
          <button onClick={openAdd}
            className="px-3 py-1.5 text-xs font-medium bg-[--accent] text-white rounded-lg hover:bg-[--accent-dark] transition-colors">
            + Add {TABS.find(t=>t.key===tab)?.singular}
          </button>
        </div>
      </div>

      {/* ── Table ── */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-sm text-[--muted]">Loading…</div>
        ) : (

          /* ── Ingredients table ── */
          tab === 'ingredients' ? (
            ingFiltered.length === 0 ? (
              <EmptyState label="ingredient" onAdd={openAdd} />
            ) : (
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-white border-b border-[--border] z-10">
                  <tr>
                    {['Name','Category','Vendor','Purchase unit','Unit cost','Recipe unit',''].map(h => (
                      <th key={h} className="px-4 py-2.5 text-left text-[10px] font-semibold text-[--hint] uppercase tracking-wide first:pl-6">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ingFiltered.map((i, idx) => {
                    const vendor = vendors.find(v => v.id === i.vendor_id)
                    return (
                      <tr key={i.id} onClick={() => openEdit(i.id)}
                        className={`border-b border-[--border] cursor-pointer hover:bg-[--accent-light]/20 ${idx%2===0?'bg-white':'bg-[--surface-2]/30'}`}>
                        <td className="px-4 py-2.5 pl-6 font-medium text-[--text]">{i.name}</td>
                        <td className="px-4 py-2.5 capitalize text-[--muted]">{i.category}</td>
                        <td className="px-4 py-2.5 text-[--muted]">{vendor?.name ?? '—'}</td>
                        <td className="px-4 py-2.5 text-[--muted]">{i.purchase_unit || '—'}</td>
                        <td className="px-4 py-2.5 text-[--accent] font-medium">{fmt$(i.purchase_unit_cost ?? null)}</td>
                        <td className="px-4 py-2.5 text-[--muted]">{i.recipe_unit || '—'}</td>
                        <td className="px-3 py-2.5 text-[--hint] text-right">›</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )

          /* ── Vendors table ── */
          ) : tab === 'vendors' ? (
            venFiltered.length === 0 ? (
              <EmptyState label="vendor" onAdd={openAdd} />
            ) : (
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-white border-b border-[--border] z-10">
                  <tr>
                    {['Name','Contact','Phone','Email','Delivery days','Acct #',''].map(h => (
                      <th key={h} className="px-4 py-2.5 text-left text-[10px] font-semibold text-[--hint] uppercase tracking-wide first:pl-6">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {venFiltered.map((v, idx) => (
                    <tr key={v.id} onClick={() => openEdit(v.id)}
                      className={`border-b border-[--border] cursor-pointer hover:bg-[--accent-light]/20 ${idx%2===0?'bg-white':'bg-[--surface-2]/30'}`}>
                      <td className="px-4 py-2.5 pl-6 font-medium text-[--text]">{v.name}</td>
                      <td className="px-4 py-2.5 text-[--muted]">{v.contact_name || '—'}</td>
                      <td className="px-4 py-2.5 text-[--muted]">{v.phone || '—'}</td>
                      <td className="px-4 py-2.5 text-[--muted]">{v.email || '—'}</td>
                      <td className="px-4 py-2.5 text-[--muted]">{v.delivery_days?.join(', ') || '—'}</td>
                      <td className="px-4 py-2.5 text-[--muted]">{v.account_number || '—'}</td>
                      <td className="px-3 py-2.5 text-[--hint] text-right">›</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )

          /* ── Service ware table ── */
          ) : (
            swFiltered.length === 0 ? (
              <EmptyState label={TABS.find(t=>t.key===tab)?.singular?.toLowerCase() ?? tab} onAdd={openAdd} />
            ) : (
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-white border-b border-[--border] z-10">
                  <tr>
                    {['Name','Brand','Size', locations.length > 1 ? 'Total QOH' : 'QOH',''].map(h => (
                      <th key={h} className="px-4 py-2.5 text-left text-[10px] font-semibold text-[--hint] uppercase tracking-wide first:pl-6">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {swFiltered.map((item, idx) => (
                    <tr key={item.id} onClick={() => openEdit(item.id)}
                      className={`border-b border-[--border] cursor-pointer hover:bg-[--accent-light]/20 ${idx%2===0?'bg-white':'bg-[--surface-2]/30'}`}>
                      <td className="px-4 py-2.5 pl-6 font-medium text-[--text]">{item.name}</td>
                      <td className="px-4 py-2.5 text-[--muted]">{item.brand || '—'}</td>
                      <td className="px-4 py-2.5 text-[--muted]">{item.size || item.description || '—'}</td>
                      <td className="px-4 py-2.5 text-[--text] font-medium">{getSwQoh(item)}</td>
                      <td className="px-3 py-2.5 text-[--hint] text-right">›</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )
        )}
      </div>

      {/* ── Modal ── */}
      {showModal && (
        <LibraryModal
          tab={tab}
          editingId={editing}
          ingredients={ingredients}
          vendors={vendors}
          swItems={swItems}
          swInventory={swInventory}
          locations={locations}
          userId={userId}
          restaurantId={restaurantId}
          onClose={() => setShowModal(false)}
          onSaved={() => {
            setShowModal(false)
            if (tab === 'ingredients') loadIngredients()
            else if (tab === 'vendors') loadVendors()
            else loadSwItems(tab as ServiceWareCategory)
          }}
          onSwInventoryChange={(itemId, locId, field, value) => {
            setSwInventory(prev => ({
              ...prev,
              [itemId]: (prev[itemId] ?? []).map(r =>
                r.location_id === locId ? { ...r, [field]: value } : r
              ),
            }))
          }}
        />
      )}
    </div>
  )
}

// ── Empty state ───────────────────────────────────────────────
function EmptyState({ label, onAdd }: { label: string; onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-52 gap-3">
      <div className="text-4xl opacity-20">📦</div>
      <p className="text-sm text-[--muted]">No {label}s yet.</p>
      <button onClick={onAdd} className="px-4 py-2 bg-[--accent] text-white text-xs font-medium rounded-lg hover:bg-[--accent-dark]">
        + Add first {label}
      </button>
    </div>
  )
}

// ── Modal ─────────────────────────────────────────────────────
interface ModalProps {
  tab: LibTab
  editingId: string | null
  ingredients: LibraryIngredient[]
  vendors: Vendor[]
  swItems: ServiceWareItem[]
  swInventory: Record<string, ServiceWareInventory[]>
  locations: Location[]
  userId: string
  restaurantId?: string
  onClose: () => void
  onSaved: () => void
  onSwInventoryChange: (itemId: string, locId: string, field: string, value: string | number) => void
}

function LibraryModal({ tab, editingId, ingredients, vendors, swItems, swInventory, locations, userId, restaurantId, onClose, onSaved, onSwInventoryChange }: ModalProps) {
  const supabase = createClient()
  const isSwTab = SW_CATEGORIES.includes(tab as LibTab)
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  // Ingredient form state
  const existing = editingId ? ingredients.find(i => i.id === editingId) : null
  const existingVen = editingId ? vendors.find(v => v.id === editingId) : null
  const existingSw = editingId ? swItems.find(i => i.id === editingId) : null

  const [name,         setName]         = useState(existing?.name ?? existingVen?.name ?? existingSw?.name ?? '')
  const [category,     setCategory]     = useState(existing?.category ?? 'pantry')
  const [vendorId,     setVendorId]     = useState(existing?.vendor_id ?? '')
  const [purchUnit,    setPurchUnit]    = useState(existing?.purchase_unit ?? '')
  const [purchCost,    setPurchCost]    = useState(String(existing?.purchase_unit_cost ?? ''))
  const [purchSize,    setPurchSize]    = useState(String(existing?.purchase_unit_size ?? ''))
  const [recipeUnit,   setRecipeUnit]   = useState(existing?.recipe_unit ?? '')
  const [conversion,   setConversion]   = useState(String(existing?.unit_conversion ?? 1))
  const [trimFactor,   setTrimFactor]   = useState(String(existing?.trim_factor ?? 1))
  const [ingNotes,     setIngNotes]     = useState(existing?.notes ?? '')
  // Vendor form
  const [venContact,   setVenContact]   = useState(existingVen?.contact_name ?? '')
  const [venPhone,     setVenPhone]     = useState(existingVen?.phone ?? '')
  const [venEmail,     setVenEmail]     = useState(existingVen?.email ?? '')
  const [venAddress,   setVenAddress]   = useState(existingVen?.address ?? '')
  const [venAcct,      setVenAcct]      = useState(existingVen?.account_number ?? '')
  const [venNotes,     setVenNotes]     = useState(existingVen?.notes ?? '')
  // Service ware form
  const [swBrand,      setSwBrand]      = useState(existingSw?.brand ?? '')
  const [swSize,       setSwSize]       = useState(existingSw?.size ?? '')
  const [swDesc,       setSwDesc]       = useState(existingSw?.description ?? '')

  async function handleSave() {
    if (!name.trim()) return
    setSaving(true); setError('')
    try {
      if (tab === 'ingredients') {
        const payload = {
          user_id: userId, name: name.trim(), category,
          vendor_id: vendorId || null,
          purchase_unit: purchUnit, purchase_unit_cost: purchCost ? parseFloat(purchCost) : null,
          purchase_unit_size: purchSize ? parseFloat(purchSize) : null,
          recipe_unit: recipeUnit, unit_conversion: parseFloat(conversion) || 1,
          trim_factor: parseFloat(trimFactor) || 1, notes: ingNotes, is_active: true,
        }
        if (editingId) await supabase.from('ingredient_library').update(payload).eq('id', editingId)
        else await supabase.from('ingredient_library').insert(payload)

      } else if (tab === 'vendors') {
        const payload = {
          user_id: userId, name: name.trim(), contact_name: venContact,
          phone: venPhone, email: venEmail, address: venAddress,
          account_number: venAcct, notes: venNotes, is_active: true,
        }
        if (editingId) await supabase.from('vendors').update(payload).eq('id', editingId)
        else await supabase.from('vendors').insert(payload)

      } else {
        // Service ware
        const payload = {
          restaurant_id: restaurantId, category: tab as ServiceWareCategory,
          name: name.trim(), brand: swBrand, description: swDesc,
          // size stored in description prefix for now until schema update
          size: swSize,
          is_active: true,
        }
        let itemId = editingId
        if (editingId) {
          await supabase.from('service_ware_items').update(payload).eq('id', editingId)
        } else {
          const { data } = await supabase.from('service_ware_items').insert(payload).select().single()
          itemId = data?.id
        }
        // Save inventory rows
        if (itemId) {
          const rows = swInventory[editingId ?? ''] ?? []
          for (const row of rows) {
            if (row.id.startsWith('new-')) {
              if (row.quantity_on_hand > 0 || row.notes) {
                await supabase.from('service_ware_inventory').insert({
                  service_ware_item_id: itemId, location_id: row.location_id,
                  quantity_on_hand: row.quantity_on_hand, notes: row.notes, updated_by: userId,
                })
              }
            } else {
              await supabase.from('service_ware_inventory').update({
                quantity_on_hand: row.quantity_on_hand, notes: row.notes, updated_by: userId,
              }).eq('id', row.id)
            }
          }
        }
      }
      onSaved()
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!editingId || !confirm('Remove this item?')) return
    if (tab === 'ingredients') await supabase.from('ingredient_library').update({ is_active: false }).eq('id', editingId)
    else if (tab === 'vendors') await supabase.from('vendors').update({ is_active: false }).eq('id', editingId)
    else await supabase.from('service_ware_items').update({ is_active: false }).eq('id', editingId)
    onSaved()
  }

  const singular = TABS.find(t=>t.key===tab)?.singular ?? ''
  const title = editingId ? `Edit ${singular}` : `Add ${singular}`

  const itemInventory = swInventory[editingId ?? ''] ?? locations.map(loc => ({
    id: `new-${loc.id}`, service_ware_item_id: '', location_id: loc.id, quantity_on_hand: 0, notes: '',
  } as ServiceWareInventory))

  return (
    <div className="fixed inset-0 bg-black/35 flex items-center justify-center z-50 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[--border] flex-shrink-0">
          <h2 className="font-serif text-lg font-medium text-[--text]">{title}</h2>
          <div className="flex items-center gap-2">
            {editingId && (
              <button onClick={handleDelete} className="text-xs text-red-400 hover:text-red-600 px-2 py-1">Remove</button>
            )}
            <button onClick={onClose} className="text-[--hint] hover:text-[--text] text-lg leading-none">✕</button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          <Row label="Name *">
            <input value={name} onChange={e => setName(e.target.value)} autoFocus className="input text-sm" placeholder="Name" />
          </Row>

          {tab === 'ingredients' && (<>
            <Row label="Category">
              <select value={category} onChange={e => setCategory(e.target.value)} className="input bg-white capitalize">
                {ING_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Row>
            <Row label="Vendor">
              <select value={vendorId} onChange={e => setVendorId(e.target.value)} className="input bg-white">
                <option value="">— No vendor —</option>
                {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </Row>
            <div className="grid grid-cols-2 gap-3">
              <Row label="Purchase unit"><input value={purchUnit} onChange={e => setPurchUnit(e.target.value)} className="input" placeholder="e.g. case, kg, each" /></Row>
              <Row label="Unit cost ($)"><input type="number" value={purchCost} onChange={e => setPurchCost(e.target.value)} className="input" placeholder="0.00" /></Row>
              <Row label="Purchase size"><input type="number" value={purchSize} onChange={e => setPurchSize(e.target.value)} className="input" placeholder="e.g. 12 (units per case)" /></Row>
              <Row label="Recipe unit"><input value={recipeUnit} onChange={e => setRecipeUnit(e.target.value)} className="input" placeholder="e.g. cup, g, oz" /></Row>
              <Row label="Unit conversion"><input type="number" value={conversion} onChange={e => setConversion(e.target.value)} className="input" /></Row>
              <Row label="Trim factor (0–1)"><input type="number" value={trimFactor} onChange={e => setTrimFactor(e.target.value)} step="0.01" min="0" max="1" className="input" /></Row>
            </div>
            <Row label="Notes"><input value={ingNotes} onChange={e => setIngNotes(e.target.value)} className="input" placeholder="Sourcing notes, allergen notes…" /></Row>
          </>)}

          {tab === 'vendors' && (<>
            <div className="grid grid-cols-2 gap-3">
              <Row label="Contact name"><input value={venContact} onChange={e => setVenContact(e.target.value)} className="input" /></Row>
              <Row label="Phone"><input value={venPhone} onChange={e => setVenPhone(e.target.value)} className="input" /></Row>
              <Row label="Email"><input type="email" value={venEmail} onChange={e => setVenEmail(e.target.value)} className="input" /></Row>
              <Row label="Account #"><input value={venAcct} onChange={e => setVenAcct(e.target.value)} className="input" /></Row>
            </div>
            <Row label="Address"><input value={venAddress} onChange={e => setVenAddress(e.target.value)} className="input" /></Row>
            <Row label="Notes"><input value={venNotes} onChange={e => setVenNotes(e.target.value)} className="input" /></Row>
          </>)}

          {isSwTab && (<>
            <div className="grid grid-cols-2 gap-3">
              <Row label="Name"><span className="text-[10px] text-[--hint]">Already filled above</span></Row>
              <Row label="Brand"><input value={swBrand} onChange={e => setSwBrand(e.target.value)} className="input" placeholder="Manufacturer or brand" /></Row>
              <Row label="Size / Dimensions"><input value={swSize} onChange={e => setSwSize(e.target.value)} className="input" placeholder="e.g. 10oz, 12-inch, 7mm" /></Row>
              <Row label="Description / Notes"><input value={swDesc} onChange={e => setSwDesc(e.target.value)} className="input" placeholder="Material, specs, usage notes…" /></Row>
            </div>
            {/* QOH table */}
            <div>
              <div className="text-[11px] font-semibold text-[--muted] mb-2 uppercase tracking-wide">Quantity on Hand by Location</div>
              <div className="border border-[--border] rounded-xl overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-[--surface-2] border-b border-[--border]">
                      <th className="px-3 py-2 text-left text-[10px] font-semibold text-[--hint] uppercase tracking-wide">Location</th>
                      <th className="px-3 py-2 text-center text-[10px] font-semibold text-[--hint] uppercase tracking-wide w-20">QOH</th>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold text-[--hint] uppercase tracking-wide">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {locations.map((loc, i) => {
                      const row = itemInventory.find(r => r.location_id === loc.id) ?? { location_id: loc.id, quantity_on_hand: 0, notes: '' }
                      const itemId = editingId ?? 'new'
                      return (
                        <tr key={loc.id} className={`border-b border-[--border] last:border-0 ${i%2===0?'bg-white':'bg-[--surface-2]/30'}`}>
                          <td className="px-3 py-2 font-medium text-[--text]">{loc.name}{loc.city ? ` · ${loc.city}` : ''}</td>
                          <td className="px-3 py-2 text-center">
                            <input type="number" min="0" defaultValue={row.quantity_on_hand ?? 0}
                              onChange={e => onSwInventoryChange(itemId, loc.id, 'quantity_on_hand', parseInt(e.target.value)||0)}
                              className="w-14 text-center px-1.5 py-1 border border-[--border-2] rounded-lg outline-none focus:border-[--accent] text-xs font-medium" />
                          </td>
                          <td className="px-3 py-2">
                            <input defaultValue={row.notes ?? ''}
                              onChange={e => onSwInventoryChange(itemId, loc.id, 'notes', e.target.value)}
                              placeholder="Notes…"
                              className="w-full bg-transparent outline-none text-xs text-[--muted] focus:bg-white focus:border focus:border-[--accent] rounded px-1 py-0.5" />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>)}

          {error && <div className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</div>}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[--border] flex justify-end gap-2 flex-shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-xs border border-[--border-2] rounded-lg text-[--muted] hover:bg-[--surface-2]">Cancel</button>
          <button onClick={handleSave} disabled={!name.trim() || saving}
            className="px-4 py-2 text-xs font-medium bg-[--accent] text-white rounded-lg hover:bg-[--accent-dark] disabled:opacity-40">
            {saving ? 'Saving…' : editingId ? 'Save changes' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-medium text-[--muted] mb-1">{label}</label>
      {children}
    </div>
  )
}
