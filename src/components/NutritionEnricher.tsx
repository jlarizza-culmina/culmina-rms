'use client'
// src/components/NutritionEnricher.tsx
// Settings → Nutrition: batch USDA enrichment for ingredient library

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
}

type DateFilter = 'all' | 'null' | 'enriched' | 'last7' | 'last30'

const DATE_FILTER_LABELS: Record<DateFilter, string> = {
  all:      'All items',
  null:     'Never enriched',
  enriched: 'Has nutrition data',
  last7:    'Updated last 7 days',
  last30:   'Updated last 30 days',
}

function fmt(v: number | null | undefined) { return v == null ? '—' : String(Math.round(v * 10) / 10) }
function fmtDate(s: string | null | undefined) {
  if (!s) return null
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

interface Props { userId: string; restaurantId?: string }

export default function NutritionEnricher({ userId, restaurantId }: Props) {
  const supabase = createClient()
  const [items,       setItems]       = useState<IngRow[]>([])
  const [loading,     setLoading]     = useState(true)
  const [totalAll,    setTotalAll]    = useState(0)
  const [totalEnrich, setTotalEnrich] = useState(0)
  const [saving,      setSaving]      = useState<string | null>(null)
  const [dateFilter,  setDateFilter]  = useState<DateFilter>('null')
  const [showExcluded, setShowExcluded] = useState(false)
  const [page,        setPage]        = useState(0)
  const [bulkRunning, setBulkRunning] = useState(false)
  const [bulkProgress, setBulkProgress] = useState<{done: number; total: number} | null>(null)
  const PAGE = 50

  const load = useCallback(async () => {
    if (!restaurantId) return
    setLoading(true)

    let q = supabase.from('ingredient_library')
      .select('*')
      .or(`restaurant_id.eq.${restaurantId},user_id.eq.${userId},user_id.is.null`)
      .eq('is_active', true)

    if (!showExcluded) q = q.eq('nutrition_excluded', false)

    // Date filter
    const now = new Date()
    if (dateFilter === 'null')    q = q.is('nutrition_updated_at', null)
    if (dateFilter === 'enriched') q = q.not('nutrition_updated_at', 'is', null)
    if (dateFilter === 'last7')   q = q.gte('nutrition_updated_at', new Date(now.getTime() - 7*86400000).toISOString())
    if (dateFilter === 'last30')  q = q.gte('nutrition_updated_at', new Date(now.getTime() - 30*86400000).toISOString())

    const [{ data }, totals, enriched] = await Promise.all([
      q.order('category').order('name').range(page * PAGE, (page + 1) * PAGE - 1),
      supabase.from('ingredient_library').select('id', { count: 'exact', head: true })
        .or(`restaurant_id.eq.${restaurantId},user_id.eq.${userId},user_id.is.null`).eq('is_active', true),
      supabase.from('ingredient_library').select('id', { count: 'exact', head: true })
        .or(`restaurant_id.eq.${restaurantId},user_id.eq.${userId},user_id.is.null`)
        .eq('is_active', true).not('nutrition_updated_at', 'is', null),
    ])
    setItems((data ?? []).map(r => ({ ...r, _checked: false })))
    setTotalAll(totals.count ?? 0)
    setTotalEnrich(enriched.count ?? 0)
    setLoading(false)
  }, [restaurantId, userId, page, dateFilter, showExcluded])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(0) }, [dateFilter, showExcluded])

  // ── Selection helpers ────────────────────────────────────────
  const checkedIds = useMemo(() => new Set(items.filter(r => r._checked).map(r => r.id)), [items])
  const allChecked = items.length > 0 && items.every(r => r._checked)
  function toggleAll() { setItems(prev => prev.map(r => ({ ...r, _checked: !allChecked }))) }
  function toggleItem(id: string) { setItems(prev => prev.map(r => r.id === id ? { ...r, _checked: !r._checked } : r)) }

  // ── USDA per-item search ─────────────────────────────────────
  async function searchOne(item: IngRow) {
    setItems(prev => prev.map(r => r.id === item.id ? { ...r, _searching: true, _showResults: false } : r))
    try {
      const res  = await fetch(`/api/usda/search?q=${encodeURIComponent(item.name)}&pageSize=5`)
      const data = await res.json()
      setItems(prev => prev.map(r => r.id === item.id
        ? { ...r, _searching: false, _results: data.foods ?? [], _showResults: true }
        : r))
    } catch { setItems(prev => prev.map(r => r.id === item.id ? { ...r, _searching: false } : r)) }
  }

  // ── Bulk USDA lookup ─────────────────────────────────────────
  async function bulkLookup() {
    const selected = items.filter(r => r._checked)
    if (!selected.length) return
    setBulkRunning(true)
    setBulkProgress({ done: 0, total: selected.length })
    for (let i = 0; i < selected.length; i++) {
      const item = selected[i]
      try {
        const res  = await fetch(`/api/usda/search?q=${encodeURIComponent(item.name)}&pageSize=5`)
        const data = await res.json()
        setItems(prev => prev.map(r => r.id === item.id
          ? { ...r, _results: data.foods ?? [], _showResults: true, _checked: false }
          : r))
      } catch { /* continue */ }
      setBulkProgress({ done: i + 1, total: selected.length })
      await new Promise(r => setTimeout(r, 150)) // rate limit buffer
    }
    setBulkRunning(false)
    setBulkProgress(null)
  }

  // ── Apply USDA result ────────────────────────────────────────
  async function applyUsda(item: IngRow, result: UsdaResult) {
    setSaving(item.id)
    const patch = {
      calories_per_100g:  result.calories,
      protein_g_per_100g: result.protein_g,
      carbs_g_per_100g:   result.carbs_g,
      fat_g_per_100g:     result.fat_g,
      fiber_g_per_100g:   result.fiber_g,
      sodium_mg_per_100g: result.sodium_mg,
      usda_fdc_id:        result.fdcId,
      nutrition_verified: true,
      nutrition_updated_at: new Date().toISOString(),
    }
    await supabase.from('ingredient_library').update(patch).eq('id', item.id)
    setItems(prev => prev.filter(r => r.id !== item.id))
    setTotalEnrich(c => c + 1)
    setSaving(null)
  }

  // ── Save manual nutrition ────────────────────────────────────
  async function saveManual(item: IngRow, vals: Record<string, any>) {
    setSaving(item.id)
    await supabase.from('ingredient_library').update({
      ...vals,
      nutrition_verified:   true,
      nutrition_updated_at: new Date().toISOString(),
    }).eq('id', item.id)
    setItems(prev => prev.filter(r => r.id !== item.id))
    setTotalEnrich(c => c + 1)
    setSaving(null)
  }

  // ── Toggle excluded ──────────────────────────────────────────
  async function toggleExclude(item: IngRow) {
    const newVal = !item.nutrition_excluded
    await supabase.from('ingredient_library').update({ nutrition_excluded: newVal }).eq('id', item.id)
    setItems(prev => prev.map(r => r.id === item.id ? { ...r, nutrition_excluded: newVal } : r))
  }

  // ── CSV export ───────────────────────────────────────────────
  function exportCsv() {
    const header = 'id,name,category,recipe_unit,grams_per_recipe_unit,calories_per_100g,protein_g_per_100g,carbs_g_per_100g,fat_g_per_100g,fiber_g_per_100g,sodium_mg_per_100g'
    const rows = items.map(i =>
      `"${i.id}","${i.name}","${i.category}","${i.recipe_unit}","${i.grams_per_recipe_unit ?? ''}","","","","","",""`
    )
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' })
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'nutrition_export.csv' })
    a.click()
  }

  const pct = totalAll > 0 ? Math.round(totalEnrich / totalAll * 100) : 0

  return (
    <div className="space-y-4">

      {/* Coverage bar */}
      <div className="bg-white rounded-xl border border-[--border] p-4 flex-shrink-0">
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
      <div className="flex items-center gap-3 flex-wrap flex-shrink-0">
        {/* Date filter */}
        <select value={dateFilter} onChange={e => setDateFilter(e.target.value as DateFilter)}
          className="text-xs border border-[--border-2] rounded-lg px-2.5 py-1.5 bg-white outline-none focus:border-[--accent]">
          {(Object.entries(DATE_FILTER_LABELS) as [DateFilter, string][]).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>

        {/* Show excluded toggle */}
        <label className="flex items-center gap-1.5 text-xs text-[--muted] cursor-pointer">
          <input type="checkbox" checked={showExcluded} onChange={e => setShowExcluded(e.target.checked)}
            className="accent-[--accent] w-3.5 h-3.5" />
          Show excluded
        </label>

        <div className="flex-1" />

        {/* Bulk lookup button */}
        {checkedIds.size > 0 && (
          <button onClick={bulkLookup} disabled={bulkRunning}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60">
            {bulkRunning && bulkProgress
              ? `Looking up ${bulkProgress.done}/${bulkProgress.total}…`
              : `🔍 USDA Lookup (${checkedIds.size} selected)`}
          </button>
        )}
      </div>

      {/* List */}
      <div className="space-y-1.5">
        {loading ? (
          <div className="text-xs text-[--hint] text-center py-12">Loading…</div>
        ) : items.length === 0 ? (
          <div className="text-xs text-center py-12 text-[--muted]">
            {dateFilter === 'enriched' || dateFilter === 'last7' || dateFilter === 'last30'
              ? 'No items match this filter.'
              : pct === 100 ? '✓ All ingredients are enriched.' : 'No items on this page.'}
          </div>
        ) : (
          <>
            {/* Select-all row */}
            <div className="flex items-center gap-3 px-4 py-1.5 bg-[--surface-2] rounded-lg border border-[--border] text-[10px] text-[--muted]">
              <input type="checkbox" checked={allChecked} onChange={toggleAll}
                className="accent-[--accent] w-3.5 h-3.5 cursor-pointer" />
              <span>{allChecked ? 'Deselect all' : 'Select all on this page'}</span>
              <span className="ml-auto">{items.length} items</span>
            </div>

            {items.map(item => (
              <div key={item.id}
                className={`bg-white rounded-xl border overflow-hidden transition-colors ${item.nutrition_excluded ? 'border-[--border] opacity-60' : 'border-[--border]'}`}>
                {/* Row header */}
                <div className="flex items-center px-4 py-2.5 gap-3">
                  {/* Checkbox */}
                  <input type="checkbox" checked={!!item._checked}
                    onChange={() => toggleItem(item.id)}
                    disabled={!!item.nutrition_excluded}
                    className="accent-[--accent] w-3.5 h-3.5 cursor-pointer flex-shrink-0" />

                  {/* Name + meta */}
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-[--text] truncate">{item.name}</div>
                    <div className="text-[10px] text-[--hint] flex items-center gap-2 flex-wrap">
                      <span>{item.category}{item.sub_category ? ` › ${item.sub_category}` : ''}</span>
                      <span>·</span>
                      <span>recipe unit: {item.recipe_unit} ({item.grams_per_recipe_unit ?? '?'}g)</span>
                      {item.nutrition_updated_at && (
                        <span className="text-green-600">· Updated {fmtDate(item.nutrition_updated_at)}</span>
                      )}
                      {item.nutrition_excluded && (
                        <span className="text-orange-500">· Excluded</span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-1.5 flex-shrink-0 items-center">
                    <button onClick={() => searchOne(item)}
                      disabled={item._searching || bulkRunning || saving === item.id || !!item.nutrition_excluded}
                      className="text-[11px] px-2 py-1 bg-blue-50 border border-blue-200 text-blue-700 rounded-lg hover:bg-blue-100 disabled:opacity-40">
                      {item._searching ? '…' : '🔍 Lookup'}
                    </button>
                    <button onClick={() => setItems(prev => prev.map(r => r.id === item.id ? { ...r, _editMode: !r._editMode, _showResults: false } : r))}
                      disabled={!!item.nutrition_excluded}
                      className="text-[11px] px-2 py-1 border border-[--border-2] text-[--muted] rounded-lg hover:bg-[--surface-2] disabled:opacity-40">
                      ✎
                    </button>
                    {/* Exclude toggle */}
                    <button onClick={() => toggleExclude(item)}
                      title={item.nutrition_excluded ? 'Click to un-exclude' : 'Exclude from nutrition enrichment'}
                      className={`text-[11px] px-2 py-1 rounded-lg border transition-colors ${item.nutrition_excluded ? 'bg-orange-50 border-orange-200 text-orange-600 hover:bg-orange-100' : 'border-[--border-2] text-[--hint] hover:border-orange-300 hover:text-orange-500'}`}>
                      {item.nutrition_excluded ? '⊘ Excluded' : '⊘'}
                    </button>
                  </div>
                </div>

                {/* USDA results */}
                {item._showResults && (
                  <div className="border-t border-[--border] bg-[--surface-2]">
                    {!item._results?.length ? (
                      <div className="px-4 py-3 text-xs text-[--hint]">No USDA results. Try a shorter term.</div>
                    ) : (
                      <div className="divide-y divide-[--border]">
                        {item._results!.map(r => (
                          <div key={r.fdcId} className="flex items-center px-4 py-2 gap-3 hover:bg-white">
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
                            <button onClick={() => applyUsda(item, r)} disabled={saving === item.id}
                              className="text-[11px] px-2.5 py-1.5 bg-[--accent] text-white rounded-lg hover:bg-[--accent-dark] disabled:opacity-50 flex-shrink-0">
                              {saving === item.id ? '…' : '✓ Use'}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Manual entry */}
                {item._editMode && !item.nutrition_excluded && (
                  <ManualForm item={item} onSave={vals => saveManual(item, vals)} saving={saving === item.id} />
                )}
              </div>
            ))}
          </>
        )}
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-center gap-3 pt-1 flex-shrink-0">
        <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
          className="text-xs px-3 py-1.5 border border-[--border-2] rounded-lg disabled:opacity-30 hover:bg-[--surface-2]">
          ← Prev
        </button>
        <span className="text-xs text-[--muted]">Page {page + 1}</span>
        <button onClick={() => setPage(p => p + 1)} disabled={items.length < PAGE}
          className="text-xs px-3 py-1.5 border border-[--border-2] rounded-lg disabled:opacity-30 hover:bg-[--surface-2]">
          Next →
        </button>
      </div>
    </div>
  )
}

// ── Manual entry form ─────────────────────────────────────────
function ManualForm({ item, onSave, saving }: {
  item: IngRow; onSave: (v: Record<string, any>) => void; saving: boolean
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
    { key: 'calories_per_100g',    label: 'Calories', unit: 'kcal' },
    { key: 'protein_g_per_100g',   label: 'Protein',  unit: 'g' },
    { key: 'carbs_g_per_100g',     label: 'Carbs',    unit: 'g' },
    { key: 'fat_g_per_100g',       label: 'Fat',      unit: 'g' },
    { key: 'fiber_g_per_100g',     label: 'Fiber',    unit: 'g' },
    { key: 'sodium_mg_per_100g',   label: 'Sodium',   unit: 'mg' },
    { key: 'grams_per_recipe_unit', label: `g per ${item.recipe_unit}`, unit: 'g' },
  ] as const
  return (
    <div className="border-t border-[--border] bg-[--surface-2] px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-[--hint] mb-2">
        Per 100g values
      </div>
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
