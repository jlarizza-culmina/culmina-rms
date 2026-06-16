'use client'
// src/components/GlobalIngredientMapper.tsx
// Settings → Map Ingredients: globally map ingredient names to library items

import { useState, useEffect, useMemo, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import type { LibraryIngredient, Recipe } from '@/lib/types'

interface IngGroup {
  name: string                          // original name (most common casing)
  nameLower: string                     // normalised key
  count: number                         // how many recipe rows use this name
  recipeIds: string[]
  recipeNames: string[]
  library_id: string | null             // if any row already has a mapping
  suggestion?: LibraryIngredient        // fuzzy match from library
  _selected?: string                    // chosen library_id in UI
  _saving?: boolean
  _saved?: boolean
  _error?: string
  _expanded?: boolean
}

interface Props {
  userId: string
  restaurantId?: string
}

export default function GlobalIngredientMapper({ userId, restaurantId }: Props) {
  const supabase = createClient()
  const [groups,   setGroups]   = useState<IngGroup[]>([])
  const [library,  setLibrary]  = useState<LibraryIngredient[]>([])
  const [loading,  setLoading]  = useState(true)
  const [search,   setSearch]   = useState('')
  const [showMapped, setShowMapped] = useState(false)
  const [bulkSaving, setBulkSaving] = useState(false)

  const load = useCallback(async () => {
    if (!restaurantId) return
    setLoading(true)

    const [{ data: recipes }, { data: lib }] = await Promise.all([
      supabase.from('recipes')
        .select('id, name, ingredients')
        .eq('restaurant_id', restaurantId)
        .eq('is_deleted', false)
        .not('ingredients', 'is', null),
      supabase.from('ingredient_library')
        .select('*')
        .or(`restaurant_id.eq.${restaurantId},user_id.eq.${userId},user_id.is.null`)
        .eq('is_active', true)
        .order('name'),
    ])

    const libList = lib ?? []
    setLibrary(libList)

    // Build lookup by lowercased name
    const libByName = new Map<string, LibraryIngredient>()
    for (const l of libList) libByName.set(l.name.toLowerCase(), l)

    // Group ingredients across all recipes
    const map = new Map<string, IngGroup>()
    for (const recipe of recipes ?? []) {
      for (const ing of (recipe.ingredients ?? []) as any[]) {
        if (!ing?.name) continue
        const key = ing.name.toLowerCase().trim()
        if (!map.has(key)) {
          map.set(key, {
            name: ing.name,
            nameLower: key,
            count: 0,
            recipeIds: [],
            recipeNames: [],
            library_id: ing.library_id ?? null,
          })
        }
        const g = map.get(key)!
        g.count++
        if (!g.recipeIds.includes(recipe.id)) {
          g.recipeIds.push(recipe.id)
          g.recipeNames.push(recipe.name)
        }
        // Keep the library_id if any row has one
        if (ing.library_id && !g.library_id) g.library_id = ing.library_id
      }
    }

    // Add suggestions via word matching
    const result = [...map.values()].map(g => {
      const suggestion = fuzzyMatch(g.nameLower, libList)
      return { ...g, suggestion, _selected: g.library_id ?? suggestion?.id ?? '' }
    })

    // Sort: unmapped first, then by recipe count desc
    result.sort((a, b) => {
      if (!!a.library_id !== !!b.library_id) return a.library_id ? 1 : -1
      return b.count - a.count
    })

    setGroups(result)
    setLoading(false)
  }, [restaurantId, userId])

  useEffect(() => { load() }, [load])

  function fuzzyMatch(name: string, lib: LibraryIngredient[]): LibraryIngredient | undefined {
    // Exact match first
    const exact = lib.find(l => l.name.toLowerCase() === name)
    if (exact) return exact
    // Word intersection score
    const words = name.split(/\W+/).filter(w => w.length > 2)
    let best: LibraryIngredient | undefined
    let bestScore = 0
    for (const l of lib) {
      const lw = l.name.toLowerCase().split(/\W+/).filter(w => w.length > 2)
      const shared = words.filter(w => lw.includes(w)).length
      const score  = shared / Math.max(words.length, lw.length, 1)
      if (score > bestScore && score >= 0.4) { best = l; bestScore = score }
    }
    return best
  }

  function updateGroup(nameLower: string, patch: Partial<IngGroup>) {
    setGroups(prev => prev.map(g => g.nameLower === nameLower ? { ...g, ...patch } : g))
  }

  async function mapGroup(g: IngGroup) {
    if (!g._selected || !restaurantId) return
    updateGroup(g.nameLower, { _saving: true, _error: undefined })
    try {
      const res = await fetch('/api/ingredients/bulk-map', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          restaurant_id:    restaurantId,
          ingredient_name:  g.name,
          library_id:       g._selected,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      updateGroup(g.nameLower, { _saving: false, _saved: true, library_id: g._selected })
    } catch (e) {
      updateGroup(g.nameLower, { _saving: false, _error: String(e) })
    }
  }

  async function mapAllSelected() {
    const toMap = visible.filter(g => g._selected && !g.library_id)
    if (!toMap.length) return
    setBulkSaving(true)
    for (const g of toMap) await mapGroup(g)
    setBulkSaving(false)
  }

  const visible = useMemo(() => {
    let list = groups
    if (!showMapped) list = list.filter(g => !g.library_id || !g._saved)
    if (search.trim()) {
      const s = search.toLowerCase()
      list = list.filter(g => g.nameLower.includes(s))
    }
    return list
  }, [groups, showMapped, search])

  const unmappedCount   = groups.filter(g => !g.library_id && !g._saved).length
  const mappedCount     = groups.filter(g => g.library_id || g._saved).length
  const withSuggestion  = visible.filter(g => !g.library_id && !g._saved && g._selected).length

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="bg-white rounded-xl border border-[--border] p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-[--text]">Ingredient mapping coverage</span>
          <span className="text-xs text-[--muted]">{mappedCount} / {groups.length} unique names mapped</span>
        </div>
        <div className="h-2 bg-[--surface-2] rounded-full overflow-hidden">
          <div className="h-full bg-[--green] rounded-full transition-all"
            style={{ width: groups.length ? `${Math.round(mappedCount/groups.length*100)}%` : '0%' }} />
        </div>
        <div className="text-[10px] text-[--hint] mt-1">
          {unmappedCount} unmapped · affects ingredient costing and nutrition calculations
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search ingredient names…"
          className="flex-1 min-w-[200px] text-xs border border-[--border-2] rounded-lg px-3 py-1.5 bg-white outline-none focus:border-[--accent]" />
        <label className="flex items-center gap-1.5 text-xs text-[--muted] cursor-pointer">
          <input type="checkbox" checked={showMapped} onChange={e => setShowMapped(e.target.checked)}
            className="accent-[--accent] w-3.5 h-3.5" />
          Show mapped
        </label>
        {withSuggestion > 0 && (
          <button onClick={mapAllSelected} disabled={bulkSaving}
            className="text-xs px-3 py-1.5 bg-[--accent] text-white rounded-lg hover:bg-[--accent-dark] disabled:opacity-60 flex-shrink-0">
            {bulkSaving ? 'Mapping…' : `⚡ Map ${withSuggestion} with suggestions`}
          </button>
        )}
      </div>

      {/* Help text */}
      <p className="text-[11px] text-[--muted]">
        Each row is a unique ingredient name found across all recipes. Map it once and every recipe using that name is updated.
        Suggestions (⚡) are auto-detected — confirm or change before mapping.
      </p>

      {/* List */}
      {loading ? (
        <div className="text-xs text-[--hint] text-center py-12">Loading recipes…</div>
      ) : visible.length === 0 ? (
        <div className="text-xs text-center py-8 text-[--muted]">
          {unmappedCount === 0 ? '✓ All ingredients are mapped.' : 'No results.'}
        </div>
      ) : (
        <div className="space-y-1.5">
          {visible.map(g => {
            const isMapped = !!(g.library_id || g._saved)
            const libItem  = library.find(l => l.id === (g.library_id || (g._saved ? g._selected : undefined)))
            return (
              <div key={g.nameLower}
                className={`bg-white rounded-xl border overflow-hidden ${isMapped ? 'border-green-200' : 'border-[--border]'}`}>
                <div className="flex items-center px-4 py-2.5 gap-3">
                  {/* Name + recipe count */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-[--text]">{g.name}</span>
                      {isMapped && <span className="text-[9px] text-green-600 bg-green-50 border border-green-200 px-1.5 py-0.5 rounded-full">mapped</span>}
                      {!isMapped && g.suggestion && !g._selected && (
                        <span className="text-[9px] text-blue-600 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded-full">suggestion ready</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-[--hint]">{g.count} use{g.count !== 1 ? 's' : ''} in {g.recipeIds.length} recipe{g.recipeIds.length !== 1 ? 's' : ''}</span>
                      {isMapped && libItem && (
                        <span className="text-[10px] text-green-600">→ {libItem.name}</span>
                      )}
                      <button onClick={() => updateGroup(g.nameLower, { _expanded: !g._expanded })}
                        className="text-[9px] text-[--hint] hover:text-[--accent] underline">
                        {g._expanded ? 'hide' : 'show recipes'}
                      </button>
                    </div>
                    {g._expanded && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {g.recipeNames.map(n => (
                          <span key={n} className="text-[9px] bg-[--surface-2] text-[--muted] px-1.5 py-0.5 rounded border border-[--border]">{n}</span>
                        ))}
                      </div>
                    )}
                    {g._error && <div className="text-[10px] text-red-500 mt-1">{g._error}</div>}
                  </div>

                  {/* Library selector + map button */}
                  {!isMapped && (
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {g.suggestion && (
                        <span className="text-[10px] text-blue-500 hidden sm:block">
                          ⚡ {g.suggestion.name}
                        </span>
                      )}
                      <select
                        value={g._selected ?? ''}
                        onChange={e => updateGroup(g.nameLower, { _selected: e.target.value })}
                        className={`text-xs border rounded-lg px-2 py-1 bg-white outline-none max-w-[220px] ${g._selected ? 'border-[--border-2] text-[--text]' : 'border-dashed border-orange-300 text-orange-500'}`}>
                        <option value="">— Select library item —</option>
                        {g.suggestion && (
                          <option value={g.suggestion.id}>⚡ {g.suggestion.name}</option>
                        )}
                        {library.filter(l => l.id !== g.suggestion?.id).map(l => (
                          <option key={l.id} value={l.id}>{l.name}</option>
                        ))}
                      </select>
                      <button
                        onClick={() => mapGroup(g)}
                        disabled={!g._selected || g._saving}
                        className="text-[11px] px-3 py-1.5 bg-[--accent] text-white rounded-lg hover:bg-[--accent-dark] disabled:opacity-40 flex-shrink-0">
                        {g._saving ? '…' : `Map ${g.count}`}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
