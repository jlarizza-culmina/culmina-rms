'use client'
import { useEffect, useState, useCallback } from 'react'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase'
import type { Recipe, Vendor, LibraryIngredient, AppMode } from '@/lib/types'
import AddModal from './AddModal'
import RecipeView from './RecipeView'
import CookMode from './CookMode'
import PrepList from './PrepList'
import IngredientLibrary from './IngredientLibrary'
import CostReport from './CostReport'

interface Props { user: User }

export default function RecipeApp({ user }: Props) {
  const supabase = createClient()

  // ── Core state ──────────────────────────────────────────────
  const [recipes,  setRecipes]  = useState<Recipe[]>([])
  const [vendors,  setVendors]  = useState<Vendor[]>([])
  const [library,  setLibrary]  = useState<LibraryIngredient[]>([])
  const [loading,  setLoading]  = useState(true)
  const [appMode,  setAppMode]  = useState<AppMode>('cookbook')
  const [activeId, setActiveId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'overview' | 'plan' | 'nutrition' | 'shopping' | 'costing'>('overview')
  const [servings, setServings] = useState<Record<string, number>>({})
  const [checks,   setChecks]   = useState<Record<string, Set<string>>>({})

  // ── Overlay state ────────────────────────────────────────────
  const [addOpen,      setAddOpen]      = useState(false)
  const [cookMode,     setCookMode]     = useState(false)
  const [prepMode,     setPrepMode]     = useState(false)
  const [prepSelected, setPrepSelected] = useState<Set<string>>(new Set())

  const activeRecipe = recipes.find(r => r.id === activeId) ?? null

  // ── Load all data ────────────────────────────────────────────
  async function loadRecipes() {
    const { data } = await supabase.from('recipes').select('*')
      .eq('user_id', user.id).order('created_at', { ascending: false })
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
  }, [user.id])

  // ── Recipe CRUD ──────────────────────────────────────────────
  const handleAddRecipes = useCallback(async (newRecipes: Omit<Recipe, 'id' | 'user_id' | 'created_at'>[]) => {
    const toInsert = newRecipes.map(r => ({
      user_id: user.id,
      name: r.name, description: r.description || '',
      recipe_type: r.recipe_type || 'food',
      base_servings: r.base_servings || 4,
      prep_time: r.prep_time || 0, cook_time: r.cook_time || 0,
      ingredients: r.ingredients || [], steps: r.steps || [],
      nutrition: r.nutrition || {}, cocktail_details: r.cocktail_details || null,
      tags: r.tags || [],
    }))
    const { data, error } = await supabase.from('recipes').insert(toInsert).select()
    if (error || !data) { console.error(error); return }
    const added: Recipe[] = data.map(r => ({ ...r, servings: r.base_servings }))
    setRecipes(prev => [...added, ...prev])
    setServings(prev => { const n = { ...prev }; added.forEach(r => { n[r.id] = r.base_servings }); return n })
    if (added.length === 1) { setActiveId(added[0].id); setAppMode('cookbook') }
  }, [user.id, supabase])

  // Generic partial update — used by RecipeView and CostingTab
  const handleUpdateRecipe = useCallback(async (id: string, updates: Partial<Recipe>) => {
    await supabase.from('recipes').update(updates).eq('id', id).eq('user_id', user.id)
    setRecipes(prev => prev.map(r => r.id === id ? { ...r, ...updates } : r))
  }, [user.id, supabase])

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm('Remove this recipe from your cookbook?')) return
    await supabase.from('recipes').delete().eq('id', id).eq('user_id', user.id)
    setRecipes(prev => prev.filter(r => r.id !== id))
    setPrepSelected(prev => { const n = new Set(prev); n.delete(id); return n })
    if (activeId === id) setActiveId(null)
  }, [user.id, activeId, supabase])

  // ── Serving scaler ───────────────────────────────────────────
  const handleServings = useCallback((id: string, delta: number) => {
    setServings(prev => ({ ...prev, [id]: Math.max(1, (prev[id] ?? 1) + delta) }))
  }, [])

  // ── Shopping checks ──────────────────────────────────────────
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

  // ── Prep list ────────────────────────────────────────────────
  const togglePrepSelect = (id: string) => {
    setPrepSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  const signOut = () => supabase.auth.signOut()

  // ── Nav button helper ─────────────────────────────────────────
  const NavBtn = ({ mode, label, icon }: { mode: AppMode; label: string; icon: string }) => (
    <button
      onClick={() => setAppMode(mode)}
      title={label}
      className={`flex-1 py-1.5 rounded-md text-[11px] font-medium transition-all flex items-center justify-center gap-1
        ${appMode === mode ? 'bg-white text-[--text] shadow-sm' : 'text-[--muted] hover:text-[--text]'}`}>
      <span>{icon}</span>
      <span className="hidden sm:inline">{label}</span>
    </button>
  )

  // ── Render ────────────────────────────────────────────────────
  return (
    <div className="flex h-screen overflow-hidden bg-[--bg]">

      {/* ── Sidebar ── */}
      <aside className="w-56 min-w-56 bg-white border-r border-[--border] flex flex-col">
        <div className="px-3 py-3 border-b border-[--border] space-y-2">
          <div className="font-serif text-base text-[--text] flex items-center gap-1.5">
            📖 <em className="text-[--accent]">recipes</em>
          </div>

          {/* App mode nav */}
          <div className="flex bg-[--surface-2] rounded-lg p-0.5 gap-0.5">
            <NavBtn mode="cookbook" label="Cookbook" icon="📖" />
            <NavBtn mode="library"  label="Library"  icon="📦" />
            <NavBtn mode="report"   label="Report"   icon="📊" />
          </div>

          {appMode === 'cookbook' && (
            <>
              <button onClick={() => setAddOpen(true)}
                className="w-full py-2 bg-[--accent] text-white rounded-md text-xs font-medium hover:bg-[--accent-dark] transition-colors flex items-center justify-center gap-1">
                + New Recipe
              </button>
              {prepSelected.size >= 2 && (
                <button onClick={() => setPrepMode(true)}
                  className="w-full py-2 border border-[--accent] text-[--accent] rounded-md text-xs font-medium hover:bg-[--accent-light] transition-colors">
                  📋 Prep List ({prepSelected.size})
                </button>
              )}
            </>
          )}
        </div>

        {/* Recipe list — always visible */}
        <nav className="flex-1 overflow-y-auto py-1.5 px-1.5">
          {loading ? (
            <div className="p-3 text-center text-[--hint] text-xs">Loading…</div>
          ) : recipes.length === 0 ? (
            <div className="p-3 text-center text-[--hint] text-xs leading-relaxed">
              No recipes yet.<br />Generate or paste one to get started.
            </div>
          ) : (
            recipes.map(r => (
              <div key={r.id}
                onClick={() => { setActiveId(r.id); setActiveTab('overview'); setAppMode('cookbook') }}
                className={`group flex items-center gap-2 px-2.5 py-2 rounded-md cursor-pointer mb-0.5 transition-colors
                  ${r.id === activeId && appMode === 'cookbook' ? 'bg-[--accent-light]' : 'hover:bg-[--surface-2]'}`}>
                <button
                  onClick={e => { e.stopPropagation(); togglePrepSelect(r.id) }}
                  title="Add to prep list"
                  className={`w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center text-[9px] transition-all
                    ${prepSelected.has(r.id) ? 'bg-[--accent] border-[--accent] text-white' : 'border-[--border-2] opacity-0 group-hover:opacity-100'}`}>
                  {prepSelected.has(r.id) ? '✓' : ''}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-[--text] truncate">{r.name}</div>
                  <div className="text-[10px] text-[--muted] mt-0.5">
                    {r.recipe_type === 'cocktail' ? '🍸' : '🍽'} {r.recipe_type === 'cocktail' ? 'cocktail' : `${servings[r.id] ?? r.base_servings} srv`} · {r.prep_time + r.cook_time}min
                  </div>
                </div>
              </div>
            ))
          )}
        </nav>

        <div className="px-3 py-2.5 border-t border-[--border]">
          <div className="text-[10px] text-[--hint] truncate mb-1">{user.email}</div>
          <button onClick={signOut} className="text-[10px] text-[--hint] hover:text-[--muted] underline">Sign out</button>
        </div>
      </aside>

      {/* ── Main ── */}
      <main className="flex-1 flex flex-col overflow-hidden">

        {appMode === 'library' && (
          <IngredientLibrary
            userId={user.id}
            vendors={vendors}
            library={library}
            onLibraryChange={loadLibrary}
            onVendorsChange={loadVendors}
          />
        )}

        {appMode === 'report' && (
          <CostReport recipes={recipes} library={library} userId={user.id} />
        )}

        {appMode === 'cookbook' && (
          !activeRecipe ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center p-10">
              <div className="text-5xl opacity-20">🍽</div>
              <h2 className="font-serif text-xl font-normal text-[--text] mt-1">Your cookbook is empty</h2>
              <p className="text-sm text-[--muted] max-w-xs">Generate a recipe with AI, paste your own, or import from a previous conversation.</p>
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
            />
          )
        )}
      </main>

      {/* ── Overlays ── */}
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
