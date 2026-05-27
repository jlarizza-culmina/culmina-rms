'use client'
import { useState, useMemo } from 'react'
import type { Recipe, MenuItemStatus, RecipeStage } from '@/lib/types'

interface Props {
  recipes: Recipe[]
  loading: boolean
  onSelect: (id: string) => void
  onNewRecipe: () => void
  prepSelected: Set<string>
  onTogglePrepSelect: (id: string) => void
  onOpenPrepList: () => void
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
  recipes, loading, onSelect, onNewRecipe,
  prepSelected, onTogglePrepSelect, onOpenPrepList,
}: Props) {
  const [tab,         setTab]         = useState<RecipeTab>('food')
  const [search,      setSearch]      = useState('')
  const [showFilter,  setShowFilter]  = useState(false)
  const [sortKey,     setSortKey]     = useState<SortKey>('created_at')
  const [sortDir,     setSortDir]     = useState<'asc' | 'desc'>('desc')
  const [filterStage, setFilterStage] = useState<RecipeStage | 'all'>('all')
  const [filterStatus,setFilterStatus]= useState<MenuItemStatus | 'all'>('all')
  const [filterSeason,setFilterSeason]= useState<string | 'all'>('all')

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
    if (filterSeason !== 'all') r = r.filter(x => (x.seasons ?? []).includes(filterSeason))
    return sortRecipes(r, sortKey, sortDir)
  }, [typeFiltered, search, filterStage, filterStatus, filterSeason, sortKey, sortDir])

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
          className={`px-3 py-1.5 text-xs border rounded-lg transition-colors ${showFilter ? 'border-[--accent] text-[--accent] bg-[--accent-light]' : 'border-[--border-2] text-[--muted] hover:bg-[--surface-2]'}`}>
          Filter {showFilter ? '▲' : '▼'}
        </button>
        <button onClick={onNewRecipe}
          className="px-3 py-1.5 text-xs font-medium bg-[--accent] text-white rounded-lg hover:bg-[--accent-dark] transition-colors">
          + New Recipe
        </button>
      </div>

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
        </div>
      )}

      {/* ── Table ── */}
      <div className="flex-1 overflow-auto">
        {loading ? (
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
                return (
                  <tr key={r.id}
                    onClick={() => onSelect(r.id)}
                    className={`border-b border-[--border] cursor-pointer transition-colors hover:bg-[--accent-light]/30 ${i % 2 === 0 ? 'bg-white' : 'bg-[--surface-2]/40'}`}>

                    {/* Prep select checkbox */}
                    <td className="px-3 py-3" onClick={e => { e.stopPropagation(); onTogglePrepSelect(r.id) }}>
                      <div className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] transition-colors ${isPrepSelected ? 'bg-[--accent] border-[--accent] text-white' : 'border-[--border-2] hover:border-[--accent]'}`}>
                        {isPrepSelected ? '✓' : ''}
                      </div>
                    </td>

                    {/* Thumbnail */}
                    <td className="px-2 py-3">
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-lg flex-shrink-0 ${r.recipe_type === 'cocktail' ? 'bg-purple-50' : 'bg-[--accent-light]'}`}>
                        {r.recipe_type === 'cocktail' ? '🍸' : '🍽'}
                      </div>
                    </td>

                    {/* Name */}
                    <td className="px-3 py-3 min-w-0">
                      <div className="font-medium text-[--text] text-sm truncate max-w-xs">{r.name}</div>
                      {r.menu_name && r.menu_name !== r.name && (
                        <div className="text-[11px] text-[--muted] truncate max-w-xs mt-0.5">
                          on menu as: {r.menu_name}
                        </div>
                      )}
                      {r.is_special && <span className="text-[10px] text-amber-600">⭐ Special</span>}
                      {r.tags?.length > 0 && (
                        <div className="flex gap-1 mt-1 flex-wrap">
                          {r.tags.slice(0,3).map(t => (
                            <span key={t} className="text-[10px] bg-[--surface-2] text-[--muted] px-1.5 py-0.5 rounded-full border border-[--border]">{t}</span>
                          ))}
                          {r.tags.length > 3 && <span className="text-[10px] text-[--hint]">+{r.tags.length-3}</span>}
                        </div>
                      )}
                    </td>

                    {/* Stage */}
                    <td className="px-3 py-3">
                      <span className={`text-[11px] px-2 py-0.5 rounded-full capitalize font-medium ${STAGE_COLORS[stage]}`}>
                        <span className="inline-block w-1.5 h-1.5 rounded-full mr-1 align-middle" style={{ background: STAGE_DOTS[stage] }} />
                        {stage.replace('_',' ')}
                      </span>
                    </td>

                    {/* Status */}
                    <td className="px-3 py-3">
                      <span className={`text-[11px] font-medium ${STATUS_COLORS[status]}`}>
                        {STATUS_LABELS[status]}
                      </span>
                    </td>

                    {/* Season */}
                    <td className="px-3 py-3 hidden md:table-cell">
                      <div className="flex gap-0.5">
                        {(r.seasons ?? []).map(s => (
                          <span key={s} title={s} className="text-sm">{SEASON_ICONS[s]}</span>
                        ))}
                      </div>
                    </td>

                    {/* Date */}
                    <td className="px-3 py-3 hidden lg:table-cell">
                      <span className="text-[11px] text-[--muted]">
                        {r.created_at ? new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                      </span>
                    </td>

                    {/* Ranking */}
                    <td className="px-3 py-3">
                      {r.ranking ? (
                        <span className="text-[11px] text-amber-500">{'★'.repeat(r.ranking)}</span>
                      ) : (
                        <span className="text-[11px] text-[--hint]">—</span>
                      )}
                    </td>
                  </tr>
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
