'use client'
import { useState, useCallback, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase'
import { ING_CATEGORIES, SUBCATEGORIES } from '@/lib/ingredientConstants'

interface LibRow {
  _key: string          // temp client-side key
  name: string
  category: string
  sub_category: string
  brand: string
  purchase_unit: string
  purchase_unit_cost: number | string
  recipe_unit: string
  unit_conversion: number | string
  notes: string
  _exists?: boolean     // true = already in library — greyed out
  _selected: boolean
}

interface Props {
  userId: string
  restaurantId?: string
  existingNames?: Set<string>
  onImported: (count: number) => void
}

export default function AIIngredientImporter({ userId, restaurantId, existingNames: externalNames, onImported }: Props) {
  const supabase = createClient()
  const [existingNames, setExistingNames] = useState<Set<string>>(externalNames ?? new Set())

  // Load existing library names to de-duplicate
  useEffect(() => {
    if (!restaurantId) return
    supabase.from('ingredient_library').select('name')
      .or(`user_id.eq.${userId},user_id.is.null,restaurant_id.eq.${restaurantId}`)
      .eq('is_active', true)
      .then(({ data }) => {
        setExistingNames(new Set((data ?? []).map((r: any) => r.name.toLowerCase().trim())))
      })
  }, [restaurantId, userId])
  const [category,   setCategory]   = useState('')
  const [loading,    setLoading]    = useState(false)
  const [importing,  setImporting]  = useState(false)
  const [error,      setError]      = useState('')
  const [rows,       setRows]       = useState<LibRow[]>([])

  async function generate() {
    if (!category.trim() || loading) return
    setLoading(true); setError(''); setRows([])

    try {
      const res = await fetch('/api/ai/ingredient-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: category.trim() }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      const parsed: any[] = data.ingredients

      const generated: LibRow[] = parsed.map((item: any, i: number) => {
        const nameKey = (item.name ?? '').toLowerCase().trim()
        return {
          _key: `gen-${i}`,
          name: item.name ?? '',
          category: item.category ?? 'Pantry',
          sub_category: item.sub_category ?? '',
          brand: item.brand ?? '',
          purchase_unit: item.purchase_unit ?? 'each',
          purchase_unit_cost: item.purchase_unit_cost ?? 0,
          recipe_unit: item.recipe_unit ?? 'oz',
          unit_conversion: item.unit_conversion ?? 1,
          notes: item.notes ?? '',
          _exists: existingNames.has(nameKey),
          _selected: !existingNames.has(nameKey),
        }
      })

      setRows(generated)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  function updateRow(key: string, field: keyof LibRow, value: any) {
    setRows(prev => prev.map(r => r._key === key ? { ...r, [field]: value } : r))
  }

  function deleteRow(key: string) {
    setRows(prev => prev.filter(r => r._key !== key))
  }

  function addRow() {
    setRows(prev => [...prev, {
      _key: `manual-${Date.now()}`,
      name: '', category: 'Pantry', sub_category: '', brand: '',
      purchase_unit: 'lb', purchase_unit_cost: 0,
      recipe_unit: 'oz', unit_conversion: 16, notes: '',
      _exists: false, _selected: true,
    }])
  }

  function toggleAll(val: boolean) {
    setRows(prev => prev.map(r => r._exists ? r : { ...r, _selected: val }))
  }

  async function importSelected() {
    const toImport = rows.filter(r => r._selected && !r._exists && r.name.trim())
    if (toImport.length === 0) return
    setImporting(true)
    try {
      const payload = toImport.map(r => ({
        user_id: userId,
        restaurant_id: restaurantId ?? null,
        name: r.name.trim(),
        category: r.category,
        sub_category: r.sub_category || null,
        brand: r.brand || null,
        purchase_unit: r.purchase_unit,
        purchase_unit_qty: null,
        purchase_unit_label: r.purchase_unit || null,
        purchase_unit_cost: parseFloat(String(r.purchase_unit_cost)) || null,
        recipe_unit: r.recipe_unit,
        unit_conversion: parseFloat(String(r.unit_conversion)) || 1,
        trim_factor: 1,
        notes: r.notes || null,
        is_active: true,
      }))
      const { error } = await supabase.from('ingredient_library').insert(payload)
      if (error) throw error
      onImported(toImport.length)
      setRows([])
      setCategory('')
    } catch (e) {
      setError(String(e))
    } finally {
      setImporting(false)
    }
  }

  const newCount      = rows.filter(r => !r._exists && r._selected).length
  const existingCount = rows.filter(r => r._exists).length

  return (
    <div className="space-y-5">
      {/* Input */}
      <div>
        <label className="block text-xs font-medium text-[--muted] mb-2">
          Food or beverage category
        </label>
        <div className="flex gap-2">
          <input
            value={category}
            onChange={e => setCategory(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && generate()}
            placeholder="e.g. Italian cold cuts, Offal, Japanese pantry, Alpine cheeses…"
            className="flex-1 px-3 py-2.5 text-sm border border-[--border-2] rounded-xl outline-none focus:border-[--accent] bg-white"
            autoFocus
          />
          <button
            onClick={generate}
            disabled={loading || !category.trim()}
            className="px-5 py-2.5 bg-[--accent] text-white text-sm font-medium rounded-xl hover:bg-[--accent-dark] disabled:opacity-50 flex items-center gap-2 flex-shrink-0"
          >
            {loading ? <><span className="spinner" />Generating…</> : '✨ Generate'}
          </button>
        </div>
        <p className="text-[11px] text-[--hint] mt-1.5">
          AI generates a suggested list. Review and edit before importing.
        </p>
      </div>

      {error && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
      )}

      {rows.length > 0 && (
        <>
          {/* Summary bar */}
          <div className="flex items-center gap-4 text-xs">
            <span className="text-[--text] font-medium">{rows.length} items generated</span>
            <span className="text-green-600">✓ {newCount} new</span>
            {existingCount > 0 && <span className="text-[--hint]">⊘ {existingCount} already in library</span>}
            <div className="ml-auto flex gap-2">
              <button onClick={() => toggleAll(true)} className="text-[--accent] hover:underline">Select all new</button>
              <button onClick={() => toggleAll(false)} className="text-[--muted] hover:underline">Deselect all</button>
              <button onClick={addRow} className="text-[--accent] hover:underline">+ Add row</button>
            </div>
          </div>

          {/* Grid */}
          <div className="overflow-x-auto rounded-xl border border-[--border]">
            <table className="w-full text-xs min-w-[1100px]">
              <thead>
                <tr className="bg-[--surface-2] border-b border-[--border]">
                  <th className="w-8 px-3 py-2 text-left" />
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-[--hint] min-w-[200px]">Name</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-[--hint] w-36">Category</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-[--hint] w-32">Sub-cat</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-[--hint] w-28">Brand</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-[--hint] w-28">Purchase unit</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-[--hint] w-20">Cost ($)</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-[--hint] w-24">Recipe unit</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-[--hint] w-20">Conv.</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-[--hint]">Notes</th>
                  <th className="w-8 px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row._key}
                    className={`border-b border-[--border] last:border-0 transition-colors ${
                      row._exists ? 'opacity-40 bg-[--surface-2]' : row._selected ? 'bg-white hover:bg-[--surface-2]/50' : 'bg-[--surface-2] opacity-60'
                    }`}>
                    {/* Checkbox */}
                    <td className="px-3 py-1.5">
                      {row._exists ? (
                        <span className="text-[--hint] text-[10px]">⊘</span>
                      ) : (
                        <input type="checkbox" checked={row._selected}
                          onChange={e => updateRow(row._key, '_selected', e.target.checked)}
                          className="accent-[--accent] w-3.5 h-3.5 cursor-pointer" />
                      )}
                    </td>
                    {/* Name */}
                    <td className="px-2 py-1">
                      <input value={row.name} onChange={e => updateRow(row._key, 'name', e.target.value)}
                        disabled={row._exists}
                        className="w-full bg-transparent outline-none text-[--text] font-medium focus:bg-white focus:border focus:border-[--accent] rounded px-1 py-0.5 disabled:cursor-not-allowed" />
                      {row._exists && <div className="text-[9px] text-[--hint]">Already in library</div>}
                    </td>
                    {/* Category */}
                    <td className="px-2 py-1">
                      <select value={row.category} onChange={e => updateRow(row._key, 'category', e.target.value)}
                        disabled={row._exists}
                        className="w-full bg-transparent outline-none text-[--muted] cursor-pointer text-xs disabled:cursor-not-allowed">
                        {ING_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </td>
                    {/* Sub-category */}
                    <td className="px-2 py-1">
                      {SUBCATEGORIES[row.category] ? (
                        <select value={row.sub_category} onChange={e => updateRow(row._key, 'sub_category', e.target.value)}
                          disabled={row._exists}
                          className="w-full bg-transparent outline-none text-[--muted] cursor-pointer text-xs disabled:cursor-not-allowed">
                          <option value="">—</option>
                          {SUBCATEGORIES[row.category].map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      ) : (
                        <input value={row.sub_category} onChange={e => updateRow(row._key, 'sub_category', e.target.value)}
                          disabled={row._exists}
                          className="w-full bg-transparent outline-none text-[--muted] focus:bg-white focus:border focus:border-[--accent] rounded px-1 py-0.5 disabled:cursor-not-allowed" />
                      )}
                    </td>
                    {/* Brand */}
                    <td className="px-2 py-1">
                      <input value={row.brand} onChange={e => updateRow(row._key, 'brand', e.target.value)}
                        disabled={row._exists}
                        className="w-full bg-transparent outline-none text-[--muted] focus:bg-white focus:border focus:border-[--accent] rounded px-1 py-0.5 disabled:cursor-not-allowed" />
                    </td>
                    {/* Purchase unit */}
                    <td className="px-2 py-1">
                      <input value={row.purchase_unit} onChange={e => updateRow(row._key, 'purchase_unit', e.target.value)}
                        disabled={row._exists}
                        className="w-full bg-transparent outline-none text-[--muted] focus:bg-white focus:border focus:border-[--accent] rounded px-1 py-0.5 disabled:cursor-not-allowed" />
                    </td>
                    {/* Cost */}
                    <td className="px-2 py-1">
                      <input type="number" min="0" step="0.01" value={row.purchase_unit_cost}
                        onChange={e => updateRow(row._key, 'purchase_unit_cost', e.target.value)}
                        disabled={row._exists}
                        className="w-full bg-transparent outline-none text-[--muted] focus:bg-white focus:border focus:border-[--accent] rounded px-1 py-0.5 disabled:cursor-not-allowed" />
                    </td>
                    {/* Recipe unit */}
                    <td className="px-2 py-1">
                      <input value={row.recipe_unit} onChange={e => updateRow(row._key, 'recipe_unit', e.target.value)}
                        disabled={row._exists}
                        className="w-full bg-transparent outline-none text-[--muted] focus:bg-white focus:border focus:border-[--accent] rounded px-1 py-0.5 disabled:cursor-not-allowed" />
                    </td>
                    {/* Conversion */}
                    <td className="px-2 py-1">
                      <input type="number" min="0" step="0.01" value={row.unit_conversion}
                        onChange={e => updateRow(row._key, 'unit_conversion', e.target.value)}
                        disabled={row._exists}
                        className="w-full bg-transparent outline-none text-[--muted] focus:bg-white focus:border focus:border-[--accent] rounded px-1 py-0.5 disabled:cursor-not-allowed" />
                    </td>
                    {/* Notes */}
                    <td className="px-2 py-1">
                      <input value={row.notes} onChange={e => updateRow(row._key, 'notes', e.target.value)}
                        disabled={row._exists}
                        className="w-full bg-transparent outline-none text-[--hint] focus:bg-white focus:border focus:border-[--accent] rounded px-1 py-0.5 disabled:cursor-not-allowed" />
                    </td>
                    {/* Delete */}
                    <td className="px-2 py-1">
                      {!row._exists && (
                        <button onClick={() => deleteRow(row._key)}
                          className="text-[--hint] hover:text-red-400 transition-colors">✕</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Import button */}
          <div className="flex items-center justify-between pt-2">
            <p className="text-[11px] text-[--hint]">
              {newCount} item{newCount !== 1 ? 's' : ''} will be added to your ingredient library.
            </p>
            <button
              onClick={importSelected}
              disabled={importing || newCount === 0}
              className="px-5 py-2.5 bg-[--accent] text-white text-sm font-medium rounded-xl hover:bg-[--accent-dark] disabled:opacity-50 flex items-center gap-2"
            >
              {importing
                ? <><span className="spinner" />Importing…</>
                : `⬇ Import ${newCount} item${newCount !== 1 ? 's' : ''}`
              }
            </button>
          </div>
        </>
      )}
    </div>
  )
}
