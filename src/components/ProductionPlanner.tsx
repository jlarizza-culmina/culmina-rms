'use client'
import { useState, useMemo, useCallback, useRef } from 'react'
import type { Recipe, LibraryIngredient, Vendor, ShoppingListItem, BatchSuggestion, Daypart } from '@/lib/types'
import { createClient } from '@/lib/supabase'

// ── Unit conversion ───────────────────────────────────────────
const TO_IMPERIAL: Record<string, { unit: string; factor: number }> = {
  g:   { unit: 'oz',    factor: 0.035274  },
  kg:  { unit: 'lb',    factor: 2.20462   },
  ml:  { unit: 'fl oz', factor: 0.033814  },
  l:   { unit: 'qt',    factor: 1.056688  },
}
const TO_METRIC: Record<string, { unit: string; factor: number }> = {
  oz:    { unit: 'g',   factor: 28.3495  },
  lb:    { unit: 'kg',  factor: 0.453592 },
  'fl oz': { unit: 'ml', factor: 29.5735 },
  qt:    { unit: 'l',   factor: 0.946353 },
  tsp:   { unit: 'ml',  factor: 4.92892  },
  tbsp:  { unit: 'ml',  factor: 14.7868  },
  cup:   { unit: 'ml',  factor: 236.588  },
}

function convertUnit(amount: number, unit: string, useMetric: boolean): { amount: number; unit: string } {
  if (useMetric && TO_METRIC[unit.toLowerCase()]) {
    const c = TO_METRIC[unit.toLowerCase()]
    return { amount: amount * c.factor, unit: c.unit }
  }
  if (!useMetric && TO_IMPERIAL[unit.toLowerCase()]) {
    const c = TO_IMPERIAL[unit.toLowerCase()]
    return { amount: amount * c.factor, unit: c.unit }
  }
  return { amount, unit }
}

function fmtAmt(n: number): string {
  if (n === 0) return '0'
  if (n >= 100) return String(Math.round(n))
  if (n >= 10)  return String(Math.round(n * 10) / 10)
  if (n >= 1)   return String(Math.round(n * 100) / 100)
  // fractions for small amounts
  const fracs: [number, string][] = [[.125,'⅛'],[.25,'¼'],[.333,'⅓'],[.5,'½'],[.667,'⅔'],[.75,'¾']]
  for (const [f, sym] of fracs) if (Math.abs(n - f) < 0.04) return sym
  return String(Math.round(n * 100) / 100)
}

function fmt$(n: number): string { return `$${n.toFixed(2)}` }

// ── Batch logic ───────────────────────────────────────────────
function suggestBatches(covers: number, baseServings: number): BatchSuggestion {
  if (covers <= 0 || baseServings <= 0) return { batches: 0, total_portions: 0, waste: 0, multiplier: 0 }
  const batches = Math.ceil(covers / baseServings)
  const total_portions = batches * baseServings
  return { batches, total_portions, waste: total_portions - covers, multiplier: batches }
}

// ── Bar categories ────────────────────────────────────────────
const BAR_CATS = new Set(['spirits', 'mixers', 'beverages'])

