'use client'
import { useState, useMemo } from 'react'
import type { Recipe, Step, CookPhase, LibraryIngredient, Vendor } from '@/lib/types'
import CostingTab from './CostingTab'
import { printRecipeCard, recipeToText } from '@/lib/recipeExport'

type Tab = 'overview' | 'plan' | 'nutrition' | 'shopping' | 'costing'

const CAT_ORDER = ['produce','meat','seafood','dairy','bakery','pantry','spices','spirits','mixers','frozen','beverages','other']
const CAT_LABELS: Record<string, string> = {
  produce:'🥦 Produce', meat:'🥩 Meat', seafood:'🐟 Seafood', dairy:'🧀 Dairy',
  bakery:'🍞 Bakery', pantry:'🥫 Pantry', spices:'🌿 Spices & Herbs',
  spirits:'🍶 Spirits', mixers:'🍋 Mixers & Syrups', frozen:'❄️ Frozen',
  beverages:'🧃 Beverages', other:'📦 Other',
}
const PHASE_META: Record<CookPhase, { label: string; icon: string; color: string }> = {
  mise:  { label: 'Mise en Place',  icon: '🔪', color: 'bg-blue-50 text-blue-700 border-blue-200' },
  cook:  { label: 'Cook',          icon: '🔥', color: 'bg-orange-50 text-orange-700 border-orange-200' },
  plate: { label: 'Plate & Finish', icon: '✨', color: 'bg-green-50 text-green-700 border-green-200' },
}

function scaleAmt(amount: number, ratio: number): string {
  const v = amount * ratio
  if (v <= 0) return '—'
  if (v >= 10) return String(Math.round(v))
  const fracs: [number, string][] = [[.125,'⅛'],[.25,'¼'],[.333,'⅓'],[.5,'½'],[.667,'⅔'],[.75,'¾']]
  for (const [f, sym] of fracs) if (Math.abs(v - f) < 0.06) return sym
  const r = Math.round(v * 4) / 4
  return r === Math.floor(r) ? String(r) : r.toFixed(2).replace(/0+$/, '')
}

interface Props {
  recipe: Recipe
  servings: number
  checks: Set<string>
  activeTab: Tab
  library: LibraryIngredient[]
  vendors: Vendor[]
  userId: string
  onTabChange: (t: Tab) => void
  onServingsChange: (delta: number) => void
  onToggleCheck: (id: string) => void
  onClearChecks: () => void
  onDelete: () => void
  onCookMode: () => void
  onUpdateRecipe: (id: string, updates: Partial<Recipe>) => Promise<void>
  onSaveVersion: (id: string, note: string) => Promise<void>
}

