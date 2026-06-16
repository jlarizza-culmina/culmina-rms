'use client'
import { useState, useMemo, useEffect } from 'react'
import type { LibraryIngredient, Vendor } from '@/lib/types'
import { createClient } from '@/lib/supabase'
import { ING_CATEGORIES, SUBCATEGORIES, CAT_ICONS } from '@/lib/ingredientConstants'
import { PURCHASE_UNIT_OPTIONS } from '@/lib/unitConversion'

// FDA 9 major allergens (structured boolean flags — Gap 1)
type AllergenKey =
  | 'allergen_milk' | 'allergen_eggs' | 'allergen_fish' | 'allergen_shellfish'
  | 'allergen_tree_nuts' | 'allergen_peanuts' | 'allergen_wheat'
  | 'allergen_soybeans' | 'allergen_sesame'
type DietaryKey = 'is_gluten_free' | 'is_vegan' | 'is_vegetarian' | 'is_halal' | 'is_kosher'

const ALLERGENS: { key: AllergenKey; label: string }[] = [
  { key: 'allergen_milk',      label: 'Dairy / Milk' },
  { key: 'allergen_eggs',      label: 'Eggs' },
  { key: 'allergen_fish',      label: 'Fish' },
  { key: 'allergen_shellfish', label: 'Shellfish' },
  { key: 'allergen_tree_nuts', label: 'Tree Nuts' },
  { key: 'allergen_peanuts',   label: 'Peanuts' },
  { key: 'allergen_wheat',     label: 'Wheat / Gluten' },
  { key: 'allergen_soybeans',  label: 'Soy' },
  { key: 'allergen_sesame',    label: 'Sesame' },
]
const DIETARY_FLAGS: { key: DietaryKey; label: string }[] = [
  { key: 'is_gluten_free', label: 'Gluten-free' },
  { key: 'is_vegan',       label: 'Vegan' },
  { key: 'is_vegetarian',  label: 'Vegetarian' },
  { key: 'is_halal',       label: 'Halal' },
  { key: 'is_kosher',      label: 'Kosher' },
]

const DAYS = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday']

type LibrarySortKey = 'name' | 'category' | 'unit' | 'purchase_unit_cost' | 'vendor_name' | 'updated_at'

// Cost per recipe unit: purchase_cost / conversion / trim
function costPerUnit(lib: LibraryIngredient): number | null {
  if (!lib.purchase_unit_cost || !lib.unit_conversion) return null
  return lib.purchase_unit_cost / lib.unit_conversion / (lib.trim_factor || 1)
}

function fmt$(n: number) { return `$${n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}` }

function sortLibrary(
  items: LibraryIngredient[],
  key: LibrarySortKey,
  dir: 'asc' | 'desc',
  vendorName: (i: LibraryIngredient) => string,
): LibraryIngredient[] {
  return [...items].sort((a, b) => {
    let cmp = 0
    switch (key) {
      case 'name':               cmp = a.name.localeCompare(b.name); break
      case 'category':           cmp = (a.category ?? '').localeCompare(b.category ?? ''); break
      case 'unit':               cmp = (a.recipe_unit ?? '').localeCompare(b.recipe_unit ?? ''); break
      case 'purchase_unit_cost': cmp = (a.purchase_unit_cost ?? 0) - (b.purchase_unit_cost ?? 0); break
      case 'vendor_name':        cmp = vendorName(a).localeCompare(vendorName(b)); break
      case 'updated_at':         cmp = (a.updated_at ?? '').localeCompare(b.updated_at ?? ''); break
    }
    return dir === 'asc' ? cmp : -cmp
  })
}

