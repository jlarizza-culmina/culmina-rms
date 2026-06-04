'use client'
import { useState, useMemo, useEffect } from 'react'
import type { Recipe, MenuItemStatus, RecipeStage, ServiceWareRef, LibraryIngredient } from '@/lib/types'
import { createClient } from '@/lib/supabase'
import { ALLERGENS, SUBCATEGORIES } from '@/lib/ingredientConstants'
import RecipeImporter from './RecipeImporter'

interface Props {
  recipes: Recipe[]
  library?: LibraryIngredient[]
  loading: boolean
  onSelect: (id: string) => void
  onNewRecipe: () => void
  onShowUnlinked?: () => void
  onUpdateRecipe?: (id: string, updates: Partial<Recipe>) => Promise<void>
  prepSelected: Set<string>
  onTogglePrepSelect: (id: string) => void
  onOpenPrepList: () => void
  userId?: string
  restaurantId?: string
  onRefreshRecipes?: () => void
}

type SortKey = 'name' | 'recipe_stage' | 'menu_status' | 'created_at' | 'ranking'
type RecipeTab = 'food' | 'drinks'

const STAGE_COLORS: Record<string, string> = {
  development:        'bg-purple-50 text-purple-700',
  testing:            'bg-yellow-50 text-yellow-700',
  active:             'bg-green-50 text-green-700',
  specials_candidate: 'bg-amber-50 text-amber-700',
  retired:            'bg-gray-50 text-gray-400',
}
const STAGE_DOTS: Record<string, string> = {
  development: '#9333EA', testing: '#CA8A04', active: '#2E6B25',
  specials_candidate: '#D97706', retired: '#B0AB9E',
}
const STATUS_LABELS: Record<string, string> = {
  not_on_menu: 'Not on menu', orderable: 'Orderable',
  on_menu: 'On menu', special: 'Special',
}
const STATUS_COLORS: Record<string, string> = {
  not_on_menu: 'text-[--hint]', orderable: 'text-blue-600',
  on_menu: 'text-[--green]', special: 'text-amber-600',
}
const SEASON_ICONS: Record<string, string> = {
  spring: '🌸', summer: '☀️', fall: '🍂', winter: '❄️',
}

function sortRecipes(recipes: Recipe[], key: SortKey, dir: 'asc' | 'desc'): Recipe[] {
  return [...recipes].sort((a, b) => {
    let cmp = 0
    switch (key) {
      case 'name':         cmp = a.name.localeCompare(b.name); break
      case 'recipe_stage': cmp = (a.recipe_stage ?? 'development').localeCompare(b.recipe_stage ?? 'development'); break
      case 'menu_status':  cmp = (a.menu_status ?? 'not_on_menu').localeCompare(b.menu_status ?? 'not_on_menu'); break
      case 'created_at':   cmp = (a.created_at ?? '').localeCompare(b.created_at ?? ''); break
      case 'ranking':      cmp = (b.ranking ?? 0) - (a.ranking ?? 0); break
    }
    return dir === 'asc' ? cmp : -cmp
  })
}

