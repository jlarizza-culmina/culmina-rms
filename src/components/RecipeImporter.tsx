'use client'
// src/components/RecipeImporter.tsx
// JSON recipe import: upload file → preview table → bulk insert

import { useState, useRef, useCallback } from 'react'

interface PreviewRow {
  name: string; menu_name?: string; ingredients: number
  steps: number; price?: number; allergens: string[]; season: string[]
}

interface Props {
  userId: string; restaurantId: string
  onComplete: (count: number) => void
  onCancel: () => void
}

export default function RecipeImporter({ userId, restaurantId, onComplete, onCancel }: Props) {
  const [stage,    setStage]    = useState<'upload' | 'preview' | 'done'>('upload')
  const [raw,      setRaw]      = useState<any>(null)
  const [preview,  setPreview]  = useState<PreviewRow[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)
  const [result,   setResult]   = useState<{ imported: number; errors: string[] } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  function parseJson(text: string) {
    try {
      const data = JSON.parse(text)
      const list = Array.isArray(data) ? data : (data.recipes ?? [])
      if (!list.length) { setError('No recipes found in this file.'); return }
      setRaw(data)
      const rows: PreviewRow[] = list.map((r: any) => ({
        name: r.name, menu_name: r.menu_name,
        ingredients: r.ingredients?.length ?? 0,
        steps: r.steps?.length ?? 0, price: r.price,
        allergens: r.allergens ?? [], season: r.season ?? [],
      }))
      setPreview(rows)
      setSelected(new Set(rows.map((_, i) => i)))
      setError('')
      setStage('preview')
    } catch {
      setError('Invalid JSON — could not parse the file.')
    }
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => parseJson(ev.target?.result as string)
    reader.readAsText(file)
  }

  function toggleRow(i: number) {
    setSelected(s => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n })
  }
  function toggleAll() {
    setSelected(s => s.size === preview.length ? new Set() : new Set(preview.map((_, i) => i)))
  }

  const doImport = useCallback(async () => {
    if (!selected.size) return
    setLoading(true)
    setError('')
    try {
      // Build the payload with only selected recipes
      const list = Array.isArray(raw) ? raw : (raw.recipes ?? [])
      const toImport = Array.from(selected).sort().map(i => list[i])
      const payload = Array.isArray(raw) ? toImport : { ...raw, recipes: toImport }

      const res = await fetch('/api/recipes/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipes: payload, restaurantId, userId }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Import failed'); setLoading(false); return }
      setResult({ imported: data.imported, errors: data.errors ?? [] })
      setStage('done')
    } catch (e: any) {
      setError(e.message)
    }
    setLoading(false)
  }, [raw, selected, restaurantId, userId])

  const SEASON_COLOR: Record<string, string> = {
    spring: '#2E6B25', summer: '#D97706', fall: '#C05A2A', winter: '#2A61A0'
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[--border] flex-shrink-0">
        <div>
          <h2 className="font-serif text-lg font-medium text-[--text]">Import Recipes from JSON</h2>
          <p className="text-xs text-[--muted] mt-0.5">
            {stage === 'upload' ? 'Upload a JSON file in Corretto format'
              : stage === 'preview' ? `${preview.length} recipes found — select which to import`
              : 'Import complete'}
          </p>
        </div>
        <button onClick={onCancel} className="text-[--hint] hover:text-[--muted] text-sm px-2">✕</button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">

        {/* ── UPLOAD STAGE ── */}
        {stage === 'upload' && (
          <div className="max-w-lg mx-auto space-y-4">
            <div
              onClick={() => fileRef.current?.click()}
              className="border-2 border-dashed border-[--border-2] rounded-2xl p-12 text-center cursor-pointer hover:border-[--accent] hover:bg-[--accent-light]/10 transition-all group">
              <div className="text-5xl mb-4 group-hover:scale-110 transition-transform">📂</div>
              <p className="text-sm font-medium text-[--text]">Click to upload a JSON file</p>
              <p className="text-xs text-[--muted] mt-1">or drag and drop</p>
              <p className="text-[11px] text-[--hint] mt-3">Supports Corretto JSON format and standard recipe arrays</p>
            </div>
            <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={onFileChange} />

            {/* Or paste JSON */}
            <div className="text-center text-xs text-[--hint]">— or —</div>
            <div>
              <label className="block text-xs text-[--muted] mb-1">Paste JSON directly</label>
              <textarea
                rows={6}
                placeholder='{ "recipes": [...] } or paste raw array'
                className="w-full text-xs border border-[--border-2] rounded-xl px-3 py-2.5 outline-none focus:border-[--accent] font-mono resize-none"
                onChange={e => { if (e.target.value.trim().startsWith('{') || e.target.value.trim().startsWith('[')) parseJson(e.target.value) }}
              />
            </div>
            {error && <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          </div>
        )}

        {/* ── PREVIEW STAGE ── */}
        {stage === 'preview' && (
          <div className="space-y-3 max-w-5xl">
            {/* Meta info from file header */}
            {raw?.category && (
              <div className="bg-[--accent-light]/20 border border-[--accent]/30 rounded-xl px-4 py-3 text-xs text-[--text]">
                <span className="font-semibold">{raw.category}</span>
                {raw.menu_section && <span className="text-[--muted] ml-2">· {raw.menu_section}</span>}
                {raw.note && <p className="text-[--muted] mt-1 italic">{raw.note}</p>}
              </div>
            )}

            {/* Table */}
            <div className="bg-white rounded-xl border border-[--border] overflow-hidden">
              {/* Header */}
              <div className="bg-[--surface-2] border-b border-[--border] grid text-[10px] font-semibold uppercase tracking-wide text-[--hint]"
                style={{ gridTemplateColumns: '36px 1fr 160px 70px 70px 80px 120px 60px' }}>
                <div className="flex items-center justify-center py-2.5">
                  <input type="checkbox"
                    checked={selected.size === preview.length}
                    onChange={toggleAll}
                    className="accent-[--accent]" />
                </div>
                {['Recipe','Description','Ingredients','Steps','Price','Allergens','Season'].map(h => (
                  <div key={h} className="px-3 py-2.5">{h}</div>
                ))}
              </div>

              {/* Rows */}
              {preview.map((row, i) => {
                const recipeList = Array.isArray(raw) ? raw : (raw.recipes ?? [])
                const fullRecipe = recipeList[i]
                return (
                  <div key={i}
                    onClick={() => toggleRow(i)}
                    className={`grid items-center border-b border-[--border] last:border-0 cursor-pointer transition-colors ${selected.has(i) ? 'bg-white' : 'bg-[--surface-2]/60 opacity-50'} hover:bg-[--accent-light]/10`}
                    style={{ gridTemplateColumns: '36px 1fr 160px 70px 70px 80px 120px 60px' }}>
                    <div className="flex items-center justify-center py-3">
                      <input type="checkbox" checked={selected.has(i)} readOnly className="accent-[--accent]" />
                    </div>
                    <div className="px-3 py-3 min-w-0">
                      <div className="text-xs font-semibold text-[--text] truncate">{row.name}</div>
                      {fullRecipe?.menu_description && (
                        <div className="text-[10px] text-[--hint] truncate mt-0.5">{fullRecipe.menu_description}</div>
                      )}
                    </div>
                    <div className="px-3 py-3 text-[10px] text-[--muted] truncate">
                      {fullRecipe?.menu_description}
                    </div>
                    <div className="px-3 py-3 text-xs text-center text-[--muted]">{row.ingredients}</div>
                    <div className="px-3 py-3 text-xs text-center text-[--muted]">{row.steps}</div>
                    <div className="px-3 py-3 text-xs font-medium text-[--accent]">
                      {row.price ? `$${row.price}` : '—'}
                    </div>
                    <div className="px-3 py-3 flex flex-wrap gap-0.5">
                      {row.allergens.slice(0,3).map(a => (
                        <span key={a} className="text-[9px] bg-red-50 text-red-600 border border-red-200 px-1 rounded">{a}</span>
                      ))}
                    </div>
                    <div className="px-3 py-3 flex flex-wrap gap-0.5">
                      {row.season.map(s => (
                        <span key={s} className="text-[9px] px-1 rounded text-white"
                          style={{ background: SEASON_COLOR[s] ?? '#6B7280' }}>
                          {s[0].toUpperCase()}
                        </span>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>

            {error && <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

            {/* Actions */}
            <div className="flex items-center justify-between pt-2">
              <div className="text-xs text-[--muted]">
                {selected.size} of {preview.length} selected
              </div>
              <div className="flex gap-3">
                <button onClick={() => setStage('upload')}
                  className="px-4 py-2 border border-[--border-2] text-[--muted] text-xs rounded-lg hover:bg-[--surface-2]">
                  ← Back
                </button>
                <button onClick={doImport} disabled={!selected.size || loading}
                  className="px-5 py-2 bg-[--accent] text-white text-xs font-medium rounded-lg hover:bg-[--accent-dark] disabled:opacity-50 flex items-center gap-2">
                  {loading
                    ? <><span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />Importing…</>
                    : `Import ${selected.size} recipe${selected.size !== 1 ? 's' : ''}`}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── DONE STAGE ── */}
        {stage === 'done' && result && (
          <div className="max-w-md mx-auto text-center py-8 space-y-4">
            <div className="text-6xl">{result.errors.length ? '⚠️' : '✅'}</div>
            <h3 className="font-serif text-xl text-[--text]">
              {result.imported} recipe{result.imported !== 1 ? 's' : ''} imported
            </h3>
            {result.errors.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-left">
                <p className="text-xs font-medium text-amber-700 mb-2">{result.errors.length} failed:</p>
                {result.errors.map((e, i) => (
                  <p key={i} className="text-[11px] text-amber-600">• {e}</p>
                ))}
              </div>
            )}
            <button onClick={() => onComplete(result.imported)}
              className="px-6 py-2.5 bg-[--accent] text-white text-sm font-medium rounded-lg hover:bg-[--accent-dark]">
              View recipes →
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