export default function RecipeView({
  recipe, servings, checks, activeTab, library, vendors, userId,
  onTabChange, onServingsChange, onToggleCheck, onClearChecks,
  onDelete, onCookMode, onUpdateRecipe, onSaveVersion
}: Props) {
  const ratio = servings / recipe.base_servings
  const isCocktail = recipe.recipe_type === 'cocktail'

  // ── Local UI state ───────────────────────────────────────
  const [showExport,       setShowExport]       = useState(false)
  const [showVersionModal, setShowVersionModal] = useState(false)
  const [versionNote,      setVersionNote]      = useState('')
  const [savingVersion,    setSavingVersion]    = useState(false)
  const [showAllergenEdit, setShowAllergenEdit] = useState(false)
  const [copied,           setCopied]           = useState(false)

  // ── Auto-detect allergens from linked library ingredients ─
  const detectedAllergens = useMemo(() => {
    const set = new Set<string>()
    recipe.ingredients.forEach(ing => {
      const lib = ing.library_id ? library.find(l => l.id === ing.library_id) : null
      lib?.allergens?.forEach(a => set.add(a))
    })
    return [...set]
  }, [recipe.ingredients, library])

  const manualAllergens = recipe.allergens ?? []
  const allAllergens    = [...new Set([...manualAllergens, ...detectedAllergens])]
  const dietary         = recipe.dietary ?? []

  const ALL_ALLERGENS = ['gluten','dairy','eggs','nuts','peanuts','shellfish','soy','sesame','fish']
  const ALL_DIETARY   = ['vegetarian','vegan','gluten-free','dairy-free','halal','kosher']

  async function toggleAllergen(a: string) {
    const current = recipe.allergens ?? []
    const updated = current.includes(a) ? current.filter(x => x !== a) : [...current, a]
    await onUpdateRecipe(recipe.id, { allergens: updated })
  }

  async function toggleDietary(d: string) {
    const current = recipe.dietary ?? []
    const updated = current.includes(d) ? current.filter(x => x !== d) : [...current, d]
    await onUpdateRecipe(recipe.id, { dietary: updated })
  }

  async function doSaveVersion() {
    setSavingVersion(true)
    await onSaveVersion(recipe.id, versionNote)
    setSavingVersion(false)
    setShowVersionModal(false)
    setVersionNote('')
  }

  function copyAsText() {
    navigator.clipboard.writeText(recipeToText(recipe, servings))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview',  label: 'Overview' },
    { key: 'plan',      label: isCocktail ? 'Build Guide' : 'Cook Plan' },
    { key: 'nutrition', label: isCocktail ? 'Stats' : 'Nutrition' },
    { key: 'shopping',  label: isCocktail ? 'Bar Stock' : 'Shopping' },
    { key: 'costing',   label: '💰 Costing' },
  ]

  return (
    <div className="flex flex-col flex-1 overflow-hidden">

      {/* ── Header ── */}
      <div className="bg-white border-b border-[--border] px-6 pt-5 pb-0">
        <div className="flex items-start justify-between mb-1.5">
          <h1 className="font-serif text-xl font-medium text-[--text] leading-snug pr-3 flex items-center gap-2">
            {isCocktail ? '🍸' : ''} {recipe.name}
            {(recipe.version ?? 1) > 1 && (
              <span className="text-[10px] font-sans font-normal text-[--hint] bg-[--surface-2] px-1.5 py-0.5 rounded-full">
                v{recipe.version}
              </span>
            )}
          </h1>
          <div className="flex gap-1.5 flex-shrink-0">
            <button onClick={onCookMode} title={isCocktail ? 'Build guide' : 'Cook mode'}
              className="px-3 py-1.5 rounded-lg border border-[--border-2] text-xs text-[--muted] hover:bg-[--surface-2] transition-colors">
              {isCocktail ? '🍹 Build' : '👨‍🍳 Cook'}
            </button>

            {/* Export dropdown */}
            <div className="relative">
              <button onClick={() => setShowExport(v => !v)}
                className="px-3 py-1.5 rounded-lg border border-[--border-2] text-xs text-[--muted] hover:bg-[--surface-2] transition-colors">
                ↓ Export
              </button>
              {showExport && (
                <div className="absolute right-0 top-full mt-1 bg-white border border-[--border-2] rounded-xl shadow-lg py-1 z-20 min-w-[160px]"
                  onMouseLeave={() => setShowExport(false)}>
                  <button onClick={() => { printRecipeCard(recipe, library, servings); setShowExport(false) }}
                    className="w-full text-left px-4 py-2 text-xs text-[--text] hover:bg-[--surface-2] flex items-center gap-2">
                    🖨 Print recipe card
                  </button>
                  <button onClick={() => { copyAsText(); setShowExport(false) }}
                    className="w-full text-left px-4 py-2 text-xs text-[--text] hover:bg-[--surface-2] flex items-center gap-2">
                    {copied ? '✓ Copied!' : '📋 Copy as text'}
                  </button>
                </div>
              )}
            </div>

            {/* Save version */}
            <button onClick={() => setShowVersionModal(true)} title="Save a version snapshot"
              className="px-3 py-1.5 rounded-lg border border-[--border-2] text-xs text-[--muted] hover:bg-[--surface-2] transition-colors">
              📌 v{recipe.version ?? 1}
            </button>

            <button onClick={onDelete} className="text-[--hint] hover:text-red-500 text-sm px-1.5 transition-colors" title="Delete">✕</button>
          </div>
        </div>
        {recipe.description && (
          <p className="text-xs text-[--muted] italic mb-2 leading-relaxed">{recipe.description}</p>
        )}
        <div className="flex gap-3 flex-wrap mb-2 text-xs text-[--muted]">
          {recipe.prep_time > 0 && <span>🕐 Prep: {recipe.prep_time}min</span>}
          {recipe.cook_time > 0 && <span>{isCocktail ? '🧊' : '🔥'} {isCocktail ? 'Build' : 'Cook'}: {recipe.cook_time}min</span>}
          <span>⏱ Total: {recipe.prep_time + recipe.cook_time}min</span>
          {isCocktail && recipe.cocktail_details?.abv && <span>🍶 ABV: ~{recipe.cocktail_details.abv}%</span>}
        </div>
        {recipe.tags?.length > 0 && (
          <div className="flex gap-1.5 flex-wrap mb-2">
            {recipe.tags.map(t => (
              <span key={t} className="text-[10px] px-2 py-0.5 rounded-full bg-[--surface-2] text-[--muted] border border-[--border]">{t}</span>
            ))}
          </div>
        )}

        {/* ── Allergen + dietary bar ── */}
        {(allAllergens.length > 0 || dietary.length > 0 || showAllergenEdit) && (
          <div className="mb-2 space-y-1">
            {allAllergens.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] font-medium text-amber-700">⚠ Contains:</span>
                {allAllergens.map(a => (
                  <span key={a} className="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 capitalize">
                    {a}
                    {detectedAllergens.includes(a) && !manualAllergens.includes(a) && (
                      <span className="ml-1 opacity-50">auto</span>
                    )}
                  </span>
                ))}
              </div>
            )}
            {dietary.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] font-medium text-[--green]">✓</span>
                {dietary.map(d => (
                  <span key={d} className="text-[10px] px-2 py-0.5 rounded-full bg-green-50 text-[--green] border border-green-200 capitalize">{d}</span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Allergen edit toggle */}
        <button onClick={() => setShowAllergenEdit(v => !v)}
          className="text-[10px] text-[--hint] hover:text-[--muted] mb-2 underline block">
          {showAllergenEdit ? 'Done editing allergens' : allAllergens.length === 0 && dietary.length === 0 ? '+ Add allergen / dietary flags' : 'Edit allergen flags'}
        </button>

        {showAllergenEdit && (
          <div className="mb-3 p-3 bg-[--surface-2] rounded-xl border border-[--border] space-y-2">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-[--hint] mb-1.5">Allergens</div>
              <div className="flex flex-wrap gap-1.5">
                {ALL_ALLERGENS.map(a => {
                  const isDetected = detectedAllergens.includes(a)
                  const isManual   = manualAllergens.includes(a)
                  const isActive   = isDetected || isManual
                  return (
                    <button key={a} onClick={() => toggleAllergen(a)}
                      className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors capitalize ${isActive ? 'bg-amber-50 border-amber-300 text-amber-700' : 'border-[--border-2] text-[--muted] hover:bg-[--surface-2]'}`}>
                      {a}{isDetected && !isManual ? ' (auto)' : ''}
                    </button>
                  )
                })}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-[--hint] mb-1.5">Dietary</div>
              <div className="flex flex-wrap gap-1.5">
                {ALL_DIETARY.map(d => (
                  <button key={d} onClick={() => toggleDietary(d)}
                    className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors capitalize ${dietary.includes(d) ? 'bg-green-50 border-green-300 text-[--green]' : 'border-[--border-2] text-[--muted] hover:bg-[--surface-2]'}`}>
                    {d}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Serving scaler */}
        <div className="flex items-center gap-2 pb-3 text-xs text-[--muted]">
          <button onClick={() => onServingsChange(-1)} className="w-6 h-6 rounded-full border border-[--border-2] flex items-center justify-center text-base font-light hover:bg-[--surface-2] transition-colors">−</button>
          <span className="font-serif text-lg text-[--accent] min-w-[24px] text-center font-medium">{servings}</span>
          <button onClick={() => onServingsChange(1)} className="w-6 h-6 rounded-full border border-[--border-2] flex items-center justify-center text-base font-light hover:bg-[--surface-2] transition-colors">+</button>
          <span>{isCocktail ? (servings === 1 ? 'cocktail' : 'cocktails') : 'servings'}</span>
          {ratio !== 1 && <span className="ml-1 text-[--accent] font-medium">({ratio > 1 ? '+' : ''}{Math.round((ratio - 1) * 100)}%)</span>}
        </div>

        {/* Tabs */}
        <div className="flex -mb-px">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => onTabChange(t.key)}
              className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === t.key ? 'text-[--accent] border-[--accent]' : 'text-[--muted] border-transparent hover:text-[--text]'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab Content ── */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {activeTab === 'overview' && <OverviewTab recipe={recipe} ratio={ratio} isCocktail={isCocktail} />}
        {activeTab === 'plan' && <PlanTab recipe={recipe} isCocktail={isCocktail} />}
        {activeTab === 'nutrition' && <NutritionTab recipe={recipe} ratio={ratio} isCocktail={isCocktail} servings={servings} />}
        {activeTab === 'shopping' && (
          <ShoppingTab recipe={recipe} ratio={ratio} checks={checks} onToggle={onToggleCheck} onClear={onClearChecks} />
        )}
        {activeTab === 'costing' && (
          <CostingTab
            recipe={recipe}
            servings={servings}
            library={library}
            vendors={vendors}
            userId={userId}
            onUpdateRecipe={onUpdateRecipe}
          />
        )}
      </div>

      {/* ── Version snapshot modal ── */}
      {showVersionModal && (
        <div className="fixed inset-0 bg-black/35 flex items-center justify-center z-50"
          onClick={e => { if (e.target === e.currentTarget) setShowVersionModal(false) }}>
          <div className="bg-white rounded-2xl p-6 w-[400px] max-w-[94vw] fade-in shadow-lg">
            <h2 className="font-serif text-lg font-medium text-[--text] mb-1">Save version snapshot</h2>
            <p className="text-xs text-[--muted] mb-4">
              Creates an archived copy of <strong>{recipe.name}</strong> at v{recipe.version ?? 1}.
              The live recipe becomes v{(recipe.version ?? 1) + 1}. Snapshots can be viewed and restored later.
            </p>
            <label className="block text-[11px] font-medium text-[--muted] mb-1.5">Version note (optional)</label>
            <input
              value={versionNote}
              onChange={e => setVersionNote(e.target.value)}
              placeholder={`e.g. "Before adding guanciale", "Opening menu version"`}
              className="w-full px-3 py-2 text-xs border border-[--border-2] rounded-lg outline-none focus:border-[--accent] mb-4"
              autoFocus
              onKeyDown={e => e.key === 'Enter' && doSaveVersion()}
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowVersionModal(false)}
                className="px-4 py-2 text-xs text-[--muted] border border-[--border-2] rounded-lg hover:bg-[--surface-2]">Cancel</button>
              <button onClick={doSaveVersion} disabled={savingVersion}
                className="px-4 py-2 text-xs font-medium bg-[--accent] text-white rounded-lg hover:bg-[--accent-dark] disabled:opacity-50 flex items-center gap-1.5">
                {savingVersion ? <><span className="spinner" />Saving…</> : '📌 Save snapshot'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Overview ──────────────────────────────────────────────────────────────────
function OverviewTab({ recipe, ratio, isCocktail }: { recipe: Recipe; ratio: number; isCocktail: boolean }) {
  return (
    <div>
      {isCocktail && recipe.cocktail_details && (
        <div className="mb-5 p-4 bg-[--surface-2] rounded-xl border border-[--border] grid grid-cols-2 gap-3">
          <Detail label="Base Spirit" value={recipe.cocktail_details.baseSpirit} />
          <Detail label="Technique" value={recipe.cocktail_details.technique} capitalize />
          <Detail label="Glassware" value={recipe.cocktail_details.glassware} />
          <Detail label="Ice" value={recipe.cocktail_details.ice} capitalize />
          <Detail label="Garnish" value={recipe.cocktail_details.garnish} />
          <Detail label="ABV" value={`~${recipe.cocktail_details.abv}%`} />
        </div>
      )}
      <h3 className="font-serif text-sm font-medium text-[--text] mb-3 flex items-baseline gap-2">
        Ingredients <span className="font-sans text-[11px] font-normal text-[--muted]">{recipe.ingredients.length} items</span>
      </h3>
      <div className="grid grid-cols-2 gap-1.5">
        {recipe.ingredients.map(ing => (
          <div key={ing.id} className="flex items-center gap-2 px-3 py-2 bg-white rounded-lg border border-[--border]">
            <span className="text-xs font-medium text-[--accent] min-w-[48px] flex-shrink-0">
              {scaleAmt(ing.amount, ratio)}{ing.unit ? ` ${ing.unit}` : ''}
            </span>
            <span className="text-xs text-[--text] leading-snug">{ing.name}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Detail({ label, value, capitalize }: { label: string; value: string; capitalize?: boolean }) {
  return (
    <div>
      <div className="text-[10px] text-[--hint] uppercase tracking-wide mb-0.5">{label}</div>
      <div className={`text-xs font-medium text-[--text] ${capitalize ? 'capitalize' : ''}`}>{value}</div>
    </div>
  )
}

// ── Cook Plan ─────────────────────────────────────────────────────────────────
function PlanTab({ recipe, isCocktail }: { recipe: Recipe; isCocktail: boolean }) {
  const phases: CookPhase[] = isCocktail ? ['mise', 'cook', 'plate'] : ['mise', 'cook', 'plate']
  const grouped: Record<CookPhase, Step[]> = { mise: [], cook: [], plate: [] }
  recipe.steps.forEach(s => { grouped[s.phase ?? 'cook'].push(s) })
  const totalTime = recipe.steps.reduce((s, x) => s + (x.duration || 0), 0)

  return (
    <div>
      <div className="flex items-baseline gap-2 mb-4">
        <h3 className="font-serif text-sm font-medium text-[--text]">{isCocktail ? 'Build Guide' : 'Cook Plan'}</h3>
        <span className="text-[11px] text-[--muted]">{recipe.steps.length} steps · ~{totalTime}min</span>
      </div>
      {phases.map(phase => {
        const steps = grouped[phase]
        if (!steps.length) return null
        const meta = PHASE_META[phase]
        return (
          <div key={phase} className="mb-5">
            <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border mb-3 ${meta.color}`}>
              {meta.icon} {meta.label}
            </div>
            <div className="space-y-2">
              {steps.map((step, i) => (
                <div key={step.id} className="flex gap-3 bg-white rounded-xl border border-[--border] p-3.5">
                  <div className="w-6 h-6 min-w-6 rounded-full bg-[--accent-light] text-[--accent] text-[11px] font-semibold flex items-center justify-center flex-shrink-0 mt-0.5">
                    {i + 1}
                  </div>
                  <div className="flex-1">
                    <div className="text-xs font-medium text-[--text] mb-1">{step.title}</div>
                    <div className="text-xs text-[--muted] leading-relaxed">{step.description}</div>
                    {step.duration > 0 && (
                      <div className="text-[11px] text-[--accent] mt-2">⏱ {step.duration} min</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Nutrition ─────────────────────────────────────────────────────────────────
function NutritionTab({ recipe, ratio, isCocktail, servings }: { recipe: Recipe; ratio: number; isCocktail: boolean; servings: number }) {
  const n = recipe.nutrition
  if (!n) return <p className="text-xs text-[--muted] pt-2">Nutrition data not available.</p>
  const cal = Math.round((n.calories || 0) * ratio)
  const p = Math.round((n.protein || 0) * ratio)
  const c = Math.round((n.carbs || 0) * ratio)
  const f = Math.round((n.fat || 0) * ratio)
  const fi = Math.round((n.fiber || 0) * ratio)
  const so = Math.round((n.sodium || 0) * ratio)
  const tot = p + c + f || 1
  const pp = Math.round(p / tot * 100)
  const cp = Math.round(c / tot * 100)
  const fp = Math.round(f / tot * 100)

  if (isCocktail) {
    const cd = recipe.cocktail_details
    return (
      <div className="space-y-4">
        <div className="bg-white rounded-xl border border-[--border] p-4 max-w-xs">
          <div className="text-2xl font-bold text-[--text] mb-0.5">{cal} <span className="text-xs font-normal text-[--muted]">cal / {servings === 1 ? 'cocktail' : `${servings} cocktails`}</span></div>
          {so > 0 && <div className="text-xs text-[--muted] mt-1">Sodium: {so}mg</div>}
        </div>
        {cd && (
          <div className="bg-white rounded-xl border border-[--border] p-4 max-w-xs space-y-2">
            <div className="text-xs font-medium text-[--text] mb-2">Cocktail Profile</div>
            <div className="text-xs text-[--muted]">ABV: <strong className="text-[--text]">~{cd.abv}%</strong></div>
            <div className="text-xs text-[--muted]">Technique: <strong className="text-[--text] capitalize">{cd.technique}</strong></div>
            <div className="text-xs text-[--muted]">Glass: <strong className="text-[--text]">{cd.glassware}</strong></div>
            <div className="text-xs text-[--muted]">Garnish: <strong className="text-[--text]">{cd.garnish}</strong></div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex gap-6 flex-wrap items-start">
      <div className="bg-white rounded-xl border border-[--border] overflow-hidden min-w-[200px]">
        <div className="px-4 py-3 border-b-[3px] border-[--text]">
          <div className="text-xl font-bold tracking-tight text-[--text]">Nutrition Facts</div>
          <div className="text-[10px] text-[--muted] mt-0.5">Per serving · {servings} shown</div>
        </div>
        <div className="px-4 py-2.5 border-b-[5px] border-[--text] flex justify-between items-baseline">
          <span className="text-2xl font-bold text-[--text]">{cal}</span>
          <span className="text-[10px] text-[--muted]">Calories</span>
        </div>
        {[
          { label: 'Total Fat', value: `${f}g`, bold: true, thick: true },
          { label: 'Total Carbohydrate', value: `${c}g`, bold: true, thick: true },
          { label: 'Dietary Fiber', value: `${fi}g`, bold: false, thick: false, indent: true },
          { label: 'Protein', value: `${p}g`, bold: true, thick: true },
          ...(so > 0 ? [{ label: 'Sodium', value: `${so}mg`, bold: false, thick: false }] : []),
        ].map(row => (
          <div key={row.label} className={`flex justify-between items-center py-1.5 text-[11px] ${row.thick ? 'border-b-[3px] border-[--text]' : 'border-b border-[--border]'} ${row.indent ? 'pl-6 pr-4' : 'px-4'}`}>
            <span className={`text-[--text] ${row.bold ? 'font-semibold' : ''}`}>{row.label}</span>
            <span className="font-medium text-[--text]">{row.value}</span>
          </div>
        ))}
      </div>

      <div className="flex-1 min-w-[160px]">
        <h3 className="font-serif text-sm font-medium text-[--text] mb-3">Macros</h3>
        <div className="flex gap-3">
          {[
            { label: 'Protein', value: p, pct: pp, color: 'var(--accent)' },
            { label: 'Carbs',   value: c, pct: cp, color: 'var(--green)' },
            { label: 'Fat',     value: f, pct: fp, color: 'var(--blue)' },
          ].map(m => (
            <div key={m.label} className="flex-1">
              <div className="text-[10px] text-[--muted] mb-1">{m.label}</div>
              <div className="text-sm font-medium mb-1.5" style={{ color: m.color }}>{m.value}g</div>
              <div className="h-1.5 bg-[--surface-2] rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${m.pct}%`, background: m.color }} />
              </div>
              <div className="text-[10px] text-[--muted] mt-1">{m.pct}%</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Shopping / Bar Stock ──────────────────────────────────────────────────────
function ShoppingTab({ recipe, ratio, checks, onToggle, onClear }: {
  recipe: Recipe; ratio: number; checks: Set<string>
  onToggle: (id: string) => void; onClear: () => void
}) {
  const cats: Record<string, typeof recipe.ingredients> = {}
  recipe.ingredients.forEach(i => {
    const c = i.category || 'other'
    ;(cats[c] = cats[c] ?? []).push(i)
  })
  const ordered = CAT_ORDER.filter(c => cats[c])
  Object.keys(cats).forEach(c => { if (!CAT_ORDER.includes(c)) ordered.push(c) })

  const total = recipe.ingredients.length
  const chkN = checks.size
  const pct = total > 0 ? Math.round(chkN / total * 100) : 0

  return (
    <div>
      {/* Progress */}
      <div className="flex items-center gap-3 mb-5">
        <div className="flex-1 h-1.5 bg-[--surface-2] rounded-full overflow-hidden">
          <div className="h-full bg-[--green] rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>
        <span className="text-xs text-[--muted] min-w-[36px] text-right">{chkN}/{total}</span>
        {chkN > 0 && (
          <button onClick={onClear} className="text-xs text-[--muted] hover:text-[--text] underline">Clear</button>
        )}
      </div>

      {/* Categories */}
      <div className="space-y-5">
        {ordered.map(cat => (
          <div key={cat}>
            <div className="text-[10px] font-semibold uppercase tracking-widest text-[--muted] pb-1.5 border-b border-[--border] mb-1.5">
              {CAT_LABELS[cat] ?? cat}
            </div>
            {cats[cat].map(ing => {
              const ck = checks.has(ing.id)
              return (
                <div
                  key={ing.id}
                  onClick={() => onToggle(ing.id)}
                  className="flex items-center gap-2.5 py-1.5 cursor-pointer group"
                >
                  <div className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-all ${ck ? 'bg-[--green] border-[--green]' : 'border-[--border-2] group-hover:border-[--muted]'}`}>
                    {ck && <span className="text-white text-[9px]">✓</span>}
                  </div>
                  <span className={`text-xs flex-1 transition-colors ${ck ? 'line-through text-[--hint]' : 'text-[--text]'}`}>{ing.name}</span>
                  <span className={`text-[11px] flex-shrink-0 transition-colors ${ck ? 'text-[--hint]' : 'text-[--muted]'}`}>
                    {scaleAmt(ing.amount, ratio)}{ing.unit ? ` ${ing.unit}` : ''}
                  </span>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
