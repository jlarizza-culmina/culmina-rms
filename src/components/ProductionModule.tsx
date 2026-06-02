'use client'
// src/components/ProductionModule.tsx
// Daily production planning: covers → portions → shopping list → T-minus schedule

import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase'
import type { Recipe, LibraryIngredient } from '@/lib/types'

// ── Types ─────────────────────────────────────────────────────
type MenuType = 'morning' | 'aperitivo' | 'dinner' | 'drinks' | 'specials'
type ProdTab  = 'plan' | 'schedule'

const SERVICE_LABELS: Record<MenuType, string> = {
  morning: 'Morning ☕', aperitivo: 'Aperitivo 🍸',
  dinner: 'Dinner 🍽', drinks: 'Drinks 🥂', specials: 'Specials ⭐',
}
const SERVICE_TYPES: MenuType[] = ['morning', 'aperitivo', 'dinner', 'drinks', 'specials']

interface DailyProduction {
  id?: string
  production_date: string
  covers_morning: number; covers_aperitivo: number; covers_dinner: number
  covers_drinks: number; covers_specials: number
  service_time_morning: number; service_time_aperitivo: number
  service_time_dinner: number; service_time_drinks: number; service_time_specials: number
  notes: string
}

interface ProdItem {
  id?: string
  recipe_id: string
  menu_type: MenuType
  planned_portions: number
  notes: string
  // populated client-side
  recipe?: Recipe
}

interface MenuRecipe {
  recipe_id: string
  recipe?: Recipe
  menu_type: MenuType
  display_name: string
  price: number
}

interface ScheduleTask {
  recipe_name: string
  step_title: string
  duration_min: number
  phase: string
  latest_start_min: number   // minutes since midnight
  latest_start_str: string
  service_time_str: string
  menu_type: MenuType
  portions: number
}

interface Props {
  userId: string
  restaurantId?: string
  locationId?: string
}

// ── Helpers ───────────────────────────────────────────────────
function minsToTime(mins: number): string {
  const h = Math.floor(mins / 60) % 24
  const m = mins % 60
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 || 12
  return `${h12}:${String(m).padStart(2,'0')} ${ampm}`
}
function timeToMins(t: string): number {
  const [hm, ap] = t.split(' ')
  const [h, m]   = hm.split(':').map(Number)
  return ((h % 12) + (ap === 'PM' ? 12 : 0)) * 60 + (m || 0)
}
function today(): string { return new Date().toISOString().split('T')[0] }
function tomorrow(): string {
  const d = new Date(); d.setDate(d.getDate()+1); return d.toISOString().split('T')[0]
}

const PHASE_ICONS: Record<string, string> = {
  mise: '🔪', prep: '🥄', cook: '🔥', plate: '🍽', bar: '🍸', batch: '📦'
}

