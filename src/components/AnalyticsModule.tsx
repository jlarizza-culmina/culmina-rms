'use client'
import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase'
import type { Recipe, LibraryIngredient, Vendor } from '@/lib/types'
import CostReport from './CostReport'

interface Props {
  userId: string
  restaurantId?: string
}

type ReportType = 'margins' | 'fat_tail' | 'toast' | 'weather'

const REPORTS: { key: ReportType; label: string; icon: string; desc: string }[] = [
  { key: 'margins',  label: 'Menu Margins',       icon: '💰', desc: 'Food cost % and gross margin by recipe' },
  { key: 'fat_tail', label: 'Menu Complexity',    icon: '📊', desc: 'Ingredient coverage and long-tail risk audit' },
  { key: 'toast',    label: 'Sales Performance',  icon: '📈', desc: 'Actual covers and revenue from Toast POS' },
  { key: 'weather',  label: 'Weather',             icon: '🌤', desc: 'Darien weather and commuter sentiment' },
]

// ── Fat tail risk tiers ───────────────────────────────────────
const RISK_TIER = (pct: number) => pct < 10 ? 'tail' : pct < 30 ? 'monitor' : 'core'
const RISK_STYLES = {
  tail:    { row: 'bg-red-50/40',    badge: 'bg-red-50 text-red-600 border-red-200',    dot: '#EF4444' },
  monitor: { row: 'bg-amber-50/30',  badge: 'bg-amber-50 text-amber-700 border-amber-200', dot: '#D97706' },
  core:    { row: '',                badge: 'bg-green-50 text-green-700 border-green-200', dot: '#2E6B25' },
}

interface IngredientStat {
  name: string
  unit: string
  recipeCount: number
  recipeNames: string[]
  coverPct: number
  weeklyQty: number
  risk: 'tail' | 'monitor' | 'core'
}

