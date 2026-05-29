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
import RecipeListPage from './RecipeListPage'
import UnlinkedIngredients from './UnlinkedIngredients'

interface Props {
  user: User
  restaurantId?: string
  ctx?: AppContext
  onSubPageChange?: (title: string) => void
  onNavigateHome?: () => void
}

export default function RecipeApp({ user, restaurantId, ctx, onSubPageChange, onNavigateHome }: Props) {
  const supabase = createClient()

  // ── Data state ───────────────────────────────────────────────
  const [recipes,  setRecipes]  = useState<Recipe[]>([])
  const [vendors,  setVendors]  = useState<Vendor[]>([])
  const [library,  setLibrary]  = useState<LibraryIngredient[]>([])
  const [loading,  setLoading]  = useState(true)

  // ── Navigation state ─────────────────────────────────────────
  const [activeId,  setActiveId]  = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'overview' | 'plan' | 'nutrition' | 'shopping' | 'costing'>('overview')

  // ── Recipe view state ────────────────────────────────────────
  const [servings, setServings] = useState<Record<string, number>>({})
  const [checks,   setChecks]   = useState<Record<string, Set<string>>>({})

  // ── Overlay state ────────────────────────────────────────────
  const [addOpen,      setAddOpen]      = useState(false)
  const [unlinkedOpen, setUnlinkedOpen] = useState(false)
  const [cookMode,     setCookMode]     = useState(false)
  const [prepMode,     setPrepMode]     = useState(false)
  const [prepSelected, setPrepSelected] = useState<Set<string>>(new Set())

  const activeRecipe = recipes.find(r => r.id === activeId) ?? null

  // ── Load all data ────────────────────────────────────────────
  useEffect(() => {
    async function loadAll() {
      setLoading(true)
      try {
        let query = supabase.from('recipes').select('*').order('created_at', { ascending: false })
        if (restaurantId) query = query.eq('restaurant_id', restaurantId)
        else query = query.eq('user_id', user.id)

        const [{ data: rData }, { data: vData }, { data: lData }, { data: cData }] = await Promise.all([
          query,
          supabase.from('vendors').select('*').eq('user_id', user.id).eq('is_active', true).order('name'),
          supabase.from('ingredient_library').select('*').eq('user_id', user.id).eq('is_active', true).order('name'),
          supabase.from('shopping_checks').select('recipe_id, ingredient_id, checked').eq('user_id', user.id).eq('checked', true),
        ])

        if (rData) {
          const loaded: Recipe[] = rData.map(r => ({ ...r, servings: r.base_servings }))
          setRecipes(loaded)
          const sMap: Record<string, number> = {}
          loaded.forEach(r => { sMap[r.id] = r.base_servings })
          setServings(sMap)
        }
        if (vData) setVendors(vData)
        if (lData) setLibrary(lData)
        if (cData) {
          const cMap: Record<string, Set<string>> = {}
          cData.forEach(c => {
            if (!cMap[c.recipe_id]) cMap[c.recipe_id] = new Set()
            cMap[c.recipe_id].add(c.ingredient_id)
          })
          setChecks(cMap)
        }
      } finally {
        setLoading(false)
      }
    }
    loadAll()
  }, [user.id, restaurantId])

  // ── Handlers ─────────────────────────────────────────────────
  const handleAddRecipes = useCallback(async (newRecipes: Omit<Recipe, 'id' | 'user_id' | 'created_at'>[]) => {
    const toInsert = newRecipes.map(r => ({
      user_id: user.id, restaurant_id: restaurantId ?? null,
      name: r.name, description: r.description || '',
      recipe_type: r.recipe_type || 'food',
      base_servings: r.base_servings || 4,
      prep_time: r.prep_time || 0, cook_time: r.cook_time || 0,
      ingredients: r.ingredients || [], steps: r.steps || [],
      nutrition: r.nutrition || {}, cocktail_details: r.cocktail_details || null,
      tags: r.tags || [], menu_status: 'not_on_menu', recipe_stage: 'development',
    }))
    const { data, error } = await supabase.from('recipes').insert(toInsert).select()
    if (error || !data) { console.error('Insert error:', error); return }
    const added: Recipe[] = data.map(r => ({ ...r, servings: r.base_servings }))
    setRecipes(prev => [...added, ...prev])
    setServings(prev => { const n = { ...prev }; added.forEach(r => { n[r.id] = r.base_servings }); return n })
    if (added.length === 1) { setActiveId(added[0].id); setActiveTab('overview'); onSubPageChange?.(added[0].name ?? '') }
  }, [user.id, restaurantId, supabase])

  const handleUpdateRecipe = useCallback(async (id: string, updates: Partial<Recipe>) => {
    await supabase.from('recipes').update(updates).eq('id', id)
    setRecipes(prev => prev.map(r => r.id === id ? { ...r, ...updates } : r))
  }, [supabase])

  const handleSaveVersion = useCallback(async (recipeId: string, note: string) => {
    const recipe = recipes.find(r => r.id === recipeId)
    if (!recipe) return
    const currentVersion = recipe.version ?? 1
    const { id: _id, created_at: _c, servings: _s, ...rest } = recipe as Recipe & { created_at?: string }
    await supabase.from('recipes').insert({
      ...rest, user_id: user.id, restaurant_id: restaurantId ?? null,
      is_active: false, parent_recipe_id: recipeId,
      version: currentVersion, notes: note || `v${currentVersion} — ${new Date().toLocaleDateString()}`,
    })
    await handleUpdateRecipe(recipeId, { version: currentVersion + 1 })
  }, [recipes, user.id, restaurantId, supabase, handleUpdateRecipe])

  const handleCloneRecipe = useCallback(async (recipeId: string) => {
    const recipe = recipes.find(r => r.id === recipeId)
    if (!recipe) return
    const { id: _id, created_at: _c, servings: _s, ...rest } = recipe as Recipe & { created_at?: string }
    const { data } = await supabase.from('recipes').insert({
      ...rest, user_id: user.id, restaurant_id: restaurantId ?? null,
      name: `${recipe.name} (Copy)`, recipe_stage: 'development',
      is_special: false, parent_recipe_id: null, version: 1,
    }).select().single()
    if (data) {
      const cloned: Recipe = { ...data, servings: data.base_servings }
      setRecipes(prev => [cloned, ...prev])
      setServings(prev => ({ ...prev, [data.id]: data.base_servings }))
      setActiveId(data.id)
    }
  }, [recipes, user.id, restaurantId, supabase])

  const handleCreateVariation = useCallback(async (recipeId: string, variationName: string) => {
    const recipe = recipes.find(r => r.id === recipeId)
    if (!recipe) return
    const { id: _id, created_at: _c, servings: _s, ...rest } = recipe as Recipe & { created_at?: string }
    const { data } = await supabase.from('recipes').insert({
      ...rest, user_id: user.id, restaurant_id: restaurantId ?? null,
      name: variationName, recipe_stage: 'development',
      is_special: false, parent_recipe_id: recipeId, version: 1,
    }).select().single()
    if (data) {
      const variation: Recipe = { ...data, servings: data.base_servings }
      setRecipes(prev => [variation, ...prev])
      setServings(prev => ({ ...prev, [data.id]: data.base_servings }))
      setActiveId(data.id)
    }
  }, [recipes, user.id, restaurantId, supabase])

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
      const n = { ...prev }; const s = new Set(n[recipeId] ?? [])
      s.has(ingredientId) ? s.delete(ingredientId) : s.add(ingredientId)
      n[recipeId] = s; return n
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

  function goBack() { setActiveId(null); setActiveTab('overview'); onSubPageChange?.('') }

  // ── Render ───────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden bg-[--bg]">
      {activeId && activeRecipe ? (
        <>
          {/* Full-screen recipe view — breadcrumb is in AppShell TopBar */}
          <div className="flex-1 overflow-hidden">
            <RecipeView
              recipe={activeRecipe}
              servings={servings[activeRecipe.id] ?? activeRecipe.base_servings}
              checks={checks[activeRecipe.id] ?? new Set()}
              activeTab={activeTab}
              library={library}
              allRecipes={recipes}
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
              onClone={() => handleCloneRecipe(activeRecipe.id)}
              onCreateVariation={name => handleCreateVariation(activeRecipe.id, name)}
              onBack={goBack}
            />
          </div>
        </>
      ) : (
        <RecipeListPage
          recipes={recipes}
          library={library}
          loading={loading}
          onSelect={id => {
            const r = recipes.find(x => x.id === id)
            setActiveId(id)
            setActiveTab('overview')
            onSubPageChange?.(r?.name ?? '')
          }}
          onNewRecipe={() => setAddOpen(true)}
          onShowUnlinked={() => setUnlinkedOpen(true)}
          prepSelected={prepSelected}
          onTogglePrepSelect={togglePrepSelect}
          onOpenPrepList={() => setPrepMode(true)}
        />
      )}

      {/* ── Overlays ── */}
      {addOpen && <AddModal onClose={() => setAddOpen(false)} onAdd={handleAddRecipes} />}
      {unlinkedOpen && (
        <div className="fixed inset-0 bg-black/35 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl w-[800px] max-w-[96vw] h-[80vh] flex flex-col shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[--border] flex-shrink-0">
              <h2 className="font-serif text-lg font-medium text-[--text]">Unlinked Ingredients</h2>
              <button onClick={() => setUnlinkedOpen(false)} className="text-[--hint] hover:text-[--text] text-lg">✕</button>
            </div>
            <UnlinkedIngredients
              userId={user.id}
              restaurantId={restaurantId}
              recipes={recipes}
              library={library}
              onRecipeUpdated={handleUpdateRecipe}
            />
          </div>
        </div>
      )}
      {cookMode && activeRecipe && (
        <CookMode recipe={activeRecipe} servings={servings[activeRecipe.id] ?? activeRecipe.base_servings} onClose={() => setCookMode(false)} />
      )}
      {prepMode && (
        <PrepList recipes={recipes.filter(r => prepSelected.has(r.id))} servings={servings} onClose={() => setPrepMode(false)} />
      )}
    </div>
  )
}
