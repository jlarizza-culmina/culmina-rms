'use client'
// src/components/NutritionEnricher.tsx
// Settings → Nutrition: batch USDA enrichment for ingredient library

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import type { LibraryIngredient } from '@/lib/types'

interface UsdaResult {
  fdcId: number
  description: string
  dataType: string
  brandOwner?: string | null
  calories: number | null
  protein_g: number | null
  carbs_g: number | null
  fat_g: number | null
  fiber_g: number | null
  sodium_mg: number | null
}

interface IngRow extends LibraryIngredient {
  _searching?: boolean
  _results?: UsdaResult[]
  _showResults?: boolean
  _editMode?: boolean
}

interface Props {
  userId: string
  restaurantId?: string
}

function fmt(v: number | null | undefined): string {
  if (v == null) return '—'
  return String(Math.round(v * 10) / 10)
}

export default function NutritionEnricher({ userId, restaurantId }: Props) {
  const supabase = createClient()
  const [items,     setItems]     = useState<IngRow[]>([])
  const [loading,   setLoading]   = useState(true)
  const [total,     setTotal]     = useState(0)
  const [covered,   setCovered]   = useState(0)
  const [saving,    setSaving]    = useState<string | null>(null)
  const [page,      setPage]      = useState(0)
  const PAGE_SIZE = 20

  const load = useCallback(async () => {
    if (!restaurantId) return
    setLoading(true)
    const [{ data: all }, { data: unenriched }] = await Promise.all([
      supabase.from('ingredient_library').select('id')
        .or(`restaurant_id.eq.${restaurantId},user_id.eq.${userId},user_id.is.null`)
        .eq('is_active', true),
      supabase.from('ingredient_library')
        .select('*')
        .or(`restaurant_id.eq.${restaurantId},user_id.eq.${userId},user_id.is.null`)
        .eq('is_active', true)
        .is('calories_per_100g', null)
        .order('category').order('name')
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1),
    ])
    const totalCount    = all?.length ?? 0
    const unenrichedAll = await supabase.from('ingredient_library')
      .select('id', { count: 'exact' })
      .or(`restaurant_id.eq.${restaurantId},user_id.eq.${userId},user_id.is.null`)
      .eq('is_active', true)
      .is('calories_per_100g', null)
    setTotal(totalCount)
    setCovered(totalCount - (unenrichedAll.count ?? 0))
    setItems(unenriched ?? [])
    setLoading(false)
  }, [restaurantId, userId, page])

  useEffect(() => { load() }, [load])

  async function searchUsda(item: IngRow) {
    setItems(prev => prev.map(r => r.id === item.id ? { ...r, _searching: true, _showResults: false } : r))
    try {
      const res  = await fetch(`/api/usda/search?q=${encodeURIComponent(item.name)}&pageSize=5`)
      const data = await res.json()
      setItems(prev => prev.map(r => r.id === item.id
        ? { ...r, _searching: false, _results: data.foods ?? [], _showResults: true }
        : r
      ))
    } catch {
      setItems(prev => prev.map(r => r.id === item.id ? { ...r, _searching: false } : r))
    }
  }

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
    }
    await supabase.from('ingredient_library').update(patch).eq('id', item.id)
    setItems(prev => prev.filter(r => r.id !== item.id))
    setCovered(c => c + 1)
    setSaving(null)
  }

  async function saveManual(item: IngRow, vals: Partial<LibraryIngredient>) {
    setSaving(item.id)
    await supabase.from('ingredient_library').update({ ...vals, nutrition_verified: true }).eq('id', item.id)
    setItems(prev => prev.filter(r => r.id !== item.id))
    setCovered(c => c + 1)
    setSaving(null)
  }

  function exportCsv() {
    const header = 'id,name,category,recipe_unit,grams_per_recipe_unit,calories_per_100g,protein_g_per_100g,carbs_g_per_100g,fat_g_per_100g,fiber_g_per_100g,sodium_mg_per_100g'
    const rows = items.map(i =>
      `"${i.id}","${i.name}","${i.category}","${i.recipe_unit}","${i.grams_per_recipe_unit ?? ''}","","","","","",""`
    )
    const csv  = [header, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = 'ingredient_nutrition_export.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const pct = total > 0 ? Math.round(covered / total * 100) : 0

  return (
    <div className="space-y-5">
      {/* Coverage bar */}
      <div className="bg-white rounded-xl border border-[--border] p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-[--text]">Nutrition coverage</span>
          <span className="text-xs text-[--muted]">{covered} / {total} ingredients</span>
        </div>
        <div className="h-2 bg-[--surface-2] rounded-full overflow-hidden mb-1">
          <div className="h-full bg-[--green] rounded-full transition-all duration-500"
            style={{ width: `${pct}%` }} />
        </div>
        <div className="flex justify-between text-[10px] text-[--hint]">
          <span>{pct}% of library has nutrition data</span>
          <button onClick={exportCsv} className="text-[--accent] hover:underline">
            ↓ Export unenriched as CSV
          </button>
        </div>
      </div>

      {/* Instructions */}
      <div className="text-[11px] text-[--muted] bg-[--surface-2] rounded-lg px-3 py-2 space-y-1">
        <div>Click <strong>USDA Lookup</strong> to search the USDA FoodData Central database and auto-fill nutrition data.</div>
        <div>Click <strong>Manual</strong> to enter values yourself. All values are per 100g.</div>
      </div>

      {/* List */}
      {loading ? (
        <div className="text-xs text-[--hint] text-center py-8">Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-xs text-center py-8 text-[--muted]">
          {covered === total ? '✓ All ingredients have nutrition data.' : 'No items on this page.'}
        </div>
      ) : (
        <div className="space-y-2">
          {items.map(item => (
            <div key={item.id}
              className="bg-white rounded-xl border border-[--border] overflow-hidden">
              {/* Item header */}
              <div className="flex items-center px-4 py-2.5 gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-[--text] truncate">{item.name}</div>
                  <div className="text-[10px] text-[--hint]">{item.category}{item.sub_category ? ` › ${item.sub_category}` : ''} · recipe unit: {item.recipe_unit} ({item.grams_per_recipe_unit ?? '?'}g)</div>
                </div>
                <div className="flex gap-1.5 flex-shrink-0">
                  <button onClick={() => searchUsda(item)} disabled={item._searching || saving === item.id}
                    className="text-[11px] px-2.5 py-1 bg-blue-50 border border-blue-200 text-blue-700 rounded-lg hover:bg-blue-100 disabled:opacity-50 flex items-center gap-1">
                    {item._searching ? '…' : '🔍 USDA Lookup'}
                  </button>
                  <button onClick={() => setItems(prev => prev.map(r => r.id === item.id ? { ...r, _editMode: !r._editMode, _showResults: false } : r))}
                    className="text-[11px] px-2.5 py-1 border border-[--border-2] text-[--muted] rounded-lg hover:bg-[--surface-2]">
                    ✎ Manual
                  </button>
                </div>
              </div>

              {/* USDA results */}
              {item._showResults && (
                <div className="border-t border-[--border] bg-[--surface-2]">
                  {!item._results?.length ? (
                    <div className="px-4 py-3 text-xs text-[--hint]">No USDA results found. Try a shorter or different search term.</div>
                  ) : (
                    <div className="divide-y divide-[--border]">
                      {item._results!.map(r => (
                        <div key={r.fdcId} className="flex items-center px-4 py-2 gap-3 hover:bg-white transition-colors">
                          <div className="flex-1 min-w-0">
                            <div className="text-[11px] font-medium text-[--text] truncate">{r.description}</div>
                            <div className="text-[9px] text-[--hint]">{r.dataType}{r.brandOwner ? ` · ${r.brandOwner}` : ''} · FDC #{r.fdcId}</div>
                            <div className="text-[10px] text-[--muted] mt-0.5 flex gap-3">
                              <span>Cal: <strong>{fmt(r.calories)}</strong></span>
                              <span>P: <strong>{fmt(r.protein_g)}g</strong></span>
                              <span>C: <strong>{fmt(r.carbs_g)}g</strong></span>
                              <span>F: <strong>{fmt(r.fat_g)}g</strong></span>
                              <span>Na: <strong>{fmt(r.sodium_mg)}mg</strong></span>
                            </div>
                          </div>
                          <button onClick={() => applyUsda(item, r)} disabled={saving === item.id}
                            className="text-[11px] px-3 py-1.5 bg-[--accent] text-white rounded-lg hover:bg-[--accent-dark] disabled:opacity-50 flex-shrink-0">
                            {saving === item.id ? '…' : '✓ Use this'}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Manual entry */}
              {item._editMode && (
                <ManualNutritionForm item={item} onSave={vals => saveManual(item, vals)} saving={saving === item.id} />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      <div className="flex items-center justify-center gap-3 pt-2">
        <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
          className="text-xs px-3 py-1.5 border border-[--border-2] rounded-lg disabled:opacity-30 hover:bg-[--surface-2]">
          ← Prev
        </button>
        <span className="text-xs text-[--muted]">Page {page + 1}</span>
        <button onClick={() => setPage(p => p + 1)} disabled={items.length < PAGE_SIZE}
          className="text-xs px-3 py-1.5 border border-[--border-2] rounded-lg disabled:opacity-30 hover:bg-[--surface-2]">
          Next →
        </button>
      </div>
    </div>
  )
}

// ── Manual entry form ─────────────────────────────────────────
function ManualNutritionForm({ item, onSave, saving }: {
  item: IngRow
  onSave: (vals: Partial<LibraryIngredient>) => void
  saving: boolean
}) {
  const [vals, setVals] = useState({
    calories_per_100g:    item.calories_per_100g   ?? '',
    protein_g_per_100g:   item.protein_g_per_100g  ?? '',
    carbs_g_per_100g:     item.carbs_g_per_100g    ?? '',
    fat_g_per_100g:       item.fat_g_per_100g      ?? '',
    fiber_g_per_100g:     item.fiber_g_per_100g    ?? '',
    sodium_mg_per_100g:   item.sodium_mg_per_100g  ?? '',
    grams_per_recipe_unit: item.grams_per_recipe_unit ?? '',
  })

  const fields = [
    { key: 'calories_per_100g',   label: 'Calories',   unit: 'kcal' },
    { key: 'protein_g_per_100g',  label: 'Protein',    unit: 'g' },
    { key: 'carbs_g_per_100g',    label: 'Carbs',      unit: 'g' },
    { key: 'fat_g_per_100g',      label: 'Fat',        unit: 'g' },
    { key: 'fiber_g_per_100g',    label: 'Fiber',      unit: 'g' },
    { key: 'sodium_mg_per_100g',  label: 'Sodium',     unit: 'mg' },
    { key: 'grams_per_recipe_unit', label: `g per ${item.recipe_unit}`, unit: 'g' },
  ] as const

  return (
    <div className="border-t border-[--border] bg-[--surface-2] px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-[--hint] mb-2">
        Enter values per 100g
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-7 gap-2 mb-3">
        {fields.map(f => (
          <div key={f.key}>
            <label className="block text-[9px] text-[--hint] mb-0.5">{f.label} ({f.unit})</label>
            <input type="number" min="0" step="0.1"
              value={vals[f.key]}
              onChange={e => setVals(p => ({ ...p, [f.key]: e.target.value }))}
              className="w-full text-xs border border-[--border-2] rounded px-1.5 py-1 bg-white outline-none focus:border-[--accent]" />
          </div>
        ))}
      </div>
      <button onClick={() => onSave(Object.fromEntries(
        Object.entries(vals).map(([k, v]) => [k, v === '' ? null : parseFloat(String(v))])
      ) as Partial<LibraryIngredient>)}
        disabled={saving}
        className="text-[11px] px-3 py-1.5 bg-[--accent] text-white rounded-lg hover:bg-[--accent-dark] disabled:opacity-50">
        {saving ? 'Saving…' : 'Save nutrition data'}
      </button>
    </div>
  )
}
