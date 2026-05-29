'use client'
import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import type { ServiceWareItem, ServiceWareInventory, ServiceWareCategory, Location } from '@/lib/types'

interface Props {
  userId: string
  restaurantId?: string
  locations: Location[]
}

const CATEGORIES: { key: ServiceWareCategory; label: string; icon: string; examples: string }[] = [
  { key: 'Plateware',         label: 'Plateware',         icon: '🍽',  examples: 'Pasta bowl, Dinner plate, Oval platter, Wooden board…' },
  { key: 'Glassware',         label: 'Glassware',         icon: '🥂',  examples: 'Rocks glass, Coupe, Highball, Wine glass, Champagne flute…' },
  { key: 'Flatware',          label: 'Flatware',          icon: '🍴',  examples: 'Dinner fork, Pasta fork, Steak knife, Dessert spoon…' },
  { key: 'Barware',           label: 'Barware',           icon: '🍸',  examples: 'Shaker, Strainer, Jigger, Speed rail, Ice bucket…' },
  { key: 'Cookware',          label: 'Cookware',          icon: '🍳',  examples: 'Sauté pan, Stock pot, Braiser, Sauce pan, Specialty…' },
  { key: 'Bakeware',          label: 'Bakeware',          icon: '🥘',  examples: 'Sheet pan, Hotel pan, Baking pan, Cambro, Roasting pan…' },
  { key: 'Kitchen Utensils',  label: 'Kitchen Utensils',  icon: '🔪',  examples: 'Knives, HACCP boards, Ladle, Tongs, Measuring cups…' },
  { key: 'Cooking Equipment', label: 'Cooking Equipment', icon: '⚙️',  examples: 'Range, Oven, Combi, Fryer, Blast chiller, Coffee machine…' },
]

