'use client'
import { useState, useEffect, useMemo } from 'react'
import type { Recipe, MenuPricing, LibraryIngredient } from '@/lib/types'
import { createClient } from '@/lib/supabase'

interface RecipeRow {
  recipe: Recipe
  costPerServing: number
  lowestPrice: number | null
  highestPrice: number | null
  bestFoodCostPct: number | null   // at highest price (best case)
  worstFoodCostPct: number | null  // at lowest price (worst case)
  meetsTarget: boolean | null
  linkedCount: number
}

function computeCostPerServing(recipe: Recipe, library: LibraryIngredient[]): number {
  return recipe.ingredients.reduce((sum, ing) => {
    if (!ing.library_id) return sum
    const lib = library.find(l => l.id === ing.library_id)
    if (!lib?.purchase_unit_cost || !lib.unit_conversion) return sum
    const cpu = lib.purchase_unit_cost / lib.unit_conversion / (lib.trim_factor || 1)
    return sum + ing.amount * cpu
  }, 0) / (recipe.base_servings || 1)
}

function fmt$(n: number) { return `$${n.toFixed(2)}` }
function fmtPct(n: number) { return `${n.toFixed(1)}%` }
function margin(price: number, cost: number) { return ((price - cost) / price) * 100 }

interface Props {
  recipes: Recipe[]
  library: LibraryIngredient[]
  userId: string
}