// ── Component ─────────────────────────────────────────────────
export default function ProductionModule({ userId, restaurantId, locationId }: Props) {
  const supabase = createClient()
  const [tab,          setTab]          = useState<ProdTab>('plan')
  const [date,         setDate]         = useState(tomorrow())
  const [recipes,      setRecipes]      = useState<Recipe[]>([])
  const [library,      setLibrary]      = useState<LibraryIngredient[]>([])
  const [production,   setProduction]   = useState<DailyProduction>({
    production_date:       tomorrow(),
    covers_morning: 0, covers_aperitivo: 0, covers_dinner: 0, covers_drinks: 0, covers_specials: 0,
    service_time_morning: 480, service_time_aperitivo: 1080,
    service_time_dinner: 1080, service_time_drinks: 1080, service_time_specials: 1080,
    notes: '',
  })
  const [items,        setItems]        = useState<ProdItem[]>([])
  const [menuRecipes,  setMenuRecipes]  = useState<MenuRecipe[]>([])
  const [loading,      setLoading]      = useState(true)
  const [saving,       setSaving]       = useState(false)
  const [saved,        setSaved]        = useState(false)
  const [recentDates,  setRecentDates]  = useState<string[]>([])

  // ── Load today's menu + existing production plan ──────────────
  const load = useCallback(async () => {
    if (!restaurantId) return
    setLoading(true)

    // Load recipes + library
    const [{ data: recipeData }, { data: libData }] = await Promise.all([
      supabase.from('recipes').select('*').eq('restaurant_id', restaurantId).eq('is_active', true),
      supabase.from('ingredient_library').select('*')
        .or(`restaurant_id.eq.${restaurantId},user_id.eq.${userId},user_id.is.null`)
        .eq('is_active', true),
    ])
    const allRecipes = recipeData ?? []
    const allLibrary = libData ?? []
    setRecipes(allRecipes)
    setLibrary(allLibrary)
    const { data: versions } = await supabase
      .from('menu_versions').select('id, menu_id')
      .eq('is_current', true)
    const { data: menus } = await supabase
      .from('menus').select('id, menu_type').eq('restaurant_id', restaurantId).eq('status', 'active')

    const vIds = (versions ?? []).map((v: any) => v.id)
    let menuItems: MenuRecipe[] = []

    if (vIds.length > 0) {
      const { data: mItems } = await supabase
        .from('menu_version_items').select('recipe_id, menu_version_id, display_name, price, section')
        .in('menu_version_id', vIds).eq('is_available', true).eq('is_printed', true)

      const versionMenuMap: Record<string, string> = {}
      for (const v of versions ?? []) {
        const menu = (menus ?? []).find((m: any) => m.id === v.menu_id)
        if (menu) versionMenuMap[v.id] = menu.menu_type
      }

      menuItems = (mItems ?? []).map((mi: any) => ({
        recipe_id:    mi.recipe_id,
        recipe:       allRecipes.find((r: any) => r.id === mi.recipe_id),
        menu_type:    (versionMenuMap[mi.menu_version_id] ?? 'dinner') as MenuType,
        display_name: mi.display_name || allRecipes.find((r: any) => r.id === mi.recipe_id)?.name || '',
        price:        mi.price,
      }))
    }

    setMenuRecipes(menuItems)

    // Load existing production plan for this date
    const { data: prod } = await supabase
      .from('daily_production').select('*')
      .eq('restaurant_id', restaurantId)
      .eq('production_date', date)
      .maybeSingle()

    if (prod) {
      setProduction(prod)
      const { data: pItems } = await supabase
        .from('production_items').select('*').eq('production_id', prod.id)
      setItems((pItems ?? []).map((i: any) => ({
        ...i, recipe: allRecipes.find((r: any) => r.id === i.recipe_id),
      })))
    } else {
      // Pre-populate items from menu
      setItems(menuItems.map((mi: any) => ({
        recipe_id: mi.recipe_id, recipe: allRecipes.find((r: any) => r.id === mi.recipe_id),
        menu_type: mi.menu_type, planned_portions: 0, notes: '',
      })))
    }

    // Load recent past production dates for quick nav
    const { data: pastPlans } = await supabase
      .from('daily_production').select('production_date')
      .eq('restaurant_id', restaurantId)
      .order('production_date', { ascending: false }).limit(10)
    setRecentDates((pastPlans ?? []).map((p: any) => p.production_date))
    setLoading(false)
  }, [restaurantId, userId, date])

  useEffect(() => { load() }, [load])

  // ── Update cover count ────────────────────────────────────────
  function setCovers(type: MenuType, val: number) {
    setProduction(p => ({ ...p, [`covers_${type}`]: val }))
  }
  function getCovers(type: MenuType): number {
    return (production as any)[`covers_${type}`] ?? 0
  }
  function getServiceTime(type: MenuType): number {
    return (production as any)[`service_time_${type}`] ?? 1080
  }
  function setServiceTime(type: MenuType, val: number) {
    setProduction(p => ({ ...p, [`service_time_${type}`]: val }))
  }

  // ── Update portions ───────────────────────────────────────────
  function setPortions(recipeId: string, menuType: MenuType, val: number) {
    setItems(prev => prev.map(i =>
      i.recipe_id === recipeId && i.menu_type === menuType
        ? { ...i, planned_portions: val } : i
    ))
  }

  // ── Save ──────────────────────────────────────────────────────
  async function save() {
    if (!restaurantId) return
    setSaving(true)
    try {
      // SELECT first to handle NULL location_id (NULL != NULL in upsert onConflict)
      let q = supabase.from('daily_production').select('id')
        .eq('restaurant_id', restaurantId)
        .eq('production_date', date)
      if (locationId) q = (q as any).eq('location_id', locationId)
      else q = (q as any).is('location_id', null)
      const { data: existing } = await q.maybeSingle()

      const payload = {
        restaurant_id:         restaurantId,
        location_id:           locationId ?? null,
        production_date:       date,
        covers_morning:        production.covers_morning,
        covers_aperitivo:      production.covers_aperitivo,
        covers_dinner:         production.covers_dinner,
        covers_drinks:         production.covers_drinks,
        covers_specials:       production.covers_specials,
        service_time_morning:  production.service_time_morning,
        service_time_aperitivo: production.service_time_aperitivo,
        service_time_dinner:   production.service_time_dinner,
        service_time_drinks:   production.service_time_drinks,
        service_time_specials: production.service_time_specials,
        notes:                 production.notes,
        created_by:            userId,
        updated_at:            new Date().toISOString(),
      }

      let prod: any
      if (existing?.id) {
        const { data } = await supabase.from('daily_production')
          .update(payload).eq('id', existing.id).select().single()
        prod = data
      } else {
        const { data } = await supabase.from('daily_production')
          .insert(payload).select().single()
        prod = data
      }

      if (!prod?.id) throw new Error('Failed to save production header')

      // Delete existing items and reinsert — cleanest way to handle no-id rows
      await supabase.from('production_items').delete().eq('production_id', prod.id)

      const toInsert = items
        .filter(i => (i.planned_portions ?? 0) > 0)
        .map((i: any) => ({
          production_id:    prod.id,
          recipe_id:        i.recipe_id,
          menu_type:        i.menu_type,
          planned_portions: i.planned_portions,
          notes:            i.notes || '',
        }))

      if (toInsert.length > 0) {
        await supabase.from('production_items').insert(toInsert)
      }

      setProduction(prev => ({ ...prev, id: prod.id }))
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      console.error('[production save]', e)
    }
    setSaving(false)
  }

  // ── Shopping list ─────────────────────────────────────────────
  const shoppingList = useMemo(() => {
    const agg: Map<string, { name: string; amount: number; unit: string }> = new Map()

    function addIngredients(recipeObj: Recipe | undefined, ratio: number) {
      if (!recipeObj) return
      for (const ing of recipeObj.ingredients ?? []) {
        if (!ing) continue
        const lib = library.find((l: any) => l.id === ing.library_id)
        const key = lib?.id ?? ing.name.toLowerCase()
        const name = lib?.name ?? ing.name
        const amount = (ing.amount || 0) * ratio
        const existing = agg.get(key)
        if (existing) { existing.amount += amount }
        else { agg.set(key, { name, amount, unit: lib?.recipe_unit ?? ing.unit ?? '' }) }
      }
      // Expand component sub-recipes
      for (const comp of recipeObj.components ?? []) {
        const compRecipe = recipes.find((r: any) => r.id === comp.recipe_id)
        if (compRecipe) {
          const compRatio = (comp.amount || 1) / (compRecipe.base_servings || 1) * ratio
          addIngredients(compRecipe, compRatio)
        }
      }
    }

    for (const item of items.filter(i => i.planned_portions > 0)) {
      const ratio = item.planned_portions / (item.recipe?.base_servings || 1)
      addIngredients(item.recipe, ratio)
    }

    return Array.from(agg.values())
      .filter((i: any) => i.amount > 0)
      .sort((a: any, b: any) => a.name.localeCompare(b.name))
  }, [items, library, recipes])

  // ── T-minus schedule ──────────────────────────────────────────
  const schedule = useMemo((): ScheduleTask[] => {
    const tasks: ScheduleTask[] = []
    for (const item of items.filter(i => i.planned_portions > 0)) {
      const recipe = item.recipe
      if (!recipe) continue
      const serviceTime = getServiceTime(item.menu_type)
      // Work backwards through steps
      let timeFromEnd = 0
      const steps = [...(recipe.steps ?? [])].reverse()
      for (const step of steps) {
        const dur = step.duration || 0
        timeFromEnd += dur
        const latestStart = serviceTime - timeFromEnd
        tasks.push({
          recipe_name:      recipe.name,
          step_title:       step.title || 'Prep',
          duration_min:     dur,
          phase:            step.phase || 'prep',
          latest_start_min: latestStart,
          latest_start_str: minsToTime(Math.max(0, latestStart)),
          service_time_str: minsToTime(serviceTime),
          menu_type:        item.menu_type,
          portions:         item.planned_portions,
        })
      }
    }
    return tasks.sort((a, b) => a.latest_start_min - b.latest_start_min)
  }, [items, production])

  // ── Group menu items by service type ──────────────────────────
  const itemsByService = useMemo(() => {
    const map: Record<string, ProdItem[]> = {}
    for (const item of items) {
      if (!map[item.menu_type]) map[item.menu_type] = []
      map[item.menu_type].push(item)
    }
    return map
  }, [items])

  const totalPortions = items.reduce((s, i) => s + (i.planned_portions || 0), 0)

  // ── Print functions ───────────────────────────────────────────
  function printPullList() {
    const rows = shoppingList.map((i: any) =>
      `<tr><td>${i.name}</td><td style="text-align:right;padding-left:24px">${Math.round(i.amount * 10)/10} ${i.unit}</td><td style="padding-left:24px">☐</td></tr>`
    ).join('')
    const portionSummary = items.filter(i => i.planned_portions > 0)
      .map((i: any) => `${i.recipe?.name ?? i.recipe_id}: ${i.planned_portions} portions`)
      .join('<br>')
    openPrint(`
      <h2 style="margin:0 0 4px">Pull List — ${date}</h2>
      <p style="margin:0 0 16px;font-size:12px;color:#666">${totalPortions} total portions · ${shoppingList.length} ingredients</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="border-bottom:2px solid #000">
          <th style="text-align:left;padding-bottom:4px">Ingredient</th>
          <th style="text-align:right;padding-left:24px">Qty</th>
          <th style="padding-left:24px">✓</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <hr style="margin:24px 0">
      <p style="font-size:11px;color:#666"><strong>Portions:</strong><br>${portionSummary}</p>
    `)
  }

  function printSchedule() {
    const rows = schedule.map((t: any, i: number) => {
      const phaseColors: Record<string, string> = {
        cook: '#fee2e2', mise: '#dbeafe', plate: '#dcfce7', bar: '#f3e8ff', prep: '#fef3c7'
      }
      const bg = phaseColors[t.phase] ?? '#f5f5f5'
      return `<tr style="background:${i%2===0?'#fff':'#fafafa'}">
        <td style="padding:6px 8px;font-weight:600">${t.latest_start_str}</td>
        <td style="padding:6px 8px">${t.recipe_name}</td>
        <td style="padding:6px 8px;color:#555">${t.step_title}</td>
        <td style="padding:6px 8px"><span style="background:${bg};padding:2px 8px;border-radius:12px;font-size:11px">${t.phase}</span></td>
        <td style="padding:6px 8px;text-align:right">${t.duration_min > 0 ? t.duration_min+'min' : ''}</td>
        <td style="padding:6px 8px;text-align:center">☐</td>
      </tr>`
    }).join('')
    openPrint(`
      <h2 style="margin:0 0 4px">Prep Schedule — ${date}</h2>
      <p style="margin:0 0 16px;font-size:12px;color:#666">${schedule.length} tasks</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="border-bottom:2px solid #000;font-size:11px;text-transform:uppercase;letter-spacing:0.05em">
          <th style="text-align:left;padding:4px 8px">Start</th>
          <th style="text-align:left;padding:4px 8px">Recipe</th>
          <th style="text-align:left;padding:4px 8px">Step</th>
          <th style="text-align:left;padding:4px 8px">Phase</th>
          <th style="text-align:right;padding:4px 8px">Duration</th>
          <th style="padding:4px 8px">✓</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `)
  }

  function openPrint(body: string) {
    const w = window.open('', '_blank', 'width=800,height=900')
    if (!w) return
    w.document.write(`<!DOCTYPE html><html><head>
      <title>Culmina Production — ${date}</title>
      <style>
        body { font-family: Georgia, serif; padding: 32px; color: #1a1a1a; max-width: 800px; margin: 0 auto; }
        table { page-break-inside: auto; }
        tr { page-break-inside: avoid; }
        @media print { body { padding: 0; } }
      </style>
    </head><body>${body}</body></html>`)
    w.document.close()
    w.focus()
    setTimeout(() => w.print(), 300)
  }

  if (loading) return <div className="flex items-center justify-center h-full text-[--hint] text-sm">Loading production plan…</div>

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="bg-white border-b border-[--border] px-6 py-4 flex-shrink-0">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h1 className="font-serif text-xl font-medium text-[--text]">Production</h1>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Quick date buttons */}
            <div className="flex rounded-lg border border-[--border-2] overflow-hidden text-xs">
              {[['Today', today()], ['Tomorrow', tomorrow()]].map(([label, val]) => (
                <button key={label} onClick={() => setDate(val)}
                  className={`px-3 py-1.5 transition-colors ${date === val ? 'bg-[--accent] text-white' : 'bg-white text-[--muted] hover:bg-[--surface-2]'}`}>
                  {label}
                </button>
              ))}
            </div>
            <input type="date" value={date}
              onChange={e => setDate(e.target.value)}
              className="text-xs border border-[--border-2] rounded-lg px-2.5 py-1.5 bg-white outline-none focus:border-[--accent]" />
            {/* Past plans */}
            {recentDates.filter(d => d !== date).length > 0 && (
              <select value="" onChange={e => e.target.value && setDate(e.target.value)}
                className="text-xs border border-[--border-2] rounded-lg px-2 py-1.5 bg-white outline-none focus:border-[--accent] text-[--muted]">
                <option value="">📅 Past plans…</option>
                {recentDates.filter(d => d !== date).map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            )}
            <button onClick={save} disabled={saving}
              className="px-4 py-2 bg-[--accent] text-white text-xs font-medium rounded-lg hover:bg-[--accent-dark] disabled:opacity-50">
              {saving ? '…' : saved ? '✓ Saved' : '💾 Save'}
            </button>
            {/* Print buttons */}
            {tab === 'plan' && shoppingList.length > 0 && (
              <button onClick={() => printPullList()}
                className="px-3 py-2 border border-[--border-2] text-[--muted] text-xs rounded-lg hover:bg-[--surface-2]">
                🖨 Print pull list
              </button>
            )}
            {tab === 'schedule' && schedule.length > 0 && (
              <button onClick={() => printSchedule()}
                className="px-3 py-2 border border-[--border-2] text-[--muted] text-xs rounded-lg hover:bg-[--surface-2]">
                🖨 Print schedule
              </button>
            )}
          </div>
        </div>
        {/* Tabs */}
        <div className="flex bg-[--surface-2] rounded-lg p-0.5 gap-0.5 w-fit">
          {(['plan','schedule'] as ProdTab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-1.5 text-xs font-medium rounded-md capitalize transition-all ${tab === t ? 'bg-white text-[--text] shadow-sm' : 'text-[--muted]'}`}>
              {t === 'plan' ? '📋 Plan' : '⏱ Schedule'}
            </button>
          ))}
        </div>
      </div>

      {/* ── PLAN TAB ── */}
      {tab === 'plan' && (
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* Cover inputs */}
          <div>
            <h2 className="font-serif text-sm font-medium text-[--text] mb-3">Expected Covers</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
              {SERVICE_TYPES.map(type => {
                const count = itemsByService[type]?.length ?? 0
                if (count === 0) return null
                return (
                  <div key={type} className="bg-white rounded-xl border border-[--border] p-3">
                    <div className="text-[11px] text-[--muted] mb-2">{SERVICE_LABELS[type]}</div>
                    <input type="number" min="0" value={getCovers(type) || ''}
                      onChange={e => setCovers(type, parseInt(e.target.value) || 0)}
                      placeholder="0"
                      className="w-full text-xl font-medium text-[--text] bg-transparent outline-none border-b border-[--border-2] focus:border-[--accent] pb-1" />
                    <div className="text-[9px] text-[--hint] mt-1">covers · {count} items</div>
                    {/* Service time */}
                    <select value={getServiceTime(type)}
                      onChange={e => setServiceTime(type, parseInt(e.target.value))}
                      className="text-[10px] text-[--muted] bg-transparent outline-none mt-1.5 w-full cursor-pointer">
                      {[360,420,480,540,600,660,720,780,840,900,960,1020,1080,1140,1200,1260,1320,1380].map((m: any) => (
                        <option key={m} value={m}>{minsToTime(m)}</option>
                      ))}
                    </select>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Recipe portion table */}
          {SERVICE_TYPES.filter(t => (itemsByService[t]?.length ?? 0) > 0).map(type => (
            <div key={type}>
              <div className="flex items-center gap-2 mb-2">
                <h2 className="font-serif text-sm font-medium text-[--text]">{SERVICE_LABELS[type]}</h2>
                <span className="text-[11px] text-[--hint]">service: {minsToTime(getServiceTime(type))} · {getCovers(type)} covers</span>
              </div>
              <div className="bg-white rounded-xl border border-[--border] overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="bg-[--surface-2] border-b border-[--border]">
                      <th className="text-left px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-[--hint]">Recipe</th>
                      <th className="text-right px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-[--hint] w-32">Portions</th>
                      <th className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-[--hint] w-48 hidden md:table-cell">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(itemsByService[type] ?? []).map(item => (
                      <tr key={`${item.recipe_id}-${item.menu_type}`}
                        className="border-b border-[--border] last:border-0">
                        <td className="px-4 py-2.5">
                          <div className="text-xs font-medium text-[--text]">
                            {item.recipe?.name ?? 'Unknown'}
                          </div>
                          {item.recipe?.is_component_recipe && (
                            <span className="text-[9px] text-purple-500">⚙ component</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2 justify-end">
                            <button onClick={() => setPortions(item.recipe_id, item.menu_type, Math.max(0, (item.planned_portions||0) - 1))}
                              className="w-6 h-6 rounded border border-[--border-2] text-[--muted] hover:bg-[--surface-2] text-sm flex items-center justify-center">−</button>
                            <input type="number" min="0" value={item.planned_portions || ''}
                              onChange={e => setPortions(item.recipe_id, item.menu_type, parseInt(e.target.value) || 0)}
                              placeholder="0"
                              className="w-14 text-sm font-medium text-center border border-[--border-2] rounded-lg px-1 py-0.5 outline-none focus:border-[--accent]" />
                            <button onClick={() => setPortions(item.recipe_id, item.menu_type, (item.planned_portions||0) + 1)}
                              className="w-6 h-6 rounded border border-[--border-2] text-[--muted] hover:bg-[--surface-2] text-sm flex items-center justify-center">+</button>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 hidden md:table-cell">
                          <input value={item.notes} onChange={e => setItems(prev => prev.map((i: any) => i.recipe_id === item.recipe_id && i.menu_type === item.menu_type ? { ...i, notes: e.target.value } : i))}
                            placeholder="notes…"
                            className="w-full text-xs text-[--muted] bg-transparent outline-none border-b border-transparent hover:border-[--border-2] focus:border-[--accent]" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          {/* Shopping list */}
          {shoppingList.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-serif text-sm font-medium text-[--text]">
                  Ingredient Pull List
                  <span className="font-sans text-[11px] font-normal text-[--hint] ml-2">
                    {totalPortions} total portions · {shoppingList.length} ingredients
                  </span>
                </h2>
                <button onClick={() => {
                  const lines = ['Ingredient,Amount,Unit', ...shoppingList.map((i: any) => `"${i.name}",${Math.round(i.amount * 10)/10},"${i.unit}"`)]
                  const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
                  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `pull-list-${date}.csv` })
                  a.click()
                }} className="text-xs px-3 py-1.5 border border-[--border-2] text-[--muted] rounded-lg hover:bg-[--surface-2]">
                  ↓ Export CSV
                </button>
              </div>
              <div className="bg-white rounded-xl border border-[--border] overflow-hidden">
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 divide-x divide-y divide-[--border]">
                  {shoppingList.map(ing => (
                    <div key={ing.name} className="px-3 py-2">
                      <div className="text-xs font-medium text-[--text] truncate">{ing.name}</div>
                      <div className="text-[11px] text-[--accent] font-medium mt-0.5">
                        {Math.round(ing.amount * 10)/10} {ing.unit}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {items.length === 0 && (
            <div className="text-center py-16 text-[--muted]">
              <div className="text-4xl opacity-20 mb-3">📋</div>
              <p className="text-sm">No menu items found. Add items to your menus first.</p>
            </div>
          )}
        </div>
      )}

      {/* ── SCHEDULE TAB ── */}
      {tab === 'schedule' && (
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <p className="text-xs text-[--muted] mb-4">
            Tasks sorted by latest start time, calculated backwards from each service time using recipe step durations.
            Zero-duration steps are omitted.
          </p>
          {schedule.length === 0 ? (
            <div className="text-center py-16 text-[--muted]">
              <div className="text-4xl opacity-20 mb-3">⏱</div>
              <p className="text-sm">Set portions in the Plan tab to generate a schedule.</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {/* Group by hour */}
              {(() => {
                const byHour: Record<string, ScheduleTask[]> = {}
                for (const t of schedule) {
                  const h = minsToTime(Math.floor(t.latest_start_min / 60) * 60)
                  ;(byHour[h] = byHour[h] ?? []).push(t)
                }
                return Object.entries(byHour).map(([hour, tasks]) => (
                  <div key={hour}>
                    <div className="text-[10px] font-semibold uppercase tracking-widest text-[--hint] px-1 py-1 mt-3 first:mt-0">
                      {hour}
                    </div>
                    {tasks.map((task, i) => (
                      <div key={i} className="flex items-center gap-3 bg-white rounded-xl border border-[--border] px-4 py-2.5 mb-1">
                        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                          task.phase === 'cook' ? 'bg-red-400' :
                          task.phase === 'mise' ? 'bg-blue-400' :
                          task.phase === 'plate' ? 'bg-green-400' :
                          task.phase === 'bar' ? 'bg-purple-400' : 'bg-amber-400'
                        }`} />
                        <div className="flex-shrink-0 w-16 text-xs font-medium text-[--accent]">
                          {task.latest_start_str}
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="text-xs font-medium text-[--text]">{task.recipe_name}</span>
                          <span className="text-[11px] text-[--muted] ml-2">— {task.step_title}</span>
                        </div>
                        <div className="flex items-center gap-3 flex-shrink-0 text-[11px] text-[--muted]">
                          <span>{PHASE_ICONS[task.phase] ?? '🔧'} {task.phase}</span>
                          {task.duration_min > 0 && <span>{task.duration_min}min</span>}
                          <span className="text-[--hint]">{task.portions} portions</span>
                          <span className="text-[9px] bg-[--surface-2] px-1.5 py-0.5 rounded capitalize">{task.menu_type}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ))
              })()}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
