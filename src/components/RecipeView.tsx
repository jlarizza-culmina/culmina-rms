'use client'
import React, { useState, useMemo, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import { ALLERGENS } from '@/lib/ingredientConstants'
import type { Recipe, Step, CookPhase, LibraryIngredient, Vendor, RecipeStage, Ingredient, ServiceWare, ServiceWareRef, Garnish } from '@/lib/types'
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

const STAGES: { value: RecipeStage; label: string; color: string; dot: string }[] = [
  { value: 'development',        label: 'Dev',       color: 'bg-purple-50 text-purple-700 border-purple-200',   dot: '#9333EA' },
  { value: 'testing',            label: 'Testing',   color: 'bg-yellow-50 text-yellow-700 border-yellow-200',   dot: '#CA8A04' },
  { value: 'active',             label: 'Active',    color: 'bg-green-50 text-green-600 border-green-200',      dot: '#2E6B25' },
  { value: 'specials_candidate', label: 'Special?',  color: 'bg-amber-50 text-amber-700 border-amber-200',      dot: '#D97706' },
  { value: 'retired',            label: 'Retired',   color: 'bg-gray-50 text-gray-400 border-gray-200',         dot: '#B0AB9E' },
]
const SEASONS = ['spring','summer','fall','winter']
const SEASON_ICONS: Record<string, string> = { spring:'🌸', summer:'☀️', fall:'🍂', winter:'❄️' }
const INGREDIENT_UNITS = [
  'each','g','kg','oz','lb','ml','l','tsp','tbsp','cup',
  'fl oz','sprig','pinch','bunch','clove','slice','sheet','piece','to taste',
]
const PREP_METHODS = [
  '—','whole','rough chopped','chopped','finely chopped','minced','julienned',
  'diced','small dice','medium dice','large dice','sliced','thinly sliced',
  'torn','grated','zested','peeled','brunoise','chiffonade','halved',
  'quartered','crushed','pressed',
]

const VESSELS = ['Pasta bowl','Side plate','Dinner plate 10"','Dinner plate 12"','Oval platter','Wooden board','Slate board','Small plate','Soup bowl','Coupe bowl','Cast iron skillet','Other']
const FLATWARE = ['Dinner fork','Dinner knife','Dessert fork','Dessert spoon','Soup spoon','Pasta fork','Steak knife','Fish knife','Fish fork','Shrimp fork','Cocktail pick','Cocktail stirrer','Demitasse spoon','Espresso spoon','Tongs']
const GLASSES = ['Rocks glass','Double rocks','Highball','Collins','Coupe','Nick & Nora','Martini','Wine — red','Wine — white','Champagne flute','Champagne coupe','Espresso cup','Demitasse','Beer pint','Stemless wine','Other']
const GARNISH_ITEMS = ['lemon twist','lemon wedge','lime wedge','orange twist','olive','cherry','mint sprig','cucumber slice','dehydrated orange','salt','sugar','other']
const GARNISH_PREPS = ['fresh','expressed','skewered','dehydrated','flamed','sugar-rimmed','salt-rimmed']
const GARNISH_PRES  = ['on rim','in drink','on pick','on side','floated']

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
  onClone: () => void
  onCreateVariation: (name: string) => void
  onBack?: () => void
}

