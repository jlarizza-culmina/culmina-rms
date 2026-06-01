'use client'
import { useState, useEffect, useMemo, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import type { Recipe, LibraryIngredient } from '@/lib/types'

// ── Types ─────────────────────────────────────────────────────
type MenuType = 'morning' | 'aperitivo' | 'dinner' | 'drinks' | 'specials'
type MenuView = 'editor' | 'snapshots'

interface Menu { id: string; name: string; menu_type: MenuType; sort_order: number; status: string }
interface MenuVersion { id: string; menu_id: string; version_number: number; is_current: boolean; is_published: boolean; notes: string; published_at: string | null }
interface MenuVersionItem {
  id: string; menu_version_id: string; recipe_id: string; section: string
  sort_order: number; display_name: string | null; description: string | null
  price: number; show_price: boolean; is_available: boolean; is_printed: boolean
}
interface DailySnapshot {
  id: string; snapshot_date: string; items_json: SnapshotItem[]
  is_auto: boolean; published_at: string | null
}
interface SnapshotItem {
  menu_type: MenuType; section: string; sort_order: number
  recipe_id: string; display_name: string; description: string
  price: number; show_price: boolean; is_available: boolean; is_removed: boolean; is_printed: boolean
}

const MENU_TYPES: MenuType[] = ['morning', 'aperitivo', 'dinner', 'drinks', 'specials']
const TYPE_ICONS: Record<MenuType, string> = {
  morning: '☕', aperitivo: '🍸', dinner: '🍽', drinks: '🥂', specials: '⭐'
}
const TYPE_LABELS: Record<MenuType, string> = {
  morning: 'Morning', aperitivo: 'Aperitivo', dinner: 'Dinner', drinks: 'Drinks', specials: 'Specials'
}

interface Props {
  userId: string
  restaurantId?: string
  locationId?: string
}

export default function MenuModule({ userId, restaurantId, locationId }: Props) {
  const supabase = createClient()
  const [recipes,  setRecipes]  = useState<Recipe[]>([])
  const [library,  setLibrary]  = useState<LibraryIngredient[]>([])

  useEffect(() => {
    if (!restaurantId) return
    // Load recipes and library in parallel
    Promise.all([
      supabase.from('recipes').select('id,name,description,recipe_type,menu_sections,menu_description,tags,base_servings')
        .eq('restaurant_id', restaurantId).eq('menu_status', 'on_menu').order('name'),
      supabase.from('ingredient_library').select('id,name,category')
        .or(`user_id.eq.${userId},user_id.is.null`).eq('is_active', true).order('name'),
    ]).then(([{ data: rData }, { data: lData }]) => {
      setRecipes((rData ?? []) as Recipe[])
      setLibrary((lData ?? []) as LibraryIngredient[])
    })
  }, [restaurantId, userId])

  const [view,        setView]       = useState<MenuView>('editor')
  const [activeType,  setActiveType] = useState<MenuType>('morning')
  const [menus,       setMenus]      = useState<Menu[]>([])
  const [versions,    setVersions]   = useState<MenuVersion[]>([])
  const [items,       setItems]      = useState<MenuVersionItem[]>([])
  const [snapshots,   setSnapshots]  = useState<DailySnapshot[]>([])
  const [loading,     setLoading]    = useState(true)
  const [publishing,  setPublishing] = useState(false)
  const [publishNotes, setPublishNotes] = useState('')
  const [showPublish, setShowPublish] = useState(false)
  const [showAddItem, setShowAddItem] = useState(false)
  const [pendingNotPrinted, setPendingNotPrinted] = useState(false)
  const [selectedSnap, setSelectedSnap] = useState<DailySnapshot | null>(null)

  // Load menus + current versions + items
  const load = useCallback(async () => {
    if (!restaurantId) return
    setLoading(true)
    const [{ data: mData }, { data: vData }, { data: sData }] = await Promise.all([
      supabase.from('menus').select('*').eq('restaurant_id', restaurantId).eq('status', 'active').order('sort_order'),
      supabase.from('menu_versions').select('*').eq('is_current', true),
      supabase.from('daily_menu_snapshots').select('*')
        .eq('location_id', locationId ?? '').order('snapshot_date', { ascending: false }).limit(30),
    ])
    const menuList = mData ?? []
    setMenus(menuList)
    setVersions(vData ?? [])
    setSnapshots((sData ?? []).map(s => ({ ...s, items_json: s.items_json ?? [] })))

    // Load items for all current versions
    const vIds = (vData ?? []).map(v => v.id)
    if (vIds.length > 0) {
      const { data: iData } = await supabase.from('menu_version_items').select('*')
        .in('menu_version_id', vIds).order('section').order('sort_order')
      setItems(iData ?? [])
    }
    setLoading(false)
  }, [restaurantId, locationId])

  useEffect(() => { load() }, [load])

  // Current menu + version for active type
  const activeMenu = menus.find(m => m.menu_type === activeType)
  const activeVersion = versions.find(v => v.menu_id === activeMenu?.id)
  const activeItems = items.filter(i => i.menu_version_id === activeVersion?.id)

  // Group items by section
  const sections = useMemo(() => {
    const map: Record<string, MenuVersionItem[]> = {}
    for (const item of activeItems) {
      if (!item.is_printed) continue  // shown in separate not-printed panel
      const sec = item.section || 'General'
      if (!map[sec]) map[sec] = []
      map[sec].push(item)
    }
    return map
  }, [activeItems])

  const notPrintedItems = useMemo(() =>
    activeItems.filter(i => !i.is_printed)
  , [activeItems])

  // Stats for publish dialog
  const totalItems = items.length
  const unpricedCount = items.filter(i => !i.price || i.price === 0).length

  // Publish all menus
  async function handlePublish() {
    if (!restaurantId || !locationId) return
    setPublishing(true)
    try {
      const { error } = await supabase.rpc('publish_daily_menu', {
        p_restaurant_id: restaurantId,
        p_location_id: locationId,
        p_user_id: userId,
        p_notes: publishNotes,
      })
      if (error) throw error
      await load()
      setShowPublish(false)
      setPublishNotes('')
    } catch (e) {
      alert(`Publish failed: ${e}`)
    } finally {
      setPublishing(false)
    }
  }

  // Add item to current version
  async function addItem(recipeId: string, section: string, price: number) {
    if (!activeVersion) return
    const recipe = recipes.find(r => r.id === recipeId)
    if (!recipe) return
    const isPrinted = !pendingNotPrinted
    const maxSort = Math.max(0, ...activeItems.filter(i => i.section === section && i.is_printed === isPrinted).map(i => i.sort_order))
    const { data } = await supabase.from('menu_version_items').insert({
      menu_version_id: activeVersion.id,
      recipe_id: recipeId,
      section: isPrinted ? (section || 'General') : 'NOT PRINTED',
      sort_order: maxSort + 1,
      display_name: null,
      description: null,
      price,
      show_price: false,
      is_available: true,
      is_printed: isPrinted,
    }).select().single()
    if (data) setItems(prev => [...prev, data])
    setShowAddItem(false)
    setPendingNotPrinted(false)
  }

  // Update item field inline
  async function updateItem(id: string, patch: Partial<MenuVersionItem>) {
    await supabase.from('menu_version_items').update(patch).eq('id', id)
    setItems(prev => prev.map(i => i.id === id ? { ...i, ...patch } : i))
  }

  // Remove item
  async function removeItem(id: string) {
    await supabase.from('menu_version_items').delete().eq('id', id)
    setItems(prev => prev.filter(i => i.id !== id))
  }

  // Move item up/down within section
  async function moveItem(id: string, dir: 'up' | 'down') {
    const item = activeItems.find(i => i.id === id)
    if (!item) return
    const sectionItems = activeItems.filter(i => i.section === item.section).sort((a, b) => a.sort_order - b.sort_order)
    const idx = sectionItems.findIndex(i => i.id === id)
    if (dir === 'up' && idx === 0) return
    if (dir === 'down' && idx === sectionItems.length - 1) return
    const swapIdx = dir === 'up' ? idx - 1 : idx + 1
    const swap = sectionItems[swapIdx]
    await Promise.all([
      supabase.from('menu_version_items').update({ sort_order: swap.sort_order }).eq('id', id),
      supabase.from('menu_version_items').update({ sort_order: item.sort_order }).eq('id', swap.id),
    ])
    setItems(prev => prev.map(i => {
      if (i.id === id)   return { ...i, sort_order: swap.sort_order }
      if (i.id === swap.id) return { ...i, sort_order: item.sort_order }
      return i
    }))
  }

  // CSV export
  function exportCSV(withPrices: boolean, snap?: SnapshotItem[]) {
    const rows = snap
      ? snap.filter(i => !i.is_removed && i.is_printed !== false)
      : items.map(i => {
          const r = recipes.find(x => x.id === i.recipe_id)
          return {
            menu_type: menus.find(m => m.id === activeVersion?.menu_id)?.menu_type ?? '',
            section: i.section, sort_order: i.sort_order,
            display_name: i.display_name || r?.name || '',
            description: i.description || r?.menu_description || r?.description || '',
            price: i.price, show_price: i.show_price,
          }
        })
    const header = withPrices
      ? 'menu_type,section,sort_order,display_name,description,price'
      : 'menu_type,section,sort_order,display_name,description'
    const lines = rows.map(r => {
      const name = `"${String(r.display_name).replace(/"/g, '""')}"`
      const desc = `"${String(r.description || '').replace(/"/g, '""')}"`
      const base = `${r.menu_type},${r.section},${r.sort_order},${name},${desc}`
      return withPrices ? `${base},${r.price ?? ''}` : base
    })
    const csv = [header, ...lines].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `corretto-menu-${new Date().toISOString().split('T')[0]}${withPrices ? '' : '-no-prices'}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) return <div className="flex items-center justify-center h-full text-[--hint] text-sm">Loading menus…</div>

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Header ── */}
      <div className="bg-white border-b border-[--border] px-6 py-4 flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="font-serif text-xl font-medium text-[--text]">Menu</h1>
            {activeVersion && (
              <div className="text-[11px] text-[--hint] mt-0.5">
                v{activeVersion.version_number}
                {activeVersion.published_at && ` · Published ${new Date(activeVersion.published_at).toLocaleDateString()}`}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* View toggle */}
            <div className="flex bg-[--surface-2] rounded-lg p-0.5 gap-0.5">
              {(['editor','snapshots'] as MenuView[]).map(v => (
                <button key={v} onClick={() => setView(v)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all capitalize ${view === v ? 'bg-white text-[--text] shadow-sm' : 'text-[--muted]'}`}>
                  {v === 'editor' ? '✏️ Editor' : '📅 History'}
                </button>
              ))}
            </div>
            {/* Export */}
            {view === 'editor' && (
              <div className="flex gap-1">
                <button onClick={() => exportCSV(false)}
                  className="px-3 py-1.5 text-xs border border-[--border-2] text-[--muted] rounded-lg hover:bg-[--surface-2]">
                  CSV (no prices)
                </button>
                <button onClick={() => exportCSV(true)}
                  className="px-3 py-1.5 text-xs border border-[--border-2] text-[--muted] rounded-lg hover:bg-[--surface-2]">
                  CSV (with prices)
                </button>
              </div>
            )}
            {/* Publish */}
            {view === 'editor' && (
              <button onClick={() => setShowPublish(true)}
                className="px-4 py-2 bg-[--accent] text-white text-xs font-medium rounded-lg hover:bg-[--accent-dark] transition-colors flex items-center gap-1.5">
                🚀 Publish All
              </button>
            )}
          </div>
        </div>

        {/* Menu type tabs */}
        {view === 'editor' && (
          <div className="flex gap-1">
            {MENU_TYPES.map(t => {
              const menu = menus.find(m => m.menu_type === t)
              const ver = versions.find(v => v.menu_id === menu?.id)
              const count = items.filter(i => i.menu_version_id === ver?.id).length
              return (
                <button key={t} onClick={() => setActiveType(t)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-all border ${
                    activeType === t
                      ? 'bg-[--accent-light] text-[--accent] border-[--accent]/30'
                      : 'text-[--muted] border-transparent hover:bg-[--surface-2]'
                  }`}>
                  <span>{TYPE_ICONS[t]}</span>
                  <span>{TYPE_LABELS[t]}</span>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${activeType === t ? 'bg-[--accent]/10 text-[--accent]' : 'bg-[--surface-2] text-[--hint]'}`}>
                    {count}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* ── EDITOR VIEW ── */}
      {view === 'editor' && (
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {!activeMenu ? (
            <div className="text-center py-16 text-[--hint] text-sm">Menu template not found. Run schema_menus.sql first.</div>
          ) : (
            <>
              {/* Section groups */}
              {Object.keys(sections).length === 0 ? (
                <div className="text-center py-12 text-[--muted]">
                  <div className="text-4xl opacity-20 mb-3">{TYPE_ICONS[activeType]}</div>
                  <p className="text-sm mb-4">No items on the {TYPE_LABELS[activeType]} menu yet.</p>
                  <button onClick={() => setShowAddItem(true)}
                    className="px-4 py-2 bg-[--accent] text-white text-xs rounded-lg hover:bg-[--accent-dark]">
                    + Add first item
                  </button>
                </div>
              ) : (
                Object.entries(sections).map(([section, sItems]) => (
                  <div key={section} className="mb-6">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="text-[10px] font-bold uppercase tracking-widest text-[--hint]">{section}</h3>
                      <div className="flex-1 h-px bg-[--border]" />
                    </div>
                    <div className="bg-white rounded-xl border border-[--border] overflow-hidden">
                      {[...sItems].sort((a,b) => a.sort_order - b.sort_order).map((item, idx) => (
                        <MenuItemRow
                          key={item.id}
                          item={item}
                          recipe={recipes.find(r => r.id === item.recipe_id)}
                          isFirst={idx === 0}
                          isLast={idx === sItems.length - 1}
                          onUpdate={patch => updateItem(item.id, patch)}
                          onRemove={() => removeItem(item.id)}
                          onMove={dir => moveItem(item.id, dir)}
                        />
                      ))}
                    </div>
                  </div>
                ))
              )}

              {/* Add item button */}
              <button onClick={() => setShowAddItem(true)}
                className="w-full py-3 border-2 border-dashed border-[--border-2] rounded-xl text-xs text-[--hint] hover:border-[--accent] hover:text-[--accent] transition-colors">
                + Add item to {TYPE_LABELS[activeType]}
              </button>

              {/* Not Printed section */}
              <div className="mt-6">
                <div className="flex items-center gap-2 mb-2">
                  <h3 className="text-[10px] font-bold uppercase tracking-widest text-[--hint]">Not Printed</h3>
                  <div className="flex-1 h-px bg-dashed border-t border-dashed border-[--border-2]" />
                  <span className="text-[9px] text-[--hint] bg-[--surface-2] px-1.5 py-0.5 rounded">
                    Priced for POS · excluded from CSV
                  </span>
                </div>
                {notPrintedItems.length === 0 ? (
                  <p className="text-[10px] text-[--hint] text-center py-3">
                    Items with prices but not on the printed menu go here.
                  </p>
                ) : (
                  <div className="bg-white rounded-xl border border-dashed border-[--border-2] overflow-hidden opacity-80">
                    {notPrintedItems.map((item, idx) => (
                      <MenuItemRow
                        key={item.id}
                        item={item}
                        recipe={recipes.find(r => r.id === item.recipe_id)}
                        isFirst={idx === 0}
                        isLast={idx === notPrintedItems.length - 1}
                        onUpdate={patch => updateItem(item.id, patch)}
                        onRemove={() => removeItem(item.id)}
                        onMove={dir => moveItem(item.id, dir)}
                      />
                    ))}
                  </div>
                )}
                <button onClick={() => { setShowAddItem(true); setPendingNotPrinted(true) }}
                  className="w-full mt-2 py-2 border border-dashed border-[--border-2] rounded-xl text-[10px] text-[--hint] hover:border-amber-300 hover:text-amber-500 transition-colors">
                  + Add unprinted item (Vodka Tonic, well spirits, etc.)
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── HISTORY / SNAPSHOTS VIEW ── */}
      {view === 'snapshots' && (
        <div className="flex-1 flex overflow-hidden">
          {/* Snapshot list */}
          <div className="w-56 border-r border-[--border] overflow-y-auto flex-shrink-0">
            {snapshots.length === 0 ? (
              <div className="p-4 text-xs text-[--hint] text-center">No snapshots yet. Publish to create one.</div>
            ) : (
              snapshots.map(snap => (
                <button key={snap.id} onClick={() => setSelectedSnap(snap)}
                  className={`w-full text-left px-4 py-3 border-b border-[--border] hover:bg-[--surface-2] transition-colors ${selectedSnap?.id === snap.id ? 'bg-[--accent-light]' : ''}`}>
                  <div className="text-xs font-medium text-[--text]">{snap.snapshot_date}</div>
                  <div className="text-[10px] text-[--hint] mt-0.5">
                    {snap.is_auto ? '↩ Carried forward' : '🚀 Published'}
                  </div>
                  {snap.published_at && (
                    <div className="text-[9px] text-[--hint]">
                      {new Date(snap.published_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  )}
                </button>
              ))
            )}
          </div>

          {/* Snapshot detail */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {!selectedSnap ? (
              <div className="text-center py-16 text-[--hint] text-sm">Select a date to view that day's menu</div>
            ) : (
              <SnapshotViewer
                snap={selectedSnap}
                onExportWithPrices={() => exportCSV(true, selectedSnap.items_json)}
                onExportNoPrice={() => exportCSV(false, selectedSnap.items_json)}
              />
            )}
          </div>
        </div>
      )}

      {/* ── PUBLISH DIALOG ── */}
      {showPublish && (
        <div className="fixed inset-0 bg-black/35 flex items-center justify-center z-50"
          onClick={e => { if (e.target === e.currentTarget) setShowPublish(false) }}>
          <div className="bg-white rounded-2xl w-[460px] max-w-[94vw] p-6 shadow-xl">
            <h2 className="font-serif text-lg font-medium text-[--text] mb-1">Publish Today's Menu</h2>
            <p className="text-xs text-[--muted] mb-4">
              Creates new versions for all 5 menu types and saves today's snapshot for {locationId ? 'this location' : 'all locations'}.
            </p>
            {/* Summary */}
            <div className="bg-[--surface-2] rounded-xl p-3 mb-4 grid grid-cols-3 gap-3">
              {[
                { label: 'Total items', value: totalItems },
                { label: 'Without price', value: unpricedCount },
                { label: 'Menu types', value: 5 },
              ].map(s => (
                <div key={s.label} className="text-center">
                  <div className={`text-lg font-medium ${s.label === 'Without price' && unpricedCount > 0 ? 'text-amber-500' : 'text-[--text]'}`}>
                    {s.value}
                  </div>
                  <div className="text-[10px] text-[--hint]">{s.label}</div>
                </div>
              ))}
            </div>
            {unpricedCount > 0 && (
              <div className="text-[11px] text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
                ⚠ {unpricedCount} item{unpricedCount !== 1 ? 's' : ''} have no price. They will be excluded from the ordering export.
              </div>
            )}
            <div className="mb-4">
              <label className="block text-[11px] font-medium text-[--muted] mb-1.5">Change notes (optional)</label>
              <input value={publishNotes} onChange={e => setPublishNotes(e.target.value)}
                placeholder="e.g. Added Hugo Spritz, updated Negroni price"
                className="w-full px-3 py-2 text-xs border border-[--border-2] rounded-lg outline-none focus:border-[--accent]" />
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowPublish(false)}
                className="px-4 py-2 text-xs border border-[--border-2] text-[--muted] rounded-lg hover:bg-[--surface-2]">
                Cancel
              </button>
              <button onClick={handlePublish} disabled={publishing}
                className="px-5 py-2 bg-[--accent] text-white text-xs font-medium rounded-lg hover:bg-[--accent-dark] disabled:opacity-50 flex items-center gap-1.5">
                {publishing ? <><span className="spinner" />Publishing…</> : '🚀 Publish'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── ADD ITEM MODAL ── */}
      {showAddItem && (
        <AddItemModal
          recipes={recipes}
          library={library}
          menuType={activeType}
          isNotPrinted={pendingNotPrinted}
          existingIds={new Set(activeItems.map(i => i.recipe_id))}
          onAdd={addItem}
          onClose={() => { setShowAddItem(false); setPendingNotPrinted(false) }}
        />
      )}
    </div>
  )
}

// ── MenuItemRow ───────────────────────────────────────────────
function MenuItemRow({ item, recipe, isFirst, isLast, onUpdate, onRemove, onMove }: {
  item: MenuVersionItem
  recipe?: Recipe
  isFirst: boolean
  isLast: boolean
  onUpdate: (patch: Partial<MenuVersionItem>) => void
  onRemove: () => void
  onMove: (dir: 'up' | 'down') => void
}) {
  const [editing, setEditing] = useState(false)
  const name = item.display_name || recipe?.name || '—'
  const desc = item.description || recipe?.menu_description || recipe?.description || ''

  return (
    <div className={`flex items-start gap-3 px-4 py-3 border-b border-[--border] last:border-0 group ${!item.is_available ? 'opacity-50' : ''}`}>
      {/* Reorder */}
      <div className="flex flex-col gap-0.5 flex-shrink-0 pt-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={() => onMove('up')} disabled={isFirst}
          className="text-[--hint] hover:text-[--accent] disabled:opacity-20 text-[10px] leading-none">↑</button>
        <button onClick={() => onMove('down')} disabled={isLast}
          className="text-[--hint] hover:text-[--accent] disabled:opacity-20 text-[10px] leading-none">↓</button>
      </div>

      {/* Name + description */}
      <div className="flex-1 min-w-0">
        {editing ? (
          <div className="space-y-1.5">
            <input defaultValue={item.display_name || recipe?.name || ''} autoFocus
              onBlur={e => onUpdate({ display_name: e.target.value || null })}
              className="w-full text-xs border border-[--border-2] rounded px-2 py-1 outline-none focus:border-[--accent]"
              placeholder="Menu name (leave blank to use recipe name)" />
            <input defaultValue={item.description || recipe?.menu_description || ''}
              onBlur={e => onUpdate({ description: e.target.value || null })}
              className="w-full text-xs border border-[--border-2] rounded px-2 py-1 outline-none focus:border-[--accent]"
              placeholder="Description (leave blank to use recipe description)" />
            <button onClick={() => setEditing(false)} className="text-[10px] text-[--accent]">Done</button>
          </div>
        ) : (
          <div onClick={() => setEditing(true)} className="cursor-text">
            <div className="text-xs font-medium text-[--text]">{name}</div>
            {desc && <div className="text-[10px] text-[--muted] mt-0.5 truncate max-w-xs">{desc}</div>}
          </div>
        )}
      </div>

      {/* Price */}
      <div className="flex-shrink-0 flex items-center gap-1.5">
        <span className="text-[--hint] text-xs">$</span>
        <input type="number" step="0.50" min="0"
          defaultValue={item.price || ''}
          onBlur={e => onUpdate({ price: parseFloat(e.target.value) || 0 })}
          className="w-16 text-xs text-right border border-[--border-2] rounded px-1.5 py-1 outline-none focus:border-[--accent]" />
      </div>

      {/* Show price toggle */}
      <button onClick={() => onUpdate({ show_price: !item.show_price })}
        title={item.show_price ? 'Price visible on menu' : 'Price hidden on guest menu'}
        className={`flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
          item.show_price ? 'bg-[--surface-2] border-[--border-2] text-[--muted]' : 'bg-orange-50 border-orange-200 text-orange-500'
        }`}>
        {item.show_price ? '👁' : '🙈'}
      </button>

      {/* Available toggle */}
      <button onClick={() => onUpdate({ is_available: !item.is_available })}
        title={item.is_available ? 'Available — click to 86' : '86\'d — click to restore'}
        className={`flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
          item.is_available ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-500'
        }`}>
        {item.is_available ? '✓' : '86'}
      </button>

      {/* Remove */}
      <button onClick={onRemove}
        className="flex-shrink-0 text-[--hint] hover:text-red-400 text-xs opacity-0 group-hover:opacity-100 transition-opacity">
        ✕
      </button>
    </div>
  )
}

// ── AddItemModal ──────────────────────────────────────────────
function AddItemModal({ recipes, library, menuType, isNotPrinted, existingIds, onAdd, onClose }: {
  recipes: Recipe[]
  library: LibraryIngredient[]
  menuType: MenuType
  isNotPrinted?: boolean
  existingIds: Set<string>
  onAdd: (recipeId: string, section: string, price: number) => void
  onClose: () => void
}) {
  const [search,  setSearch]  = useState('')
  const [section, setSection] = useState('')
  const [price,   setPrice]   = useState('')
  const [selected, setSelected] = useState<string | null>(null)

  // Filter recipes by menu type tags and search
  const filtered = recipes.filter(r => {
    if (existingIds.has(r.id)) return false
    if (search && !r.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const selectedRecipe = recipes.find(r => r.id === selected)

  // Default price from menu_pricing if available
  useEffect(() => {
    if (!selected) return
    // Could look up from menu_pricing table here; for now leave blank
  }, [selected])

  return (
    <div className="fixed inset-0 bg-black/35 flex items-center justify-center z-50"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl w-[520px] max-w-[94vw] max-h-[80vh] flex flex-col shadow-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[--border] flex items-center justify-between flex-shrink-0">
          <div>
            <h3 className="font-serif text-base font-medium text-[--text]">
              {isNotPrinted ? '🙈 Add Unprinted Item' : `Add to ${TYPE_LABELS[menuType]}`}
            </h3>
            {isNotPrinted && (
              <p className="text-[10px] text-amber-600 mt-0.5">Priced for POS/ordering — not on guest menu or CSV</p>
            )}
          </div>
          <button onClick={onClose} className="text-[--hint] hover:text-[--text]">✕</button>
        </div>

        {/* Search */}
        <div className="px-4 py-2 border-b border-[--border] flex-shrink-0">
          <input value={search} onChange={e => setSearch(e.target.value)} autoFocus
            placeholder="Search recipes…"
            className="w-full text-xs border border-[--border-2] rounded-lg px-3 py-1.5 outline-none focus:border-[--accent]" />
        </div>

        {/* Recipe list */}
        <div className="flex-1 overflow-y-auto divide-y divide-[--border]">
          {filtered.slice(0, 30).map(r => (
            <button key={r.id} onClick={() => setSelected(r.id)}
              className={`w-full px-5 py-2.5 text-left hover:bg-[--surface-2] flex items-center gap-3 ${selected === r.id ? 'bg-[--accent-light]' : ''}`}>
              <span className="text-sm flex-shrink-0">{r.recipe_type === 'cocktail' ? '🍸' : '🍽'}</span>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-[--text]">{r.name}</div>
                {r.description && <div className="text-[10px] text-[--hint] truncate">{r.description}</div>}
              </div>
              {selected === r.id && <span className="text-[--accent] text-sm flex-shrink-0">✓</span>}
            </button>
          ))}
        </div>

        {/* Section + price + confirm */}
        {selected && (
          <div className="px-5 py-4 border-t border-[--border] bg-[--surface-2] flex-shrink-0">
            <div className="text-xs font-medium text-[--text] mb-3">{selectedRecipe?.name}</div>
            <div className="grid grid-cols-2 gap-3">
              {!isNotPrinted && (
                <div>
                  <label className="block text-[10px] text-[--muted] mb-1">Section</label>
                  <input value={section} onChange={e => setSection(e.target.value.toUpperCase())}
                    placeholder="e.g. NEGRONI, PASTA, CAFFÈ"
                    className="w-full text-xs border border-[--border-2] rounded-lg px-2.5 py-1.5 outline-none focus:border-[--accent]" />
                </div>
              )}
              <div>
                <label className="block text-[10px] text-[--muted] mb-1">Menu price ($)</label>
                <input type="number" step="0.50" min="0" value={price} onChange={e => setPrice(e.target.value)}
                  placeholder="0.00"
                  className="w-full text-xs border border-[--border-2] rounded-lg px-2.5 py-1.5 outline-none focus:border-[--accent]" />
              </div>
            </div>
            <button onClick={() => selected && onAdd(selected, section || 'General', parseFloat(price) || 0)}
              disabled={!selected}
              className="w-full mt-3 py-2 bg-[--accent] text-white text-xs font-medium rounded-lg hover:bg-[--accent-dark] disabled:opacity-50">
              Add to {TYPE_LABELS[menuType]}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── SnapshotViewer ────────────────────────────────────────────
function SnapshotViewer({ snap, onExportWithPrices, onExportNoPrice }: {
  snap: DailySnapshot
  onExportWithPrices: () => void
  onExportNoPrice: () => void
}) {
  const byType = useMemo(() => {
    const map: Record<string, SnapshotItem[]> = {}
    for (const item of snap.items_json.filter(i => !i.is_removed)) {
      if (!map[item.menu_type]) map[item.menu_type] = []
      map[item.menu_type].push(item)
    }
    return map
  }, [snap])

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-serif text-base font-medium text-[--text]">{snap.snapshot_date}</h2>
          <div className="text-[11px] text-[--hint] mt-0.5">
            {snap.is_auto ? '↩ Carried forward automatically' : `🚀 Published ${snap.published_at ? new Date(snap.published_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : ''}`}
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={onExportNoPrice}
            className="text-xs px-3 py-1.5 border border-[--border-2] text-[--muted] rounded-lg hover:bg-[--surface-2]">
            CSV (no prices)
          </button>
          <button onClick={onExportWithPrices}
            className="text-xs px-3 py-1.5 border border-[--border-2] text-[--muted] rounded-lg hover:bg-[--surface-2]">
            CSV (with prices)
          </button>
        </div>
      </div>

      {MENU_TYPES.filter(t => byType[t]?.length > 0).map(menuType => (
        <div key={menuType} className="mb-6">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-base">{TYPE_ICONS[menuType]}</span>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[--text]">{TYPE_LABELS[menuType]}</h3>
            <div className="flex-1 h-px bg-[--border]" />
          </div>
          <div className="bg-white rounded-xl border border-[--border] overflow-hidden">
            {/* Group by section */}
            {Object.entries(
              (byType[menuType] ?? []).reduce<Record<string, SnapshotItem[]>>((acc, item) => {
                const sec = item.section || 'General'
                if (!acc[sec]) acc[sec] = []
                acc[sec].push(item)
                return acc
              }, {})
            ).map(([section, sItems]) => (
              <div key={section}>
                <div className="px-4 py-1.5 bg-[--surface-2] border-b border-[--border] text-[10px] font-semibold uppercase tracking-widest text-[--hint]">
                  {section}
                </div>
                {[...sItems].sort((a, b) => a.sort_order - b.sort_order).map(item => (
                  <div key={`${item.recipe_id}-${item.sort_order}`}
                    className="flex items-baseline px-4 py-2.5 border-b border-[--border] last:border-0">
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-medium text-[--text]">{item.display_name}</span>
                      {item.description && (
                        <span className="text-[10px] text-[--muted] ml-2">{item.description}</span>
                      )}
                    </div>
                    <div className="flex-shrink-0 text-xs font-medium text-[--text] ml-4">
                      {item.show_price && item.price ? `$${item.price.toFixed(2)}` : ''}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      ))}

      {snap.items_json.length === 0 && (
        <div className="text-center py-8 text-xs text-[--hint]">No items in this snapshot.</div>
      )}
    </div>
  )
}
