'use client'
import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase'
import type { Recipe, LibraryIngredient } from '@/lib/types'

interface UnlinkedRow {
  recipeId: string
  recipeName: string
  ingId: string
  ingName: string
  amount: number
  unit: string
  category: string
  suggestions: LibraryIngredient[]
}

interface Props {
  userId: string
  restaurantId?: string
  recipes: Recipe[]
  library: LibraryIngredient[]
  onRecipeUpdated: (id: string, updates: Partial<Recipe>) => Promise<void>
}

export default function UnlinkedIngredients({ userId, restaurantId, recipes, library, onRecipeUpdated }: Props) {
  const supabase = createClient()
  const [saving, setSaving] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [linked, setLinked] = useState<Set<string>>(new Set()) // ingId keys already linked this session
  const [aiSuggesting, setAiSuggesting] = useState(false)
  const [aiSuggestions, setAiSuggestions] = useState<Record<string, string>>({}) // ingName -> libraryId

  // Build unlinked list from all recipe ingredients
  const unlinked = useMemo<UnlinkedRow[]>(() => {
    const rows: UnlinkedRow[] = []
    for (const recipe of recipes) {
      for (const ing of recipe.ingredients ?? []) {
        if (ing.library_id || linked.has(`${recipe.id}:${ing.id}`)) continue
        if (search && !ing.name.toLowerCase().includes(search.toLowerCase())) continue
        // Find suggestions: library items whose name contains any word from ing.name
        const words = ing.name.toLowerCase().split(/\s+/).filter(w => w.length > 2)
        const suggestions = library.filter(l =>
          words.some(w => l.name.toLowerCase().includes(w))
        ).slice(0, 5)
        rows.push({
          recipeId: recipe.id,
          recipeName: recipe.name,
          ingId: ing.id,
          ingName: ing.name,
          amount: ing.amount,
          unit: ing.unit,
          category: ing.category,
          suggestions,
        })
      }
    }
    return rows
  }, [recipes, library, search, linked])

  const stats = {
    total: recipes.reduce((n, r) => n + (r.ingredients?.length ?? 0), 0),
    unlinked: unlinked.length,
    linked: recipes.reduce((n, r) => n + (r.ingredients?.filter(i => i.library_id).length ?? 0), 0),
  }

  async function linkIngredient(row: UnlinkedRow, libraryId: string, libraryName: string) {
    const recipe = recipes.find(r => r.id === row.recipeId)
    if (!recipe) return
    setSaving(prev => new Set(prev).add(`${row.recipeId}:${row.ingId}`))
    const updatedIngs = recipe.ingredients.map(i =>
      i.id === row.ingId ? { ...i, library_id: libraryId, name: libraryName } : i
    )
    await onRecipeUpdated(row.recipeId, { ingredients: updatedIngs })
    setLinked(prev => new Set(prev).add(`${row.recipeId}:${row.ingId}`))
    setSaving(prev => { const n = new Set(prev); n.delete(`${row.recipeId}:${row.ingId}`); return n })
  }

  async function createAndLink(row: UnlinkedRow) {
    setSaving(prev => new Set(prev).add(`${row.recipeId}:${row.ingId}`))
    try {
      const { data } = await supabase.from('ingredient_library').insert({
        user_id: userId,
        restaurant_id: restaurantId ?? null,
        name: row.ingName,
        category: row.category || 'Pantry',
        is_active: true,
        allergens: [],
        notes: '',
        purchase_unit: row.unit,
        purchase_unit_label: row.unit,
        purchase_unit_qty: null,
        recipe_unit: row.unit,
        unit_conversion: 1,
        trim_factor: 1,
        purchase_unit_cost: null,
        purchase_unit_size: null,
      }).select().single()
      if (data) {
        await linkIngredient(row, data.id, data.name)
      }
    } finally {
      setSaving(prev => { const n = new Set(prev); n.delete(`${row.recipeId}:${row.ingId}`); return n })
    }
  }

  async function runAiSuggestions() {
    if (unlinked.length === 0) return
    setAiSuggesting(true)
    try {
      const payload = {
        unlinked: unlinked.slice(0, 50).map(r => ({ id: `${r.recipeId}:${r.ingId}`, name: r.ingName, unit: r.unit, category: r.category })),
        library: library.map(l => ({ id: l.id, name: l.name, category: l.category })),
      }
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'match_ingredients', payload }),
      })
      if (res.ok) {
        const data = await res.json()
        if (data.matches) setAiSuggestions(data.matches)
      }
    } finally {
      setAiSuggesting(false)
    }
  }

  if (unlinked.length === 0 && !search) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="text-4xl mb-3">✅</div>
        <div className="text-sm font-medium text-[--text] mb-1">All ingredients are linked</div>
        <div className="text-xs text-[--hint]">
          {stats.linked} of {stats.total} recipe ingredients linked to the library
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-[--border] flex items-center gap-4 flex-shrink-0">
        <div className="flex-1">
          <h2 className="text-sm font-medium text-[--text]">Unlinked Ingredients</h2>
          <p className="text-[11px] text-[--hint] mt-0.5">
            {stats.unlinked} unlinked · {stats.linked} linked · {stats.total} total across {recipes.length} recipes
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Filter by name…"
            className="text-xs border border-[--border-2] rounded-lg px-3 py-1.5 outline-none focus:border-[--accent] w-44" />
          <button onClick={runAiSuggestions} disabled={aiSuggesting || unlinked.length === 0}
            className="text-xs px-3 py-1.5 bg-purple-50 text-purple-700 border border-purple-200 rounded-lg hover:bg-purple-100 disabled:opacity-50 flex items-center gap-1.5">
            {aiSuggesting ? <><span className="spinner" />Matching…</> : '✨ AI Match All'}
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="px-6 py-2 border-b border-[--border] flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex-1 h-1.5 bg-[--surface-2] rounded-full overflow-hidden">
            <div className="h-full bg-[--accent] rounded-full transition-all"
              style={{ width: `${stats.total > 0 ? (stats.linked / stats.total) * 100 : 0}%` }} />
          </div>
          <span className="text-[10px] text-[--hint] flex-shrink-0">
            {stats.total > 0 ? Math.round((stats.linked / stats.total) * 100) : 0}% linked
          </span>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto divide-y divide-[--border]">
        {unlinked.map(row => {
          const key = `${row.recipeId}:${row.ingId}`
          const isSaving = saving.has(key)
          const aiMatch = aiSuggestions[row.ingName] ? library.find(l => l.id === aiSuggestions[row.ingName]) : null

          return (
            <div key={key} className="px-6 py-3">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium text-[--text]">{row.ingName}</span>
                    <span className="text-[10px] text-[--hint]">{row.amount} {row.unit}</span>
                    {row.category && (
                      <span className="text-[9px] bg-[--surface-2] text-[--hint] px-1.5 py-0.5 rounded">
                        {row.category}
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-[--hint] mb-2">in {row.recipeName}</div>

                  {/* AI suggestion */}
                  {aiMatch && (
                    <div className="flex items-center gap-2 mb-2 p-2 bg-purple-50 rounded-lg border border-purple-100">
                      <span className="text-[9px] text-purple-600 font-medium">✨ AI suggests</span>
                      <span className="text-[11px] text-purple-800 font-medium flex-1">{aiMatch.name}</span>
                      <button onClick={() => linkIngredient(row, aiMatch.id, aiMatch.name)} disabled={isSaving}
                        className="text-[10px] bg-purple-600 text-white px-2 py-0.5 rounded font-medium hover:bg-purple-700 disabled:opacity-50">
                        Link
                      </button>
                    </div>
                  )}

                  {/* Library suggestions */}
                  {row.suggestions.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {row.suggestions.map(s => (
                        <button key={s.id} onClick={() => linkIngredient(row, s.id, s.name)}
                          disabled={isSaving}
                          className="text-[10px] px-2 py-0.5 border border-[--border-2] rounded-full text-[--muted] hover:bg-[--accent-light] hover:border-[--accent] hover:text-[--accent] transition-colors disabled:opacity-50">
                          {s.name}
                        </button>
                      ))}
                    </div>
                  )}

                  {row.suggestions.length === 0 && !aiMatch && (
                    <p className="text-[10px] text-[--hint] italic">No library matches found</p>
                  )}
                </div>

                <div className="flex flex-col gap-1.5 flex-shrink-0">
                  <button onClick={() => createAndLink(row)} disabled={isSaving}
                    className="text-[10px] px-2.5 py-1 bg-[--surface-2] border border-[--border-2] rounded-lg text-[--muted] hover:bg-white hover:border-[--accent] hover:text-[--accent] transition-colors disabled:opacity-50 whitespace-nowrap">
                    {isSaving ? '…' : '+ Create & Link'}
                  </button>
                </div>
              </div>
            </div>
          )
        })}

        {unlinked.length === 0 && search && (
          <div className="py-8 text-center text-xs text-[--hint]">No unlinked ingredients matching "{search}"</div>
        )}
      </div>
    </div>
  )
}
