'use client'
import { useEffect, useState, useCallback } from 'react'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase'
import type { Recipe, Vendor, LibraryIngredient, MenuItemStatus } from '@/lib/types'
import type { AppContext } from './AppShell'
import AddModal from './AddModal'
import RecipeView from './RecipeView'
import CookMode from './CookMode'
import PrepList from './PrepList'

interface Props {
  user: User
  restaurantId?: string
  ctx?: AppContext
}

const STATUS_LABELS: Record<MenuItemStatus, string> = {
  not_on_menu: 'Not on menu',
  orderable:   'Orderable',
  on_menu:     'On menu',
  special:     'Special',
}
const STATUS_DOT: Record<MenuItemStatus, string> = {
  not_on_menu: '#B0AB9E',
  orderable:   '#3B82F6',
  on_menu:     '#2E6B25',
  special:     '#D97706',
}

export default function RecipeApp({ user, restaurantId, ctx }: Props) {
  const supabase = createClient()

  const [recipes,  setRecipes]  = useState<Recipe[]>([])
  const [vendors,  setVendors]  = useState<Vendor[]>([])
  const [library,  setLibrary]  = useState<LibraryIngredient[]>([])
  const [loading,  setLoading]  = useState(true)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'overview' | 'plan' | 'nutrition' | 'shopping' | 'costing'>('overview')
  const [servings, setServings] = useState<Record<string, number>>({})
  const [checks,   setChecks]   = useState<Record<string, Set<string>>>({})

  // Sidebar filter state
  const [recipeTab,    setRecipeTab]    = useState<'food' | 'drinks'>('food')
  const [showFilter,   setShowFilter]   = useState(false)
  const [filterStatus, setFilterStatus] = useState<MenuItemStatus | 'all'>('all')
  const [searchTerm,   setSearchTerm]   = useState('')

  const [addOpen,      setAddOpen]      = useState(false)
  const [cookMode,     setCookMode]     = useState(false)
  const [prepMode,     setPrepMode]     = useState(false)
  const [prepSelected, setPrepSelected] = useState<Set<string>>(new Set())

  const activeRecipe = recipes.find(r => r.id === activeId) ?? null

  // Load data
  async function loadRecipes() {
    let query = supabase.from('recipes').select('*').order('created_at', { ascending: false })
    if (restaurantId) {
      query = query.eq('restaurant_id', restaurantId)
    } else {
      query = query.eq('user_id', user.id)
    }
    const { data } = await query
    if (data) {
      const loaded: Recipe[] = data.map(r => ({ ...r, servings: r.base_servings }))
      setRecipes(loaded)
      const sMap: Record<string, number> = {}
      loaded.forEach(r => { sMap[r.id] = r.base_servings })
      setServings(sMap)
    }
  }

  async function loadVendors() {
    const { data } = await supabase.from('vendors').select('*')
      .eq('user_id', user.id).eq('is_active', true).order('name')
    setVendors(data ?? [])
  }

  async function loadLibrary() {
    const { data } = await supabase.from('ingredient_library').select('*')
      .eq('user_id', user.id).eq('is_active', true).order('name')
    setLibrary(data ?? [])
  }

  useEffect(() => {
    async function loadAll() {
      setLoading(true)
      await Promise.all([loadRecipes(), loadVendors(), loadLibrary()])
      const { data: cData } = await supabase.from('shopping_checks').select('recipe_id, ingredient_id, checked')
        .eq('user_id', user.id).eq('checked', true)
      if (cData) {
        const cMap: Record<string, Set<string>> = {}
        cData.forEach(c => {
          if (!cMap[c.recipe_id]) cMap[c.recipe_id] = new Set()
          cMap[c.recipe_id].add(c.ingredient_id)
        })
        setChecks(cMap)
      }
      setLoading(false)
    }
    loadAll()
  }, [user.id, restaurantId])

  const handleAddRecipes = useCallback(async (newRecipes: Omit<Recipe, 'id' | 'user_id' | 'created_at'>[]) => {
    const toInsert = newRecipes.map(r => ({
      user_id: user.id,
      restaurant_id: restaurantId ?? null,
      name: r.name, description: r.description || '',
      recipe_type: r.recipe_type || 'food',
      base_servings: r.base_servings || 4,
      prep_time: r.prep_time || 0, cook_time: r.cook_time || 0,
      ingredients: r.ingredients || [], steps: r.steps || [],
      nutrition: r.nutrition || {}, cocktail_details: r.cocktail_details || null,
      tags: r.tags || [],
      menu_status: 'not_on_menu',
    }))
    const { data, error } = await supabase.from('recipes').insert(toInsert).select()
    if (error || !data) { console.error(error); return }
    const added: Recipe[] = data.map(r => ({ ...r, servings: r.base_servings }))
    setRecipes(prev => [...added, ...prev])
    setServings(prev => { const n = { ...prev }; added.forEach(r => { n[r.id] = r.base_servings }); return n })
    if (added.length === 1) setActiveId(added[0].id)
  }, [user.id, restaurantId, supabase])

  const handleUpdateRecipe = useCallback(async (id: string, updates: Partial<Recipe>) => {
    await supabase.from('recipes').update(updates).eq('id', id)
    setRecipes(prev => prev.map(r => r.id === id ? { ...r, ...updates } : r))
  }, [supabase])

  const handleSaveVersion = useCallback(async (recipeId: string, note: string) => {
    const recipe = recipes.find(r => r.id === recipeId)
    if (!recipe) return
    const currentVersion = recipe.version ?? 1
    const { id, created_at, servings: _s, ...rest } = recipe as Recipe & { created_at?: string }
    await supabase.from('recipes').insert({
      ...rest, user_id: user.id, restaurant_id: restaurantId ?? null,
      is_active: false, parent_version_id: recipeId,
      version: currentVersion, notes: note || `v${currentVersion} — ${new Date().toLocaleDateString()}`,
    })
    await handleUpdateRecipe(recipeId, { version: currentVersion + 1 })
  }, [recipes, user.id, restaurantId, supabase, handleUpdateRecipe])

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm('Remove this recipe?')) return
    await supabase.from('recipes').delete().eq('id', id)
    setRecipes(prev => prev.filter(r => r.id !== id))
    setPrepSelected(prev => { const n = new Set(prev); n.delete(id); return n })
    if (activeId === id) setActiveId(null)
  }, [activeId, supabase])

  const handleServings = useCallback((id: string, delta: number) => {
    setServings(prev => ({ ...prev, [id]: Math.max(1, (prev[id] ?? 1) + delta) }))
  }, [])

  const handleToggleCheck = useCallback(async (recipeId: string, ingredientId: string) => {
    setChecks(prev => {
      const n = { ...prev }
      const s = new Set(n[recipeId] ?? [])
      s.has(ingredientId) ? s.delete(ingredientId) : s.add(ingredientId)
      n[recipeId] = s
      return n
    })
    const isChecked = !(checks[recipeId]?.has(ingredientId))
    await supabase.from('shopping_checks').upsert(
      { user_id: user.id, recipe_id: recipeId, ingredient_id: ingredientId, checked: isChecked },
      { onConflict: 'user_id,recipe_id,ingredient_id' }
    )
  }, [checks, user.id, supabase])

  const handleClearChecks = useCallback(async (recipeId: string) => {
    setChecks(prev => ({ ...prev, [recipeId]: new Set() }))
    await supabase.from('shopping_checks').update({ checked: false }).eq('recipe_id', recipeId).eq('user_id', user.id)
  }, [user.id, supabase])

  const togglePrepSelect = (id: string) => {
    setPrepSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  // Filtered recipe list
  const visibleRecipes = recipes.filter(r => {
    if (recipeTab === 'food'   && r.recipe_type !== 'food')     return false
    if (recipeTab === 'drinks' && r.recipe_type !== 'cocktail') return false
    if (filterStatus !== 'all' && r.menu_status !== filterStatus) return false
    if (searchTerm && !r.name.toLowerCase().includes(searchTerm.toLowerCase())) return false
    return true
  })

  const foodCount   = recipes.filter(r => r.recipe_type === 'food').length
  const drinkCount  = recipes.filter(r => r.recipe_type === 'cocktail').length

  return (
    <div className="flex h-full overflow-hidden bg-[--bg]">

      {/* Sidebar */}
      <aside className="w-60 min-w-60 bg-white border-r border-[--border] flex flex-col">

        {/* Tabs: Food / Drinks */}
        <div className="flex border-b border-[--border]">
          {(['food','drinks'] as const).map(t => (
            <button key={t} onClick={() => setRecipeTab(t)}
              className={`flex-1 py-2.5 text-xs font-medium transition-colors capitalize ${recipeTab === t ? 'text-[--accent] border-b-2 border-[--accent]' : 'text-[--muted] hover:text-[--text]'}`}>
              {t === 'food' ? `🍽 Food (${foodCount})` : `🍸 Drinks (${drinkCount})`}
            </button>
          ))}
        </div>

        {/* Search + filter toggle */}
        <div className="px-2.5 pt-2.5 pb-2 space-y-1.5">
          <div className="flex gap-1.5">
            <input
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="Search…"
              className="flex-1 px-2.5 py-1.5 text-xs border border-[--border-2] rounded-lg outline-none focus:border-[--accent] bg-white"
            />
            <button
              onClick={() => setShowFilter(f => !f)}
              className={`px-2 py-1.5 rounded-lg border text-xs transition-colors ${showFilter ? 'border-[--accent] bg-[--accent-light] text-[--accent]' : 'border-[--border-2] text-[--muted] hover:bg-[--surface-2]'}`}
              title="Filter">
              ▼
            </button>
          </div>

          {/* Collapsible filter */}
          {showFilter && (
            <div className="bg-[--surface-2] rounded-lg p-2 space-y-1.5 border border-[--border]">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-[--hint] mb-1">Status</div>
              {(['all','not_on_menu','orderable','on_menu','special'] as const).map(s => (
                <button key={s} onClick={() => setFilterStatus(s)}
                  className={`w-full text-left text-[11px] px-2 py-1 rounded-md transition-colors flex items-center gap-1.5
                    ${filterStatus === s ? 'bg-white text-[--text] shadow-sm' : 'text-[--muted] hover:bg-white/60'}`}>
                  {s !== 'all' && (
                    <div className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{ background: STATUS_DOT[s as MenuItemStatus] }} />
                  )}
                  {s === 'all' ? 'All' : STATUS_LABELS[s as MenuItemStatus]}
                </button>
              ))}
            </div>
          )}

          {/* New Recipe + Prep List */}
          <button onClick={() => setAddOpen(true)}
            className="w-full py-1.5 bg-[--accent] text-white rounded-lg text-xs font-medium hover:bg-[--accent-dark] transition-colors">
            + New Recipe
          </button>
          {prepSelected.size >= 2 && (
            <button onClick={() => setPrepMode(true)}
              className="w-full py-1.5 border border-[--accent] text-[--accent] rounded-lg text-xs font-medium hover:bg-[--accent-light] transition-colors">
              📋 Prep List ({prepSelected.size})
            </button>
          )}
        </div>

        {/* Recipe list */}
        <nav className="flex-1 overflow-y-auto px-1.5 pb-2">
          {loading ? (
            <div className="p-3 text-center text-[--hint] text-xs">Loading…</div>
          ) : visibleRecipes.length === 0 ? (
            <div className="p-3 text-center text-[--hint] text-xs leading-relaxed">
              {searchTerm ? 'No matches' : `No ${recipeTab} recipes yet.`}
            </div>
          ) : (
            visibleRecipes.map(r => {
              const status = (r.menu_status ?? 'not_on_menu') as MenuItemStatus
              return (
                <div key={r.id}
                  onClick={() => { setActiveId(r.id); setActiveTab('overview') }}
                  className={`group flex items-center gap-2 px-2 py-2 rounded-lg cursor-pointer mb-0.5 transition-colors
                    ${r.id === activeId ? 'bg-[--accent-light]' : 'hover:bg-[--surface-2]'}`}>

                  {/* Prep select */}
                  <button onClick={e => { e.stopPropagation(); togglePrepSelect(r.id) }}
                    className={`w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center text-[9px] transition-all
                      ${prepSelected.has(r.id) ? 'bg-[--accent] border-[--accent] text-white' : 'border-[--border-2] opacity-0 group-hover:opacity-100'}`}>
                    {prepSelected.has(r.id) ? '✓' : ''}
                  </button>

                  {/* Status dot */}
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-0.5"
                    style={{ background: STATUS_DOT[status] }} />

                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium text-[--text] truncate">{r.name}</div>
                    <div className="text-[10px] text-[--muted] mt-0.5 flex items-center gap-1">
                      <span>{STATUS_LABELS[status]}</span>
                      {r.ranking && <span>· {'★'.repeat(r.ranking)}</span>}
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </nav>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {!activeRecipe ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center p-10">
            <div className="text-5xl opacity-20">🍽</div>
            <h2 className="font-serif text-xl font-normal text-[--text] mt-1">Select a recipe</h2>
            <p className="text-sm text-[--muted] max-w-xs">
              Choose from the list or add a new recipe.
            </p>
            <button onClick={() => setAddOpen(true)}
              className="mt-2 px-4 py-2.5 bg-[--accent] text-white rounded-lg text-sm font-medium hover:bg-[--accent-dark] transition-colors">
              + Add first recipe
            </button>
          </div>
        ) : (
          <RecipeView
            recipe={activeRecipe}
            servings={servings[activeRecipe.id] ?? activeRecipe.base_servings}
            checks={checks[activeRecipe.id] ?? new Set()}
            activeTab={activeTab}
            library={library}
            vendors={vendors}
            userId={user.id}
            onTabChange={setActiveTab}
            onServingsChange={d => handleServings(activeRecipe.id, d)}
            onToggleCheck={id => handleToggleCheck(activeRecipe.id, id)}
            onClearChecks={() => handleClearChecks(activeRecipe.id)}
            onDelete={() => handleDelete(activeRecipe.id)}
            onCookMode={() => setCookMode(true)}
            onUpdateRecipe={handleUpdateRecipe}
            onSaveVersion={handleSaveVersion}
          />
        )}
      </main>

      {/* Overlays */}
      {addOpen && <AddModal onClose={() => setAddOpen(false)} onAdd={handleAddRecipes} />}
      {cookMode && activeRecipe && (
        <CookMode recipe={activeRecipe} servings={servings[activeRecipe.id] ?? activeRecipe.base_servings} onClose={() => setCookMode(false)} />
      )}
      {prepMode && (
        <PrepList recipes={recipes.filter(r => prepSelected.has(r.id))} servings={servings} onClose={() => setPrepMode(false)} />
      )}
    </div>
  )
}