function exportLibraryCSV(ingredients: LibraryIngredient[], vendors: Vendor[]) {
  const headers = [
    'Name','Category','Recipe Unit','Vendor','Purchase Qty','Purchase Unit',
    'Purchase Cost','Trim Factor','Is Active','Created','Updated'
  ]

  const rows = ingredients.map(ing => {
    const vendor = vendors.find(v => v.id === ing.vendor_id)
    return [
      ing.name ?? '',
      ing.category ?? '',
      ing.recipe_unit ?? '',
      vendor?.name ?? '',
      ing.purchase_unit_qty ?? '',
      ing.purchase_unit_label ?? '',
      ing.purchase_unit_cost ?? '',
      ing.trim_factor ?? '',
      ing.is_active ? 'true' : 'false',
      ing.created_at ? new Date(ing.created_at).toLocaleDateString() : '',
      ing.updated_at ? new Date(ing.updated_at).toLocaleDateString() : '',
    ]
  })

  // UTF-8 BOM for Excel compatibility
  const BOM = '﻿'
  const csvContent = BOM + [headers, ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n')

  const date = new Date().toISOString().split('T')[0]
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `culmina_ingredients_${date}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function printLibrary(ingredients: LibraryIngredient[], vendors: Vendor[]) {
  const date = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric'
  })

  const rows = ingredients.map(ing => {
    const vendor = vendors.find(v => v.id === ing.vendor_id)
    return `
      <tr>
        <td>${ing.category ?? '—'}</td>
        <td><strong>${ing.name ?? ''}</strong></td>
        <td>${ing.recipe_unit ?? '—'}</td>
        <td>${vendor?.name ?? '—'}</td>
        <td>${ing.purchase_unit_cost ? `$${ing.purchase_unit_cost}` : '—'}</td>
        <td></td>
      </tr>`
  }).join('')

  const html = `<!DOCTYPE html><html><head>
    <title>Ingredient Library</title>
    <style>
      body { font-family: Georgia, serif; font-size: 11px; margin: 20px; }
      h2 { font-size: 14px; margin-bottom: 4px; }
      p.meta { font-size: 10px; color: #666; margin-bottom: 12px; }
      table { width: 100%; border-collapse: collapse; }
      th { background: #f0ede8; text-align: left; padding: 4px 8px;
           font-size: 9px; text-transform: uppercase; letter-spacing: 0.05em;
           border-bottom: 1px solid #ccc; }
      td { padding: 4px 8px; border-bottom: 1px solid #eee; vertical-align: top; }
      @media print { body { margin: 0; } }
    </style>
    </head><body>
    <h2>Ingredient Library</h2>
    <p class="meta">Printed ${date} · ${ingredients.length} items</p>
    <table>
      <thead><tr>
        <th>Category</th><th>Name</th><th>Unit</th>
        <th>Vendor</th><th>Cost</th><th>Notes</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    </body></html>`

  const w = window.open('', '_blank')
  if (w) { w.document.write(html); w.document.close(); w.print() }
}

interface Props {
  userId: string
  vendors: Vendor[]
  library: LibraryIngredient[]
  onLibraryChange: () => void
  onVendorsChange: () => void
}

// ── Blank states ─────────────────────────────────────────────
const blankIngredient = (): Partial<LibraryIngredient> => ({
  name: '', category: 'Pantry', sub_category: '' as string, vendor_id: null,
  purchase_unit: '', purchase_unit_cost: null, purchase_unit_size: null,
  recipe_unit: '', recipe_unit_is_metric: false,
  unit_conversion: 1, trim_factor: 1,
  allergens: [], notes: '', is_active: true,
})
const blankVendor = (): Partial<Vendor> => ({
  name: '', contact_name: '', phone: '', email: '',
  address: '', delivery_days: [], order_cutoff: '',
  account_number: '', notes: '', is_active: true,
})

export default function IngredientLibrary({ userId, vendors, library, onLibraryChange, onVendorsChange }: Props) {
  const supabase = createClient()
  const [subTab, setSubTab] = useState<'ingredients' | 'vendors'>('ingredients')

  // ── Ingredient state ─────────────────────────────────────────
  const [ingSearch, setIngSearch] = useState('')
  const [ingCat, setIngCat]       = useState('all')
  const [ingVendor, setIngVendor] = useState('all')
  const [editIng, setEditIng]     = useState<Partial<LibraryIngredient> | null>(null)
  const [savingIng, setSavingIng] = useState(false)
  const [sortKey, setSortKey]     = useState<LibrarySortKey>('name')
  const [sortDir, setSortDir]     = useState<'asc' | 'desc'>('asc')

  // ── Vendor state ─────────────────────────────────────────────
  const [editVend, setEditVend]   = useState<Partial<Vendor> | null>(null)
  const [savingVend, setSavingVend] = useState(false)

  // ── Recipe unit picklist ─────────────────────────────────────
  const [recipeUnits, setRecipeUnits] = useState<{value:string;label:string}[]>([])
  useEffect(() => {
    createClient().from('picklist_values').select('value,label')
      .eq('list_name','recipe_unit').eq('is_active',true).order('sort_order')
      .then(({ data }) => setRecipeUnits(data ?? []))
  }, [])

  // ── Filtered ingredients ──────────────────────────────────────
  const filtered = useMemo(() => library.filter(i => {
    const matchSearch = !ingSearch || i.name.toLowerCase().includes(ingSearch.toLowerCase())
    const matchCat    = ingCat === 'all' || i.category === ingCat
    const matchVend   = ingVendor === 'all' || i.vendor_id === ingVendor
    return matchSearch && matchCat && matchVend
  }), [library, ingSearch, ingCat, ingVendor])

  // ── Sorting ───────────────────────────────────────────────────
  function toggleSort(key: LibrarySortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  const sorted = useMemo(() => {
    const vendorName = (i: LibraryIngredient) => vendors.find(v => v.id === i.vendor_id)?.name ?? ''
    return sortLibrary(filtered, sortKey, sortDir, vendorName)
  }, [filtered, sortKey, sortDir, vendors])

  const SortIcon = ({ col }: { col: LibrarySortKey }) =>
    sortKey === col ? <span className="ml-1 text-[--accent]">{sortDir === 'asc' ? '▲' : '▼'}</span> : null

  // ── Ingredient CRUD ───────────────────────────────────────────
  async function saveIngredient(override?: Partial<LibraryIngredient>) {
    const src = override ?? editIng
    if (!src?.name?.trim()) return
    setSavingIng(true)
    const payload = {
      user_id: userId,
      name: src.name!.trim(),
      category: src.category || 'other',
      sub_category: (src as any).sub_category || null,
      vendor_id: src.vendor_id || null,
      purchase_unit_qty: src.purchase_unit_qty ?? null,
      purchase_unit_label: src.purchase_unit_label || null,
      purchase_unit_cost: src.purchase_unit_cost ?? null,
      purchase_unit_size: src.purchase_unit_size ?? null,
      recipe_unit: src.recipe_unit || '',
      recipe_unit_is_metric: src.recipe_unit_is_metric || false,
      unit_conversion: src.unit_conversion ?? 1,
      trim_factor: src.trim_factor ?? 1,
      allergens: src.allergens || [],
      notes: src.notes || '',
      is_active: src.is_active ?? true,
      // Structured allergens & dietary (Gap 1)
      allergen_milk:      src.allergen_milk ?? false,
      allergen_eggs:      src.allergen_eggs ?? false,
      allergen_fish:      src.allergen_fish ?? false,
      allergen_shellfish: src.allergen_shellfish ?? false,
      allergen_tree_nuts: src.allergen_tree_nuts ?? false,
      allergen_peanuts:   src.allergen_peanuts ?? false,
      allergen_wheat:     src.allergen_wheat ?? false,
      allergen_soybeans:  src.allergen_soybeans ?? false,
      allergen_sesame:    src.allergen_sesame ?? false,
      allergens_confirmed:    src.allergens_confirmed ?? false,
      allergens_confirmed_by: src.allergens_confirmed_by ?? null,
      allergens_confirmed_at: src.allergens_confirmed_at ?? null,
      is_gluten_free: src.is_gluten_free ?? false,
      is_vegan:       src.is_vegan ?? false,
      is_vegetarian:  src.is_vegetarian ?? false,
      is_halal:       src.is_halal ?? false,
      is_kosher:      src.is_kosher ?? false,
      allergen_notes: src.allergen_notes || null,
    }
    if (src.id) {
      await supabase.from('ingredient_library').update(payload).eq('id', src.id)
    } else {
      await supabase.from('ingredient_library').insert(payload)
    }
    setSavingIng(false)
    setEditIng(null)
    onLibraryChange()
  }

  function confirmAllergens() {
    if (!editIng) return
    const confirmed: Partial<LibraryIngredient> = {
      ...editIng,
      allergens_confirmed: true,
      allergens_confirmed_at: new Date().toISOString(),
      allergens_confirmed_by: userId,
    }
    setEditIng(confirmed)
    saveIngredient(confirmed)
  }

  async function deleteIngredient(id: string) {
    if (!confirm('Remove from library? Recipes using this ingredient will lose their cost link.')) return
    await supabase.from('ingredient_library').update({ is_active: false }).eq('id', id)
    onLibraryChange()
  }

  // ── Vendor CRUD ───────────────────────────────────────────────
  async function saveVendor() {
    if (!editVend?.name?.trim()) return
    setSavingVend(true)
    const payload = {
      user_id: userId,
      name: editVend.name!.trim(),
      contact_name: editVend.contact_name || '',
      phone: editVend.phone || '',
      email: editVend.email || '',
      address: editVend.address || '',
      delivery_days: editVend.delivery_days || [],
      order_cutoff: editVend.order_cutoff || '',
      account_number: editVend.account_number || '',
      notes: editVend.notes || '',
      is_active: editVend.is_active ?? true,
    }
    if (editVend.id) {
      await supabase.from('vendors').update(payload).eq('id', editVend.id)
    } else {
      await supabase.from('vendors').insert(payload)
    }
    setSavingVend(false)
    setEditVend(null)
    onVendorsChange()
  }

  async function deleteVendor(id: string) {
    if (!confirm('Remove this vendor?')) return
    await supabase.from('vendors').update({ is_active: false }).eq('id', id)
    onVendorsChange()
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="bg-white border-b border-[--border] px-6 py-4">
        <h1 className="font-serif text-xl font-medium text-[--text] mb-3">Ingredient Library</h1>
        <div className="flex gap-0.5 bg-[--surface-2] rounded-lg p-0.5">
          {(['ingredients','vendors'] as const).map(t => (
            <button key={t} onClick={() => setSubTab(t)}
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all capitalize ${subTab === t ? 'bg-white text-[--text] shadow-sm' : 'text-[--muted]'}`}>
              {t === 'ingredients' ? `📦 Ingredients (${library.length})` : `🚚 Vendors (${vendors.length})`}
            </button>
          ))}
        </div>
      </div>

      {/* ── Ingredients Tab ── */}
      {subTab === 'ingredients' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Toolbar */}
          <div className="flex gap-2 px-6 py-3 bg-white border-b border-[--border] flex-wrap">
            <input value={ingSearch} onChange={e => setIngSearch(e.target.value)}
              placeholder="Search ingredients…"
              className="flex-1 min-w-40 px-3 py-1.5 text-xs border border-[--border-2] rounded-lg outline-none focus:border-[--accent]" />
            <select value={ingCat} onChange={e => setIngCat(e.target.value)}
              className="px-2.5 py-1.5 text-xs border border-[--border-2] rounded-lg outline-none bg-white">
              <option value="all">All categories</option>
              {ING_CATEGORIES.map(c => <option key={c} value={c}>{CAT_ICONS[c] ?? ''} {c}</option>)}
            </select>
            <select value={ingVendor} onChange={e => setIngVendor(e.target.value)}
              className="px-2.5 py-1.5 text-xs border border-[--border-2] rounded-lg outline-none bg-white">
              <option value="all">All vendors</option>
              {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            <button onClick={() => exportLibraryCSV(sorted, vendors)}
              className="px-3 py-1.5 border border-[--border-2] text-[--muted] text-xs font-medium rounded-lg hover:bg-[--surface-2] transition-colors whitespace-nowrap">
              ↓ Export CSV
            </button>
            <button onClick={() => printLibrary(sorted, vendors)}
              className="px-3 py-1.5 border border-[--border-2] text-[--muted] text-xs font-medium rounded-lg hover:bg-[--surface-2] transition-colors whitespace-nowrap">
              🖨 Print
            </button>
            <button onClick={() => setEditIng(blankIngredient())}
              className="px-3 py-1.5 bg-[--accent] text-white text-xs font-medium rounded-lg hover:bg-[--accent-dark] transition-colors whitespace-nowrap">
              + Add Ingredient
            </button>
          </div>

          {/* Table */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {sorted.length === 0 ? (
              <div className="text-center py-16 text-[--muted]">
                <div className="text-4xl opacity-20 mb-3">📦</div>
                <p className="text-sm">No ingredients yet. Add your first to start tracking food costs.</p>
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[--border]">
                    <th className="text-left py-2 pr-3">
                      <button onClick={() => toggleSort('name')} className="text-[10px] font-semibold uppercase tracking-wide text-[--hint] hover:text-[--text] flex items-center">Name <SortIcon col="name" /></button>
                    </th>
                    <th className="text-left py-2 pr-3">
                      <button onClick={() => toggleSort('category')} className="text-[10px] font-semibold uppercase tracking-wide text-[--hint] hover:text-[--text] flex items-center">Category <SortIcon col="category" /></button>
                    </th>
                    <th className="text-left py-2 pr-3">
                      <button onClick={() => toggleSort('vendor_name')} className="text-[10px] font-semibold uppercase tracking-wide text-[--hint] hover:text-[--text] flex items-center">Vendor <SortIcon col="vendor_name" /></button>
                    </th>
                    <th className="text-left py-2 pr-3">
                      <button onClick={() => toggleSort('purchase_unit_cost')} className="text-[10px] font-semibold uppercase tracking-wide text-[--hint] hover:text-[--text] flex items-center">Purchase <SortIcon col="purchase_unit_cost" /></button>
                    </th>
                    <th className="text-left py-2 pr-3 text-[10px] font-semibold uppercase tracking-wide text-[--hint]">Cost</th>
                    <th className="text-left py-2 pr-3">
                      <button onClick={() => toggleSort('unit')} className="text-[10px] font-semibold uppercase tracking-wide text-[--hint] hover:text-[--text] flex items-center">Recipe unit <SortIcon col="unit" /></button>
                    </th>
                    <th className="text-left py-2 pr-3 text-[10px] font-semibold uppercase tracking-wide text-[--hint]">$/unit</th>
                    <th className="text-left py-2 pr-3 text-[10px] font-semibold uppercase tracking-wide text-[--hint]">Trim</th>
                    <th className="text-left py-2 pr-3">
                      <button onClick={() => toggleSort('updated_at')} className="text-[10px] font-semibold uppercase tracking-wide text-[--hint] hover:text-[--text] flex items-center">Updated <SortIcon col="updated_at" /></button>
                    </th>
                    <th className="text-left py-2 pr-3 text-[10px] font-semibold uppercase tracking-wide text-[--hint]"></th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(ing => {
                    const cpu = costPerUnit(ing)
                    const vend = vendors.find(v => v.id === ing.vendor_id)
                    const unitDisplay = ing.purchase_unit_qty && ing.purchase_unit_label
                      ? `${ing.purchase_unit_qty} ${ing.purchase_unit_label}`
                      : ing.purchase_unit ?? ''
                    return (
                      <tr key={ing.id} className="border-b border-[--border] hover:bg-[--surface-2] group">
                        <td className="py-2 pr-3 font-medium text-[--text]">{ing.name}</td>
                        <td className="py-2 pr-3 text-[--muted]">{CAT_ICONS[ing.category] ? `${CAT_ICONS[ing.category]} ${ing.category}` : ing.category}</td>
                        <td className="py-2 pr-3 text-[--muted]">{vend?.name ?? '—'}</td>
                        <td className="py-2 pr-3 text-[--muted]">
                          {ing.purchase_unit_cost ? `$${ing.purchase_unit_cost.toFixed(2)}${unitDisplay ? ` / ${unitDisplay}` : ''}` : '—'}
                        </td>
                        <td className="py-2 pr-3 text-[--muted]">
                          {ing.unit_conversion !== 1 ? `× ${ing.unit_conversion}` : '—'}
                        </td>
                        <td className="py-2 pr-3 text-[--muted]">{ing.recipe_unit || '—'}</td>
                        <td className="py-2 pr-3 font-medium text-[--accent]">
                          {cpu ? `${fmt$(cpu)}/${ing.recipe_unit || 'unit'}` : '—'}
                        </td>
                        <td className="py-2 pr-3 text-[--muted]">
                          {ing.trim_factor < 1 ? `${Math.round(ing.trim_factor * 100)}%` : '100%'}
                        </td>
                        <td className="py-2 pr-3 text-[--muted]">
                          {ing.updated_at ? new Date(ing.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                        </td>
                        <td className="py-2">
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => setEditIng({ ...ing })}
                              className="px-2 py-0.5 text-[10px] border border-[--border-2] rounded text-[--muted] hover:text-[--text]">Edit</button>
                            <button onClick={() => deleteIngredient(ing.id)}
                              className="px-2 py-0.5 text-[10px] border border-red-200 rounded text-red-400 hover:text-red-600">✕</button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ── Vendors Tab ── */}
      {subTab === 'vendors' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex justify-end px-6 py-3 bg-white border-b border-[--border]">
            <button onClick={() => setEditVend(blankVendor())}
              className="px-3 py-1.5 bg-[--accent] text-white text-xs font-medium rounded-lg hover:bg-[--accent-dark] transition-colors">
              + Add Vendor
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {vendors.length === 0 ? (
              <div className="text-center py-16 text-[--muted]">
                <div className="text-4xl opacity-20 mb-3">🚚</div>
                <p className="text-sm">No vendors yet. Your Bronx suppliers are already seeded — check the SQL seed data.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {vendors.map(v => (
                  <div key={v.id} className="flex items-start gap-4 p-4 bg-white rounded-xl border border-[--border] group">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm text-[--text]">{v.name}</div>
                      <div className="flex gap-4 mt-1 flex-wrap">
                        {v.phone && <span className="text-xs text-[--muted]">📞 {v.phone}</span>}
                        {v.address && <span className="text-xs text-[--muted]">📍 {v.address}</span>}
                        {v.delivery_days?.length > 0 && (
                          <span className="text-xs text-[--muted]">
                            🚚 {v.delivery_days.map(d => d.slice(0,3)).join(', ')}
                          </span>
                        )}
                        {v.order_cutoff && <span className="text-xs text-[--muted]">⏰ {v.order_cutoff}</span>}
                      </div>
                      {v.notes && <div className="text-xs text-[--hint] mt-1 italic">{v.notes}</div>}
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                      <button onClick={() => setEditVend({ ...v })}
                        className="px-2.5 py-1 text-[11px] border border-[--border-2] rounded text-[--muted] hover:text-[--text]">Edit</button>
                      <button onClick={() => deleteVendor(v.id)}
                        className="px-2.5 py-1 text-[11px] border border-red-200 rounded text-red-400 hover:text-red-600">✕</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Ingredient Modal ── */}
      {editIng && (
        <Modal title={editIng.id ? 'Edit Ingredient' : 'Add Ingredient'} onClose={() => setEditIng(null)}>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>Name</Label>
              <input value={editIng.name || ''} onChange={e => setEditIng(p => ({ ...p!, name: e.target.value }))}
                placeholder="e.g. Pancetta, 00 Flour, Campari"
                className="fi w-full" autoFocus />
            </div>
            <div>
              <Label>Category</Label>
              <select value={editIng.category || 'pantry'} onChange={e => setEditIng(p => ({ ...p!, category: e.target.value, sub_category: '' } as any))}
                className="fi w-full bg-white">
                {ING_CATEGORIES.map(c => <option key={c} value={c}>{CAT_ICONS[c] ?? ''} {c}</option>)}
              </select>
            </div>
            <div>
              <Label>Vendor</Label>
              <select value={editIng.vendor_id || ''} onChange={e => setEditIng(p => ({ ...p!, vendor_id: e.target.value || null }))}
                className="fi w-full bg-white">
                <option value="">— None —</option>
                {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </div>
            {SUBCATEGORIES[editIng.category || ''] && (
              <div>
                <Label>Sub-category</Label>
                <select value={(editIng as any).sub_category || ''} onChange={e => setEditIng(p => ({ ...p!, sub_category: e.target.value } as any))}
                  className="fi w-full bg-white">
                  <option value="">— None —</option>
                  {SUBCATEGORIES[editIng.category || ''].map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            )}

            <div>
              <Label>Sub-category</Label>
              <input value={(editIng as any).sub_category || ''} onChange={e => setEditIng(p => ({ ...p!, sub_category: e.target.value } as any))}
                className="fi w-full" placeholder="e.g. Beef, Shellfish, Syrups…" />
            </div>
            <div className="col-span-2 border-t border-[--border] pt-3 mt-1">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[--hint] mb-2">Purchase Info</div>
            </div>
            <div>
              <div className="flex gap-2">
                <div className="w-[30%]">
                  <Label>Purchase qty</Label>
                  <input type="number" min="0" step="any"
                    value={editIng.purchase_unit_qty ?? ''}
                    onChange={e => setEditIng(p => ({ ...p!, purchase_unit_qty: e.target.value ? parseFloat(e.target.value) : undefined }))}
                    placeholder="750" className="fi w-full" />
                </div>
                <div className="w-[70%]">
                  <Label>Unit</Label>
                  <select value={editIng.purchase_unit_label ?? ''}
                    onChange={e => setEditIng(p => ({ ...p!, purchase_unit_label: e.target.value }))}
                    className="fi w-full bg-white">
                    <option value="">— select unit —</option>
                    {PURCHASE_UNIT_OPTIONS.map(g => (
                      <optgroup key={g.group} label={g.group}>
                        {g.options.map(o => <option key={o} value={o}>{o}</option>)}
                      </optgroup>
                    ))}
                  </select>
                </div>
              </div>
            </div>
            <div>
              <Label>Cost per purchase unit ($)</Label>
              <input type="number" step="0.01" min="0"
                value={editIng.purchase_unit_cost ?? ''} onChange={e => setEditIng(p => ({ ...p!, purchase_unit_cost: e.target.value ? parseFloat(e.target.value) : null }))}
                placeholder="12.00" className="fi w-full" />
            </div>

            <div className="col-span-2 border-t border-[--border] pt-3 mt-1">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[--hint] mb-2">Recipe Usage</div>
            </div>
            <div>
              <Label>Recipe unit</Label>
              {recipeUnits.length > 0 ? (
                <select value={editIng.recipe_unit || ''} onChange={e => setEditIng(p => ({ ...p!, recipe_unit: e.target.value }))}
                  className="fi w-full bg-white">
                  <option value="">— Select unit —</option>
                  {recipeUnits.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
                </select>
              ) : (
                <input value={editIng.recipe_unit || ''} onChange={e => setEditIng(p => ({ ...p!, recipe_unit: e.target.value }))}
                  placeholder="g, oz, cup, each, tsp" className="fi w-full" />
              )}
            </div>
            <div>
              <Label>
                Conversion
                <span className="text-[--hint] normal-case ml-1">(recipe units per purchase unit)</span>
              </Label>
              <input type="number" step="0.001" min="0.001"
                value={editIng.unit_conversion ?? 1} onChange={e => setEditIng(p => ({ ...p!, unit_conversion: parseFloat(e.target.value) || 1 }))}
                placeholder="453.6" className="fi w-full" />
              <div className="text-[10px] text-[--hint] mt-1">e.g. 1 lb = 453.6g → enter 453.6</div>
            </div>
            <div>
              <Label>Trim / yield factor (%)</Label>
              <input type="number" step="1" min="1" max="100"
                value={Math.round((editIng.trim_factor ?? 1) * 100)}
                onChange={e => setEditIng(p => ({ ...p!, trim_factor: (parseInt(e.target.value) || 100) / 100 }))}
                placeholder="100" className="fi w-full" />
              <div className="text-[10px] text-[--hint] mt-1">e.g. 85 = 15% waste after trimming</div>
            </div>
            <div>
              <Label>Cost per recipe unit (auto)</Label>
              <div className="fi w-full bg-[--surface-2] text-[--accent] font-medium">
                {editIng.purchase_unit_cost && editIng.unit_conversion && editIng.recipe_unit
                  ? `${fmt$(editIng.purchase_unit_cost / editIng.unit_conversion / (editIng.trim_factor || 1))} / ${editIng.recipe_unit}`
                  : '— fill in fields above'}
              </div>
            </div>

            <div className="col-span-2 border-t border-[--border] pt-3 mt-1">
              <Label>Allergens</Label>
              {/* Part A — FDA 9 major allergens */}
              <div className="grid grid-cols-3 gap-2 mt-1">
                {ALLERGENS.map(a => (
                  <label key={a.key} className="flex items-center gap-1.5 text-xs cursor-pointer">
                    <input type="checkbox" checked={!!editIng[a.key]}
                      onChange={e => setEditIng(p => ({ ...p!, [a.key]: e.target.checked, allergens_confirmed: false }))}
                      className="accent-[--accent]" />
                    <span>{a.label}</span>
                  </label>
                ))}
              </div>

              {/* Part B — Dietary flags */}
              <div className="flex flex-wrap gap-3 mt-3 pt-3 border-t border-[--border]">
                {DIETARY_FLAGS.map(d => (
                  <label key={d.key} className="flex items-center gap-1 text-[11px] cursor-pointer">
                    <input type="checkbox" checked={!!editIng[d.key]}
                      onChange={e => setEditIng(p => ({ ...p!, [d.key]: e.target.checked }))}
                      className="accent-[--accent]" />
                    <span>{d.label}</span>
                  </label>
                ))}
              </div>

              {/* Part C — Notes + confirm */}
              <input value={editIng.allergen_notes || ''}
                onChange={e => setEditIng(p => ({ ...p!, allergen_notes: e.target.value }))}
                placeholder="e.g. may contain traces of nuts" className="fi w-full mt-3" />
              <div className="mt-2 flex items-center gap-3">
                <button type="button" onClick={confirmAllergens} disabled={savingIng}
                  className="px-3 py-1.5 text-xs font-medium border border-[--accent] text-[--accent] rounded-lg hover:bg-[--accent-light] disabled:opacity-50">
                  Mark allergens as confirmed
                </button>
                {editIng.allergens_confirmed ? (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200 font-medium">
                    ✓ Confirmed{editIng.allergens_confirmed_at ? ` ${new Date(editIng.allergens_confirmed_at).toLocaleDateString()}` : ''}
                  </span>
                ) : (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 font-medium">
                    ⚠ Unconfirmed
                  </span>
                )}
              </div>
            </div>
            <div className="col-span-2">
              <Label>Notes</Label>
              <textarea value={editIng.notes || ''} onChange={e => setEditIng(p => ({ ...p!, notes: e.target.value }))}
                rows={2} className="fi w-full resize-none" placeholder="Storage notes, sourcing details…" />
            </div>
          </div>
          <ModalActions onClose={() => setEditIng(null)} onSave={saveIngredient} saving={savingIng} />
        </Modal>
      )}

      {/* ── Vendor Modal ── */}
      {editVend && (
        <Modal title={editVend.id ? 'Edit Vendor' : 'Add Vendor'} onClose={() => setEditVend(null)}>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>Vendor name</Label>
              <input value={editVend.name || ''} onChange={e => setEditVend(p => ({ ...p!, name: e.target.value }))}
                placeholder="Borgatti's Ravioli & Egg Noodles" className="fi w-full" autoFocus />
            </div>
            <div>
              <Label>Contact name</Label>
              <input value={editVend.contact_name || ''} onChange={e => setEditVend(p => ({ ...p!, contact_name: e.target.value }))}
                className="fi w-full" />
            </div>
            <div>
              <Label>Phone</Label>
              <input value={editVend.phone || ''} onChange={e => setEditVend(p => ({ ...p!, phone: e.target.value }))}
                placeholder="(718) 555-0100" className="fi w-full" />
            </div>
            <div>
              <Label>Email</Label>
              <input type="email" value={editVend.email || ''} onChange={e => setEditVend(p => ({ ...p!, email: e.target.value }))}
                className="fi w-full" />
            </div>
            <div>
              <Label>Account number</Label>
              <input value={editVend.account_number || ''} onChange={e => setEditVend(p => ({ ...p!, account_number: e.target.value }))}
                className="fi w-full" />
            </div>
            <div className="col-span-2">
              <Label>Address</Label>
              <input value={editVend.address || ''} onChange={e => setEditVend(p => ({ ...p!, address: e.target.value }))}
                className="fi w-full" />
            </div>
            <div className="col-span-2">
              <Label>Delivery days</Label>
              <div className="flex flex-wrap gap-2 mt-1">
                {DAYS.map(d => (
                  <label key={d} className="flex items-center gap-1 text-xs cursor-pointer">
                    <input type="checkbox" checked={(editVend.delivery_days || []).includes(d)}
                      onChange={e => setEditVend(p => ({
                        ...p!, delivery_days: e.target.checked
                          ? [...(p!.delivery_days || []), d]
                          : (p!.delivery_days || []).filter(x => x !== d)
                      }))} className="accent-[--accent]" />
                    <span className="capitalize">{d.slice(0,3)}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <Label>Order cutoff</Label>
              <input value={editVend.order_cutoff || ''} onChange={e => setEditVend(p => ({ ...p!, order_cutoff: e.target.value }))}
                placeholder="By 3pm day prior" className="fi w-full" />
            </div>
            <div className="col-span-2">
              <Label>Notes</Label>
              <textarea value={editVend.notes || ''} onChange={e => setEditVend(p => ({ ...p!, notes: e.target.value }))}
                rows={2} className="fi w-full resize-none" />
            </div>
          </div>
          <ModalActions onClose={() => setEditVend(null)} onSave={saveVendor} saving={savingVend} />
        </Modal>
      )}
    </div>
  )
}

// ── Shared sub-components ─────────────────────────────────────
function Label({ children }: { children?: React.ReactNode }) {
  return <label className="block text-[11px] font-medium text-[--muted] mb-1">{children}</label>
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children?: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/35 flex items-center justify-center z-50"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl p-6 w-[560px] max-w-[94vw] max-h-[88vh] overflow-y-auto fade-in shadow-lg">
        <h2 className="font-serif text-lg font-medium text-[--text] mb-4">{title}</h2>
        {children}
      </div>
    </div>
  )
}

function ModalActions({ onClose, onSave, saving }: { onClose: () => void; onSave: () => void; saving: boolean }) {
  return (
    <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-[--border]">
      <button onClick={onClose} className="px-4 py-2 text-xs text-[--muted] border border-[--border-2] rounded-lg hover:bg-[--surface-2]">Cancel</button>
      <button onClick={onSave} disabled={saving}
        className="px-4 py-2 text-xs font-medium bg-[--accent] text-white rounded-lg hover:bg-[--accent-dark] disabled:opacity-50 flex items-center gap-1.5 min-w-[70px] justify-center">
        {saving ? <><span className="spinner" />Saving…</> : 'Save'}
      </button>
    </div>
  )
}