export default function ServiceWareLibrary({ userId, restaurantId, locations }: Props) {
  const supabase = createClient()
  const [category,  setCategory]  = useState<ServiceWareCategory>('plateware')
  const [items,     setItems]     = useState<ServiceWareItem[]>([])
  const [inventory, setInventory] = useState<Record<string, ServiceWareInventory[]>>({})
  const [selectedId,setSelectedId]= useState<string | null>(null)
  const [loading,   setLoading]   = useState(true)
  const [saving,    setSaving]    = useState(false)

  // New item form
  const [newName,   setNewName]   = useState('')
  const [newBrand,  setNewBrand]  = useState('')
  const [showAdd,   setShowAdd]   = useState(false)

  const selectedItem = items.find(i => i.id === selectedId) ?? null

  const loadItems = useCallback(async () => {
    setLoading(true)
    let q = supabase.from('service_ware_items').select('*')
      .eq('category', category).eq('is_active', true).order('name')
    if (restaurantId) q = q.eq('restaurant_id', restaurantId)
    const { data } = await q
    setItems(data ?? [])
    setSelectedId(prev => data?.find(i => i.id === prev) ? prev : (data?.[0]?.id ?? null))
    setLoading(false)
  }, [category, restaurantId, supabase])

  const loadInventory = useCallback(async (itemId: string) => {
    if (inventory[itemId]) return
    const { data } = await supabase
      .from('service_ware_inventory')
      .select('*')
      .eq('service_ware_item_id', itemId)
    const rows = data ?? []
    // Fill in missing locations with zero rows
    const filled = locations.map(loc => {
      const existing = rows.find(r => r.location_id === loc.id)
      return existing ?? {
        id: `new-${loc.id}`,
        service_ware_item_id: itemId,
        location_id: loc.id,
        quantity_on_hand: 0,
        notes: '',
      } as ServiceWareInventory
    })
    setInventory(prev => ({ ...prev, [itemId]: filled }))
  }, [inventory, locations, supabase])

  useEffect(() => { loadItems() }, [loadItems])

  useEffect(() => {
    if (selectedId) loadInventory(selectedId)
  }, [selectedId, loadInventory])

  async function handleAddItem() {
    if (!newName.trim() || !restaurantId) return
    setSaving(true)
    const { data } = await supabase.from('service_ware_items').insert({
      restaurant_id: restaurantId,
      category,
      name: newName.trim(),
      brand: newBrand.trim(),
      description: '',
      is_active: true,
    }).select().single()
    if (data) {
      setItems(prev => [...prev, data].sort((a,b) => a.name.localeCompare(b.name)))
      setSelectedId(data.id)
      setNewName(''); setNewBrand(''); setShowAdd(false)
    }
    setSaving(false)
  }

  async function updateItem(id: string, updates: Partial<ServiceWareItem>) {
    await supabase.from('service_ware_items').update(updates).eq('id', id)
    setItems(prev => prev.map(i => i.id === id ? { ...i, ...updates } : i))
  }

  async function deleteItem(id: string) {
    if (!confirm('Remove this item?')) return
    await supabase.from('service_ware_items').update({ is_active: false }).eq('id', id)
    setItems(prev => prev.filter(i => i.id !== id))
    setSelectedId(prev => prev === id ? (items[0]?.id ?? null) : prev)
  }

  async function updateInventory(itemId: string, locationId: string, field: 'quantity_on_hand' | 'notes', value: string | number) {
    const rows = inventory[itemId] ?? []
    const existing = rows.find(r => r.location_id === locationId)
    const isNew = !existing || existing.id.startsWith('new-')

    if (isNew) {
      const { data } = await supabase.from('service_ware_inventory').insert({
        service_ware_item_id: itemId,
        location_id: locationId,
        quantity_on_hand: field === 'quantity_on_hand' ? Number(value) : 0,
        notes: field === 'notes' ? String(value) : '',
        updated_by: userId,
      }).select().single()
      if (data) {
        setInventory(prev => ({
          ...prev,
          [itemId]: (prev[itemId] ?? []).map(r =>
            r.location_id === locationId ? data : r
          ),
        }))
      }
    } else {
      await supabase.from('service_ware_inventory')
        .update({ [field]: value, updated_by: userId, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
      setInventory(prev => ({
        ...prev,
        [itemId]: (prev[itemId] ?? []).map(r =>
          r.location_id === locationId ? { ...r, [field]: value } : r
        ),
      }))
    }
  }

  const catMeta = CATEGORIES.find(c => c.key === category)!
  const itemInventory = selectedId ? (inventory[selectedId] ?? []) : []

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Left: item list ── */}
      <div className="w-64 flex-shrink-0 border-r border-[--border] flex flex-col bg-white">

        {/* Category tabs */}
        <div className="flex border-b border-[--border] flex-shrink-0">
          {CATEGORIES.map(c => (
            <button key={c.key} onClick={() => setCategory(c.key)}
              className={`flex-1 py-2.5 text-xs font-medium transition-colors ${category === c.key ? 'text-[--accent] border-b-2 border-[--accent]' : 'text-[--muted] hover:text-[--text]'}`}>
              {c.icon}
            </button>
          ))}
        </div>

        <div className="px-3 py-2 border-b border-[--border] flex-shrink-0">
          <div className="text-xs font-medium text-[--text]">{catMeta.label}</div>
          <div className="text-[10px] text-[--hint] mt-0.5">{items.length} items</div>
        </div>

        {/* Item list */}
        <div className="flex-1 overflow-y-auto py-1">
          {loading ? (
            <div className="px-3 py-4 text-xs text-[--muted]">Loading…</div>
          ) : items.length === 0 ? (
            <div className="px-3 py-4 text-xs text-[--muted]">No {catMeta.label.toLowerCase()} yet.</div>
          ) : (
            items.map(item => (
              <button key={item.id} onClick={() => setSelectedId(item.id)}
                className={`w-full text-left px-3 py-2.5 transition-colors border-b border-[--border] last:border-0 ${selectedId === item.id ? 'bg-[--accent-light]' : 'hover:bg-[--surface-2]'}`}>
                <div className="text-xs font-medium text-[--text] truncate">{item.name}</div>
                {item.brand && <div className="text-[10px] text-[--muted]">{item.brand}</div>}
              </button>
            ))
          )}
        </div>

        {/* Add item */}
        <div className="border-t border-[--border] p-3 flex-shrink-0">
          {showAdd ? (
            <div className="space-y-1.5">
              <input value={newName} onChange={e => setNewName(e.target.value)}
                placeholder="Item name *" autoFocus
                onKeyDown={e => e.key === 'Enter' && handleAddItem()}
                className="w-full px-2 py-1.5 text-xs border border-[--border-2] rounded-lg outline-none focus:border-[--accent]" />
              <input value={newBrand} onChange={e => setNewBrand(e.target.value)}
                placeholder="Brand (optional)"
                onKeyDown={e => e.key === 'Enter' && handleAddItem()}
                className="w-full px-2 py-1.5 text-xs border border-[--border-2] rounded-lg outline-none focus:border-[--accent]" />
              <div className="flex gap-1.5">
                <button onClick={handleAddItem} disabled={!newName.trim() || saving}
                  className="flex-1 py-1.5 text-[11px] font-medium bg-[--accent] text-white rounded-lg disabled:opacity-40">
                  {saving ? '…' : 'Add'}
                </button>
                <button onClick={() => { setShowAdd(false); setNewName(''); setNewBrand('') }}
                  className="px-2 py-1.5 text-[11px] border border-[--border-2] rounded-lg text-[--muted]">
                  ✕
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setShowAdd(true)}
              className="w-full py-1.5 text-xs text-[--accent] border border-dashed border-[--border-2] rounded-lg hover:border-[--accent] transition-colors">
              + Add {catMeta.label.slice(0,-1).toLowerCase()}
            </button>
          )}
        </div>
      </div>

      {/* ── Right: item detail ── */}
      <div className="flex-1 overflow-y-auto">
        {!selectedItem ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-8">
            <div className="text-5xl mb-4 opacity-20">{catMeta.icon}</div>
            <p className="text-sm text-[--muted] mb-1">{catMeta.label}</p>
            <p className="text-xs text-[--hint]">{catMeta.examples}</p>
          </div>
        ) : (
          <div className="px-6 py-5 max-w-2xl">

            {/* Item fields */}
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1 min-w-0">
                <input
                  key={selectedItem.id + '-name'}
                  defaultValue={selectedItem.name}
                  onBlur={e => updateItem(selectedItem.id, { name: e.target.value })}
                  className="text-xl font-serif font-medium text-[--text] bg-transparent border-b border-transparent hover:border-[--border-2] focus:border-[--accent] outline-none w-full pb-0.5"
                />
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-[10px] bg-[--surface-2] text-[--muted] px-1.5 py-0.5 rounded capitalize">{catMeta.icon} {selectedItem.category}</span>
                  <input
                    key={selectedItem.id + '-brand'}
                    defaultValue={selectedItem.brand}
                    onBlur={e => updateItem(selectedItem.id, { brand: e.target.value })}
                    placeholder="Brand / manufacturer"
                    className="text-xs text-[--muted] bg-transparent border-b border-transparent hover:border-[--border-2] focus:border-[--accent] outline-none"
                  />
                </div>
              </div>
              <button onClick={() => deleteItem(selectedItem.id)}
                className="text-[--hint] hover:text-red-400 text-xs ml-3 transition-colors flex-shrink-0">
                Remove
              </button>
            </div>

            <div className="mb-6">
              <label className="block text-[10px] font-semibold uppercase tracking-wide text-[--hint] mb-1">Description</label>
              <textarea
                key={selectedItem.id + '-desc'}
                defaultValue={selectedItem.description}
                onBlur={e => updateItem(selectedItem.id, { description: e.target.value })}
                placeholder="Size, material, specs…"
                rows={2}
                className="w-full px-3 py-2 text-xs border border-[--border-2] rounded-xl outline-none focus:border-[--accent] resize-none placeholder:text-[--hint]"
              />
            </div>

            {/* ── Inventory by location ── */}
            <div>
              <h3 className="text-[10px] font-semibold uppercase tracking-wide text-[--hint] mb-2">
                Inventory by Location
              </h3>
              <div className="border border-[--border] rounded-xl overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-[--surface-2] border-b border-[--border]">
                      <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-[--hint] uppercase tracking-wide">Location</th>
                      <th className="px-4 py-2.5 text-center text-[10px] font-semibold text-[--hint] uppercase tracking-wide w-24">QOH</th>
                      <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-[--hint] uppercase tracking-wide">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {locations.map((loc, i) => {
                      const row = itemInventory.find(r => r.location_id === loc.id)
                      return (
                        <tr key={loc.id} className={`border-b border-[--border] last:border-0 ${i % 2 === 0 ? 'bg-white' : 'bg-[--surface-2]/30'}`}>
                          <td className="px-4 py-2.5">
                            <div className="font-medium text-[--text]">{loc.name}</div>
                            {loc.city && <div className="text-[10px] text-[--muted]">{loc.city}{loc.state ? `, ${loc.state}` : ''}</div>}
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            <input
                              type="number" min="0"
                              defaultValue={row?.quantity_on_hand ?? 0}
                              onBlur={e => updateInventory(selectedItem.id, loc.id, 'quantity_on_hand', parseInt(e.target.value) || 0)}
                              className="w-16 text-center px-2 py-1 border border-[--border-2] rounded-lg outline-none focus:border-[--accent] text-xs font-medium text-[--text]"
                            />
                          </td>
                          <td className="px-4 py-2.5">
                            <input
                              defaultValue={row?.notes ?? ''}
                              onBlur={e => updateInventory(selectedItem.id, loc.id, 'notes', e.target.value)}
                              placeholder="e.g. checked weekly, needs reorder…"
                              className="w-full bg-transparent outline-none text-xs text-[--muted] focus:bg-white focus:border focus:border-[--accent] rounded px-1 py-0.5 placeholder:text-[--hint]"
                            />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {locations.length === 0 && (
                  <div className="text-center py-4 text-xs text-[--hint]">No locations configured yet.</div>
                )}
              </div>
              <p className="text-[10px] text-[--hint] mt-1.5">QOH updates on blur · last updated shown on hover</p>
            </div>

          </div>
        )}
      </div>
    </div>
  )
}
