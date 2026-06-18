'use client'
// src/components/InventoryModule.tsx
// Inventory: dashboard (below-par + batch expiry) and par-level configuration.
// Receiving + Batches tabs land in the next phase.
import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase'
import type {
  InventoryParLevel, InventoryLevel, PreparedBatch, LibraryIngredient,
} from '@/lib/types'

interface Props {
  locationId?: string
  restaurantId?: string
  locationName?: string
}

type InvTab = 'dashboard' | 'par' | 'receiving' | 'batches'
type Track = 'beverage' | 'food'

interface ParDraft {
  id?: string
  library_id: string
  name: string
  track: Track
  par_qty: string
  par_unit: string
  reorder_threshold: string
  reorder_qty: string
  notes: string
}

const DISCARD_REASONS = ['Expired', 'Waste', 'Other']

function fmtDate(s: string): string {
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export default function InventoryModule({ locationId, restaurantId, locationName }: Props) {
  const supabase = createClient()
  const [tab, setTab] = useState<InvTab>('dashboard')

  const [parLevels, setParLevels] = useState<InventoryParLevel[]>([])
  const [levels,    setLevels]    = useState<InventoryLevel[]>([])
  const [batches,   setBatches]   = useState<PreparedBatch[]>([])
  const [library,   setLibrary]   = useState<LibraryIngredient[]>([])
  const [loading,   setLoading]   = useState(true)

  const [track,  setTrack]  = useState<Track>('beverage')
  const [search, setSearch] = useState('')
  const [parDraft, setParDraft] = useState<ParDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [discardId, setDiscardId] = useState<string | null>(null)
  const [discardReason, setDiscardReason] = useState('Expired')
  const [discardValue, setDiscardValue] = useState('')

  const load = useCallback(async () => {
    if (!locationId) { setLoading(false); return }
    setLoading(true)
    const [{ data: pars }, { data: levs }, { data: bats }, { data: lib }] = await Promise.all([
      supabase.from('inventory_par_levels').select('*').eq('location_id', locationId),
      supabase.from('inventory_levels').select('*').eq('location_id', locationId),
      supabase.from('prepared_batches').select('*').eq('location_id', locationId)
        .in('status', ['active', 'partially_used', 'expired']).order('use_by_date', { ascending: true }),
      supabase.from('ingredient_library').select('id,name,category,recipe_unit,purchase_unit_label')
        .or(`restaurant_id.eq.${restaurantId},user_id.is.null`).eq('is_active', true).order('name'),
    ])
    setParLevels((pars ?? []) as InventoryParLevel[])
    setLevels((levs ?? []) as InventoryLevel[])
    setBatches((bats ?? []) as PreparedBatch[])
    setLibrary((lib ?? []) as LibraryIngredient[])
    setLoading(false)
  }, [locationId, restaurantId, supabase])

  useEffect(() => { load() }, [load])

  // ── Below-par computation ─────────────────────────────────────
  function belowParRows(t: Track) {
    return parLevels.filter(p => p.track === t).map(p => {
      const lvl = levels.find(l => l.library_id === p.library_id && l.track === t)
      const onHand = lvl ? lvl.on_hand_qty : null
      const lib = library.find(l => l.id === p.library_id)
      const name = lib?.name ?? '(unknown item)'
      const isRed = onHand === null || (p.reorder_threshold != null && onHand < p.reorder_threshold)
      const belowPar = onHand === null || onHand < p.par_qty
      return { p, name, onHand, status: isRed ? 'red' as const : 'amber' as const, belowPar }
    }).filter(r => r.belowPar)
  }

  // ── Batch expiry buckets ──────────────────────────────────────
  const { expired, soon, activeCount } = useMemo(() => {
    const now = Date.now()
    const H48 = 48 * 3600 * 1000
    const exp: PreparedBatch[] = [], sn: PreparedBatch[] = []
    let active = 0
    for (const b of batches) {
      const t = new Date(b.use_by_date).getTime()
      if (!isNaN(t) && t < now) exp.push(b)
      else if (!isNaN(t) && t <= now + H48) sn.push(b)
      else active++
    }
    return { expired: exp, soon: sn, activeCount: active }
  }, [batches])

  async function confirmDiscard(b: PreparedBatch) {
    await supabase.from('prepared_batch_depletions').insert({
      batch_id: b.id, depleted_at: new Date().toISOString(),
      depleted_qty: b.current_qty, depleted_unit: b.current_unit,
      source: 'waste', source_ref: '', depleted_by: '', notes: discardReason,
    })
    await supabase.from('prepared_batches').update({
      status: 'discarded', discarded_at: new Date().toISOString(),
      discard_reason: discardReason, discard_value: discardValue === '' ? null : parseFloat(discardValue),
    }).eq('id', b.id)
    setDiscardId(null); setDiscardReason('Expired'); setDiscardValue('')
    load()
  }

  // ── Par levels: configured + not-configured for active track ──
  const configured = useMemo(() => {
    return parLevels.filter(p => p.track === track).map(p => {
      const lib = library.find(l => l.id === p.library_id)
      return { p, lib, name: lib?.name ?? '(unknown)', category: lib?.category ?? '' }
    }).filter(r => !search || r.name.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
  }, [parLevels, library, track, search])

  const notConfigured = useMemo(() => {
    return library.filter(l => !parLevels.some(p => p.library_id === l.id && p.track === track))
      .filter(l => !search || l.name.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => (a.category ?? '').localeCompare(b.category ?? '') || a.name.localeCompare(b.name))
  }, [library, parLevels, track, search])

  function openSetPar(lib: LibraryIngredient) {
    setParDraft({
      library_id: lib.id, name: lib.name, track,
      par_qty: '', par_unit: lib.recipe_unit ?? '', reorder_threshold: '', reorder_qty: '', notes: '',
    })
  }
  function openEditPar(p: InventoryParLevel, name: string) {
    setParDraft({
      id: p.id, library_id: p.library_id, name, track: p.track,
      par_qty: String(p.par_qty), par_unit: p.par_unit,
      reorder_threshold: p.reorder_threshold == null ? '' : String(p.reorder_threshold),
      reorder_qty: p.reorder_qty == null ? '' : String(p.reorder_qty),
      notes: p.notes ?? '',
    })
  }

  async function savePar() {
    if (!parDraft || !locationId) return
    if (parDraft.par_qty === '' || isNaN(parseFloat(parDraft.par_qty))) { alert('Par qty is required'); return }
    setSaving(true)
    const payload = {
      location_id: locationId,
      library_id: parDraft.library_id,
      track: parDraft.track,
      par_qty: parseFloat(parDraft.par_qty),
      par_unit: parDraft.par_unit || '',
      reorder_threshold: parDraft.reorder_threshold === '' ? null : parseFloat(parDraft.reorder_threshold),
      reorder_qty: parDraft.reorder_qty === '' ? null : parseFloat(parDraft.reorder_qty),
      notes: parDraft.notes || '',
    }
    if (parDraft.id) {
      await supabase.from('inventory_par_levels').update(payload).eq('id', parDraft.id)
    } else {
      await supabase.from('inventory_par_levels').insert(payload)
    }
    setSaving(false)
    setParDraft(null)
    load()
  }

  if (loading) return <div className="flex items-center justify-center h-full text-[--hint] text-sm">Loading inventory…</div>

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="bg-white border-b border-[--border] px-6 py-4 flex-shrink-0">
        <h1 className="font-serif text-xl font-medium text-[--text] mb-3">Inventory{locationName ? ` — ${locationName}` : ''}</h1>
        <div className="flex bg-[--surface-2] rounded-lg p-0.5 gap-0.5 w-fit">
          {([['dashboard', '📦 Dashboard'], ['par', '⚖ Par Levels'], ['receiving', '🚚 Receiving'], ['batches', '📋 Batches']] as [InvTab, string][]).map(([t, label]) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-1.5 text-xs font-medium rounded-md transition-all ${tab === t ? 'bg-white text-[--text] shadow-sm' : 'text-[--muted]'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {!locationId ? (
          <p className="text-sm text-[--muted]">No location selected.</p>
        ) : tab === 'dashboard' ? (
          <DashboardTab
            belowParRows={belowParRows}
            expired={expired} soon={soon} activeCount={activeCount}
            discardId={discardId} setDiscardId={setDiscardId}
            discardReason={discardReason} setDiscardReason={setDiscardReason}
            discardValue={discardValue} setDiscardValue={setDiscardValue}
            confirmDiscard={confirmDiscard}
          />
        ) : tab === 'par' ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex bg-[--surface-2] rounded-lg p-0.5 gap-0.5 w-fit">
                {(['beverage', 'food'] as Track[]).map(t => (
                  <button key={t} onClick={() => setTrack(t)}
                    className={`px-4 py-1.5 text-xs font-medium rounded-md capitalize transition-all ${track === t ? 'bg-white text-[--text] shadow-sm' : 'text-[--muted]'}`}>
                    {t}
                  </button>
                ))}
              </div>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name…"
                className="text-xs border border-[--border-2] rounded-lg px-2.5 py-1.5 outline-none focus:border-[--accent] w-48" />
            </div>

            {/* Configured */}
            {configured.length === 0 ? (
              <p className="text-sm text-[--muted]">No {track} par levels configured yet.</p>
            ) : (
              <div className="bg-white rounded-xl border border-[--border] overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[--border] bg-[--surface-2] text-[10px] uppercase tracking-wide text-[--hint]">
                      <th className="text-left px-3 py-2">Name</th>
                      <th className="text-left px-3 py-2">Category</th>
                      <th className="text-left px-3 py-2">Par Qty</th>
                      <th className="text-left px-3 py-2">Unit</th>
                      <th className="text-left px-3 py-2">Reorder at</th>
                      <th className="text-left px-3 py-2">Reorder qty</th>
                      <th className="text-left px-3 py-2 w-12"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {configured.map(({ p, name, category }) => (
                      <tr key={p.id} className="border-b border-[--border] last:border-0">
                        <td className="px-3 py-2.5 font-medium text-[--text]">{name}</td>
                        <td className="px-3 py-2.5 text-[--muted]">{category}</td>
                        <td className="px-3 py-2.5 text-[--muted]">{p.par_qty}</td>
                        <td className="px-3 py-2.5 text-[--muted]">{p.par_unit}</td>
                        <td className="px-3 py-2.5 text-[--muted]">{p.reorder_threshold ?? '—'}</td>
                        <td className="px-3 py-2.5 text-[--muted]">{p.reorder_qty ?? '—'}</td>
                        <td className="px-3 py-2.5">
                          <button onClick={() => openEditPar(p, name)}
                            className="px-2 py-0.5 text-[10px] border border-[--border-2] rounded text-[--muted] hover:text-[--text]">Edit</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Not yet configured */}
            {notConfigured.length > 0 && (
              <div>
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[--hint] mb-2">Not yet configured</h3>
                <div className="bg-white rounded-xl border border-[--border] overflow-hidden opacity-80">
                  <table className="w-full text-xs">
                    <tbody>
                      {notConfigured.map(l => (
                        <tr key={l.id} className="border-b border-[--border] last:border-0">
                          <td className="px-3 py-2 font-medium text-[--muted]">{l.name}</td>
                          <td className="px-3 py-2 text-[--hint]">{l.category}</td>
                          <td className="px-3 py-2 text-right">
                            <button onClick={() => openSetPar(l)}
                              className="px-2 py-0.5 text-[10px] border border-[--accent] text-[--accent] rounded hover:bg-[--accent-light]">+ Set par</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Set par form */}
            {parDraft && (
              <div className="bg-white rounded-xl border border-[--border] p-4 space-y-3">
                <h3 className="font-serif text-sm font-medium text-[--text]">{parDraft.id ? 'Edit par level' : 'Set par level'}</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-[--muted] mb-1">Item</label>
                    <div className="text-xs text-[--text] px-2.5 py-1.5 bg-[--surface-2] rounded-lg">{parDraft.name}</div>
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-[--muted] mb-1">Track</label>
                    <div className="text-xs text-[--text] px-2.5 py-1.5 bg-[--surface-2] rounded-lg capitalize">{parDraft.track}</div>
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-[--muted] mb-1">Par qty</label>
                    <input type="number" step="any" value={parDraft.par_qty}
                      onChange={e => setParDraft(d => ({ ...d!, par_qty: e.target.value }))}
                      className="text-xs border border-[--border-2] rounded-lg px-2.5 py-1.5 outline-none focus:border-[--accent] w-full" />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-[--muted] mb-1">Unit</label>
                    <input value={parDraft.par_unit}
                      onChange={e => setParDraft(d => ({ ...d!, par_unit: e.target.value }))}
                      className="text-xs border border-[--border-2] rounded-lg px-2.5 py-1.5 outline-none focus:border-[--accent] w-full" />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-[--muted] mb-1">Reorder at</label>
                    <input type="number" step="any" value={parDraft.reorder_threshold}
                      onChange={e => setParDraft(d => ({ ...d!, reorder_threshold: e.target.value }))}
                      className="text-xs border border-[--border-2] rounded-lg px-2.5 py-1.5 outline-none focus:border-[--accent] w-full" />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-[--muted] mb-1">Reorder qty</label>
                    <input type="number" step="any" value={parDraft.reorder_qty}
                      onChange={e => setParDraft(d => ({ ...d!, reorder_qty: e.target.value }))}
                      className="text-xs border border-[--border-2] rounded-lg px-2.5 py-1.5 outline-none focus:border-[--accent] w-full" />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-[11px] font-medium text-[--muted] mb-1">Notes</label>
                    <input value={parDraft.notes}
                      onChange={e => setParDraft(d => ({ ...d!, notes: e.target.value }))}
                      className="text-xs border border-[--border-2] rounded-lg px-2.5 py-1.5 outline-none focus:border-[--accent] w-full" />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={savePar} disabled={saving}
                    className="px-4 py-1.5 text-xs font-medium bg-[--accent] text-white rounded-lg hover:bg-[--accent-dark] disabled:opacity-50">
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                  <button onClick={() => setParDraft(null)}
                    className="px-4 py-1.5 text-xs border border-[--border-2] text-[--muted] rounded-lg hover:bg-[--surface-2]">Cancel</button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-16 text-[--muted]">
            <div className="text-4xl opacity-20 mb-3">{tab === 'receiving' ? '🚚' : '📋'}</div>
            <p className="text-sm">{tab === 'receiving' ? 'Receiving' : 'Batches'} coming in the next phase.</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Dashboard tab ─────────────────────────────────────────────
function DashboardTab(props: {
  belowParRows: (t: Track) => { p: InventoryParLevel; name: string; onHand: number | null; status: 'red' | 'amber' }[]
  expired: PreparedBatch[]; soon: PreparedBatch[]; activeCount: number
  discardId: string | null; setDiscardId: (id: string | null) => void
  discardReason: string; setDiscardReason: (s: string) => void
  discardValue: string; setDiscardValue: (s: string) => void
  confirmDiscard: (b: PreparedBatch) => void
}) {
  const { belowParRows, expired, soon, activeCount, discardId, setDiscardId, discardReason, setDiscardReason, discardValue, setDiscardValue, confirmDiscard } = props

  function ParSection({ t }: { t: Track }) {
    const rows = belowParRows(t)
    if (rows.length === 0) return null
    return (
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-[--hint] mb-1.5 capitalize">{t}</div>
        <div className="bg-white rounded-xl border border-[--border] overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[--border] text-[10px] uppercase tracking-wide text-[--hint]">
                <th className="text-left px-3 py-2">Item</th>
                <th className="text-left px-3 py-2">On hand</th>
                <th className="text-left px-3 py-2">Par</th>
                <th className="text-left px-3 py-2">Unit</th>
                <th className="text-left px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.p.id} className={`border-b border-[--border] last:border-0 ${r.status === 'red' ? 'bg-red-50/50' : 'bg-amber-50/40'}`}>
                  <td className="px-3 py-2 font-medium text-[--text]">{r.name}</td>
                  <td className="px-3 py-2 text-[--muted]">{r.onHand ?? '—'}</td>
                  <td className="px-3 py-2 text-[--muted]">{r.p.par_qty}</td>
                  <td className="px-3 py-2 text-[--muted]">{r.p.par_unit}</td>
                  <td className="px-3 py-2">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${r.status === 'red' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
                      {r.status === 'red' ? 'Reorder' : 'Low'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  const anyBelow = belowParRows('beverage').length > 0 || belowParRows('food').length > 0

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-serif text-sm font-medium text-[--text] mb-2">Below par</h2>
        {anyBelow ? (
          <div className="space-y-3">
            <ParSection t="beverage" />
            <ParSection t="food" />
          </div>
        ) : (
          <p className="text-sm text-[--green]">✓ All items at or above par</p>
        )}
      </div>

      <div>
        <h2 className="font-serif text-sm font-medium text-[--text] mb-2">Prepared batches</h2>
        <div className="flex gap-4 text-xs mb-3 flex-wrap">
          <span className="text-red-600">🔴 Expired: {expired.length} — needs action</span>
          <span className="text-amber-600">🟡 Expiring soon (48hrs): {soon.length}</span>
          <span className="text-[--green]">🟢 Active: {activeCount}</span>
        </div>

        <div className="space-y-2">
          {[...expired, ...soon].map(b => {
            const isExpired = expired.includes(b)
            return (
              <div key={b.id} className={`rounded-xl border p-3 ${isExpired ? 'border-red-200 bg-red-50/40' : 'border-amber-200 bg-amber-50/40'}`}>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="text-xs">
                    <span className="font-medium text-[--text]">{b.batch_name}</span>
                    <span className="text-[--muted]"> · {b.current_qty} {b.current_unit} · USE BY {fmtDate(b.use_by_date)}</span>
                  </div>
                  {isExpired ? (
                    <button onClick={() => setDiscardId(discardId === b.id ? null : b.id)}
                      className="px-2.5 py-1 text-[11px] border border-red-300 text-red-600 rounded-lg hover:bg-red-50">Discard</button>
                  ) : (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">Expires {fmtDate(b.use_by_date)}</span>
                  )}
                </div>
                {discardId === b.id && (
                  <div className="mt-2 pt-2 border-t border-red-200 flex items-end gap-2 flex-wrap">
                    <div>
                      <label className="block text-[10px] text-[--muted] mb-1">Reason</label>
                      <select value={discardReason} onChange={e => setDiscardReason(e.target.value)}
                        className="text-xs border border-[--border-2] rounded-lg px-2 py-1 bg-white outline-none focus:border-[--accent]">
                        {DISCARD_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] text-[--muted] mb-1">Value ($)</label>
                      <input type="number" step="0.01" value={discardValue} onChange={e => setDiscardValue(e.target.value)}
                        className="text-xs border border-[--border-2] rounded-lg px-2 py-1 outline-none focus:border-[--accent] w-24" />
                    </div>
                    <button onClick={() => confirmDiscard(b)}
                      className="px-3 py-1 text-[11px] font-medium bg-red-600 text-white rounded-lg hover:bg-red-700">Confirm discard</button>
                  </div>
                )}
              </div>
            )
          })}
          {expired.length === 0 && soon.length === 0 && (
            <p className="text-xs text-[--muted]">No expired or expiring batches.</p>
          )}
        </div>
      </div>
    </div>
  )
}