// ── Shopping list generation ──────────────────────────────────
function generateList(
  recipes: Recipe[],
  covers: Record<string, number>,
  wastePct: number,
  library: LibraryIngredient[],
  vendors: Vendor[]
): { kitchen: ShoppingListItem[]; bar: ShoppingListItem[] } {
  const acc: Record<string, ShoppingListItem> = {}
  const wasteMultiplier = 1 + wastePct / 100

  recipes.forEach(recipe => {
    const c = covers[recipe.id] ?? 0
    if (c <= 0) return
    const { multiplier } = suggestBatches(c, recipe.base_servings)
    if (multiplier <= 0) return

    recipe.ingredients.forEach(ing => {
      const key = `${ing.name.toLowerCase()}::${ing.unit}`
      const lib = ing.library_id ? library.find(l => l.id === ing.library_id) : null
      const vendor = lib?.vendor_id ? vendors.find(v => v.id === lib.vendor_id) : null
      const cpu = lib?.purchase_unit_cost && lib.unit_conversion
        ? lib.purchase_unit_cost / lib.unit_conversion / (lib.trim_factor || 1)
        : null

      if (!acc[key]) {
        acc[key] = {
          key, name: ing.name,
          category: ing.category || 'other',
          is_bar: BAR_CATS.has(ing.category),
          total_recipe_amount: 0, unit: ing.unit,
          library_id: ing.library_id, vendor_id: lib?.vendor_id ?? null,
          vendor_name: vendor?.name,
          purchase_unit: lib?.purchase_unit,
          unit_cost: cpu, recipe_names: [],
        }
      }

      acc[key].total_recipe_amount += ing.amount * multiplier
      if (!acc[key].recipe_names.includes(recipe.name)) acc[key].recipe_names.push(recipe.name)
    })
  })

  // Compute purchase amounts with waste buffer + trim
  Object.values(acc).forEach(item => {
    const lib = item.library_id ? library.find(l => l.id === item.library_id) : null
    if (lib?.unit_conversion && lib.trim_factor) {
      item.purchase_amount = (item.total_recipe_amount / lib.unit_conversion / lib.trim_factor) * wasteMultiplier
    }
    if (item.unit_cost) item.total_cost = item.total_recipe_amount * item.unit_cost * wasteMultiplier
  })

  const sortFn = (a: ShoppingListItem, b: ShoppingListItem) => {
    const vA = a.vendor_name ?? 'zzz'
    const vB = b.vendor_name ?? 'zzz'
    if (vA !== vB) return vA.localeCompare(vB)
    return a.name.localeCompare(b.name)
  }

  const all = Object.values(acc)
  return { kitchen: all.filter(i => !i.is_bar).sort(sortFn), bar: all.filter(i => i.is_bar).sort(sortFn) }
}

// ── Date helpers ──────────────────────────────────────────────
function getWeekStart(offset = 0): string {
  const d = new Date()
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1) + offset * 7
  d.setDate(diff)
  return d.toISOString().split('T')[0]
}

function getWeekEnd(start: string): string {
  const d = new Date(start)
  d.setDate(d.getDate() + 6)
  return d.toISOString().split('T')[0]
}

function isOnMenu(recipe: Recipe, startDate: string, endDate: string): boolean {
  if (recipe.is_sub_recipe) return false
  if (recipe.is_active === false) return false
  const rStart = recipe.menu_start_date
  const rEnd   = recipe.menu_end_date
  if (!rStart && !rEnd) return true // no dates = always on menu
  if (rStart && rStart > endDate)   return false
  if (rEnd   && rEnd   < startDate) return false
  return true
}

// ── Props ─────────────────────────────────────────────────────
interface Props {
  recipes: Recipe[]
  library: LibraryIngredient[]
  vendors: Vendor[]
  userId: string
}

const CAT_LABELS: Record<string, string> = {
  produce:'🥦 Produce', meat:'🥩 Meat', seafood:'🐟 Seafood', dairy:'🧀 Dairy',
  bakery:'🍞 Bakery', pantry:'🥫 Pantry', spices:'🌿 Spices',
  spirits:'🍶 Spirits', mixers:'🍋 Mixers', frozen:'❄️ Frozen',
  beverages:'🧃 Beverages', other:'📦 Other',
}

const DAYPARTS: { value: Daypart; label: string }[] = [
  { value: 'all', label: 'All day' },
  { value: 'breakfast', label: 'Breakfast' },
  { value: 'lunch', label: 'Lunch' },
  { value: 'dinner', label: 'Dinner' },
  { value: 'aperitivo', label: 'Aperitivo' },
  { value: 'late-night', label: 'Late Night' },
]

