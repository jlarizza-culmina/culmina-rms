'use client'
import { useState, useEffect, useMemo } from 'react'
import type { Recipe, LibraryIngredient, Vendor, MenuPricing, Daypart } from '@/lib/types'
import { createClient } from '@/lib/supabase'

const DAYPARTS: Daypart[] = ['all','breakfast','lunch','dinner','aperitivo','late-night']
const DAYPART_LABELS: Record<Daypart, string> = {
  all: 'All day', breakfast: 'Breakfast', lunch: 'Lunch',
  dinner: 'Dinner', aperitivo: 'Aperitivo', 'late-night': 'Late Night',
}

function costPerRecipeUnit(lib: LibraryIngredient): number | null {
  if (!lib.purchase_unit_cost || !lib.unit_conversion) return null
  return lib.purchase_unit_cost / lib.unit_conversion / (lib.trim_factor || 1)
}

function computeLineCost(amount: number, libId: string | null | undefined, library: LibraryIngredient[]): number | null {
  if (!libId) return null
  const lib = library.find(l => l.id === libId)
  if (!lib) return null
  const cpu = costPerRecipeUnit(lib)
  if (cpu === null) return null
  return amount * cpu
}

function fmt$(n: number) { return `$${n.toFixed(2)}` }
function fmtPct(n: number) { return `${n.toFixed(1)}%` }

function foodCostPct(costPerServing: number, price: number): number {
  if (!price) return 0
  return (costPerServing / price) * 100
}

function statusColor(pct: number, target: number | null): string {
  if (!target) return 'text-[--muted]'
  if (pct <= target) return 'text-[--green]'
  if (pct <= target * 1.1) return 'text-amber-600'
  return 'text-red-500'
}

interface Props {
  recipe: Recipe
  servings: number
  library: LibraryIngredient[]
  vendors: Vendor[]
  userId: string
  onUpdateRecipe: (id: string, updates: Partial<Recipe>) => Promise<void>
}

const blankPricing = (recipeId: string, userId: string): Omit<MenuPricing, 'id' | 'created_at'> => ({
  recipe_id: recipeId, user_id: userId,
  daypart: 'all', serving_label: '', serving_multiplier: 1,
  price: 0, is_active: true, notes: '',
})