export default function CostReport({ recipes, library, userId }: Props) {
  const supabase = createClient()
  const [pricing, setPricing] = useState<MenuPricing[]>([])
  const [loading, setLoading] = useState(true)
  const [sortBy, setSortBy]   = useState<'name' | 'cost' | 'fcp' | 'margin'>('fcp')
  const [filterType, setFilterType] = useState<'all' | 'food' | 'cocktail' | 'over-target'>('all')

  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data } = await supabase.from('menu_pricing').select('*')
        .eq('user_id', userId).eq('is_active', true)
      setPricing(data ?? [])
      setLoading(false)
    }
    load()
  }, [userId])

  const rows = useMemo<RecipeRow[]>(() => {
    return recipes.map(r => {
      const costPerServing = computeCostPerServing(r, library)
      const rPricing = pricing.filter(p => p.recipe_id === r.id)
      const prices = rPricing.map(p => p.price)
      const lowestPrice  = prices.length > 0 ? Math.min(...prices) : null
      const highestPrice = prices.length > 0 ? Math.max(...prices) : null
      const bestFCP  = highestPrice && costPerServing > 0 ? (costPerServing / highestPrice) * 100 : null
      const worstFCP = lowestPrice  && costPerServing > 0 ? (costPerServing / lowestPrice)  * 100 : null
      const target   = r.target_food_cost_pct
      const meetsTarget = bestFCP !== null && target ? bestFCP <= target : null
      const linkedCount = r.ingredients.filter(i => i.library_id).length

      return { recipe: r, costPerServing, lowestPrice, highestPrice, bestFoodCostPct: bestFCP, worstFoodCostPct: worstFCP, meetsTarget, linkedCount }
    })
  }, [recipes, library, pricing])

  const filtered = useMemo(() => rows.filter(row => {
    if (filterType === 'food')        return row.recipe.recipe_type === 'food'
    if (filterType === 'cocktail')    return row.recipe.recipe_type === 'cocktail'
    if (filterType === 'over-target') return row.meetsTarget === false
    return true
  }), [rows, filterType])

  const sorted = useMemo(() => [...filtered].sort((a, b) => {
    if (sortBy === 'name')   return a.recipe.name.localeCompare(b.recipe.name)
    if (sortBy === 'cost')   return b.costPerServing - a.costPerServing
    if (sortBy === 'fcp')    return (b.bestFoodCostPct ?? 999) - (a.bestFoodCostPct ?? 999)
    if (sortBy === 'margin') return (b.highestPrice ? margin(b.highestPrice, b.costPerServing) : -999) - (a.highestPrice ? margin(a.highestPrice, a.costPerServing) : -999)
    return 0
  }), [filtered, sortBy])

  // Summary stats
  const costsAvailable = rows.filter(r => r.costPerServing > 0)
  const overTarget     = rows.filter(r => r.meetsTarget === false).length
  const fullyCosted    = rows.filter(r => r.linkedCount === r.recipe.ingredients.length && r.linkedCount > 0).length
  const avgFCP         = costsAvailable.length > 0
    ? costsAvailable.reduce((s, r) => s + (r.bestFoodCostPct ?? 0), 0) / costsAvailable.filter(r => r.bestFoodCostPct !== null).length
    : null

  function fcpColor(pct: number | null, target: number | null | undefined): string {
    if (pct === null) return 'text-[--hint]'
    if (!target) return 'text-[--muted]'
    if (pct <= target) return 'text-[--green]'
    if (pct <= target * 1.1) return 'text-amber-600'
    return 'text-red-500'
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="bg-white border-b border-[--border] px-6 py-4">
        <h1 className="font-serif text-xl font-medium text-[--text] mb-4">Cost Report</h1>

        {/* Summary cards */}
        <div className="grid grid-cols-4 gap-3 mb-4">
          {[
            { label: 'Total recipes',  value: String(recipes.length),        sub: 'in cookbook' },
            { label: 'Fully costed',   value: String(fullyCosted),            sub: 'all ingredients linked' },
            { label: 'Avg food cost',  value: avgFCP ? fmtPct(avgFCP) : '—', sub: 'at menu price' },
            { label: 'Over target',    value: String(overTarget),             sub: overTarget > 0 ? '⚠ needs attention' : '✓ all on target' },
          ].map(s => (
            <div key={s.label} className="bg-[--surface-2] rounded-xl p-3">
              <div className="text-[10px] text-[--muted] uppercase tracking-wide mb-1">{s.label}</div>
              <div className={`text-lg font-medium leading-none ${s.label === 'Over target' && overTarget > 0 ? 'text-red-500' : 'text-[--text]'}`}>{s.value}</div>
              <div className="text-[10px] text-[--hint] mt-1">{s.sub}</div>
            </div>
          ))}
        </div>

        {/* Filter + sort */}
        <div className="flex gap-2 flex-wrap">
          <div className="flex bg-[--surface-2] rounded-lg p-0.5 gap-0.5">
            {(['all','food','cocktail','over-target'] as const).map(f => (
              <button key={f} onClick={() => setFilterType(f)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all capitalize ${filterType === f ? 'bg-white text-[--text] shadow-sm' : 'text-[--muted]'}`}>
                {f === 'over-target' ? '⚠ Over target' : f === 'all' ? `All (${rows.length})` : `${f === 'food' ? '🍽' : '🍸'} ${f}`}
              </button>
            ))}
          </div>
          <select value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)}
            className="px-2.5 py-1.5 text-xs border border-[--border-2] rounded-lg outline-none bg-white ml-auto">
            <option value="fcp">Sort: Food cost %</option>
            <option value="cost">Sort: Cost / serving</option>
            <option value="margin">Sort: Margin</option>
            <option value="name">Sort: Name</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading ? (
          <div className="text-center py-12 text-[--hint] text-sm">Loading pricing data…</div>
        ) : sorted.length === 0 ? (
          <div className="text-center py-16 text-[--muted]">
            <div className="text-4xl opacity-20 mb-3">📊</div>
            <p className="text-sm">No recipes match this filter.</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-[--border] overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-[--surface-2]">
                <tr>
                  {['Recipe','Type','Costed','Cost/srv','Price range','Food cost %','Best margin','Target',''].map(h => (
                    <th key={h} className="text-left py-2.5 px-3 text-[10px] font-semibold uppercase tracking-wide text-[--hint]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map(({ recipe: r, costPerServing, lowestPrice, highestPrice, bestFoodCostPct, worstFoodCostPct, meetsTarget, linkedCount }) => (
                  <tr key={r.id} className="border-t border-[--border] hover:bg-[--surface-2]">
                    <td className="py-2.5 px-3">
                      <div className="font-medium text-[--text]">{r.menu_name || r.name}</div>
                      {r.menu_name && r.menu_name !== r.name && <div className="text-[10px] text-[--hint]">{r.name}</div>}
                    </td>
                    <td className="py-2.5 px-3 text-[--muted]">
                      {r.recipe_type === 'cocktail' ? '🍸' : '🍽'}
                    </td>
                    <td className="py-2.5 px-3">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                        linkedCount === r.ingredients.length && linkedCount > 0
                          ? 'bg-[--green]/10 text-[--green]'
                          : linkedCount > 0 ? 'bg-amber-50 text-amber-600' : 'bg-[--surface-2] text-[--hint]'
                      }`}>
                        {linkedCount}/{r.ingredients.length}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 font-medium text-[--text]">
                      {costPerServing > 0 ? fmt$(costPerServing) : '—'}
                    </td>
                    <td className="py-2.5 px-3 text-[--muted]">
                      {lowestPrice && highestPrice
                        ? lowestPrice === highestPrice ? fmt$(lowestPrice) : `${fmt$(lowestPrice)} – ${fmt$(highestPrice)}`
                        : '—'}
                    </td>
                    <td className="py-2.5 px-3">
                      {bestFoodCostPct !== null ? (
                        <div>
                          <span className={`font-medium ${fcpColor(bestFoodCostPct, r.target_food_cost_pct)}`}>
                            {fmtPct(bestFoodCostPct)}
                          </span>
                          {worstFoodCostPct !== null && worstFoodCostPct !== bestFoodCostPct && (
                            <span className="text-[--hint] ml-1">– {fmtPct(worstFoodCostPct)}</span>
                          )}
                        </div>
                      ) : '—'}
                    </td>
                    <td className="py-2.5 px-3 text-[--muted]">
                      {highestPrice && costPerServing > 0 ? fmtPct(margin(highestPrice, costPerServing)) : '—'}
                    </td>
                    <td className="py-2.5 px-3">
                      {r.target_food_cost_pct ? (
                        <span className={`text-[10px] font-medium ${meetsTarget === true ? 'text-[--green]' : meetsTarget === false ? 'text-red-500' : 'text-[--hint]'}`}>
                          {meetsTarget === true ? `✓ ${r.target_food_cost_pct}%` : meetsTarget === false ? `⚠ ${r.target_food_cost_pct}%` : `${r.target_food_cost_pct}%`}
                        </span>
                      ) : <span className="text-[--hint]">—</span>}
                    </td>
                    <td className="py-2.5 px-3">
                      {meetsTarget === false && (
                        <span className="text-[10px] text-red-400 bg-red-50 px-1.5 py-0.5 rounded-full">needs review</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[10px] text-[--hint] mt-3 text-center">
          Food cost % is calculated at highest menu price (best case). Open any recipe → Costing tab to link ingredients and set prices.
        </p>
      </div>
    </div>
  )
}
