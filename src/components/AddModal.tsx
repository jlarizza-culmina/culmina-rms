'use client'
import { useState } from 'react'
import type { Recipe } from '@/lib/types'

type Mode = 'generate' | 'paste' | 'import' | 'manual'

const SAMPLES = [
  'Spaghetti alla Carbonara', 'Chicken Piccata', 'Mushroom Risotto',
  'Pasta alla Norma', 'Lemon Ricotta Pancakes', 'Orecchiette with Sausage & Broccoli Rabe',
  'Negroni', 'Aperol Spritz', 'Whiskey Sour', 'Tommy\'s Margarita',
]

interface Props {
  onClose: () => void
  onAdd: (recipes: Omit<Recipe, 'id' | 'user_id' | 'created_at'>[]) => Promise<void>
}

export default function AddModal({ onClose, onAdd }: Props) {
  const [mode, setMode] = useState<Mode>('generate')
  const [input, setInput] = useState('')
  const [isCocktail, setIsCocktail] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // For import-chat: show found recipes for confirmation
  const [foundRecipes, setFoundRecipes] = useState<Omit<Recipe, 'id' | 'user_id' | 'created_at'>[] | null>(null)
  const [selectedImports, setSelectedImports] = useState<Set<number>>(new Set())

  // Manual entry
  const [manualName, setManualName] = useState('')
  const [manualType, setManualType] = useState<'food' | 'cocktail'>('food')
  const [manualDesc, setManualDesc] = useState('')
  const [manualServings, setManualServings] = useState('4')
  const [manualSection, setManualSection] = useState('')

  const modeLabel = mode === 'generate' ? 'Generate' : mode === 'paste' ? 'Parse Recipe' : mode === 'manual' ? 'Create' : 'Find Recipes'

  async function handleManualCreate() {
    if (!manualName.trim() || loading) return
    setLoading(true)
    try {
      await onAdd([{
        name: manualName.trim(),
        description: manualDesc.trim(),
        recipe_type: manualType,
        base_servings: parseInt(manualServings) || 4,
        prep_time: 0, cook_time: 0,
        ingredients: [], steps: [],
        nutrition: { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sodium: 0 },
        tags: [], menu_status: 'not_on_menu', recipe_stage: 'development',
        menu_sections: manualSection ? [manualSection] : [],
      }])
      onClose()
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  function fillSample() {
    const s = SAMPLES[Math.floor(Math.random() * SAMPLES.length)]
    setInput(s)
    setIsCocktail(s.includes('oni') || s.includes('Sour') || s.includes('Spritz') || s.includes('Margarita'))
  }

  async function handleSubmit() {
    if (!input.trim() || loading) return
    setLoading(true)
    setError('')
    setFoundRecipes(null)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: mode === 'paste' ? 'parse' : mode, input, iscocktail: isCocktail }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'API error')

      if (mode === 'import') {
        if (!data.recipes?.length) {
          setError('No recipes found in that conversation. Try pasting more of the chat text.')
          return
        }
        setFoundRecipes(data.recipes)
        setSelectedImports(new Set(data.recipes.map((_: unknown, i: number) => i)))
      } else {
        await onAdd([data.recipe])
        onClose()
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  async function handleImportConfirm() {
    if (!foundRecipes || selectedImports.size === 0) return
    const toImport = foundRecipes.filter((_, i) => selectedImports.has(i))
    setLoading(true)
    await onAdd(toImport)
    setLoading(false)
    onClose()
  }

  function toggleImportSelect(i: number) {
    setSelectedImports(prev => {
      const n = new Set(prev)
      n.has(i) ? n.delete(i) : n.add(i)
      return n
    })
  }

  return (
    <div
      className="fixed inset-0 bg-black/35 flex items-center justify-center z-50"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white rounded-2xl p-6 w-[500px] max-w-[94vw] max-h-[88vh] overflow-y-auto fade-in shadow-lg">
        <h2 className="font-serif text-lg font-medium text-[--text] mb-1">Add a Recipe</h2>
        <p className="text-xs text-[--muted] mb-4">Generate with AI, paste existing text, or import from a chat transcript</p>

        {/* Mode toggle */}
        <div className="flex bg-[--surface-2] rounded-lg p-0.5 gap-0.5 mb-4">
          {(['generate', 'paste', 'import', 'manual'] as Mode[]).map(m => (
            <button
              key={m}
              onClick={() => { setMode(m); setError(''); setFoundRecipes(null) }}
              className={`flex-1 py-2 rounded-md text-xs font-medium transition-all ${mode === m ? 'bg-white text-[--text] shadow-sm' : 'text-[--muted] hover:text-[--text]'}`}
            >
              {m === 'generate' ? '✨ Generate' : m === 'paste' ? '📋 Paste' : m === 'import' ? '💬 Import' : '✏️ Manual'}
            </button>
          ))}
        </div>

        {/* Form: found recipes confirmation */}
        {foundRecipes ? (
          <div>
            <p className="text-xs font-medium text-[--muted] mb-3">
              Found {foundRecipes.length} recipe{foundRecipes.length !== 1 ? 's' : ''} — select which to import:
            </p>
            <div className="space-y-2 mb-4 max-h-64 overflow-y-auto">
              {foundRecipes.map((r, i) => (
                <div
                  key={i}
                  onClick={() => toggleImportSelect(i)}
                  className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-colors ${selectedImports.has(i) ? 'border-[--accent] bg-[--accent-light]' : 'border-[--border] hover:bg-[--surface-2]'}`}
                >
                  <div className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center text-[10px] mt-0.5 transition-all ${selectedImports.has(i) ? 'bg-[--accent] border-[--accent] text-white' : 'border-[--border-2]'}`}>
                    {selectedImports.has(i) ? '✓' : ''}
                  </div>
                  <div>
                    <div className="text-xs font-medium text-[--text]">{r.name}</div>
                    <div className="text-[11px] text-[--muted] mt-0.5">{r.description}</div>
                    <div className="text-[10px] text-[--hint] mt-1">
                      {r.recipe_type === 'cocktail' ? '🍸' : '🍽'} {r.ingredients?.length ?? 0} ingredients · {(r.prep_time ?? 0) + (r.cook_time ?? 0)} min
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setFoundRecipes(null)} className="px-3 py-2 text-xs text-[--muted] border border-[--border-2] rounded-lg hover:bg-[--surface-2]">
                Back
              </button>
              <button
                onClick={handleImportConfirm}
                disabled={selectedImports.size === 0 || loading}
                className="px-4 py-2 bg-[--accent] text-white text-xs font-medium rounded-lg hover:bg-[--accent-dark] disabled:opacity-50 flex items-center gap-1.5"
              >
                {loading ? <><span className="spinner" />Importing…</> : `Import ${selectedImports.size} recipe${selectedImports.size !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Generate */}
            {mode === 'generate' && (
              <div className="mb-3">
                <label className="block text-[11px] font-medium text-[--muted] mb-1.5">Recipe name or idea</label>
                <input
                  type="text"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                  placeholder="e.g. Spaghetti Cacio e Pepe, Thai Green Curry, Negroni…"
                  className="w-full px-3 py-2.5 rounded-lg border border-[--border-2] text-sm bg-white text-[--text] outline-none focus:border-[--accent] transition-colors"
                  autoFocus
                />
                <div className="flex items-center justify-between mt-2">
                  <button onClick={fillSample} className="text-[11px] text-[--accent] hover:text-[--accent-dark] underline">
                    Try an example →
                  </button>
                  <label className="flex items-center gap-1.5 text-[11px] text-[--muted] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isCocktail}
                      onChange={e => setIsCocktail(e.target.checked)}
                      className="accent-[--accent]"
                    />
                    Cocktail recipe
                  </label>
                </div>
              </div>
            )}

            {/* Paste */}
            {mode === 'paste' && (
              <div className="mb-3">
                <label className="block text-[11px] font-medium text-[--muted] mb-1.5">Paste your recipe</label>
                <textarea
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  placeholder="Paste any recipe text — ingredients list, steps, notes — in any format. AI will structure it automatically."
                  rows={7}
                  className="w-full px-3 py-2.5 rounded-lg border border-[--border-2] text-sm bg-white text-[--text] outline-none focus:border-[--accent] transition-colors resize-y"
                  autoFocus
                />
              </div>
            )}

            {/* Import Chat */}
            {mode === 'import' && (
              <div className="mb-3">
                <label className="block text-[11px] font-medium text-[--muted] mb-1.5">Paste conversation transcript</label>
                <textarea
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  placeholder="Paste text from a Claude chat, ChatGPT conversation, food blog, email thread — anything containing recipes. AI will find and extract all of them."
                  rows={8}
                  className="w-full px-3 py-2.5 rounded-lg border border-[--border-2] text-sm bg-white text-[--text] outline-none focus:border-[--accent] transition-colors resize-y"
                  autoFocus
                />
                <p className="text-[11px] text-[--hint] mt-1.5">Works with Claude.ai chats, ChatGPT exports, recipe websites, food blogs, emails, and more.</p>
              </div>
            )}

            {/* Manual entry */}
            {mode === 'manual' && (
              <div className="mb-3 space-y-3">
                <div>
                  <label className="block text-[11px] font-medium text-[--muted] mb-1.5">Recipe name *</label>
                  <input
                    type="text" value={manualName} onChange={e => setManualName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleManualCreate()}
                    placeholder="e.g. Tagliatelle al Ragù, Negroni Classico…"
                    className="w-full px-3 py-2.5 rounded-lg border border-[--border-2] text-sm bg-white text-[--text] outline-none focus:border-[--accent]"
                    autoFocus
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-[--muted] mb-1.5">Type</label>
                    <select value={manualType} onChange={e => setManualType(e.target.value as 'food' | 'cocktail')}
                      className="w-full px-3 py-2 rounded-lg border border-[--border-2] text-sm bg-white outline-none focus:border-[--accent]">
                      <option value="food">🍽 Food</option>
                      <option value="cocktail">🍸 Cocktail / Drink</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-[--muted] mb-1.5">Servings</label>
                    <input type="number" min="1" value={manualServings} onChange={e => setManualServings(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-lg border border-[--border-2] text-sm bg-white outline-none focus:border-[--accent]" />
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-[--muted] mb-1.5">Description</label>
                  <textarea value={manualDesc} onChange={e => setManualDesc(e.target.value)}
                    placeholder="Brief description shown on menu…" rows={2}
                    className="w-full px-3 py-2.5 rounded-lg border border-[--border-2] text-sm bg-white text-[--text] outline-none focus:border-[--accent] resize-none" />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-[--muted] mb-1.5">Menu Section</label>
                  <input value={manualSection} onChange={e => setManualSection(e.target.value)}
                    placeholder="e.g. Antipasti, Pasta, Caffè…"
                    className="w-full px-3 py-2.5 rounded-lg border border-[--border-2] text-sm bg-white text-[--text] outline-none focus:border-[--accent]" />
                </div>
                <p className="text-[11px] text-[--hint]">Creates a blank recipe shell. Add ingredients and steps in the recipe editor.</p>
              </div>
            )}

            {error && (
              <div className="mb-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
            )}

            <div className="flex gap-2 justify-end">
              <button onClick={onClose} className="px-3 py-2 text-xs text-[--muted] border border-[--border-2] rounded-lg hover:bg-[--surface-2]">
                Cancel
              </button>
              <button
                onClick={mode === 'manual' ? handleManualCreate : handleSubmit}
                disabled={loading || (mode === 'manual' ? !manualName.trim() : !input.trim())}
                className="px-4 py-2 bg-[--accent] text-white text-xs font-medium rounded-lg hover:bg-[--accent-dark] disabled:opacity-50 flex items-center gap-1.5 min-w-[90px] justify-center"
              >
                {loading ? <><span className="spinner" />{mode === 'import' ? 'Scanning…' : mode === 'manual' ? 'Creating…' : 'Generating…'}</> : modeLabel}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