export default function CostingTab({ recipe, servings, library, vendors, userId, onUpdateRecipe }: Props) {
  const supabase = createClient()
  const ratio = servings / recipe.base_servings

  const [pricing, setPricing]   = useState<MenuPricing[]>([])
  const [loadingP, setLoadingP] = useState(true)
  const [editP, setEditP]       = useState<Partial<MenuPricing> | null>(null)
  const [savingP, setSavingP]   = useState(false)
  const [editTarget, setEditTarget] = useState(false)
  const [targetVal, setTargetVal]   = useState(String(recipe.target_food_cost_pct ?? ''))

  // Load menu pricing
  useEffect(() => {
    async function load() {
      setLoadingP(true)
      const { data } = await supabase.from('menu_pricing').select('*')
        .eq('recipe_id', recipe.id).eq('is_active', true).order('daypart').order('price')
      setPricing(data ?? [])
      setLoadingP(false)
    }
    load()
  }, [recipe.id])

  // Auto-match: suggest library entries by name for unlinked ingredients
  function suggestMatch(ingName: string): LibraryIngredient | null {
    const lower = ingName.toLowerCase()
    return library.find(l =>
      l.name.toLowerCase() === lower ||
      l.name.toLowerCase().includes(lower) ||
      lower.includes(l.name.toLowerCase().split(' ')[0])
    ) ?? null
  }

  // Cost computations
  const costBreakdown = useMemo(() => recipe.ingredients.map(ing => {
    const lineCost = computeLineCost(ing.amount * ratio, ing.library_id, library)
    const lib = ing.library_id ? library.find(l => l.id === ing.library_id) : null
    const suggestion = !ing.library_id ? suggestMatch(ing.name) : null
    return { ing, lineCost, lib, suggestion }
  }), [recipe.ingredients, library, ratio])

  const totalCost     = costBreakdown.reduce((s, r) => s + (r.lineCost ?? 0), 0)
  const costPerServ   = servings > 0 ? totalCost / servings : 0
  const linkedCount   = costBreakdown.filter(r => r.ing.library_id).length
  const unlinkedCount = recipe.ingredients.length - linkedCount
  const target        = recipe.target_food_cost_pct

  // Link ingredient to library entry
  async function linkIngredient(ingredientId: string, libraryId: string | null) {
    const updated = recipe.ingredients.map(i =>
      i.id === ingredientId ? { ...i, library_id: libraryId } : i
    )
    await onUpdateRecipe(recipe.id, { ingredients: updated })
  }

  // Save target food cost %
  async function saveTarget() {
    const v = parseFloat(targetVal)
    await onUpdateRecipe(recipe.id, { target_food_cost_pct: isNaN(v) ? null : v })
    setEditTarget(false)
  }

  // Menu pricing CRUD
  async function savePricing() {
    if (!editP || !editP.price) return
    setSavingP(true)
    const payload = {
      recipe_id: recipe.id, user_id: userId,
      daypart: editP.daypart || 'all',
      serving_label: editP.serving_label || '',
      serving_multiplier: editP.serving_multiplier ?? 1,
      price: editP.price!,
      is_active: true,
      notes: editP.notes || '',
    }
    if (editP.id) {
      const { data } = await supabase.from('menu_pricing').update(payload).eq('id', editP.id).select().single()
      if (data) setPricing(prev => prev.map(p => p.id === data.id ? data : p))
    } else {
      const { data } = await supabase.from('menu_pricing').insert(payload).select().single()
      if (data) setPricing(prev => [...prev, data])
    }
    setSavingP(false)
    setEditP(null)
  }

  async function deletePricing(id: string) {
    await supabase.from('menu_pricing').update({ is_active: false }).eq('id', id)
    setPricing(prev => prev.filter(p => p.id !== id))
  }

  return (
    <div className="space-y-6">

      {/* ── Summary stats ── */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Total cost', value: linkedCount > 0 ? fmt$(totalCost) : '—', sub: `${servings} servings` },
          { label: 'Cost / serving', value: linkedCount > 0 ? fmt$(costPerServ) : '—', sub: 'at current scale' },
          { label: 'Ingredients costed', value: `${linkedCount}/${recipe.ingredients.length}`, sub: unlinkedCount > 0 ? `${unlinkedCount} unlinked` : 'fully costed ✓' },
          { label: 'Target food cost', value: target ? `${target}%` : 'Not set', sub: 'click to edit' },
        ].map(s => (
          <div key={s.label} className="bg-[--surface-2] rounded-xl p-3" onClick={s.label === 'Target food cost' ? () => setEditTarget(true) : undefined}
            style={s.label === 'Target food cost' ? { cursor: 'pointer' } : {}}>
            <div className="text-[10px] text-[--muted] uppercase tracking-wide mb-1">{s.label}</div>
            <div className="text-lg font-medium text-[--text] leading-none">{s.value}</div>
            <div className="text-[10px] text-[--hint] mt-1">{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Target editor */}
      {editTarget && (
        <div className="flex items-center gap-2 p-3 bg-[--accent-light] rounded-xl border border-orange-200">
          <span className="text-xs text-[--accent] font-medium">Target food cost %</span>
          <input type="number" step="0.5" min="0" max="100" value={targetVal}
            onChange={e => setTargetVal(e.target.value)}
            className="w-20 px-2 py-1 text-xs border border-[--border-2] rounded-lg outline-none focus:border-[--accent]"
            autoFocus onKeyDown={e => { if (e.key === 'Enter') saveTarget(); if (e.key === 'Escape') setEditTarget(false) }} />
          <span className="text-xs text-[--muted]">%</span>
          <button onClick={saveTarget} className="px-3 py-1 bg-[--accent] text-white text-xs rounded-lg hover:bg-[--accent-dark]">Save</button>
          <button onClick={() => setEditTarget(false)} className="text-xs text-[--muted] underline">Cancel</button>
        </div>
      )}

      {/* ── Ingredient cost breakdown ── */}
      <div>
        <div className="flex items-baseline justify-between mb-3">
          <h3 className="font-serif text-sm font-medium text-[--text]">
            Ingredient Costs
            <span className="font-sans text-[11px] font-normal text-[--muted] ml-2">
              {unlinkedCount > 0 ? `${unlinkedCount} ingredient${unlinkedCount !== 1 ? 's' : ''} not linked to library` : 'all linked ✓'}
            </span>
          </h3>
        </div>

        <div className="bg-white rounded-xl border border-[--border] overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-[--surface-2]">
              <tr>
                {['Ingredient','Amount','Library entry','$/unit','Line cost'].map(h => (
                  <th key={h} className="text-left py-2 px-3 text-[10px] font-semibold uppercase tracking-wide text-[--hint]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {costBreakdown.map(({ ing, lineCost, lib, suggestion }) => (
                <tr key={ing.id} className="border-t border-[--border]">
                  <td className="py-2 px-3 font-medium text-[--text]">{ing.name}</td>
                  <td className="py-2 px-3 text-[--muted]">
                    {ing.amount * ratio !== ing.amount
                      ? `${(ing.amount * ratio).toFixed(2)} ${ing.unit}`
                      : `${ing.amount} ${ing.unit}`}
                  </td>
                  <td className="py-2 px-3">
                    <select
                      value={ing.library_id || ''}
                      onChange={e => linkIngredient(ing.id, e.target.value || null)}
                      className={`text-xs border rounded-lg px-2 py-1 outline-none max-w-[180px] w-full bg-white
                        ${ing.library_id ? 'border-[--border-2] text-[--text]' : 'border-dashed border-orange-300 text-orange-500'}`}>
                      <option value="">{suggestion ? `⚡ Suggested: ${suggestion.name}` : '— Link to library —'}</option>
                      {suggestion && <option value={suggestion.id}>✓ {suggestion.name}</option>}
                      {library.filter(l => l.id !== suggestion?.id).map(l => (
                        <option key={l.id} value={l.id}>{l.name} ({l.recipe_unit})</option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 px-3 text-[--muted]">
                    {lib ? `$${(costPerRecipeUnit(lib) ?? 0).toFixed(4)}/${lib.recipe_unit}` : '—'}
                  </td>
                  <td className={`py-2 px-3 font-medium ${lineCost !== null ? 'text-[--text]' : 'text-[--hint]'}`}>
                    {lineCost !== null ? fmt$(lineCost) : '—'}
                  </td>
                </tr>
              ))}
              {/* Totals row */}
              <tr className="border-t-2 border-[--border-2] bg-[--surface-2]">
                <td colSpan={4} className="py-2 px-3 text-xs font-semibold text-[--text] text-right">
                  Total · Cost per serving ({servings} servings)
                </td>
                <td className="py-2 px-3 font-semibold text-[--text]">
                  {linkedCount > 0 ? `${fmt$(totalCost)} · ${fmt$(costPerServ)}` : '—'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Menu Pricing ── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-serif text-sm font-medium text-[--text]">Menu Pricing</h3>
          <button onClick={() => setEditP(blankPricing(recipe.id, userId))}
            className="px-3 py-1.5 text-xs font-medium bg-[--accent] text-white rounded-lg hover:bg-[--accent-dark] transition-colors">
            + Add price point
          </button>
        </div>

        {loadingP ? (
          <div className="text-xs text-[--hint] py-4 text-center">Loading…</div>
        ) : pricing.length === 0 ? (
          <div className="bg-[--surface-2] rounded-xl p-6 text-center text-[--muted] text-xs">
            No price points yet. Add pricing by daypart to calculate food cost %.
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-[--border] overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-[--surface-2]">
                <tr>
                  {['Daypart','Label','Price','Food cost %','Margin','vs target',''].map(h => (
                    <th key={h} className="text-left py-2 px-3 text-[10px] font-semibold uppercase tracking-wide text-[--hint]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pricing.map(p => {
                  const fcp: number | null = costPerServ > 0 ? foodCostPct(costPerServ * p.serving_multiplier, p.price) : null
                  const margin: number | null = p.price > 0 ? p.price - costPerServ * p.serving_multiplier : null
                  return (
                    <tr key={p.id} className="border-t border-[--border] group">
                      <td className="py-2 px-3 text-[--text]">{DAYPART_LABELS[p.daypart as Daypart] ?? p.daypart}</td>
                      <td className="py-2 px-3 text-[--muted]">{p.serving_label || '—'}</td>
                      <td className="py-2 px-3 font-medium text-[--text]">${p.price.toFixed(2)}</td>
                      <td className={`py-2 px-3 font-medium ${fcp != null ? statusColor(fcp, target) : 'text-[--hint]'}`}>
                        {fcp != null ? fmtPct(fcp) : '—'}
                      </td>
                      <td className="py-2 px-3 text-[--muted]">
                        {margin != null ? fmt$(margin) : '—'}
                      </td>
                      <td className="py-2 px-3">
                        {fcp != null && target ? (
                          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${fcp <= target ? 'bg-[--green]/10 text-[--green]' : 'bg-red-50 text-red-500'}`}>
                            {fcp <= target ? `✓ ${fmtPct(target - fcp)} under` : `↑ ${fmtPct(fcp - target)} over`}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="py-2 px-3">
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => setEditP({ ...p })}
                            className="px-2 py-0.5 text-[10px] border border-[--border-2] rounded text-[--muted] hover:text-[--text]">Edit</button>
                          <button onClick={() => deletePricing(p.id)}
                            className="px-2 py-0.5 text-[10px] border border-red-200 rounded text-red-400 hover:text-red-600">✕</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Pricing modal ── */}
      {editP && (
        <div className="fixed inset-0 bg-black/35 flex items-center justify-center z-50"
          onClick={e => { if (e.target === e.currentTarget) setEditP(null) }}>
          <div className="bg-white rounded-2xl p-6 w-[420px] max-w-[94vw] fade-in shadow-lg">
            <h2 className="font-serif text-lg font-medium text-[--text] mb-4">
              {editP.id ? 'Edit Price Point' : 'Add Price Point'}
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-[--muted] mb-1">Daypart</label>
                <select value={editP.daypart || 'all'} onChange={e => setEditP(p => ({ ...p!, daypart: e.target.value as Daypart }))}
                  className="fi w-full bg-white">
                  {DAYPARTS.map(d => <option key={d} value={d}>{DAYPART_LABELS[d]}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-[--muted] mb-1">Serving label</label>
                <input value={editP.serving_label || ''} onChange={e => setEditP(p => ({ ...p!, serving_label: e.target.value }))}
                  placeholder="¼ lb, single, flight of 3" className="fi w-full" />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-[--muted] mb-1">Price ($)</label>
                <input type="number" step="0.50" min="0"
                  value={editP.price || ''} onChange={e => setEditP(p => ({ ...p!, price: parseFloat(e.target.value) || 0 }))}
                  placeholder="18.00" className="fi w-full" autoFocus />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-[--muted] mb-1">
                  Serving multiplier
                  <span className="text-[--hint] ml-1">(vs base {recipe.base_servings})</span>
                </label>
                <input type="number" step="0.25" min="0.1"
                  value={editP.serving_multiplier ?? 1} onChange={e => setEditP(p => ({ ...p!, serving_multiplier: parseFloat(e.target.value) || 1 }))}
                  className="fi w-full" />
              </div>
              {costPerServ > 0 && editP.price && (
                <div className="col-span-2 bg-[--surface-2] rounded-lg p-3 text-xs">
                  <span className="text-[--muted]">Food cost: </span>
                  <span className={`font-medium ${statusColor(foodCostPct(costPerServ * (editP.serving_multiplier ?? 1), editP.price), target)}`}>
                    {fmtPct(foodCostPct(costPerServ * (editP.serving_multiplier ?? 1), editP.price))}
                  </span>
                  <span className="text-[--muted] ml-3">Margin: </span>
                  <span className="font-medium text-[--text]">
                    {fmt$(editP.price - costPerServ * (editP.serving_multiplier ?? 1))}
                  </span>
                  {target && <span className="text-[--hint] ml-3">Target: {target}%</span>}
                </div>
              )}
              <div className="col-span-2">
                <label className="block text-[11px] font-medium text-[--muted] mb-1">Notes</label>
                <input value={editP.notes || ''} onChange={e => setEditP(p => ({ ...p!, notes: e.target.value }))}
                  placeholder="e.g. bar snack size, family style" className="fi w-full" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-[--border]">
              <button onClick={() => setEditP(null)} className="px-4 py-2 text-xs text-[--muted] border border-[--border-2] rounded-lg hover:bg-[--surface-2]">Cancel</button>
              <button onClick={savePricing} disabled={savingP || !editP.price}
                className="px-4 py-2 text-xs font-medium bg-[--accent] text-white rounded-lg hover:bg-[--accent-dark] disabled:opacity-50 flex items-center gap-1.5 min-w-[70px] justify-center">
                {savingP ? <><span className="spinner" />Saving…</> : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