export default function ProductionPlanner({ recipes, library, vendors, userId }: Props) {
  const supabase = createClient()
  const printRef = useRef<HTMLDivElement>(null)

  // ── Step state ────────────────────────────────────────────
  const [step, setStep]           = useState<'setup' | 'list'>('setup')
  const [startDate, setStartDate] = useState(getWeekStart())
  const [endDate, setEndDate]     = useState(getWeekEnd(getWeekStart()))
  const [covers, setCovers]       = useState<Record<string, number>>({})
  const [wastePct, setWastePct]   = useState(10)
  const [listTab, setListTab]     = useState<'kitchen' | 'bar'>('kitchen')
  const [useMetric, setUseMetric] = useState(false)
  const [saving, setSaving]       = useState(false)
  const [savedName, setSavedName] = useState('')
  const [showSaveForm, setShowSaveForm] = useState(false)

  // ── Active menu recipes for selected dates ─────────────────
  const menuRecipes = useMemo(() =>
    recipes.filter(r => isOnMenu(r, startDate, endDate)),
  [recipes, startDate, endDate])

  // ── Generated list (only when on step 'list') ──────────────
  const { kitchen, bar } = useMemo(() =>
    step === 'list' ? generateList(menuRecipes, covers, wastePct, library, vendors)
    : { kitchen: [], bar: [] },
  [step, menuRecipes, covers, wastePct, library, vendors])

  const totalCoveredRecipes = Object.values(covers).filter((v): v is number => Number(v) > 0).length
  const kitchenCost = kitchen.reduce((s, i) => s + (i.total_cost ?? 0), 0)
  const barCost     = bar.reduce((s, i) => s + (i.total_cost ?? 0), 0)

  // ── Cover input handler ────────────────────────────────────
  const setCover = useCallback((recipeId: string, val: number) => {
    setCovers(prev => ({ ...prev, [recipeId]: Math.max(0, val) }))
  }, [])

  // ── Quick-fill helpers ─────────────────────────────────────
  function fillAll(n: number) {
    const m: Record<string, number> = {}
    menuRecipes.forEach(r => { m[r.id] = n })
    setCovers(m)
  }

  // ── Save to Supabase ───────────────────────────────────────
  async function saveList() {
    if (!savedName.trim()) return
    setSaving(true)
    const allItems = [...kitchen, ...bar]
    const { data: listRow, error } = await supabase
      .from('shopping_lists')
      .insert({
        user_id: userId,
        name: savedName.trim(),
        list_date: startDate,
        list_type: bar.length > 0 && kitchen.length > 0 ? 'both' : bar.length > 0 ? 'bar' : 'kitchen',
        date_from: startDate,
        date_to: endDate,
        status: 'draft',
        notes: `${totalCoveredRecipes} recipes · ${wastePct}% waste buffer`,
      })
      .select()
      .single()

    if (!error && listRow) {
      const items = allItems.map((item, i) => ({
        shopping_list_id: listRow.id,
        user_id: userId,
        ingredient_name: item.name,
        category: item.category,
        library_id: item.library_id ?? null,
        vendor_id: item.vendor_id ?? null,
        recipe_quantity: item.total_recipe_amount,
        recipe_unit: item.unit,
        purchase_quantity: item.purchase_amount ?? null,
        purchase_unit: item.purchase_unit ?? '',
        unit_cost: item.unit_cost ?? null,
        total_cost: item.total_cost ?? null,
        is_checked: false,
        sort_order: i,
      }))
      await supabase.from('shopping_list_items').insert(items)
    }
    setSaving(false)
    setShowSaveForm(false)
    setSavedName('')
    alert(`Saved "${savedName.trim()}" to your shopping lists.`)
  }

  // ── Print ──────────────────────────────────────────────────
  function printList() {
    const activeList = listTab === 'kitchen' ? kitchen : bar
    const title = `${listTab === 'kitchen' ? 'Kitchen' : 'Bar'} Shopping List — ${startDate} to ${endDate}`
    const rows = activeList.map(item => {
      const conv = convertUnit(item.total_recipe_amount, item.unit, useMetric)
      const purchConv = item.purchase_amount && item.purchase_unit
        ? convertUnit(item.purchase_amount, item.purchase_unit, useMetric)
        : null
      return `
        <tr>
          <td>${item.name}</td>
          <td>${item.recipe_names.join(', ')}</td>
          <td>${fmtAmt(conv.amount)} ${conv.unit}</td>
          <td>${purchConv ? `${fmtAmt(purchConv.amount)} ${purchConv.unit}` : '—'}</td>
          <td>${item.vendor_name ?? '—'}</td>
          <td>${item.total_cost ? fmt$(item.total_cost) : '—'}</td>
          <td>&nbsp;</td>
        </tr>`
    }).join('')

    const groups: Record<string, typeof activeList> = {}
    activeList.forEach(item => {
      const v = item.vendor_name ?? 'No vendor'
      ;(groups[v] = groups[v] ?? []).push(item)
    })

    const groupedRows = Object.entries(groups).map(([vendor, items]) => `
      <tr class="vendor-header"><td colspan="7">${vendor}</td></tr>
      ${items.map(item => {
        const conv = convertUnit(item.total_recipe_amount, item.unit, useMetric)
        const purchConv = item.purchase_amount && item.purchase_unit
          ? convertUnit(item.purchase_amount, item.purchase_unit, useMetric)
          : null
        return `<tr>
          <td><input type="checkbox"> ${item.name}</td>
          <td class="small">${item.recipe_names.join(', ')}</td>
          <td>${fmtAmt(conv.amount)} ${conv.unit}</td>
          <td>${purchConv ? `${fmtAmt(purchConv.amount)} ${purchConv.unit}` : '—'}</td>
          <td>${item.total_cost ? fmt$(item.total_cost) : '—'}</td>
          <td class="notes">&nbsp;</td>
        </tr>`
      }).join('')}
    `).join('')

    const win = window.open('', '_blank')
    if (!win) return
    win.document.write(`
      <!DOCTYPE html><html><head>
      <title>${title}</title>
      <style>
        body { font-family: 'Georgia', serif; font-size: 11px; margin: 20px; color: #201C18; }
        h1 { font-size: 16px; margin-bottom: 4px; }
        h2 { font-size: 12px; color: #7A7568; margin-bottom: 16px; font-weight: normal; }
        table { width: 100%; border-collapse: collapse; }
        th { text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em; color: #B0AB9E; border-bottom: 1px solid #ddd; padding: 4px 8px 4px 4px; }
        td { padding: 5px 8px 5px 4px; border-bottom: 0.5px solid #eee; vertical-align: top; }
        .vendor-header td { background: #F8F5F0; font-weight: bold; font-size: 10px; padding: 6px 4px; border-top: 1px solid #ddd; }
        .small { font-size: 9px; color: #7A7568; }
        .notes { width: 120px; }
        input[type=checkbox] { margin-right: 4px; }
        @media print { body { margin: 10px; } }
      </style>
      </head><body>
      <h1>${title}</h1>
      <h2>${totalCoveredRecipes} recipes · ${wastePct}% waste buffer · ${useMetric ? 'Metric' : 'Imperial'}</h2>
      <table>
        <tr>
          <th>Ingredient</th><th>Recipes</th>
          <th>Recipe qty</th><th>Order qty</th>
          <th>Est. cost</th><th>Notes</th>
        </tr>
        ${groupedRows}
      </table>
      ${kitchenCost > 0 || barCost > 0 ? `<p style="margin-top:12px;font-size:10px;color:#7A7568;">
        Estimated ${listTab} cost: <strong>${fmt$(listTab === 'kitchen' ? kitchenCost : barCost)}</strong>
      </p>` : ''}
      </body></html>`)
    win.document.close()
    win.print()
  }

  // ── Render: Step 1 — Setup ────────────────────────────────
  if (step === 'setup') {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="bg-white border-b border-[--border] px-6 py-4">
          <h1 className="font-serif text-xl font-medium text-[--text] mb-4">Production Planner</h1>

          {/* Date range + waste buffer */}
          <div className="flex gap-4 items-end flex-wrap mb-4">
            <div>
              <label className="block text-[11px] font-medium text-[--muted] mb-1">Week starting</label>
              <input type="date" value={startDate}
                onChange={e => { setStartDate(e.target.value); setEndDate(getWeekEnd(e.target.value)) }}
                className="px-3 py-1.5 text-xs border border-[--border-2] rounded-lg outline-none focus:border-[--accent] bg-white" />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-[--muted] mb-1">Week ending</label>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                className="px-3 py-1.5 text-xs border border-[--border-2] rounded-lg outline-none focus:border-[--accent] bg-white" />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-[--muted] mb-1">
                Waste buffer
                <span className="text-[--hint] ml-1 normal-case">(extra to order)</span>
              </label>
              <div className="flex items-center gap-2">
                <input type="number" min="0" max="30" step="5" value={wastePct}
                  onChange={e => setWastePct(Number(e.target.value))}
                  className="w-16 px-2 py-1.5 text-xs border border-[--border-2] rounded-lg outline-none focus:border-[--accent]" />
                <span className="text-xs text-[--muted]">%</span>
              </div>
            </div>
            <div className="flex gap-1.5 ml-auto">
              <button onClick={() => fillAll(50)}
                className="px-3 py-1.5 text-xs border border-[--border-2] rounded-lg text-[--muted] hover:bg-[--surface-2]">
                Fill all: 50
              </button>
              <button onClick={() => fillAll(0)}
                className="px-3 py-1.5 text-xs border border-[--border-2] rounded-lg text-[--muted] hover:bg-[--surface-2]">
                Clear all
              </button>
            </div>
          </div>

          {/* Quick-week nav */}
          <div className="flex gap-1.5">
            {[-1, 0, 1, 2].map(offset => {
              const ws = getWeekStart(offset)
              const we = getWeekEnd(ws)
              const label = offset === -1 ? 'Last week' : offset === 0 ? 'This week' : offset === 1 ? 'Next week' : 'In 2 weeks'
              return (
                <button key={offset}
                  onClick={() => { setStartDate(ws); setEndDate(we) }}
                  className={`px-3 py-1 text-[11px] rounded-md transition-colors border ${startDate === ws ? 'bg-[--accent-light] border-[--accent] text-[--accent]' : 'border-[--border] text-[--muted] hover:bg-[--surface-2]'}`}>
                  {label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Recipe cover inputs */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {menuRecipes.length === 0 ? (
            <div className="text-center py-16 text-[--muted]">
              <div className="text-4xl opacity-20 mb-3">📅</div>
              <p className="text-sm font-medium mb-1">No active menu items for this period</p>
              <p className="text-xs max-w-xs mx-auto">Recipes without date restrictions always appear here. Add start/stop dates to recipes in the Cookbook to filter by week.</p>
            </div>
          ) : (
            <>
              <div className="flex items-baseline gap-2 mb-4">
                <h2 className="font-serif text-sm font-medium text-[--text]">
                  Active menu — {menuRecipes.length} recipes
                </h2>
                <span className="text-[11px] text-[--muted]">
                  Enter expected covers for the week
                </span>
              </div>

              <div className="grid grid-cols-1 gap-3">
                {menuRecipes.map(recipe => {
                  const c = covers[recipe.id] ?? 0
                  const batch = suggestBatches(c, recipe.base_servings)
                  return (
                    <div key={recipe.id}
                      className="flex items-center gap-4 bg-white rounded-xl border border-[--border] px-4 py-3">

                      {/* Recipe info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-[--text] truncate">
                            {recipe.recipe_type === 'cocktail' ? '🍸' : '🍽'} {recipe.name}
                          </span>
                          {recipe.is_sub_recipe && (
                            <span className="text-[10px] bg-[--surface-2] text-[--hint] px-1.5 py-0.5 rounded-full">sub-recipe</span>
                          )}
                        </div>
                        <div className="text-[10px] text-[--muted] mt-0.5">
                          Base: {recipe.base_servings} servings · {recipe.prep_time + recipe.cook_time}min
                          {recipe.menu_start_date && ` · from ${recipe.menu_start_date}`}
                          {recipe.menu_end_date   && ` · to ${recipe.menu_end_date}`}
                        </div>
                      </div>

                      {/* Cover input */}
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <label className="text-[11px] text-[--muted] whitespace-nowrap">Covers</label>
                        <div className="flex items-center border border-[--border-2] rounded-lg overflow-hidden">
                          <button onClick={() => setCover(recipe.id, c - (c <= 10 ? 1 : 10))}
                            className="w-7 h-7 text-[--muted] hover:bg-[--surface-2] text-sm flex items-center justify-center border-r border-[--border]">−</button>
                          <input type="number" min="0" value={c || ''}
                            onChange={e => setCover(recipe.id, parseInt(e.target.value) || 0)}
                            placeholder="0"
                            className="w-14 text-center text-xs py-1 outline-none bg-white" />
                          <button onClick={() => setCover(recipe.id, c + (c < 10 ? 1 : 10))}
                            className="w-7 h-7 text-[--muted] hover:bg-[--surface-2] text-sm flex items-center justify-center border-l border-[--border]">+</button>
                        </div>
                      </div>

                      {/* Batch suggestion */}
                      <div className="flex-shrink-0 min-w-[120px] text-right">
                        {c > 0 ? (
                          <div>
                            <span className="text-xs font-medium text-[--accent]">
                              {batch.batches} batch{batch.batches !== 1 ? 'es' : ''} of {recipe.base_servings}
                            </span>
                            <div className="text-[10px] text-[--muted] mt-0.5">
                              = {batch.total_portions} portions
                              {batch.waste > 0 && <span className="text-[--hint] ml-1">({batch.waste} extra)</span>}
                            </div>
                          </div>
                        ) : (
                          <span className="text-[10px] text-[--hint]">not scheduled</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>

        {/* Footer action */}
        <div className="px-6 py-3 bg-white border-t border-[--border] flex items-center gap-3">
          <div className="text-xs text-[--muted]">
            {totalCoveredRecipes > 0
              ? `${totalCoveredRecipes} recipe${totalCoveredRecipes !== 1 ? 's' : ''} scheduled · ${Object.values(covers).reduce((s: number, v) => s + Number(v), 0)} total covers`
              : 'No covers entered yet'}
          </div>
          <button
            onClick={() => setStep('list')}
            disabled={totalCoveredRecipes === 0}
            className="ml-auto px-5 py-2 bg-[--accent] text-white text-xs font-medium rounded-lg hover:bg-[--accent-dark] disabled:opacity-40 transition-colors">
            Generate Shopping Lists →
          </button>
        </div>
      </div>
    )
  }

  // ── Render: Step 2 — Shopping Lists ──────────────────────
  const activeList = listTab === 'kitchen' ? kitchen : bar
  const activeCost = listTab === 'kitchen' ? kitchenCost : barCost

  // Group by vendor
  const byVendor = useMemo(() => {
    const g: Record<string, ShoppingListItem[]> = {}
    activeList.forEach(item => {
      const key = item.vendor_name ?? '⚪ No vendor assigned'
      ;(g[key] = g[key] ?? []).push(item)
    })
    return g
  }, [activeList])

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="bg-white border-b border-[--border] px-6 py-4">
        <div className="flex items-center gap-3 mb-3">
          <button onClick={() => setStep('setup')}
            className="text-xs text-[--muted] hover:text-[--text] flex items-center gap-1">
            ← Back to covers
          </button>
          <h1 className="font-serif text-xl font-medium text-[--text]">Shopping Lists</h1>
          <div className="text-xs text-[--muted] ml-1">
            {startDate} → {endDate} · {totalCoveredRecipes} recipes · {wastePct}% buffer
          </div>
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-4 gap-3 mb-3">
          {[
            { label: 'Kitchen items', value: String(kitchen.length), sub: `est. ${kitchenCost > 0 ? fmt$(kitchenCost) : '—'}` },
            { label: 'Bar items',     value: String(bar.length),     sub: `est. ${barCost > 0 ? fmt$(barCost) : '—'}` },
            { label: 'Total est. cost', value: kitchenCost + barCost > 0 ? fmt$(kitchenCost + barCost) : '—', sub: 'linked items only' },
            { label: 'Vendors',       value: String(new Set(activeList.map(i => i.vendor_name).filter(Boolean)).size), sub: 'on this list' },
          ].map(s => (
            <div key={s.label} className="bg-[--surface-2] rounded-xl p-3">
              <div className="text-[10px] text-[--muted] uppercase tracking-wide mb-1">{s.label}</div>
              <div className="text-base font-medium text-[--text] leading-none">{s.value}</div>
              <div className="text-[10px] text-[--hint] mt-1">{s.sub}</div>
            </div>
          ))}
        </div>

        {/* Controls row */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Kitchen / Bar toggle */}
          <div className="flex bg-[--surface-2] rounded-lg p-0.5 gap-0.5">
            <button onClick={() => setListTab('kitchen')}
              className={`px-4 py-1.5 text-xs font-medium rounded-md transition-all ${listTab === 'kitchen' ? 'bg-white text-[--text] shadow-sm' : 'text-[--muted]'}`}>
              🔪 Kitchen ({kitchen.length})
            </button>
            <button onClick={() => setListTab('bar')}
              className={`px-4 py-1.5 text-xs font-medium rounded-md transition-all ${listTab === 'bar' ? 'bg-white text-[--text] shadow-sm' : 'text-[--muted]'}`}>
              🍸 Bar ({bar.length})
            </button>
          </div>

          {/* Metric/Imperial toggle */}
          <button onClick={() => setUseMetric(m => !m)}
            className={`px-3 py-1.5 text-xs font-medium border rounded-lg transition-colors ${useMetric ? 'bg-[--accent-light] border-[--accent] text-[--accent]' : 'border-[--border-2] text-[--muted] hover:bg-[--surface-2]'}`}>
            {useMetric ? 'Metric ✓' : 'Imperial'} → {useMetric ? 'Switch to Imperial' : 'Switch to Metric'}
          </button>

          {/* Actions */}
          <div className="flex gap-1.5 ml-auto">
            <button onClick={printList}
              className="px-3 py-1.5 text-xs border border-[--border-2] rounded-lg text-[--muted] hover:bg-[--surface-2]">
              🖨 Print
            </button>
            <button onClick={() => setShowSaveForm(s => !s)}
              className="px-3 py-1.5 text-xs bg-[--accent] text-white rounded-lg hover:bg-[--accent-dark]">
              💾 Save list
            </button>
          </div>
        </div>

        {/* Save form */}
        {showSaveForm && (
          <div className="mt-3 flex items-center gap-2 p-3 bg-[--accent-light] rounded-xl border border-orange-200">
            <span className="text-xs text-[--accent] font-medium whitespace-nowrap">List name</span>
            <input
              value={savedName}
              onChange={e => setSavedName(e.target.value)}
              placeholder={`Kitchen list — week of ${startDate}`}
              className="flex-1 px-2.5 py-1.5 text-xs border border-[--border-2] rounded-lg outline-none focus:border-[--accent]"
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter') saveList(); if (e.key === 'Escape') setShowSaveForm(false) }}
            />
            <button onClick={saveList} disabled={saving || !savedName.trim()}
              className="px-3 py-1.5 bg-[--accent] text-white text-xs rounded-lg hover:bg-[--accent-dark] disabled:opacity-50 flex items-center gap-1">
              {saving ? <><span className="spinner" />Saving…</> : 'Save'}
            </button>
            <button onClick={() => setShowSaveForm(false)} className="text-xs text-[--muted] underline">Cancel</button>
          </div>
        )}
      </div>

      {/* List content */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {activeList.length === 0 ? (
          <div className="text-center py-16 text-[--muted]">
            <div className="text-4xl opacity-20 mb-3">{listTab === 'bar' ? '🍸' : '🔪'}</div>
            <p className="text-sm">No {listTab} ingredients found.</p>
            <p className="text-xs mt-1">
              {listTab === 'bar'
                ? 'Bar ingredients have categories: spirits, mixers, or beverages.'
                : 'Kitchen ingredients are all non-bar categories.'}
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {(Object.entries(byVendor) as [string, typeof byVendor[string]][]).map(([vendorName, items]) => (
              <div key={vendorName}>
                {/* Vendor header */}
                <div className="flex items-center gap-3 mb-3">
                  <div className="text-xs font-semibold text-[--text]">{vendorName}</div>
                  <div className="flex-1 h-px bg-[--border]" />
                  <div className="text-[10px] text-[--hint]">{items.length} items</div>
                  {items.some(i => i.total_cost) && (
                    <div className="text-[10px] text-[--accent] font-medium">
                      {fmt$(items.reduce((s, i) => s + (i.total_cost ?? 0), 0))}
                    </div>
                  )}
                </div>

                {/* Items */}
                <div className="bg-white rounded-xl border border-[--border] overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-[--surface-2]">
                      <tr>
                        {['','Ingredient','For recipes','Recipe qty','Order qty','Cost',''].map((h,i) => (
                          <th key={i} className="text-left py-2 px-3 text-[10px] font-semibold uppercase tracking-wide text-[--hint]">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {items.map(item => {
                        const recipeConv = convertUnit(item.total_recipe_amount, item.unit, useMetric)
                        const purchConv  = item.purchase_amount && item.purchase_unit
                          ? convertUnit(item.purchase_amount, item.purchase_unit, useMetric)
                          : null
                        return (
                          <tr key={item.key} className="border-t border-[--border] hover:bg-[--surface-2]">
                            <td className="py-2.5 px-3 w-6">
                              <div className="w-4 h-4 rounded border border-[--border-2]" />
                            </td>
                            <td className="py-2.5 px-3">
                              <div className="font-medium text-[--text]">{item.name}</div>
                              <div className="text-[10px] text-[--hint] mt-0.5">{CAT_LABELS[item.category] ?? item.category}</div>
                            </td>
                            <td className="py-2.5 px-3 text-[--muted] text-[11px]">
                              {item.recipe_names.slice(0,2).join(', ')}
                              {item.recipe_names.length > 2 && ` +${item.recipe_names.length - 2} more`}
                            </td>
                            <td className="py-2.5 px-3 font-medium text-[--text]">
                              {fmtAmt(recipeConv.amount)} {recipeConv.unit}
                            </td>
                            <td className="py-2.5 px-3">
                              {purchConv ? (
                                <span className="font-medium text-[--accent]">
                                  {fmtAmt(purchConv.amount)} {purchConv.unit}
                                </span>
                              ) : (
                                <span className="text-[--hint]">—</span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-[--muted]">
                              {item.total_cost ? fmt$(item.total_cost) : '—'}
                            </td>
                            <td className="py-2.5 px-3 w-24 text-[--hint] text-[10px]">
                              {item.library_id ? '' : '⚠ not costed'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
