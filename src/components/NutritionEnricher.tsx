'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase'
import type { LibraryIngredient } from '@/lib/types'

interface UsdaResult {
  fdcId: number; description: string; dataType: string; brandOwner?: string | null
  calories: number | null; protein_g: number | null; carbs_g: number | null
  fat_g: number | null; fiber_g: number | null; sodium_mg: number | null
}
interface IngRow extends LibraryIngredient {
  nutrition_updated_at?: string | null
  nutrition_excluded?: boolean
  _checked?: boolean
  _searching?: boolean
  _results?: UsdaResult[]
  _showResults?: boolean
  _editMode?: boolean
  _searchOverride?: string   // manual search term
  _showSearch?: boolean
}

type ListFilter = 'null' | 'enriched' | 'last7' | 'last30' | 'excluded' | 'all'
const FILTER_LABELS: Record<ListFilter, string> = {
  null:     'Never enriched',
  enriched: 'Has nutrition data',
  last7:    'Updated last 7 days',
  last30:   'Updated last 30 days',
  excluded: 'Ignored / Excluded',
  all:      'All items',
}

function fmt(v: number | null | undefined) { return v == null ? '—' : String(Math.round(v * 10) / 10) }
function fmtDate(s?: string | null) {
  if (!s) return null
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

interface Props { userId: string; restaurantId?: string }

export default function NutritionEnricher({ userId, restaurantId }: Props) {
  const supabase = createClient()
  const [items,        setItems]       = useState<IngRow[]>([])
  const [loading,      setLoading]     = useState(true)
  const [totalAll,     setTotalAll]    = useState(0)
  const [totalEnrich,  setTotalEnrich] = useState(0)
  const [saving,       setSaving]      = useState<string | null>(null)
  const [listFilter,   setListFilter]  = useState<ListFilter>('null')
  const [page,         setPage]        = useState(0)
  const [totalPages,   setTotalPages]  = useState(1)
  const [bulkRunning,  setBulkRunning] = useState(false)
  const [bulkProgress, setBulkProgress] = useState<{done:number;total:number}|null>(null)
  const PAGE = 50

  const load = useCallback(async () => {
    if (!restaurantId) return
    setLoading(true)

    // Base query — deduplicated via distinct ID selection
    const base = () => supabase.from('ingredient_library')
      .select('*')
      .or(`restaurant_id.eq.${restaurantId},user_id.eq.${userId},user_id.is.null`)
      .eq('is_active', true)

    // Apply list filter
    const applyFilter = (q: ReturnType<typeof base>) => {
      const now = new Date()
      if (listFilter === 'null')    return q.is('nutrition_updated_at', null).eq('nutrition_excluded', false)
      if (listFilter === 'enriched') return q.not('nutrition_updated_at', 'is', null).eq('nutrition_excluded', false)
      if (listFilter === 'last7')   return q.gte('nutrition_updated_at', new Date(now.getTime()-7*86400000).toISOString()).eq('nutrition_excluded', false)
      if (listFilter === 'last30')  return q.gte('nutrition_updated_at', new Date(now.getTime()-30*86400000).toISOString()).eq('nutrition_excluded', false)
      if (listFilter === 'excluded') return q.eq('nutrition_excluded', true)
      return q // 'all'
    }

    const [pageData, allCountData, enrichCountData] = await Promise.all([
      applyFilter(base()).order('category').order('name').range(page * PAGE, (page + 1) * PAGE - 1),
      base().select('id'),
      base().not('nutrition_updated_at', 'is', null).select('id'),
    ])

    // Deduplicate by id
    const seen = new Set<string>()
    const unique = (pageData.data ?? []).filter((r: any) => {
      if (seen.has(r.id)) return false
      seen.add(r.id)
      return true
    })

    // Count filtered items for pagination
    let filteredRaw = allCountData.data ?? []
    const now2 = new Date()
    if (listFilter === 'null')     filteredRaw = filteredRaw.filter((r:any) => !r.nutrition_updated_at && !r.nutrition_excluded)
    if (listFilter === 'enriched') filteredRaw = filteredRaw.filter((r:any) => r.nutrition_updated_at && !r.nutrition_excluded)
    if (listFilter === 'last7')    filteredRaw = filteredRaw.filter((r:any) => r.nutrition_updated_at && new Date(r.nutrition_updated_at) >= new Date(now2.getTime()-7*86400000))
    if (listFilter === 'last30')   filteredRaw = filteredRaw.filter((r:any) => r.nutrition_updated_at && new Date(r.nutrition_updated_at) >= new Date(now2.getTime()-30*86400000))
    if (listFilter === 'excluded') filteredRaw = filteredRaw.filter((r:any) => r.nutrition_excluded)
    const filteredCount = filteredRaw.length

    // Deduplicate enrichCountData
    const enrichSeen = new Set<string>()
    const enrichUnique = (enrichCountData.data ?? []).filter((r:any) => {
      if (enrichSeen.has(r.id)) return false; enrichSeen.add(r.id); return true
    })
    const allSeen = new Set<string>()
    const allUnique = (allCountData.data ?? []).filter((r:any) => {
      if (allSeen.has(r.id)) return false; allSeen.add(r.id); return true
    })

    setItems(unique.map((r: any) => ({ ...r, _checked: false })))
    setTotalPages(Math.max(1, Math.ceil(filteredCount / PAGE)))
    setTotalAll(allUnique.length)
    setTotalEnrich(enrichUnique.length)
    setLoading(false)
  }, [restaurantId, userId, page, listFilter])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(0) }, [listFilter])

  // ── Selection ────────────────────────────────────────────────
  const checkedCount = useMemo(() => items.filter(r => r._checked).length, [items])
  const allChecked   = items.length > 0 && items.every(r => r._checked)
  const toggleAll    = () => setItems(prev => prev.map(r => ({ ...r, _checked: !allChecked })))
  const toggleItem   = (id: string) => setItems(prev => prev.map(r => r.id === id ? { ...r, _checked: !r._checked } : r))

  // ── USDA search ──────────────────────────────────────────────
  async function searchOne(item: IngRow) {
    const q = item._searchOverride?.trim() || item.name
    setItems(prev => prev.map(r => r.id === item.id ? { ...r, _searching: true, _showResults: false } : r))
    try {
      const res  = await fetch(`/api/usda/search?q=${encodeURIComponent(q)}&pageSize=5`)
      const data = await res.json()
      setItems(prev => prev.map(r => r.id === item.id
        ? { ...r, _searching: false, _results: data.foods ?? [], _showResults: true }
        : r))
    } catch {
      setItems(prev => prev.map(r => r.id === item.id ? { ...r, _searching: false } : r))
    }
  }

  // ── Bulk lookup ──────────────────────────────────────────────
  async function bulkLookup() {
    const selected = items.filter(r => r._checked)
    if (!selected.length) return
    setBulkRunning(true); setBulkProgress({ done: 0, total: selected.length })
    for (let i = 0; i < selected.length; i++) {
      const item = selected[i]
      const q = item._searchOverride?.trim() || item.name
      try {
        const res  = await fetch(`/api/usda/search?q=${encodeURIComponent(q)}&pageSize=5`)
        const data = await res.json()
        setItems(prev => prev.map(r => r.id === item.id
          ? { ...r, _results: data.foods ?? [], _showResults: true, _checked: false }
          : r))
      } catch { /* continue */ }
      setBulkProgress({ done: i + 1, total: selected.length })
      await new Promise(r => setTimeout(r, 120))
    }
    setBulkRunning(false); setBulkProgress(null)
  }

  // ── Apply USDA result ────────────────────────────────────────
  async function applyUsda(itemId: string, result: UsdaResult) {
    setSaving(itemId)
    await supabase.from('ingredient_library').update({
      calories_per_100g:  result.calories,
      protein_g_per_100g: result.protein_g,
      carbs_g_per_100g:   result.carbs_g,
      fat_g_per_100g:     result.fat_g,
      fiber_g_per_100g:   result.fiber_g,
      sodium_mg_per_100g: result.sodium_mg,
      usda_fdc_id:        result.fdcId,
      nutrition_verified: true,
      nutrition_updated_at: new Date().toISOString(),
    }).eq('id', itemId)
    setItems(prev => prev.filter(r => r.id !== itemId))
    setTotalEnrich(c => c + 1)
    setSaving(null)
  }

  // ── Save manual ──────────────────────────────────────────────
  async function saveManual(itemId: string, vals: Record<string, any>) {
    setSaving(itemId)
    await supabase.from('ingredient_library').update({
      ...vals, nutrition_verified: true, nutrition_updated_at: new Date().toISOString(),
    }).eq('id', itemId)
    setItems(prev => prev.filter(r => r.id !== itemId))
    setTotalEnrich(c => c + 1)
    setSaving(null)
  }

  // ── Toggle excluded ──────────────────────────────────────────
  async function toggleExclude(item: IngRow) {
    const newVal = !item.nutrition_excluded
    await supabase.from('ingredient_library').update({ nutrition_excluded: newVal }).eq('id', item.id)
    setItems(prev => prev.filter(r => r.id !== item.id))
  }

  // ── CSV export ───────────────────────────────────────────────
  function exportCsv() {
    const header = 'id,name,category,recipe_unit,grams_per_recipe_unit,calories_per_100g,protein_g_per_100g,carbs_g_per_100g,fat_g_per_100g,fiber_g_per_100g,sodium_mg_per_100g'
    const rows   = items.map(i => `"${i.id}","${i.name}","${i.category}","${i.recipe_unit}","${i.grams_per_recipe_unit ?? ''}","","","","","",""`)
    const blob   = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' })
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'nutrition_export.csv' })
    a.click()
  }

  const pct = totalAll > 0 ? Math.round(totalEnrich / totalAll * 100) : 0

  return (
    <div className="space-y-4">

      {/* Coverage bar */}
      <div className="bg-white rounded-xl border border-[--border] p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-[--text]">Nutrition coverage</span>
          <span className="text-xs text-[--muted]">{totalEnrich} / {totalAll} ingredients</span>
        </div>
        <div className="h-2 bg-[--surface-2] rounded-full overflow-hidden mb-1">
          <div className="h-full bg-[--green] rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>
        <div className="flex justify-between text-[10px] text-[--hint]">
          <span>{pct}% enriched</span>
          <button onClick={exportCsv} className="text-[--accent] hover:underline">↓ Export as CSV</button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <select value={listFilter} onChange={e => setListFilter(e.target.value as ListFilter)}
          className="text-xs border border-[--border-2] rounded-lg px-2.5 py-1.5 bg-white outline-none focus:border-[--accent]">
          {(Object.entries(FILTER_LABELS) as [ListFilter, string][]).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <div className="flex-1" />
        {checkedCount > 0 && (
          <button onClick={bulkLookup} disabled={bulkRunning}
            className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60 flex items-center gap-1.5">
            {bulkRunning && bulkProgress
              ? `🔍 ${bulkProgress.done}/${bulkProgress.total}…`
              : `🔍 USDA Lookup (${checkedCount})`}
          </button>
        )}
      </div>

      {/* List */}
      <div className="space-y-1.5">
        {loading ? (
          <div className="text-xs text-[--hint] text-center py-12">Loading…</div>
        ) : items.length === 0 ? (
          <div className="text-xs text-center py-12 text-[--muted]">No items match this filter.</div>
        ) : (
          <>
            {/* Select-all row */}
            <div className="flex items-center gap-3 px-4 py-1.5 bg-[--surface-2] rounded-lg border border-[--border] text-[10px] text-[--muted]">
              <input type="checkbox" checked={allChecked} onChange={toggleAll}
                className="accent-[--accent] w-3.5 h-3.5 cursor-pointer" />
              <span>{allChecked ? 'Deselect all' : `Select all ${items.length} on this page`}</span>
            </div>

            {items.map(item => (
              <div key={item.id} className={`bg-white rounded-xl border border-[--border] overflow-hidden ${item.nutrition_excluded ? 'opacity-60' : ''}`}>
                {/* Row */}
                <div className="flex items-center px-4 py-2.5 gap-3">
                  <input type="checkbox" checked={!!item._checked} onChange={() => toggleItem(item.id)}
                    className="accent-[--accent] w-3.5 h-3.5 flex-shrink-0 cursor-pointer" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-[--text] truncate">{item.name}</div>
                    <div className="text-[10px] text-[--hint] flex flex-wrap gap-2">
                      <span>{item.category}{item.sub_category ? ` › ${item.sub_category}` : ''}</span>
                      <span>· {item.recipe_unit} ({item.grams_per_recipe_unit ?? '?'}g)</span>
                      {item.nutrition_updated_at && <span className="text-green-600">· {fmtDate(item.nutrition_updated_at)}</span>}
                      {item.nutrition_excluded && <span className="text-orange-500">· Ignored</span>}
                    </div>
                  </div>
                  <div className="flex gap-1.5 flex-shrink-0 items-center">
                    <button onClick={() => setItems(prev => prev.map(r => r.id === item.id ? { ...r, _showSearch: !r._showSearch, _showResults: false, _editMode: false } : r))}
                      className="text-[11px] px-2 py-1 bg-blue-50 border border-blue-200 text-blue-700 rounded-lg hover:bg-blue-100 disabled:opacity-40"
                      disabled={bulkRunning}>
                      {item._searching ? '…' : '🔍 Lookup'}
                    </button>
                    <button onClick={() => setItems(prev => prev.map(r => r.id === item.id ? { ...r, _editMode: !r._editMode, _showResults: false, _showSearch: false } : r))}
                      className="text-[11px] px-2 py-1 border border-[--border-2] text-[--muted] rounded-lg hover:bg-[--surface-2]">✎</button>
                    <button onClick={() => toggleExclude(item)}
                      title={item.nutrition_excluded ? 'Un-ignore' : 'Ignore this ingredient'}
                      className={`text-[11px] px-2 py-1 rounded-lg border transition-colors ${item.nutrition_excluded ? 'bg-orange-50 border-orange-200 text-orange-600' : 'border-[--border-2] text-[--hint] hover:border-orange-300 hover:text-orange-500'}`}>
                      ⊘
                    </button>
                  </div>
                </div>

                {/* Search override panel */}
                {item._showSearch && (
                  <div className="border-t border-[--border] bg-[--surface-2] px-4 py-2 flex items-center gap-2">
                    <span className="text-[10px] text-[--muted] flex-shrink-0">Search USDA as:</span>
                    <input
                      defaultValue={item._searchOverride ?? item.name}
                      onChange={e => setItems(prev => prev.map(r => r.id === item.id ? { ...r, _searchOverride: e.target.value } : r))}
                      placeholder={item.name}
                      className="flex-1 text-xs border border-[--border-2] rounded-lg px-2.5 py-1.5 bg-white outline-none focus:border-[--accent]"
                      onKeyDown={e => e.key === 'Enter' && searchOne(item)}
                    />
                    <button onClick={() => searchOne(item)} disabled={item._searching}
                      className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60 flex-shrink-0">
                      {item._searching ? '…' : 'Search'}
                    </button>
                  </div>
                )}

                {/* USDA results */}
                {item._showResults && (
                  <div className="border-t border-[--border] bg-[--surface-2]">
                    {!item._results?.length ? (
                      <div className="px-4 py-3 text-xs text-[--hint]">No USDA results. Try the search override above.</div>
                    ) : item._results!.map(r => (
                      <div key={r.fdcId} className="flex items-center px-4 py-2 gap-3 border-b border-[--border] last:border-0 hover:bg-white">
                        <div className="flex-1 min-w-0">
                          <div className="text-[11px] font-medium text-[--text] truncate">{r.description}</div>
                          <div className="text-[9px] text-[--hint]">{r.dataType} · FDC #{r.fdcId}</div>
                          <div className="text-[10px] text-[--muted] mt-0.5 flex gap-2.5">
                            <span>Cal: <strong>{fmt(r.calories)}</strong></span>
                            <span>P: <strong>{fmt(r.protein_g)}g</strong></span>
                            <span>C: <strong>{fmt(r.carbs_g)}g</strong></span>
                            <span>F: <strong>{fmt(r.fat_g)}g</strong></span>
                            <span>Na: <strong>{fmt(r.sodium_mg)}mg</strong></span>
                          </div>
                        </div>
                        <button onClick={() => applyUsda(item.id, r)} disabled={saving === item.id}
                          className="text-[11px] px-2.5 py-1.5 bg-[--accent] text-white rounded-lg hover:bg-[--accent-dark] disabled:opacity-50 flex-shrink-0">
                          {saving === item.id ? '…' : '✓ Use'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Manual entry */}
                {item._editMode && (
                  <ManualForm item={item} onSave={vals => saveManual(item.id, vals)} saving={saving === item.id} />
                )}
              </div>
            ))}
          </>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
            className="text-xs px-3 py-1.5 border border-[--border-2] rounded-lg disabled:opacity-30 hover:bg-[--surface-2]">
            ← Prev
          </button>
          <span className="text-xs text-[--muted]">Page {page + 1} of {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
            className="text-xs px-3 py-1.5 border border-[--border-2] rounded-lg disabled:opacity-30 hover:bg-[--surface-2]">
            Next →
          </button>
        </div>
      )}
    </div>
  )
}

function ManualForm({ item, onSave, saving }: {
  item: IngRow; onSave: (v: Record<string,any>) => void; saving: boolean
}) {
  const [v, setV] = useState({
    calories_per_100g:    item.calories_per_100g    ?? '',
    protein_g_per_100g:   item.protein_g_per_100g   ?? '',
    carbs_g_per_100g:     item.carbs_g_per_100g     ?? '',
    fat_g_per_100g:       item.fat_g_per_100g       ?? '',
    fiber_g_per_100g:     item.fiber_g_per_100g     ?? '',
    sodium_mg_per_100g:   item.sodium_mg_per_100g   ?? '',
    grams_per_recipe_unit: item.grams_per_recipe_unit ?? '',
  })
  const fields = [
    { key: 'calories_per_100g',    label: 'Cal',    unit: 'kcal' },
    { key: 'protein_g_per_100g',   label: 'Protein', unit: 'g' },
    { key: 'carbs_g_per_100g',     label: 'Carbs',  unit: 'g' },
    { key: 'fat_g_per_100g',       label: 'Fat',    unit: 'g' },
    { key: 'fiber_g_per_100g',     label: 'Fiber',  unit: 'g' },
    { key: 'sodium_mg_per_100g',   label: 'Sodium', unit: 'mg' },
    { key: 'grams_per_recipe_unit', label: `g/${item.recipe_unit}`, unit: 'g' },
  ] as const
  return (
    <div className="border-t border-[--border] bg-[--surface-2] px-4 py-3">
      <div className="text-[10px] text-[--hint] mb-2">Per 100g values</div>
      <div className="grid grid-cols-4 sm:grid-cols-7 gap-2 mb-3">
        {fields.map(f => (
          <div key={f.key}>
            <label className="block text-[9px] text-[--hint] mb-0.5">{f.label} ({f.unit})</label>
            <input type="number" min="0" step="0.1" value={v[f.key]}
              onChange={e => setV(p => ({ ...p, [f.key]: e.target.value }))}
              className="w-full text-xs border border-[--border-2] rounded px-1.5 py-1 bg-white outline-none focus:border-[--accent]" />
          </div>
        ))}
      </div>
      <button onClick={() => onSave(Object.fromEntries(fields.map(f => [f.key, v[f.key] === '' ? null : parseFloat(String(v[f.key]))])))}
        disabled={saving}
        className="text-[11px] px-3 py-1.5 bg-[--accent] text-white rounded-lg hover:bg-[--accent-dark] disabled:opacity-50">
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  )
}