export default function RecipeListPage({
  recipes, library = [], loading, onSelect, onNewRecipe, onShowUnlinked,
  onUpdateRecipe, prepSelected, onTogglePrepSelect, onOpenPrepList,
  userId = '', restaurantId = '', onRefreshRecipes,
}: Props) {
  const [tab,         setTab]         = useState<RecipeTab>('food')
  const [showImporter, setShowImporter] = useState(false)
  const [viewMode,    setViewMode]    = useState<'list' | 'calendar'>('list')
  const [search,      setSearch]      = useState('')
  const [showFilter,  setShowFilter]  = useState(false)
  const [sortKey,     setSortKey]     = useState<SortKey>('created_at')
  const [sortDir,     setSortDir]     = useState<'asc' | 'desc'>('desc')
  const [editingId,   setEditingId]   = useState<string | null>(null)
  const [filterStage, setFilterStage] = useState<RecipeStage | 'all'>('all')
  const [filterStatus,setFilterStatus]= useState<MenuItemStatus | 'all'>('all')
  const [filterSeason,    setFilterSeason]    = useState<string | 'all'>('all')
  const [filterSection,   setFilterSection]   = useState<string | 'all'>('all')
  const [filterTag,       setFilterTag]       = useState<string | 'all'>('all')
  const [filterLibCat,    setFilterLibCat]    = useState<string>('')
  const [filterAllergen,  setFilterAllergen]  = useState<string>('')
  const [filterSubCat,    setFilterSubCat]    = useState<string>('')
  const [filterSubCatCat, setFilterSubCatCat] = useState<string>('')
  const [filterComponent, setFilterComponent] = useState<boolean>(false)
  const [filterLibItem,   setFilterLibItem]   = useState<string>('')  // item id
  const [libFilterItems,  setLibFilterItems]  = useState<ServiceWareRef[]>([])

  const supabase = createClient()

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  const typeFiltered = useMemo(() =>
    recipes.filter(r => tab === 'food' ? r.recipe_type === 'food' : r.recipe_type === 'cocktail'),
    [recipes, tab]
  )

  const filtered = useMemo(() => {
    let r = typeFiltered
    if (search)        r = r.filter(x => x.name.toLowerCase().includes(search.toLowerCase()))
    if (filterStage !== 'all')  r = r.filter(x => (x.recipe_stage ?? 'development') === filterStage)
    if (filterStatus !== 'all') r = r.filter(x => (x.menu_status ?? 'not_on_menu') === filterStatus)
    if (filterSeason !== 'all')  r = r.filter(x => (x.seasons ?? []).includes(filterSeason))
    if (filterSection !== 'all') r = r.filter(x => (x.menu_sections ?? []).includes(filterSection))
    if (filterTag !== 'all')     r = r.filter(x => (x.tags ?? []).includes(filterTag))
    if (filterComponent) {
      r = r.filter(x => x.is_component_recipe === true)
    }
    if (filterAllergen) {      r = r.filter(x => (x.allergens ?? []).some((a: string) => a.toLowerCase() === filterAllergen.toLowerCase()))
    }
    if (filterSubCat && filterSubCatCat) {
      // Find library IDs that match this sub-category
      const matchIds = new Set(library.filter(l => l.sub_category === filterSubCat).map(l => l.id))
      if (matchIds.size > 0) {
        r = r.filter(x => (x.ingredients ?? []).some((i: any) => matchIds.has(i.library_id)))
      }
    }
    if (filterLibItem) {
      r = r.filter(x => {
        if (filterLibCat === 'Ingredient')
          return (x.ingredients ?? []).some((i: any) => i.library_id === filterLibItem)
        if (filterLibCat === 'Plateware')
          return ((x.service_ware as any)?.plateware ?? []).some((p: any) => p.id === filterLibItem)
        if (filterLibCat === 'Glassware')
          return ((x.service_ware as any)?.glassware ?? []).some((g: any) => g.id === filterLibItem)
        if (filterLibCat === 'Flatware')
          return ((x.service_ware as any)?.flatware ?? []).some((f: any) => f.id === filterLibItem)
        // Cookware/Bakeware/Kitchen Utensils/Cooking Equipment — check step equipment
        return (x.steps ?? []).some((s: any) => (s.equipment ?? []).some((e: any) => e.id === filterLibItem)) ||
               ((x as any).equipment_needed ?? []).some((e: any) => e.id === filterLibItem)
      })
    }
    return sortRecipes(r, sortKey, sortDir)
  }, [typeFiltered, search, filterStage, filterStatus, filterSeason, filterSection, filterTag, filterLibItem, filterLibCat, filterAllergen, filterSubCat, filterSubCatCat, filterComponent, library, sortKey, sortDir])

  const foodCount  = recipes.filter(r => r.recipe_type === 'food').length
  const drinkCount = recipes.filter(r => r.recipe_type === 'cocktail').length

  const SortIcon = ({ col }: { col: SortKey }) => sortKey !== col ? (
    <span className="opacity-20 ml-1">↕</span>
  ) : (
    <span className="ml-1 text-[--accent]">{sortDir === 'asc' ? '↑' : '↓'}</span>
  )

  const STAGES: RecipeStage[] = ['development','testing','active','specials_candidate','retired']
  const STATUSES: (MenuItemStatus | 'all')[] = ['all','not_on_menu','orderable','on_menu','special']
  const SEASONS = ['spring','summer','fall','winter']

  const activeFilterCount = [filterStage, filterStatus, filterSeason, filterSection, filterTag].filter(f => f !== 'all').length + (filterLibItem ? 1 : 0) + (filterAllergen ? 1 : 0) + (filterSubCat ? 1 : 0) + (filterComponent ? 1 : 0)

  useEffect(() => {
    if (!filterLibCat) { setLibFilterItems([]); setFilterLibItem(''); return }
    const loadItems = async () => {
      if (filterLibCat === 'Ingredient') {
        // Use the library prop already loaded in RecipeApp (includes global + restaurant items)
        setLibFilterItems(library.map(l => ({ id: l.id, name: l.name })))
      } else {
        const { data } = await (supabase.from('service_ware_items') as any).select('id,name')
          .eq('category', filterLibCat).eq('is_active', true).order('name')
        setLibFilterItems((data ?? []).map((d: any) => ({ id: d.id, name: d.name })))
      }
    }
    loadItems()
    setFilterLibItem('')
  }, [filterLibCat, library])

  function clearFilters() {
    setFilterStage('all'); setFilterStatus('all'); setFilterSeason('all')
    setFilterSection('all'); setFilterTag('all'); setSearch('')
    setFilterLibCat(''); setFilterLibItem('')
    setFilterAllergen(''); setFilterSubCat(''); setFilterSubCatCat('')
    setFilterComponent(false)
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[--bg]">

      {/* ── Header ── */}
      <div className="bg-white border-b border-[--border] px-6 py-3 flex items-center gap-3 flex-shrink-0">
        <h1 className="font-serif text-lg font-medium text-[--text]">Recipes</h1>
        <div className="flex-1" />
        {prepSelected.size >= 2 && (
          <button onClick={onOpenPrepList}
            className="px-3 py-1.5 text-xs font-medium border border-[--accent] text-[--accent] rounded-lg hover:bg-[--accent-light] transition-colors">
            📋 Prep List ({prepSelected.size})
          </button>
        )}
        <div className="relative">
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search recipes…"
            className="pl-7 pr-3 py-1.5 text-xs border border-[--border-2] rounded-lg outline-none focus:border-[--accent] w-44" />
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[--hint] text-xs">🔍</span>
        </div>
        <button onClick={() => setShowFilter(f => !f)}
          className={`px-3 py-1.5 text-xs border rounded-lg transition-colors flex items-center gap-1.5 ${showFilter || activeFilterCount > 0 ? 'border-[--accent] text-[--accent] bg-[--accent-light]' : 'border-[--border-2] text-[--muted] hover:bg-[--surface-2]'}`}>
          Filters {activeFilterCount > 0 && <span className="bg-[--accent] text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center font-semibold">{activeFilterCount}</span>} {showFilter ? '▲' : '▼'}
        </button>
        {onShowUnlinked && (
          <button onClick={onShowUnlinked}
            className="px-3 py-1.5 text-xs border border-[--border-2] text-[--muted] rounded-lg hover:bg-[--surface-2] transition-colors flex items-center gap-1">
            🔗 Unlinked
          </button>
        )}
        <button onClick={() => setViewMode(v => v === 'list' ? 'calendar' : 'list')}
          className={`px-3 py-1.5 text-xs border rounded-lg transition-colors ${viewMode === 'calendar' ? 'border-[--accent] text-[--accent] bg-[--accent-light]' : 'border-[--border-2] text-[--muted] hover:bg-[--surface-2]'}`}
          title="Toggle calendar view">
          {viewMode === 'calendar' ? '☰ List' : '📅 Calendar'}
        </button>
        <button onClick={() => setShowImporter(true)}
          className="px-3 py-1.5 text-xs font-medium border border-[--accent] text-[--accent] rounded-lg hover:bg-[--accent-light] transition-colors">
          ↑ Import JSON
        </button>
        <button onClick={onNewRecipe}
          className="px-3 py-1.5 text-xs font-medium bg-[--accent] text-white rounded-lg hover:bg-[--accent-dark] transition-colors">
          + New Recipe
        </button>
      </div>

      {/* ── Importer overlay ── */}
      {showImporter && userId && restaurantId && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-[--surface] rounded-2xl shadow-2xl w-full max-w-4xl h-[90vh] overflow-hidden flex flex-col">
            <RecipeImporter
              userId={userId}
              restaurantId={restaurantId}
              onCancel={() => setShowImporter(false)}
              onComplete={count => {
                setShowImporter(false)
                onRefreshRecipes?.()
              }}
            />
          </div>
        </div>
      )}

      {/* ── Tabs ── */}
      <div className="bg-white border-b border-[--border] px-6 flex gap-0 flex-shrink-0">
        {([['food','🍽 Food', foodCount], ['drinks','🍸 Drinks', drinkCount]] as const).map(([t, label, count]) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${tab === t ? 'border-[--accent] text-[--accent]' : 'border-transparent text-[--muted] hover:text-[--text]'}`}>
            {label} <span className="ml-1 text-[--hint]">({count})</span>
          </button>
        ))}
      </div>

      {/* ── Collapsible filter ── */}
      {showFilter && (
        <div className="bg-[--surface-2] border-b border-[--border] px-6 py-3 flex flex-wrap gap-4 flex-shrink-0">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-[--hint] mb-1.5">Stage</div>
            <div className="flex gap-1">
              <button onClick={() => setFilterStage('all')}
                className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${filterStage === 'all' ? 'bg-[--accent] text-white border-[--accent]' : 'border-[--border-2] text-[--muted] hover:bg-white'}`}>
                All
              </button>
              {STAGES.map(s => (
                <button key={s} onClick={() => setFilterStage(filterStage === s ? 'all' : s)}
                  className={`text-[11px] px-2 py-0.5 rounded-full border capitalize transition-colors ${filterStage === s ? (STAGE_COLORS[s] + ' border-current') : 'border-[--border-2] text-[--muted] hover:bg-white'}`}>
                  {s.replace('_', ' ')}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-[--hint] mb-1.5">Menu Status</div>
            <div className="flex gap-1">
              {STATUSES.map(s => (
                <button key={s} onClick={() => setFilterStatus(s)}
                  className={`text-[11px] px-2 py-0.5 rounded-full border capitalize transition-colors ${filterStatus === s ? 'bg-[--accent] text-white border-[--accent]' : 'border-[--border-2] text-[--muted] hover:bg-white'}`}>
                  {s === 'all' ? 'All' : STATUS_LABELS[s]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-[--hint] mb-1.5">Menu Section</div>
            <select value={filterSection} onChange={e => setFilterSection(e.target.value)}
              className="text-xs border border-[--border-2] rounded-lg px-2.5 py-1.5 bg-white outline-none focus:border-[--accent] min-w-[160px] capitalize">
              <option value="all">All sections</option>
              {Array.from(new Set(recipes.flatMap(r => r.menu_sections ?? []))).sort().map(s => (
                <option key={s} value={s}>{s.replace('_',' ')}</option>
              ))}
            </select>
          </div>
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-[--hint] mb-1.5">Tag</div>
            <select value={filterTag} onChange={e => setFilterTag(e.target.value)}
              className="text-xs border border-[--border-2] rounded-lg px-2.5 py-1.5 bg-white outline-none focus:border-[--accent] min-w-[160px]">
              <option value="all">All tags</option>
              {Array.from(new Set(recipes.flatMap(r => r.tags ?? []))).sort().map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-[--hint] mb-1.5">Season</div>
            <div className="flex gap-1">
              <button onClick={() => setFilterSeason('all')}
                className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${filterSeason === 'all' ? 'bg-[--accent] text-white border-[--accent]' : 'border-[--border-2] text-[--muted] hover:bg-white'}`}>
                All
              </button>
              {SEASONS.map(s => (
                <button key={s} onClick={() => setFilterSeason(filterSeason === s ? 'all' : s)}
                  className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors capitalize ${filterSeason === s ? 'bg-[--accent-light] text-[--accent] border-[--accent]' : 'border-[--border-2] text-[--muted] hover:bg-white'}`}>
                  {SEASON_ICONS[s]} {s}
                </button>
              ))}
            </div>
          </div>
          {/* ── Component recipe filter ── */}
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-[--hint] mb-1.5">Recipe Type</div>
            <button
              onClick={() => setFilterComponent(f => !f)}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                filterComponent
                  ? 'bg-purple-50 border-purple-300 text-purple-700 font-medium'
                  : 'border-[--border-2] text-[--muted] hover:bg-[--surface-2]'
              }`}>
              ⚙ Component recipes only
            </button>
          </div>

          {/* ── Allergen filter ── */}
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-[--hint] mb-1.5">Contains Allergen</div>
            <select value={filterAllergen} onChange={e => setFilterAllergen(e.target.value)}
              className="text-xs border border-[--border-2] rounded-lg px-2.5 py-1.5 bg-white outline-none focus:border-[--accent]">
              <option value="">All</option>
              {ALLERGENS.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          {/* ── Ingredient Sub-category filter ── */}
          {library.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-[--hint] mb-1.5">Ingredient Type</div>
              <div className="flex gap-2">
                <select value={filterSubCatCat} onChange={e => { setFilterSubCatCat(e.target.value); setFilterSubCat('') }}
                  className="text-xs border border-[--border-2] rounded-lg px-2.5 py-1.5 bg-white outline-none focus:border-[--accent]">
                  <option value="">— Category —</option>
                  {Object.keys(SUBCATEGORIES).map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                {filterSubCatCat && SUBCATEGORIES[filterSubCatCat] && (
                  <select value={filterSubCat} onChange={e => setFilterSubCat(e.target.value)}
                    className="text-xs border border-[--border-2] rounded-lg px-2.5 py-1.5 bg-white outline-none focus:border-[--accent]">
                    <option value="">— Sub-category —</option>
                    {SUBCATEGORIES[filterSubCatCat].map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                )}
              </div>
            </div>
          )}
          {/* ── Library Item filter ── */}
          <div className="w-full border-t border-[--border] pt-3 mt-1 flex items-center gap-2 flex-wrap">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-[--hint] flex-shrink-0">By Library Item</div>
            <select value={filterLibCat} onChange={e => setFilterLibCat(e.target.value)}
              className="text-xs border border-[--border-2] rounded-lg px-2.5 py-1.5 bg-white outline-none focus:border-[--accent]">
              <option value="">— Pick category —</option>
              <option value="Ingredient">🥬 Ingredient</option>
              <option value="Plateware">🍽 Plateware</option>
              <option value="Glassware">🥂 Glassware</option>
              <option value="Flatware">🍴 Flatware</option>
              <option value="Barware">🍸 Barware</option>
              <option value="Cookware">🍳 Cookware</option>
              <option value="Bakeware">🥘 Bakeware</option>
              <option value="Kitchen Utensils">🔪 Kitchen Utensils</option>
              <option value="Cooking Equipment">⚙️ Cooking Equipment</option>
            </select>
            {filterLibCat && libFilterItems.length > 0 && (
              <select value={filterLibItem} onChange={e => setFilterLibItem(e.target.value)}
                className="text-xs border border-[--border-2] rounded-lg px-2.5 py-1.5 bg-white outline-none focus:border-[--accent] min-w-[200px]">
                <option value="">— Pick item —</option>
                {libFilterItems.map(item => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            )}
            {filterLibItem && (
              <span className="text-[11px] bg-[--accent-light] text-[--accent] border border-[--accent] rounded-full px-2 py-0.5 font-medium">
                {libFilterItems.find(i => i.id === filterLibItem)?.name}
                <button onClick={() => { setFilterLibItem(''); setFilterLibCat('') }} className="ml-1.5 hover:text-red-500">✕</button>
              </span>
            )}
          </div>
          {activeFilterCount > 0 && (
            <div className="flex items-end ml-auto">
              <button onClick={clearFilters}
                className="text-[11px] text-[--hint] hover:text-red-400 border border-[--border-2] rounded-lg px-2.5 py-1.5 transition-colors">
                ✕ Clear all
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Calendar or Table ── */}
      <div className="flex-1 overflow-auto">
        {viewMode === 'calendar' ? (
          <MenuCalendarView recipes={recipes} onSelect={onSelect} />
        ) : loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="text-sm text-[--muted]">Loading recipes…</div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-52 gap-3">
            <div className="text-4xl opacity-20">🍽</div>
            <p className="text-sm text-[--muted]">
              {search || filterStage !== 'all' || filterStatus !== 'all' ? 'No recipes match your filters.' : `No ${tab} recipes yet.`}
            </p>
            {!search && filterStage === 'all' && filterStatus === 'all' && (
              <button onClick={onNewRecipe} className="px-4 py-2 bg-[--accent] text-white text-xs font-medium rounded-lg hover:bg-[--accent-dark]">
                + Add first recipe
              </button>
            )}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white border-b border-[--border] z-10">
              <tr>
                <th className="w-10 px-3 py-2.5" />
                <th className="w-12 px-2 py-2.5" />
                <th className="px-3 py-2.5 text-left">
                  <button onClick={() => toggleSort('name')} className="text-[11px] font-semibold uppercase tracking-wide text-[--muted] hover:text-[--text] flex items-center">
                    Name <SortIcon col="name" />
                  </button>
                </th>
                <th className="px-3 py-2.5 text-left w-28">
                  <button onClick={() => toggleSort('recipe_stage')} className="text-[11px] font-semibold uppercase tracking-wide text-[--muted] hover:text-[--text] flex items-center">
                    Stage <SortIcon col="recipe_stage" />
                  </button>
                </th>
                <th className="px-3 py-2.5 text-left w-28">
                  <button onClick={() => toggleSort('menu_status')} className="text-[11px] font-semibold uppercase tracking-wide text-[--muted] hover:text-[--text] flex items-center">
                    Status <SortIcon col="menu_status" />
                  </button>
                </th>
                <th className="px-3 py-2.5 text-left w-24 hidden md:table-cell">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-[--muted]">Season</span>
                </th>
                <th className="px-3 py-2.5 text-left w-24 hidden lg:table-cell">
                  <button onClick={() => toggleSort('created_at')} className="text-[11px] font-semibold uppercase tracking-wide text-[--muted] hover:text-[--text] flex items-center">
                    Added <SortIcon col="created_at" />
                  </button>
                </th>
                <th className="px-3 py-2.5 text-left w-16">
                  <button onClick={() => toggleSort('ranking')} className="text-[11px] font-semibold uppercase tracking-wide text-[--muted] hover:text-[--text] flex items-center">
                    ★ <SortIcon col="ranking" />
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => {
                const stage  = r.recipe_stage ?? 'development'
                const status = r.menu_status  ?? 'not_on_menu'
                const isPrepSelected = prepSelected.has(r.id)
                const isEditing = editingId === r.id
                return (
                  <>
                  <tr key={r.id}
                    className={`border-b ${isEditing ? 'border-[--accent]' : 'border-[--border]'} cursor-pointer transition-colors hover:bg-[--accent-light]/30 group ${i % 2 === 0 ? 'bg-white' : 'bg-[--surface-2]/40'}`}>

                    {/* Prep select checkbox */}
                    <td className="px-3 py-3" onClick={e => { e.stopPropagation(); onTogglePrepSelect(r.id) }}>
                      <div className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] transition-colors ${isPrepSelected ? 'bg-[--accent] border-[--accent] text-white' : 'border-[--border-2] hover:border-[--accent]'}`}>
                        {isPrepSelected ? '✓' : ''}
                      </div>
                    </td>

                    {/* Thumbnail */}
                    <td className="px-2 py-3" onClick={() => onSelect(r.id)}>
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-lg flex-shrink-0 ${r.recipe_type === 'cocktail' ? 'bg-purple-50' : 'bg-[--accent-light]'}`}>
                        {r.recipe_type === 'cocktail' ? '🍸' : '🍽'}
                      </div>
                    </td>

                    {/* Name + edit toggle */}
                    <td className="px-3 py-3 min-w-0" onClick={() => onSelect(r.id)}>
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-[--text] text-sm truncate max-w-xs">{r.name}</div>
                          {r.menu_name && r.menu_name !== r.name && (
                            <div className="text-[11px] text-[--muted] truncate max-w-xs mt-0.5">
                              menu: {r.menu_name}
                            </div>
                          )}
                          {r.is_special && <span className="text-[10px] text-amber-600">⭐ Special</span>}
                          {r.description && (
                            <div className="text-[11px] text-[--hint] truncate max-w-xs mt-0.5">{r.description}</div>
                          )}
                          {(r.menu_sections ?? []).length > 0 && (
                            <div className="flex gap-1 mt-0.5 flex-wrap">
                              {(r.menu_sections ?? []).map(s => (
                                <span key={s} className="text-[9px] bg-[--accent-light] text-[--accent] px-1.5 py-0.5 rounded-full capitalize">{s.replace('_',' ')}</span>
                              ))}
                            </div>
                          )}
                          {r.tags?.length > 0 && (
                            <div className="flex gap-1 mt-1 flex-wrap">
                              {r.tags.slice(0,4).map(t => (
                                <span key={t} className="text-[10px] bg-[--surface-2] text-[--muted] px-1.5 py-0.5 rounded-full border border-[--border]">{t}</span>
                              ))}
                              {r.tags.length > 4 && <span className="text-[10px] text-[--hint]">+{r.tags.length-4}</span>}
                            </div>
                          )}
                        </div>
                        {/* Edit pencil */}
                        {onUpdateRecipe && (
                          <button
                            onClick={e => { e.stopPropagation(); setEditingId(isEditing ? null : r.id) }}
                            className={`flex-shrink-0 text-[11px] p-1 rounded transition-colors mt-0.5 ${isEditing ? 'text-[--accent]' : 'text-[--hint] opacity-0 group-hover:opacity-100 hover:text-[--accent]'}`}>
                            ✎
                          </button>
                        )}
                      </div>
                    </td>

                    {/* Stage */}
                    <td className="px-3 py-3" onClick={() => onSelect(r.id)}>
                      <span className={`text-[11px] px-2 py-0.5 rounded-full capitalize font-medium ${STAGE_COLORS[stage]}`}>
                        <span className="inline-block w-1.5 h-1.5 rounded-full mr-1 align-middle" style={{ background: STAGE_DOTS[stage] }} />
                        {stage.replace('_',' ')}
                      </span>
                    </td>

                    {/* Status */}
                    <td className="px-3 py-3" onClick={() => onSelect(r.id)}>
                      <span className={`text-[11px] font-medium ${STATUS_COLORS[status]}`}>
                        {STATUS_LABELS[status]}
                      </span>
                    </td>

                    {/* Season */}
                    <td className="px-3 py-3 hidden md:table-cell" onClick={() => onSelect(r.id)}>
                      <div className="flex gap-0.5">
                        {(r.seasons ?? []).map(s => (
                          <span key={s} title={s} className="text-sm">{SEASON_ICONS[s]}</span>
                        ))}
                      </div>
                    </td>

                    {/* Date */}
                    <td className="px-3 py-3 hidden lg:table-cell" onClick={() => onSelect(r.id)}>
                      <span className="text-[11px] text-[--muted]">
                        {r.created_at ? new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                      </span>
                    </td>

                    {/* Ranking */}
                    <td className="px-3 py-3" onClick={() => onSelect(r.id)}>
                      {r.ranking ? (
                        <span className="text-[11px] text-amber-500">{'★'.repeat(r.ranking)}</span>
                      ) : (
                        <span className="text-[11px] text-[--hint]">—</span>
                      )}
                    </td>
                  </tr>

                  {/* ── Inline edit row ── */}
                  {isEditing && onUpdateRecipe && (
                    <tr key={`${r.id}-edit`} className="bg-[--accent-light]/20 border-b border-[--accent]">
                      <td colSpan={8} className="px-4 py-3">
                        <InlineEditRow
                          recipe={r}
                          onSave={async updates => {
                            await onUpdateRecipe(r.id, updates)
                            setEditingId(null)
                          }}
                          onCancel={() => setEditingId(null)}
                        />
                      </td>
                    </tr>
                  )}
                  </>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Footer count ── */}
      <div className="border-t border-[--border] bg-white px-6 py-2 flex items-center flex-shrink-0">
        <span className="text-[11px] text-[--hint]">
          {filtered.length} recipe{filtered.length !== 1 ? 's' : ''}
          {filtered.length !== typeFiltered.length && ` of ${typeFiltered.length}`}
        </span>
        <span className="ml-auto text-[10px] text-[--hint]">Powered by CulminaRMS</span>
      </div>
    </div>
  )
}

// ── InlineEditRow ─────────────────────────────────────────────
function InlineEditRow({ recipe, onSave, onCancel }: {
  recipe: Recipe
  onSave: (updates: Partial<Recipe>) => Promise<void>
  onCancel: () => void
}) {
  const [saving, setSaving] = useState(false)
  const [vals, setVals] = useState({
    name:             recipe.name            ?? '',
    description:      recipe.description     ?? '',
    menu_name:        recipe.menu_name        ?? '',
    menu_description: recipe.menu_description ?? '',
    internal_notes:   recipe.internal_notes   ?? '',
    server_notes:     recipe.server_notes     ?? '',
  })
  const [tags, setTags] = useState<string[]>(recipe.tags ?? [])
  const [tagInput, setTagInput] = useState('')

  function addTag(t: string) {
    const clean = t.trim().toLowerCase()
    if (clean && !tags.includes(clean)) setTags(prev => [...prev, clean])
    setTagInput('')
  }
  function removeTag(t: string) { setTags(prev => prev.filter(x => x !== t)) }

  async function save() {
    setSaving(true)
    await onSave({ ...vals, tags })
    setSaving(false)
  }

  const fields = [
    { key: 'name' as const,             label: 'Recipe name',        wide: false },
    { key: 'description' as const,      label: 'Description',        wide: true  },
    { key: 'menu_name' as const,        label: 'Menu name',          wide: false },
    { key: 'menu_description' as const, label: 'Menu description',   wide: true  },
    { key: 'internal_notes' as const,   label: 'Internal notes',     wide: true  },
    { key: 'server_notes' as const,     label: 'Server notes (FOH)', wide: true  },
  ]

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        {fields.map(f => (
          <div key={f.key} className={f.wide ? 'col-span-2' : ''}>
            <label className="block text-[10px] font-medium text-[--muted] mb-1 uppercase tracking-wide">{f.label}</label>
            {f.wide ? (
              <textarea rows={2} value={vals[f.key]}
                onChange={e => setVals(p => ({ ...p, [f.key]: e.target.value }))}
                className="w-full text-xs border border-[--border-2] rounded-lg px-2.5 py-1.5 bg-white outline-none focus:border-[--accent] resize-none" />
            ) : (
              <input value={vals[f.key]}
                onChange={e => setVals(p => ({ ...p, [f.key]: e.target.value }))}
                className="w-full text-xs border border-[--border-2] rounded-lg px-2.5 py-1.5 bg-white outline-none focus:border-[--accent]" />
            )}
          </div>
        ))}
      </div>

      {/* Tags */}
      <div>
        <label className="block text-[10px] font-medium text-[--muted] mb-1.5 uppercase tracking-wide">Tags</label>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {tags.map(t => (
            <span key={t} className="inline-flex items-center gap-1 text-[11px] bg-[--surface-2] text-[--muted] px-2 py-0.5 rounded-full border border-[--border]">
              {t}
              <button onClick={() => removeTag(t)} className="text-[--hint] hover:text-red-400 text-[10px]">✕</button>
            </span>
          ))}
          <input
            value={tagInput}
            onChange={e => setTagInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(tagInput) }
            }}
            onBlur={() => { if (tagInput.trim()) addTag(tagInput) }}
            placeholder="+ add tag"
            className="text-[11px] border-0 outline-none bg-transparent text-[--accent] placeholder:text-[--hint] min-w-[80px]"
          />
        </div>
      </div>

      <div className="flex gap-2">
        <button onClick={save} disabled={saving}
          className="px-4 py-1.5 bg-[--accent] text-white text-xs font-medium rounded-lg hover:bg-[--accent-dark] disabled:opacity-50">
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        <button onClick={onCancel}
          className="px-4 py-1.5 border border-[--border-2] text-[--muted] text-xs rounded-lg hover:bg-[--surface-2]">
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── MenuCalendarView ─────────────────────────────────────────
function MenuCalendarView({ recipes, onSelect }: { recipes: Recipe[]; onSelect: (id: string) => void }) {
  const today = new Date()
  const [viewDate, setViewDate] = useState(today)

  const year = viewDate.getFullYear()
  const month = viewDate.getMonth()
  const firstDay = new Date(year, month, 1)

  const scheduled = recipes.filter(r => r.menu_start_date || r.menu_end_date)
  const currentlyActive = scheduled.filter(r => {
    const start = r.menu_start_date ? new Date(r.menu_start_date) : null
    const end = r.menu_end_date ? new Date(r.menu_end_date) : null
    const now = new Date()
    if (start && end) return now >= start && now <= end
    if (start) return now >= start
    if (end) return now <= end
    return false
  })

  const startOfGrid = new Date(firstDay)
  startOfGrid.setDate(startOfGrid.getDate() - startOfGrid.getDay())
  const days: Date[] = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(startOfGrid)
    d.setDate(d.getDate() + i)
    days.push(d)
  }

  function recipesOnDay(day: Date) {
    const dayStr = day.toISOString().split('T')[0]
    return scheduled.filter(r => {
      const start = r.menu_start_date ?? null
      const end = r.menu_end_date ?? null
      if (start && end) return dayStr >= start && dayStr <= end
      if (start) return dayStr === start
      if (end) return dayStr === end
      return false
    })
  }

  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

  return (
    <div className="flex flex-col h-full p-6">
      {currentlyActive.length > 0 && (
        <div className="mb-4 p-3 bg-green-50 border border-green-100 rounded-xl">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-green-600 mb-2">Currently on menu</div>
          <div className="flex flex-wrap gap-1.5">
            {currentlyActive.map(r => (
              <button key={r.id} onClick={() => onSelect(r.id)}
                className="text-[11px] px-2.5 py-0.5 bg-white border border-green-200 text-green-800 rounded-full hover:bg-green-50 font-medium">
                {r.name}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="flex items-center justify-between mb-3">
        <button onClick={() => setViewDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
          className="text-xs text-[--muted] hover:text-[--text] px-2 py-1 border border-[--border-2] rounded-lg">← Prev</button>
        <span className="text-sm font-medium text-[--text]">{MONTHS[month]} {year}</span>
        <button onClick={() => setViewDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
          className="text-xs text-[--muted] hover:text-[--text] px-2 py-1 border border-[--border-2] rounded-lg">Next →</button>
      </div>
      <div className="grid grid-cols-7 mb-1">
        {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
          <div key={d} className="text-center text-[10px] font-semibold uppercase tracking-wide text-[--hint] py-1">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 flex-1 gap-px bg-[--border]">
        {days.map((day, i) => {
          const inMonth = day.getMonth() === month
          const isToday = day.toDateString() === today.toDateString()
          const dayStr = day.toISOString().split('T')[0]
          const dayRecipes = recipesOnDay(day)
          return (
            <div key={i} className={`bg-white p-1 min-h-[70px] ${!inMonth ? 'opacity-30' : ''}`}>
              <div className={`text-[11px] font-medium mb-0.5 w-5 h-5 flex items-center justify-center rounded-full ${isToday ? 'bg-[--accent] text-white' : 'text-[--muted]'}`}>
                {day.getDate()}
              </div>
              {dayRecipes.slice(0,3).map(r => (
                <button key={r.id} onClick={() => onSelect(r.id)}
                  className="w-full text-left text-[9px] px-1 py-0.5 mb-0.5 bg-[--accent-light] text-[--accent] rounded truncate hover:bg-[--accent] hover:text-white transition-colors block">
                  {r.name}
                </button>
              ))}
              {dayRecipes.length > 3 && <div className="text-[9px] text-[--hint] px-1">+{dayRecipes.length-3}</div>}
            </div>
          )
        })}
      </div>
      {scheduled.length === 0 && (
        <div className="mt-6 text-center text-xs text-[--hint]">No recipes have menu date ranges. Add start/end dates in recipe Overview → Menu Presentation.</div>
      )}
    </div>
  )
}