export default function RecipeView({
  recipe, servings, checks, activeTab, library, vendors, userId,
  onTabChange, onServingsChange, onToggleCheck, onClearChecks,
  onDelete, onCookMode, onUpdateRecipe, onSaveVersion,
  onClone, onCreateVariation, onBack,
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
  const [editingName,        setEditingName]        = useState(false)
  const [nameDraft,          setNameDraft]          = useState(recipe.name)
  const [editingDesc,        setEditingDesc]        = useState(false)
  const [descDraft,          setDescDraft]          = useState(recipe.description)
  const [showVariationModal, setShowVariationModal] = useState(false)
  const [variationName,      setVariationName]      = useState('')
  const [serverNotesDraft,   setServerNotesDraft]   = useState(recipe.server_notes ?? '')

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

  // ── Library service ware (load from DB) ─────────────────────
  const [libPlateware,  setLibPlateware]  = useState<ServiceWareRef[]>([])
  const [libFlatware,   setLibFlatware]   = useState<ServiceWareRef[]>([])
  const [libGlasses,    setLibGlasses]    = useState<ServiceWareRef[]>([])
  const [libBohUtensils,setLibBohUtensils]= useState<ServiceWareRef[]>([])
  const [libEquipment,  setLibEquipment]  = useState<ServiceWareRef[]>([])
  const [libCookware,   setLibCookware]   = useState<ServiceWareRef[]>([])
  const [libBakeware,   setLibBakeware]   = useState<ServiceWareRef[]>([])
  const [menuSectionOpts,setMenuSectionOpts]= useState<{value:string;label:string}[]>([])
  const [ingredientUnits,setIngredientUnits]= useState<string[]>([])

  // Load service ware from library on mount
  const supabase = createClient()
  useEffect(() => {
    const rid = recipe.restaurant_id
    type SwRow = { id: string; name: string }
    const cats: [string, React.Dispatch<React.SetStateAction<ServiceWareRef[]>>][] = [
      ['Plateware',         setLibPlateware],
      ['Flatware',          setLibFlatware],
      ['Glassware',         setLibGlasses],
      ['Kitchen Utensils',  setLibBohUtensils],
      ['Cooking Equipment', setLibEquipment],
      ['Cookware',          setLibCookware],
      ['Bakeware',          setLibBakeware],
    ]
    cats.forEach(([cat, setter]) => {
      let q = (supabase.from('service_ware_items') as any).select('id,name').eq('category', cat).eq('is_active', true).order('name')
      if (rid) q = q.or(`restaurant_id.eq.${rid},restaurant_id.is.null`)
      q.then(({ data }: { data: SwRow[]|null }) =>
        setter((data ?? []).map((d: SwRow) => ({ id: d.id, name: d.name })))
      )
    })
    supabase.from('picklist_values').select('value,label').eq('list_name','menu_section')
      .eq('is_active', true).order('sort_order')
      .then(({ data }: { data: {value:string;label:string}[]|null }) => setMenuSectionOpts(data ?? []))
    supabase.from('picklist_values').select('value').eq('list_name','ingredient_unit')
      .eq('is_active', true).order('sort_order')
      .then(({ data }: { data: {value:string}[]|null }) => {
        if (data && data.length > 0) setIngredientUnits(data.map(d => d.value))
      })
  }, [recipe.restaurant_id])

  // ── Phase 2 handlers ─────────────────────────────────────
  async function setStage(stage: RecipeStage) {
    await onUpdateRecipe(recipe.id, { recipe_stage: stage })
  }
  async function toggleSeason(s: string) {
    const cur = recipe.seasons ?? []
    await onUpdateRecipe(recipe.id, { seasons: cur.includes(s) ? cur.filter(x => x !== s) : [...cur, s] })
  }
  async function toggleSpecial() {
    await onUpdateRecipe(recipe.id, { is_special: !(recipe.is_special ?? false) })
  }
  async function updateIngredient(ingId: string, field: keyof Ingredient, value: string | number) {
    const updated = recipe.ingredients.map(i => i.id === ingId ? { ...i, [field]: value } : i)
    await onUpdateRecipe(recipe.id, { ingredients: updated })
  }
  async function addIngredient() {
    const newIng: Ingredient = { id: crypto.randomUUID(), name: '', amount: 1, unit: 'each', category: 'other', prep_method: '', prep_notes: '' }
    await onUpdateRecipe(recipe.id, { ingredients: [...recipe.ingredients, newIng] })
  }
  async function deleteIngredient(ingId: string) {
    await onUpdateRecipe(recipe.id, { ingredients: recipe.ingredients.filter(i => i.id !== ingId) })
  }
  async function saveServerNotes() {
    await onUpdateRecipe(recipe.id, { server_notes: serverNotesDraft })
  }

  // ── Equipment needed ────────────────────────────────────────
  async function toggleEquipment(item: string) {
    const cur = (recipe.equipment_needed ?? []) as ServiceWareRef[]
    const exists = cur.some(e => (typeof e === 'string' ? e : e.name) === item)
    const updated = exists
      ? cur.filter(e => (typeof e === 'string' ? e : e.name) !== item)
      : [...cur, { id: item, name: item }]
    await onUpdateRecipe(recipe.id, { equipment_needed: updated })
  }
  async function addEquipment(item: string) {
    const cur = (recipe.equipment_needed ?? []) as ServiceWareRef[]
    const trimmed = item.trim()
    if (!trimmed || cur.some(e => (typeof e === 'string' ? e : e.name) === trimmed)) return
    await onUpdateRecipe(recipe.id, { equipment_needed: [...cur, { id: trimmed, name: trimmed }] })
  }

  // ── Service ware helpers ─────────────────────────────────────
  const sw = (recipe.service_ware ?? {}) as ServiceWare
  async function updateSW(patch: Partial<ServiceWare>) {
    await onUpdateRecipe(recipe.id, { service_ware: { ...sw, ...patch } })
  }
  async function toggleSwRef(field: 'plateware' | 'glassware' | 'flatware', item: ServiceWareRef) {
    const cur = (sw[field] ?? []) as ServiceWareRef[]
    const exists = cur.some(x => x.id === item.id)
    await updateSW({ [field]: exists ? cur.filter(x => x.id !== item.id) : [...cur, item] })
  }
  async function toggleFlatware(item: string) {
    const cur = (sw.flatware ?? []) as ServiceWareRef[]
    const exists = cur.some(x => x.name === item)
    const ref: ServiceWareRef = { id: item, name: item }
    await updateSW({ flatware: exists ? cur.filter(x => x.name !== item) : [...cur, ref] })
  }
  async function addGarnish() {
    const g: Garnish = { id: crypto.randomUUID(), qty: 1, item: 'lemon twist', prep: 'fresh', presentation: 'on rim' }
    await updateSW({ garnishes: [...(sw.garnishes ?? []), g] })
  }
  async function updateGarnish(id: string, patch: Partial<Garnish>) {
    await updateSW({ garnishes: (sw.garnishes ?? []).map(g => g.id === id ? { ...g, ...patch } : g) })
  }
  async function removeGarnish(id: string) {
    await updateSW({ garnishes: (sw.garnishes ?? []).filter(g => g.id !== id) })
  }
  function doCreateVariation() {
    if (!variationName.trim()) return
    onCreateVariation(variationName.trim())
    setShowVariationModal(false)
    setVariationName('')
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview',  label: 'Overview' },
    { key: 'plan',      label: isCocktail ? 'Build Guide' : 'Cook Plan' },
    { key: 'nutrition', label: isCocktail ? 'Stats' : 'Nutrition' },
    { key: 'shopping',  label: isCocktail ? 'Bar Stock' : 'Shopping' },
    { key: 'costing',   label: '💰 Costing' },
  ]

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Header ── */}
      <div className="bg-white border-b border-[--border] px-6 pt-5 pb-0 flex-shrink-0">
        <div className="flex items-start justify-between mb-1.5">
          <div className="pr-3 flex-1 min-w-0">
            <div className="font-serif text-xl font-medium text-[--text] leading-snug flex items-center gap-2">
              {isCocktail ? '🍸' : ''}
              {editingName ? (
                <input value={nameDraft}
                  onChange={e => setNameDraft(e.target.value)}
                  onBlur={() => { onUpdateRecipe(recipe.id, { name: nameDraft }); setEditingName(false) }}
                  onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()}
                  className="font-serif text-xl font-medium bg-white border-b-2 border-[--accent] outline-none w-full"
                  autoFocus />
              ) : (
                <span onClick={() => { setNameDraft(recipe.name); setEditingName(true) }}
                  className="cursor-text hover:text-[--accent] transition-colors" title="Click to edit name">
                  {recipe.name}
                </span>
              )}
              {(recipe.version ?? 1) > 1 && (
                <span className="text-[10px] font-sans font-normal text-[--hint] bg-[--surface-2] px-1.5 py-0.5 rounded-full flex-shrink-0">
                  v{recipe.version}
                </span>
              )}
            </div>
            {recipe.parent_recipe_id && (
              <div className="text-[10px] text-[--muted] mt-0.5">✦ Variation</div>
            )}
            {editingDesc ? (
              <textarea value={descDraft}
                onChange={e => setDescDraft(e.target.value)}
                onBlur={() => { onUpdateRecipe(recipe.id, { description: descDraft }); setEditingDesc(false) }}
                rows={2}
                className="text-xs text-[--muted] w-full mt-1 bg-white border border-[--border-2] rounded px-2 py-1 outline-none focus:border-[--accent] resize-none"
                autoFocus />
            ) : (
              <p onClick={() => { setDescDraft(recipe.description); setEditingDesc(true) }}
                className="text-xs text-[--muted] mt-0.5 cursor-text hover:text-[--text] transition-colors italic"
                title="Click to edit description">
                {recipe.description || <span className="opacity-40">Add description…</span>}
              </p>
            )}
          </div>
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

            {/* Clone */}
            <button onClick={onClone} title="Clone this recipe"
              className="px-3 py-1.5 rounded-lg border border-[--border-2] text-xs text-[--muted] hover:bg-[--surface-2] transition-colors">
              ⎘ Clone
            </button>

            {/* Variation */}
            <button onClick={() => setShowVariationModal(true)} title="Create a variation"
              className="px-3 py-1.5 rounded-lg border border-[--border-2] text-xs text-[--muted] hover:bg-[--surface-2] transition-colors">
              ✦ Variation
            </button>

            <button onClick={onDelete} className="text-[--hint] hover:text-red-500 text-sm px-1.5 transition-colors" title="Delete">✕</button>
          </div>
        </div>

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
        {activeTab === 'overview' && (
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
            <div className="mb-4">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-[--hint] mb-1.5">Stage</div>
              <div className="flex flex-wrap gap-1.5">
                {STAGES.map(s => (
                  <button key={s.value} onClick={() => setStage(s.value)}
                    className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${(recipe.recipe_stage ?? 'development') === s.value ? s.color + ' font-medium' : 'border-[--border-2] text-[--muted] hover:bg-[--surface-2]'}`}>
                    {s.label}
                  </button>
                ))}
                <button onClick={toggleSpecial}
                  className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${recipe.is_special ? 'bg-amber-50 text-amber-700 border-amber-300 font-medium' : 'border-[--border-2] text-[--muted] hover:bg-[--surface-2]'}`}>
                  ⭐ {recipe.is_special ? 'On specials' : 'Flag as special'}
                </button>
              </div>
            </div>
            <div className="mb-4">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-[--hint] mb-1.5">Season</div>
              <div className="flex gap-1.5">
                {SEASONS.map(s => {
                  const active = (recipe.seasons ?? []).includes(s)
                  return (
                    <button key={s} onClick={() => toggleSeason(s)}
                      className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors capitalize ${active ? 'bg-[--accent-light] border-[--accent] text-[--accent] font-medium' : 'border-[--border-2] text-[--muted] hover:bg-[--surface-2]'}`}>
                      {SEASON_ICONS[s]} {s}
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-serif text-sm font-medium text-[--text] flex items-baseline gap-2">
                  Ingredients <span className="font-sans text-[11px] font-normal text-[--muted]">{recipe.ingredients.length} items</span>
                </h3>
                <button onClick={addIngredient} className="text-[11px] text-[--accent] hover:text-[--accent-dark] font-medium transition-colors">+ Add ingredient</button>
              </div>
              <div className="border border-[--border] rounded-xl overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-[--surface-2] border-b border-[--border]">
                      <th className="px-2 py-1.5 text-left text-[10px] font-semibold text-[--hint] uppercase tracking-wide w-14">Qty</th>
                      <th className="px-2 py-1.5 text-left text-[10px] font-semibold text-[--hint] uppercase tracking-wide w-20">Unit</th>
                      <th className="px-2 py-1.5 text-left text-[10px] font-semibold text-[--hint] uppercase tracking-wide">Ingredient</th>
                      <th className="px-2 py-1.5 text-left text-[10px] font-semibold text-[--hint] uppercase tracking-wide w-28">Prep Method</th>
                      <th className="px-2 py-1.5 text-center text-[10px] font-semibold text-[--hint] uppercase tracking-wide w-16">Garnish</th>
                      <th className="px-2 py-1.5 text-left text-[10px] font-semibold text-[--hint] uppercase tracking-wide">Notes</th>
                      <th className="w-5" />
                    </tr>
                  </thead>
                  <tbody>
                    {recipe.ingredients.map((ing, idx) => (
                      <tr key={ing.id} className={`border-b border-[--border] last:border-0 ${ing.is_garnish ? 'bg-amber-50/60' : idx % 2 === 0 ? 'bg-white' : 'bg-[--surface-2]/30'}`}>
                        <td className="px-2 py-1">
                          <input type="number" min="0" step="0.1" defaultValue={ing.amount}
                            onBlur={e => updateIngredient(ing.id, 'amount', parseFloat(e.target.value) || 0)}
                            className="w-full bg-transparent outline-none text-xs text-[--accent] font-medium px-1 py-0.5 focus:bg-white focus:border focus:border-[--accent] rounded" />
                        </td>
                        <td className="px-2 py-1">
                          <select defaultValue={ing.unit} onChange={e => updateIngredient(ing.id, 'unit', e.target.value)}
                            className="w-full bg-transparent outline-none text-xs text-[--text] cursor-pointer">
                            {(ingredientUnits.length > 0 ? ingredientUnits : INGREDIENT_UNITS).map(u => <option key={u} value={u}>{u}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-1">
                          <input defaultValue={ing.name} onBlur={e => updateIngredient(ing.id, 'name', e.target.value)}
                            placeholder="name" className="w-full bg-transparent outline-none text-xs text-[--text] px-1 py-0.5 focus:bg-white focus:border focus:border-[--accent] rounded" />
                        </td>
                        <td className="px-2 py-1">
                          <select defaultValue={ing.prep_method || '—'} onChange={e => updateIngredient(ing.id, 'prep_method', e.target.value === '—' ? '' : e.target.value)}
                            className="w-full bg-transparent outline-none text-xs text-[--muted] cursor-pointer">
                            {PREP_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-1 text-center">
                          <input type="checkbox" checked={!!ing.is_garnish}
                            onChange={e => updateIngredient(ing.id, 'is_garnish', e.target.checked)}
                            className="accent-amber-500 w-3.5 h-3.5 cursor-pointer" title="Mark as garnish" />
                        </td>
                        <td className="px-2 py-1">
                          <input defaultValue={ing.prep_notes || ''} onBlur={e => updateIngredient(ing.id, 'prep_notes', e.target.value)}
                            placeholder="notes…" className="w-full bg-transparent outline-none text-xs text-[--muted] px-1 py-0.5 focus:bg-white focus:border focus:border-[--accent] rounded" />
                        </td>
                        <td className="px-1 py-1">
                          <button onClick={() => deleteIngredient(ing.id)} className="text-[--hint] hover:text-red-400 text-[11px] px-0.5 transition-colors">✕</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {recipe.ingredients.length === 0 && (
                  <div className="text-center py-4 text-xs text-[--hint]">No ingredients — click + Add ingredient above</div>
                )}
              </div>
            </div>
            <div className="mb-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-[--hint] mb-1.5">
                Server Notes <span className="font-normal normal-case text-[--hint]">— visible to FOH</span>
              </div>
              <textarea value={serverNotesDraft} onChange={e => setServerNotesDraft(e.target.value)} onBlur={saveServerNotes}
                placeholder="How to describe this dish, common questions, upsell options, pairing suggestions…"
                rows={3}
                className="w-full px-3 py-2 text-xs border border-[--border-2] rounded-xl outline-none focus:border-[--accent] resize-none placeholder:text-[--hint]" />
            </div>

            {/* ── Menu presentation fields ── */}
            <div className="mt-5 pt-5 border-t border-[--border] space-y-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-[--hint]">Menu Presentation</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-medium text-[--muted] mb-1">Menu Name</label>
                  <input defaultValue={recipe.menu_name ?? ''}
                    onBlur={e => onUpdateRecipe(recipe.id, { menu_name: e.target.value })}
                    placeholder={recipe.name}
                    className="w-full px-2.5 py-1.5 text-xs border border-[--border-2] rounded-lg outline-none focus:border-[--accent]" />
                  <p className="text-[10px] text-[--hint] mt-0.5">Shown on printed menu if different from recipe name</p>
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-[--muted] mb-1">Internal Notes</label>
                  <input defaultValue={recipe.internal_notes ?? ''}
                    onBlur={e => onUpdateRecipe(recipe.id, { internal_notes: e.target.value })}
                    placeholder="Chef notes, sourcing reminders…"
                    className="w-full px-2.5 py-1.5 text-xs border border-[--border-2] rounded-lg outline-none focus:border-[--accent]" />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-medium text-[--muted] mb-1">Menu Description</label>
                <textarea defaultValue={recipe.menu_description ?? ''}
                  onBlur={e => onUpdateRecipe(recipe.id, { menu_description: e.target.value })}
                  placeholder="As it appears on the printed menu…"
                  rows={2}
                  className="w-full px-2.5 py-1.5 text-xs border border-[--border-2] rounded-xl outline-none focus:border-[--accent] resize-none placeholder:text-[--hint]" />
              </div>
            </div>

            {/* ── UDF Tags ── */}
            <TagEditor recipe={recipe} onUpdateRecipe={onUpdateRecipe} />

            {/* ── Equipment needed ── */}
            <div className="mt-4 pt-4 border-t border-[--border]">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-[--hint] mb-3">Equipment Needed</div>
              <div className="space-y-3">
                <LibraryRefPicker
                  label="Cooking Equipment"
                  items={libEquipment}
                  selected={(recipe.equipment_needed ?? []) as ServiceWareRef[]}
                  onToggle={item => toggleEquipment(item.name)}
                  emptyHint="Add items to Cooking Equipment library to enable"
                />
              </div>
            </div>

            {/* ── Service & Presentation ── */}
            <div className="mt-5 pt-5 border-t border-[--border]">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-[--hint] mb-3">
                Service & Presentation
              </div>
              <div className="space-y-4">
                {/* Glassware — cocktails & drinks */}
                {isCocktail && (
                  <LibraryRefPicker
                    label="Glassware"
                    items={libGlasses}
                    selected={(sw.glassware ?? []) as ServiceWareRef[]}
                    onToggle={item => toggleSwRef('glassware', item)}
                    emptyHint="Add items to Glassware library to enable"
                  />
                )}
                {/* Plateware — food */}
                {!isCocktail && (
                  <LibraryRefPicker
                    label="Plateware"
                    items={libPlateware}
                    selected={(sw.plateware ?? []) as ServiceWareRef[]}
                    onToggle={item => toggleSwRef('plateware', item)}
                    emptyHint="Add items to Plateware library to enable"
                  />
                )}
                {/* Flatware — all recipes */}
                <LibraryRefPicker
                  label="Flatware"
                  items={libFlatware}
                  selected={(sw.flatware ?? []) as ServiceWareRef[]}
                  onToggle={item => toggleSwRef('flatware', item)}
                  emptyHint="Add items to Flatware library to enable"
                />
                {/* Garnish — cocktails */}
                {isCocktail && (
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-[10px] font-medium text-[--muted]">Garnish</label>
                      <button onClick={addGarnish} className="text-[11px] text-[--accent] hover:text-[--accent-dark] font-medium">+ Add garnish</button>
                    </div>
                    {(sw.garnishes ?? []).length === 0 && (
                      <p className="text-[11px] text-[--hint]">No garnish specified</p>
                    )}
                    <div className="space-y-2">
                      {(sw.garnishes ?? []).map(g => (
                        <div key={g.id} className="flex items-center gap-2 flex-wrap">
                          <input type="number" min="0.5" step="0.5" defaultValue={g.qty}
                            onBlur={e => updateGarnish(g.id, { qty: parseFloat(e.target.value) || 1 })}
                            className="w-12 px-2 py-1 text-xs border border-[--border-2] rounded-lg outline-none focus:border-[--accent] text-center" />
                          <select defaultValue={g.item} onChange={e => updateGarnish(g.id, { item: e.target.value })}
                            className="px-2 py-1 text-xs border border-[--border-2] rounded-lg outline-none bg-white capitalize">
                            {GARNISH_ITEMS.map(i => <option key={i} value={i}>{i}</option>)}
                          </select>
                          <select defaultValue={g.prep} onChange={e => updateGarnish(g.id, { prep: e.target.value })}
                            className="px-2 py-1 text-xs border border-[--border-2] rounded-lg outline-none bg-white">
                            {GARNISH_PREPS.map(p => <option key={p} value={p}>{p}</option>)}
                          </select>
                          <select defaultValue={g.presentation} onChange={e => updateGarnish(g.id, { presentation: e.target.value })}
                            className="px-2 py-1 text-xs border border-[--border-2] rounded-lg outline-none bg-white">
                            {GARNISH_PRES.map(p => <option key={p} value={p}>{p}</option>)}
                          </select>
                          <button onClick={() => removeGarnish(g.id)} className="text-[--hint] hover:text-red-400 text-xs">✕</button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        {activeTab === 'plan' && <PlanTab recipe={recipe} isCocktail={isCocktail} onUpdateRecipe={onUpdateRecipe}
              libCookware={libCookware} libBakeware={libBakeware}
              libKitchenUtensils={libBohUtensils} libEquipment={libEquipment} />}
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

      {/* ── Variation modal ── */}
      {showVariationModal && (
        <div className="fixed inset-0 bg-black/35 flex items-center justify-center z-50"
          onClick={e => { if (e.target === e.currentTarget) setShowVariationModal(false) }}>
          <div className="bg-white rounded-2xl p-6 w-[400px] max-w-[94vw] shadow-lg">
            <h2 className="font-serif text-lg font-medium text-[--text] mb-1">Create variation</h2>
            <p className="text-xs text-[--muted] mb-4">
              Creates a new recipe based on <strong>{recipe.name}</strong>. You can then change ingredients or steps while keeping the original intact.
            </p>
            <label className="block text-[11px] font-medium text-[--muted] mb-1.5">Variation name *</label>
            <input value={variationName} onChange={e => setVariationName(e.target.value)}
              placeholder={`e.g. "${recipe.name} with Wild Boar"`}
              className="w-full px-3 py-2 text-xs border border-[--border-2] rounded-lg outline-none focus:border-[--accent] mb-4"
              autoFocus onKeyDown={e => e.key === 'Enter' && doCreateVariation()} />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowVariationModal(false)}
                className="px-4 py-2 text-xs text-[--muted] border border-[--border-2] rounded-lg hover:bg-[--surface-2]">Cancel</button>
              <button onClick={doCreateVariation} disabled={!variationName.trim()}
                className="px-4 py-2 text-xs font-medium bg-[--accent] text-white rounded-lg hover:bg-[--accent-dark] disabled:opacity-40">
                ✦ Create variation
              </button>
            </div>
          </div>
        </div>
      )}

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
// ── LibraryRefPicker ─────────────────────────────────────────
function LibraryRefPicker({
  label, items, selected, onToggle, emptyHint
}: {
  label: string
  items: ServiceWareRef[]
  selected: ServiceWareRef[]
  onToggle: (item: ServiceWareRef) => void
  emptyHint?: string
}) {
  if (items.length === 0) return (
    <div>
      <div className="text-[10px] font-medium text-[--muted] mb-1">{label}</div>
      <p className="text-[11px] text-[--hint]">{emptyHint ?? 'No library items found'}</p>
    </div>
  )
  return (
    <div>
      <div className="text-[10px] font-medium text-[--muted] mb-1.5">
        {label}
        {selected.length > 0 && <span className="ml-2 text-[--accent] font-normal">{selected.length} selected</span>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {items.map(item => {
          const active = selected.some(s => s.id === item.id)
          return (
            <button key={item.id} onClick={() => onToggle(item)}
              className={"text-[11px] px-2.5 py-0.5 rounded-full border transition-colors " +
                (active
                  ? 'bg-[--accent-light] border-[--accent] text-[--accent] font-medium'
                  : 'border-[--border-2] text-[--muted] hover:bg-[--surface-2]')}>
              {active ? '✓ ' : ''}{item.name}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── EquipmentSection ─────────────────────────────────────────
function EquipmentSection({
  equipment, libItems, onToggle, onAdd
}: {
  equipment: (ServiceWareRef | string)[]
  libItems: ServiceWareRef[]
  onToggle: (item: string) => void
  onAdd: (item: string) => void
}) {
  const [newItem, setNewItem] = useState('')
  const equipNames = equipment.map(e => typeof e === 'string' ? e : e.name)

  return (
    <div className="mt-4">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-[--hint] mb-1.5">
        Equipment Needed
      </div>
      {libItems.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {libItems.map(item => (
            <button key={item.id} onClick={() => onToggle(item.name)}
              className={"text-[11px] px-2.5 py-0.5 rounded-full border transition-colors " +
                (equipNames.includes(item.name)
                  ? 'bg-[--accent-light] border-[--accent] text-[--accent] font-medium'
                  : 'border-[--border-2] text-[--muted] hover:bg-[--surface-2]')}>
              {equipNames.includes(item.name) ? '✓ ' : ''}{item.name}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-1.5 mb-2">
        {equipNames.filter(e => !libItems.some(l => l.name === e)).map(e => (
          <span key={e} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-[--surface-2] border border-[--border] text-[--text]">
            ⚙️ {e}
            <button onClick={() => onToggle(e)} className="text-[--hint] hover:text-red-400">×</button>
          </span>
        ))}
      </div>
      <div className="flex gap-1.5">
        <input value={newItem} onChange={e => setNewItem(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && newItem.trim()) { onAdd(newItem); setNewItem('') } }}
          placeholder="Add equipment…"
          className="px-2.5 py-1 text-xs border border-[--border-2] rounded-lg outline-none focus:border-[--accent] w-40" />
        <button onClick={() => { if (newItem.trim()) { onAdd(newItem); setNewItem('') } }}
          disabled={!newItem.trim()}
          className="px-2.5 py-1 text-xs bg-[--surface-2] border border-[--border-2] rounded-lg hover:bg-[--cream-3] disabled:opacity-40">
          +
        </button>
      </div>
    </div>
  )
}

// ── TagEditor ─────────────────────────────────────────────────
function TagEditor({ recipe, onUpdateRecipe }: { recipe: Recipe; onUpdateRecipe: (id: string, updates: Partial<Recipe>) => Promise<void> }) {
  const [newTag, setNewTag] = useState('')
  const tags = recipe.tags ?? []

  async function addTag() {
    const t = newTag.trim()
    if (!t || tags.includes(t)) return
    await onUpdateRecipe(recipe.id, { tags: [...tags, t] })
    setNewTag('')
  }

  async function removeTag(t: string) {
    await onUpdateRecipe(recipe.id, { tags: tags.filter(x => x !== t) })
  }

  return (
    <div className="mt-4">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-[--hint] mb-1.5">Tags</div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {tags.map(t => (
          <span key={t} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-[--surface-2] border border-[--border] text-[--text]">
            {t}
            <button onClick={() => removeTag(t)} className="text-[--hint] hover:text-red-400 leading-none">×</button>
          </span>
        ))}
        {tags.length === 0 && <span className="text-[11px] text-[--hint]">No tags yet</span>}
      </div>
      <div className="flex gap-1.5">
        <input value={newTag} onChange={e => setNewTag(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addTag()}
          placeholder="Add tag…"
          className="px-2.5 py-1 text-xs border border-[--border-2] rounded-lg outline-none focus:border-[--accent] w-36" />
        <button onClick={addTag} disabled={!newTag.trim()}
          className="px-2.5 py-1 text-xs bg-[--surface-2] border border-[--border-2] rounded-lg hover:bg-[--cream-3] disabled:opacity-40">
          +
        </button>
      </div>
    </div>
  )
}

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
function PlanTab({ recipe, isCocktail, onUpdateRecipe, libCookware, libBakeware, libKitchenUtensils, libEquipment }: {
  recipe: Recipe
  isCocktail: boolean
  onUpdateRecipe: (id: string, updates: Partial<Recipe>) => Promise<void>
  libCookware: ServiceWareRef[]
  libBakeware: ServiceWareRef[]
  libKitchenUtensils: ServiceWareRef[]
  libEquipment: ServiceWareRef[]
}) {
  const totalTime = recipe.steps.reduce((s, x) => s + (x.duration || 0), 0)
  const PHASES: CookPhase[] = ['mise', 'cook', 'plate']
  const [expandedEquipment, setExpandedEquipment] = useState<Set<string>>(new Set())

  // All step-usable equipment combined
  const allStepEquipment = [
    ...libCookware.map(i => ({ ...i, category: 'Cookware' })),
    ...libBakeware.map(i => ({ ...i, category: 'Bakeware' })),
    ...libKitchenUtensils.map(i => ({ ...i, category: 'Kitchen Utensils' })),
    ...libEquipment.map(i => ({ ...i, category: 'Cooking Equipment' })),
  ]

  async function updateStep(stepId: string, patch: Partial<Step>) {
    const updated = recipe.steps.map(s => s.id === stepId ? { ...s, ...patch } : s)
    await onUpdateRecipe(recipe.id, { steps: updated })
  }

  async function toggleStepEquipment(stepId: string, item: ServiceWareRef & { category?: string }) {
    const step = recipe.steps.find(s => s.id === stepId)
    if (!step) return
    const cur = step.equipment ?? []
    const exists = cur.some(e => e.id === item.id)
    await updateStep(stepId, { equipment: exists ? cur.filter(e => e.id !== item.id) : [...cur, item] })
  }

  async function deleteStep(stepId: string) {
    await onUpdateRecipe(recipe.id, { steps: recipe.steps.filter(s => s.id !== stepId) })
  }

  async function addStep() {
    const newStep: Step = { id: crypto.randomUUID(), title: '', description: '', duration: 0, phase: 'cook', equipment: [] }
    await onUpdateRecipe(recipe.id, { steps: [...recipe.steps, newStep] })
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-baseline gap-2">
          <h3 className="font-serif text-sm font-medium text-[--text]">{isCocktail ? 'Build Guide' : 'Cook Plan'}</h3>
          <span className="text-[11px] text-[--muted]">{recipe.steps.length} steps · ~{totalTime}min</span>
        </div>
        <button onClick={addStep} className="text-[11px] text-[--accent] hover:text-[--accent-dark] font-medium">
          + Add step
        </button>
      </div>

      {recipe.steps.length === 0 && (
        <div className="text-center py-8 text-[--muted] text-sm">
          No steps yet — click + Add step to build your cook plan.
        </div>
      )}

      <div className="space-y-2">
        {recipe.steps.map((step, i) => {
          const meta = PHASE_META[step.phase ?? 'cook']
          return (
            <div key={step.id} className="bg-white rounded-xl border border-[--border] p-3.5">
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 min-w-6 rounded-full bg-[--accent-light] text-[--accent] text-[11px] font-semibold flex items-center justify-center flex-shrink-0 mt-1">
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    <input
                      key={step.id + '-t'}
                      defaultValue={step.title}
                      onBlur={e => updateStep(step.id, { title: e.target.value })}
                      placeholder="Step title…"
                      className="flex-1 min-w-0 text-xs font-medium text-[--text] bg-transparent border-b border-transparent hover:border-[--border-2] focus:border-[--accent] outline-none py-0.5"
                    />
                    <select
                      key={step.id + '-p'}
                      defaultValue={step.phase ?? 'cook'}
                      onChange={e => updateStep(step.id, { phase: e.target.value as CookPhase })}
                      className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium cursor-pointer outline-none ${meta.color}`}>
                      {PHASES.map(p => (
                        <option key={p} value={p}>{PHASE_META[p].icon} {PHASE_META[p].label}</option>
                      ))}
                    </select>
                    <button onClick={() => deleteStep(step.id)} className="text-[--hint] hover:text-red-400 text-xs flex-shrink-0">✕</button>
                  </div>
                  <textarea
                    key={step.id + '-d'}
                    defaultValue={step.description}
                    onBlur={e => updateStep(step.id, { description: e.target.value })}
                    placeholder="Describe this step…"
                    rows={2}
                    className="w-full text-xs text-[--muted] leading-relaxed bg-transparent border border-transparent hover:border-[--border-2] focus:border-[--accent] rounded-lg px-1.5 py-1 outline-none resize-none placeholder:text-[--hint]"
                  />
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className="text-[10px] text-[--hint]">⏱</span>
                    <input
                      key={step.id + '-dur'}
                      type="number" min="0"
                      defaultValue={step.duration || ''}
                      onBlur={e => updateStep(step.id, { duration: parseInt(e.target.value) || 0 })}
                      placeholder="0"
                      className="w-12 text-[11px] text-[--accent] bg-transparent border-b border-transparent hover:border-[--border-2] focus:border-[--accent] outline-none text-center"
                    />
                    <span className="text-[10px] text-[--hint]">min</span>
                  </div>
                  {/* Step equipment */}
                  {allStepEquipment.length > 0 && (
                    <div className="mt-2">
                      <button
                        onClick={() => setExpandedEquipment(prev => {
                          const n = new Set(prev)
                          n.has(step.id) ? n.delete(step.id) : n.add(step.id)
                          return n
                        })}
                        className="text-[10px] text-[--hint] hover:text-[--accent] transition-colors">
                        ⚙ Equipment needed
                        {(step.equipment ?? []).length > 0 && (
                          <span className="ml-1 text-[--accent]">({step.equipment?.length})</span>
                        )}
                        {expandedEquipment.has(step.id) ? ' ▲' : ' ▼'}
                      </button>
                      {(step.equipment ?? []).length > 0 && !expandedEquipment.has(step.id) && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {(step.equipment ?? []).map(e => (
                            <span key={e.id} className="text-[10px] bg-[--surface-2] text-[--muted] px-1.5 py-0.5 rounded border border-[--border]">{e.name}</span>
                          ))}
                        </div>
                      )}
                      {expandedEquipment.has(step.id) && (
                        <div className="mt-2 p-2 bg-[--surface-2] rounded-lg">
                          {['Cookware', 'Bakeware', 'Kitchen Utensils', 'Cooking Equipment'].map(cat => {
                            const catItems = allStepEquipment.filter(e => e.category === cat)
                            if (!catItems.length) return null
                            return (
                              <div key={cat} className="mb-2 last:mb-0">
                                <div className="text-[9px] font-semibold uppercase tracking-wide text-[--hint] mb-1">{cat}</div>
                                <div className="flex flex-wrap gap-1">
                                  {catItems.map(item => {
                                    const active = (step.equipment ?? []).some(e => e.id === item.id)
                                    return (
                                      <button key={item.id} onClick={() => toggleStepEquipment(step.id, item)}
                                        className={"text-[10px] px-1.5 py-0.5 rounded border transition-colors " +
                                          (active ? 'bg-[--accent-light] border-[--accent] text-[--accent] font-medium' : 'border-[--border-2] text-[--muted] hover:bg-white')}>
                                        {active ? '✓ ' : ''}{item.name}
                                      </button>
                                    )
                                  })}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {recipe.steps.length > 0 && (
        <button onClick={addStep}
          className="w-full mt-3 py-2.5 border-2 border-dashed border-[--border-2] rounded-xl text-xs text-[--muted] hover:border-[--accent] hover:text-[--accent] transition-colors">
          + Add step
        </button>
      )}
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