export default function AnalyticsModule({ userId, restaurantId }: Props) {
  const supabase = createClient()
  const [report,  setReport]  = useState<ReportType>('margins')
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [library, setLibrary] = useState<LibraryIngredient[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)

  // Fat tail state
  const [minCovers,   setMinCovers]   = useState(50)
  const [riskFilter,  setRiskFilter]  = useState<'all' | 'tail' | 'monitor'>('all')
  const [sortFat,     setSortFat]     = useState<'coverPct' | 'recipeCount' | 'name'>('coverPct')
  const [typeFilter,  setTypeFilter]  = useState<'all' | 'food' | 'beverages'>('all')

  useEffect(() => {
    async function load() {
      setLoading(true)
      let q = supabase.from('recipes').select('*').order('name')
      if (restaurantId) q = q.eq('restaurant_id', restaurantId)
      else q = q.eq('user_id', userId)

      const [{ data: rData }, { data: lData }, { data: vData }] = await Promise.all([
        q,
        supabase.from('ingredient_library').select('*').eq('user_id', userId).eq('is_active', true),
        supabase.from('vendors').select('*').eq('user_id', userId).eq('is_active', true),
      ])
      setRecipes(rData ?? [])
      setLibrary(lData ?? [])
      setVendors(vData ?? [])
      setLoading(false)
    }
    load()
  }, [userId, restaurantId])

  // ── Fat tail computation ──────────────────────────────────────
  const fatTailStats = useMemo((): IngredientStat[] => {
    const activeRecipes = recipes.filter(r => {
      const onMenu = r.menu_status === 'on_menu' || r.menu_status === 'orderable' || r.menu_status === 'special'
      if (!onMenu) return false
      if (typeFilter === 'food')      return r.recipe_type === 'food'
      if (typeFilter === 'beverages') return r.recipe_type !== 'food'
      return true
    })
    if (!activeRecipes.length) return []

    const statsMap: Record<string, { names: string[]; covers: number; qty: number; unit: string }> = {}

    activeRecipes.forEach(r => {
      const covers = minCovers
      r.ingredients.forEach(ing => {
        if (!ing?.name) return          // skip nameless ingredients
        const key = ing.name.toLowerCase().trim()
        if (!key) return                // skip blank names
        if (!statsMap[key]) statsMap[key] = { names: [], covers: 0, qty: 0, unit: ing.unit ?? '' }
        if (!statsMap[key].names.includes(r.name)) statsMap[key].names.push(r.name)
        statsMap[key].covers += covers
        statsMap[key].qty    += (ing.amount ?? 0) * covers
      })
    })

    const maxCovers = activeRecipes.length * minCovers
    return Object.entries(statsMap).map(([name, s]) => ({
      name,
      unit:        s.unit,
      recipeCount: s.names.length,
      recipeNames: s.names,
      coverPct:    maxCovers > 0 ? Math.round((s.covers / maxCovers) * 100) : 0,
      weeklyQty:   Math.round(s.qty * 10) / 10,
      risk:        RISK_TIER(maxCovers > 0 ? (s.covers / maxCovers) * 100 : 0) as 'tail' | 'monitor' | 'core',
    })).sort((a, b) => {
      if (sortFat === 'coverPct')    return a.coverPct - b.coverPct
      if (sortFat === 'recipeCount') return a.recipeCount - b.recipeCount
      return a.name.localeCompare(b.name)
    })
  }, [recipes, minCovers, sortFat, typeFilter])

  const filteredFat = useMemo(() =>
    riskFilter === 'all' ? fatTailStats : fatTailStats.filter(s => s.risk === riskFilter),
    [fatTailStats, riskFilter]
  )

  const tiers = useMemo(() => ({
    tail:    fatTailStats.filter(s => s.risk === 'tail').length,
    monitor: fatTailStats.filter(s => s.risk === 'monitor').length,
    core:    fatTailStats.filter(s => s.risk === 'core').length,
  }), [fatTailStats])

  const activeRecipeCount = recipes.filter(r =>
    r.menu_status === 'on_menu' || r.menu_status === 'orderable' || r.menu_status === 'special'
  ).length

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Report selector ── */}
      <div className="bg-white border-b border-[--border] px-6 py-4 flex-shrink-0">
        <h1 className="font-serif text-xl font-medium text-[--text] mb-3">Analytics</h1>
        <div className="flex gap-2 flex-wrap">
          {REPORTS.map(r => (
            <button key={r.key} onClick={() => setReport(r.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-xs transition-all ${report === r.key ? 'border-[--accent] bg-[--accent-light] text-[--accent] font-medium' : 'border-[--border-2] text-[--muted] hover:bg-[--surface-2]'}`}>
              <span>{r.icon}</span>
              <div className="text-left hidden sm:block">
                <div className="font-medium">{r.label}</div>
              </div>
              <span className="sm:hidden">{r.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">

        {/* ── Margin report (existing CostReport) ── */}
        {report === 'margins' && (
          <CostReport recipes={recipes} library={library} userId={userId} />
        )}

        {/* ── Fat tail report ── */}
        {report === 'fat_tail' && (
          <div className="px-6 py-5">

            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
              <StatCard label="Active recipes" value={String(activeRecipeCount)} />
              <StatCard label="Unique ingredients" value={String(fatTailStats.length)} />
              <StatCard label="⚠ Tail risk" value={String(tiers.tail)} color="text-red-600" />
              <StatCard label="👁 Monitor" value={String(tiers.monitor)} color="text-amber-600" />
            </div>

            {/* Controls */}
            <div className="flex items-center gap-4 mb-4 flex-wrap">
              {/* Type filter */}
              <div className="flex bg-[--surface-2] rounded-lg p-0.5 gap-0.5">
                {([
                  { key: 'all',       label: `All (${recipes.filter(r => r.menu_status === 'on_menu' || r.menu_status === 'orderable' || r.menu_status === 'special').length})` },
                  { key: 'food',      label: '🍽 Food' },
                  { key: 'beverages', label: '🍸 Beverages' },
                ] as const).map(f => (
                  <button key={f.key} onClick={() => setTypeFilter(f.key)}
                    className={`text-xs px-3 py-1 rounded-md transition-all font-medium ${typeFilter === f.key ? 'bg-white text-[--text] shadow-sm' : 'text-[--muted]'}`}>
                    {f.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-[--muted]">Weekly covers / recipe</label>
                <input type="number" min="1" value={minCovers}
                  onChange={e => setMinCovers(parseInt(e.target.value) || 50)}
                  className="w-16 px-2 py-1 text-xs border border-[--border-2] rounded-lg outline-none focus:border-[--accent] text-center" />
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-[--muted]">Risk:</span>
                {(['all','tail','monitor'] as const).map(f => (
                  <button key={f} onClick={() => setRiskFilter(f)}
                    className={`text-[11px] px-2.5 py-0.5 rounded-full border capitalize transition-colors ${riskFilter === f ? 'bg-[--accent] text-white border-[--accent]' : 'border-[--border-2] text-[--muted] hover:bg-[--surface-2]'}`}>
                    {f === 'all' ? `All (${fatTailStats.length})` : f === 'tail' ? `⚠ Tail (${tiers.tail})` : `👁 Monitor (${tiers.monitor})`}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1.5 ml-auto">
                <span className="text-xs text-[--muted]">Sort:</span>
                {(['coverPct','recipeCount','name'] as const).map(s => (
                  <button key={s} onClick={() => setSortFat(s)}
                    className={`text-[11px] px-2 py-0.5 rounded border transition-colors ${sortFat === s ? 'bg-[--surface-2] text-[--text] border-[--border-2]' : 'border-transparent text-[--muted] hover:text-[--text]'}`}>
                    {s === 'coverPct' ? '% covers' : s === 'recipeCount' ? '# dishes' : 'name'}
                  </button>
                ))}
              </div>
            </div>

            {/* How to read */}
            <div className="text-xs text-[--muted] mb-4 flex gap-4">
              <span><span className="font-medium text-red-600">⚠ Tail</span> — used in &lt;10% of covers. Simplification candidate.</span>
              <span><span className="font-medium text-amber-600">👁 Monitor</span> — 10–30% of covers. Worth watching.</span>
              <span><span className="font-medium text-green-600">✓ Core</span> — &gt;30% of covers. Keep.</span>
            </div>

            {/* Table */}
            {loading ? (
              <div className="text-center py-10 text-[--muted] text-sm">Loading…</div>
            ) : filteredFat.length === 0 ? (
              <div className="text-center py-10 text-[--muted] text-sm">
                {activeRecipeCount === 0 ? 'No on-menu recipes found. Set some recipes to "On Menu" first.' : 'No ingredients match the current filter.'}
              </div>
            ) : (
              <div className="border border-[--border] rounded-xl overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-[--surface-2] border-b border-[--border]">
                      <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-[--hint] uppercase tracking-wide">Ingredient</th>
                      <th className="px-3 py-2.5 text-center text-[10px] font-semibold text-[--hint] uppercase tracking-wide w-16">Dishes</th>
                      <th className="px-3 py-2.5 text-center text-[10px] font-semibold text-[--hint] uppercase tracking-wide w-20">Cover %</th>
                      <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-[--hint] uppercase tracking-wide w-28">Wkly qty</th>
                      <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-[--hint] uppercase tracking-wide w-20">Risk</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredFat.map((s, i) => {
                      const style = RISK_STYLES[s.risk]
                      return (
                        <tr key={s.name} className={`border-b border-[--border] last:border-0 ${style.row || (i % 2 === 0 ? 'bg-white' : 'bg-[--surface-2]/20')}`}>
                          <td className="px-3 py-2.5">
                            <div className="font-medium text-[--text] capitalize">{s.name}</div>
                            <div className="text-[10px] text-[--muted] mt-0.5 truncate max-w-xs">
                              {s.recipeNames.slice(0,3).join(' · ')}{s.recipeNames.length > 3 ? ` +${s.recipeNames.length-3}` : ''}
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <span className="font-medium text-[--text]">{s.recipeCount}</span>
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-1.5 bg-[--surface-2] rounded-full overflow-hidden">
                                <div className="h-full rounded-full" style={{ width: `${Math.min(s.coverPct, 100)}%`, background: style.dot }} />
                              </div>
                              <span className="text-[11px] font-medium w-8 text-right" style={{ color: style.dot }}>{s.coverPct}%</span>
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-[--muted]">
                            {s.weeklyQty} {s.unit}
                          </td>
                          <td className="px-3 py-2.5">
                            <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium capitalize ${style.badge}`}>
                              {s.risk}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── Toast — stub ── */}
        {report === 'toast' && (
          <div className="px-6 py-10 text-center max-w-md mx-auto">
            <div className="text-5xl mb-4 opacity-30">📈</div>
            <h2 className="font-serif text-lg font-medium text-[--text] mb-2">Toast Sales Performance</h2>
            <p className="text-sm text-[--muted] mb-6">
              Connect your Toast POS account to see actual covers, daily sales by dish, variance against planned production, and recipe performance over time.
            </p>
            <div className="bg-[--surface-2] rounded-xl border border-[--border] p-4 text-left text-xs text-[--muted] space-y-2 mb-6">
              <div className="font-medium text-[--text] mb-1">What this will show:</div>
              <div>✓ First sold date, last sold date, total days on menu</div>
              <div>✓ Average daily covers, best day, consecutive days</div>
              <div>✓ Actual vs. planned production variance</div>
              <div>✓ Revenue by dish with average realized price</div>
            </div>
            <button className="px-5 py-2.5 bg-[--accent] text-white text-sm font-medium rounded-lg hover:bg-[--accent-dark] transition-colors opacity-50 cursor-not-allowed">
              Connect Toast — Coming Soon
            </button>
            <p className="text-[10px] text-[--hint] mt-3">Requires Toast RMS Pro subscription</p>
          </div>
        )}

        {/* ── Weather ── */}
        {report === 'weather' && (
          <div className="px-6 py-5 space-y-6 max-w-2xl">
            <div>
              <h2 className="font-serif text-lg font-medium text-[--text] mb-1">Weather — Darien CT</h2>
              <p className="text-xs text-[--muted]">
                Captured at 6am, noon, and 6pm via Open-Meteo. Used to anticipate commuter behaviour and menu demand.
              </p>
            </div>
            <div className="bg-[--surface-2] rounded-xl p-6 text-center text-[--muted] text-sm">
              Weather integration coming soon — will show 6am/noon/6pm conditions captured at Darien, CT.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value, color = 'text-[--text]' }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-white rounded-xl border border-[--border] p-4 text-center">
      <div className={`text-2xl font-medium ${color}`}>{value}</div>
      <div className="text-[10px] text-[--muted] mt-0.5">{label}</div>
    </div>
  )
}
