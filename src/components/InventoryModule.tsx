'use client'
// src/components/InventoryModule.tsx
// Inventory: dashboard, par levels, receiving, and prepared batches.
import { useState, useEffect, useCallback, useMemo, Fragment } from 'react'
import { createClient } from '@/lib/supabase'
import type {
  InventoryParLevel, InventoryLevel, PreparedBatch, LibraryIngredient,
  InventoryReceipt, InventoryReceiptLine,
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
type BatchFilter = 'all' | 'active' | 'expiring' | 'expired' | 'depleted'
const BATCH_UNITS = ['kg', 'L', 'portions', 'gallons', 'each']
const USE_SOURCES: { value: 'service_use' | 'mise_en_place' | 'waste' | 'manual'; label: string }[] = [
  { value: 'service_use',   label: 'Service use' },
  { value: 'mise_en_place', label: 'Mise en place' },
  { value: 'waste',         label: 'Waste' },
  { value: 'manual',        label: 'Manual' },
]

interface DeliveryLine {
  item_name: string
  library_id: string | null
  ordered_qty: string
  received_qty: string
  unit: string
  unit_cost: string
  notes: string
}
interface DeliveryDraft {
  received_by: string
  supplier_name: string
  invoice_ref: string
  received_at: string
  notes: string
  lines: DeliveryLine[]
}
interface NewBatchDraft {
  batch_name: string
  recipe_id: string
  batch_qty: string
  batch_unit: string
  use_by_date: string
  prep_by: string
  storage_location: string
}

const blankLine = (): DeliveryLine => ({ item_name: '', library_id: null, ordered_qty: '', received_qty: '', unit: '', unit_cost: '', notes: '' })

function fmtDate(s: string): string {
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function fmtDay(s: string): string {
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// "YYYY-MM-DDTHH:MM" in local time, for datetime-local inputs.
function nowLocalDatetime(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
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

  // Receiving
  const [receipts, setReceipts] = useState<InventoryReceipt[]>([])
  const [receiptLines, setReceiptLines] = useState<Record<string, InventoryReceiptLine[]>>({})
  const [recipes, setRecipes] = useState<{ id: string; name: string }[]>([])
  const [expandedReceiptId, setExpandedReceiptId] = useState<string | null>(null)
  const [delivery, setDelivery] = useState<DeliveryDraft | null>(null)

  // Batches
  const [batchFilter, setBatchFilter] = useState<BatchFilter>('active')
  const [logUseId, setLogUseId] = useState<string | null>(null)
  const [useQty, setUseQty] = useState('')
  const [useUnit, setUseUnit] = useState('')
  const [useSource, setUseSource] = useState<'service_use' | 'mise_en_place' | 'waste' | 'manual'>('service_use')
  const [newBatch, setNewBatch] = useState<NewBatchDraft | null>(null)

  const load = useCallback(async () => {
    if (!locationId) { setLoading(false); return }
    setLoading(true)
    const since = new Date(Date.now() - 30 * 86400000).toISOString()
    const [{ data: pars }, { data: levs }, { data: bats }, { data: lib }, { data: recs }, { data: recipeRows }] = await Promise.all([
      supabase.from('inventory_par_levels').select('*').eq('location_id', locationId),
      supabase.from('inventory_levels').select('*').eq('location_id', locationId),
      supabase.from('prepared_batches').select('*').eq('location_id', locationId).order('use_by_date', { ascending: true }),
      supabase.from('ingredient_library').select('id,name,category,recipe_unit,purchase_unit_label')
        .or(`restaurant_id.eq.${restaurantId},user_id.is.null`).eq('is_active', true).order('name'),
      supabase.from('inventory_receipts').select('*').eq('location_id', locationId)
        .gte('received_at', since).order('received_at', { ascending: false }),
      supabase.from('recipes').select('id,name').eq('restaurant_id', restaurantId).eq('is_deleted', false).order('name'),
    ])
    setParLevels((pars ?? []) as InventoryParLevel[])
    setLevels((levs ?? []) as InventoryLevel[])
    setBatches((bats ?? []) as PreparedBatch[])
    setLibrary((lib ?? []) as LibraryIngredient[])
    setReceipts((recs ?? []) as InventoryReceipt[])
    setRecipes((recipeRows ?? []) as { id: string; name: string }[])

    const recIds = (recs ?? []).map((r: { id: string }) => r.id)
    if (recIds.length) {
      const { data: lines } = await supabase.from('inventory_receipt_lines').select('*').in('receipt_id', recIds)
      const map: Record<string, InventoryReceiptLine[]> = {}
      for (const ln of (lines ?? []) as InventoryReceiptLine[]) {
        if (!map[ln.receipt_id]) map[ln.receipt_id] = []
        map[ln.receipt_id].push(ln)
      }
      setReceiptLines(map)
    } else {
      setReceiptLines({})
    }
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
      if (b.status === 'depleted' || b.status === 'discarded') continue
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

  // ── Order guide (items below par, both tracks) ────────────────
  const orderGuide = useMemo(() => {
    const rows = parLevels.map(p => {
      const lvl = levels.find(l => l.library_id === p.library_id && l.track === p.track)
      const onHand = lvl ? lvl.on_hand_qty : 0
      const need = p.par_qty - onHand
      const lib = library.find(l => l.id === p.library_id)
      return { p, name: lib?.name ?? '(unknown)', category: lib?.category ?? '', onHand, need, unit: p.par_unit }
    }).filter(r => r.need > 0)
    return rows.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
  }, [parLevels, levels, library])

  // ── Receiving ─────────────────────────────────────────────────
  function openDelivery() {
    const lines: DeliveryLine[] = orderGuide.map(r => ({
      item_name: r.name, library_id: r.p.library_id,
      ordered_qty: String(r.need), received_qty: '', unit: r.unit, unit_cost: '', notes: '',
    }))
    setDelivery({
      received_by: '', supplier_name: '', invoice_ref: '', received_at: nowLocalDatetime(), notes: '',
      lines: lines.length ? lines : [blankLine()],
    })
  }
  function setLine(i: number, patch: Partial<DeliveryLine>) {
    setDelivery(d => d ? { ...d, lines: d.lines.map((l, idx) => idx === i ? { ...l, ...patch } : l) } : d)
  }

  async function saveDelivery() {
    if (!delivery || !locationId) return
    if (!delivery.received_by.trim()) { alert('Received by is required'); return }
    setSaving(true)
    const { data: rec } = await supabase.from('inventory_receipts').insert({
      location_id: locationId,
      received_at: delivery.received_at ? new Date(delivery.received_at).toISOString() : new Date().toISOString(),
      received_by: delivery.received_by.trim(),
      supplier_name: delivery.supplier_name || '',
      invoice_ref: delivery.invoice_ref || '',
      notes: delivery.notes || '',
    }).select().single()
    const receiptId = (rec as { id: string } | null)?.id
    if (!receiptId) { setSaving(false); alert('Failed to save receipt'); return }

    const valid = delivery.lines.filter(l => l.item_name.trim() && l.received_qty !== '')
    if (valid.length) {
      await supabase.from('inventory_receipt_lines').insert(valid.map(l => ({
        receipt_id: receiptId,
        library_id: l.library_id,
        item_name: l.item_name.trim(),
        ordered_qty: l.ordered_qty === '' ? null : parseFloat(l.ordered_qty),
        received_qty: parseFloat(l.received_qty),
        unit: l.unit || '',
        unit_cost: l.unit_cost === '' ? null : parseFloat(l.unit_cost),
        notes: l.notes || '',
      })))
      // Add received quantities to inventory levels.
      for (const l of valid) {
        if (!l.library_id) continue
        const recv = parseFloat(l.received_qty) || 0
        const par = parLevels.find(p => p.library_id === l.library_id)
        const t: Track = par?.track ?? 'food'
        const existing = levels.find(lv => lv.library_id === l.library_id && lv.track === t)
        if (existing) {
          await supabase.from('inventory_levels').update({
            on_hand_qty: existing.on_hand_qty + recv, on_hand_unit: l.unit || existing.on_hand_unit, updated_at: new Date().toISOString(),
          }).eq('id', existing.id)
        } else {
          await supabase.from('inventory_levels').insert({
            location_id: locationId, library_id: l.library_id, track: t,
            on_hand_qty: recv, on_hand_unit: l.unit || '',
            last_count_qty: null, last_count_at: null, last_count_by: null,
          })
        }
      }
    }
    setSaving(false)
    setDelivery(null)
    load()
    alert(`✓ Delivery logged — ${valid.length} items received`)
  }

  function printOrderGuide() {
    const rows = orderGuide.map(r => `<tr><td>${r.category}</td><td><strong>${r.name}</strong></td><td>${r.onHand}</td><td>${r.p.par_qty}</td><td>${+r.need.toFixed(2)}</td><td>${r.unit}</td></tr>`).join('')
    const w = window.open('', '_blank', 'width=800,height=900')
    if (!w) return
    w.document.write(`<!DOCTYPE html><html><head><title>Order Guide</title>
      <style>body{font-family:Arial,sans-serif;font-size:11px;padding:24px}h2{font-size:14px;margin:0 0 4px}
      table{width:100%;border-collapse:collapse;margin-top:10px}
      th{background:#f0ede8;text-align:left;padding:4px 8px;font-size:9px;text-transform:uppercase;border-bottom:1px solid #ccc}
      td{padding:4px 8px;border-bottom:1px solid #eee}</style></head><body>
      <h2>Order Guide${locationName ? ` — ${locationName}` : ''}</h2>
      <p style="font-size:10px;color:#666">Items below par · ${new Date().toLocaleDateString()}</p>
      <table><thead><tr><th>Category</th><th>Item</th><th>On hand</th><th>Par</th><th>Need to order</th><th>Unit</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6">All items at or above par.</td></tr>'}</tbody></table>
      </body></html>`)
    w.document.close(); w.focus(); setTimeout(() => w.print(), 300)
  }

  // ── Batches ───────────────────────────────────────────────────
  function batchBucket(b: PreparedBatch): 'active' | 'expiring' | 'expired' | 'depleted' {
    if (b.status === 'depleted' || b.status === 'discarded') return 'depleted'
    const t = new Date(b.use_by_date).getTime()
    const now = Date.now()
    if (!isNaN(t) && t < now) return 'expired'
    if (!isNaN(t) && t <= now + 48 * 3600 * 1000) return 'expiring'
    return 'active'
  }
  const filteredBatches = useMemo(() => batches.filter(b => {
    const bucket = batchBucket(b)
    if (batchFilter === 'all') return true
    if (batchFilter === 'active') return bucket !== 'depleted'
    if (batchFilter === 'depleted') return bucket === 'depleted'
    return bucket === batchFilter
  }), [batches, batchFilter])

  async function saveLogUse(b: PreparedBatch) {
    const qty = parseFloat(useQty)
    if (!qty || qty <= 0) { alert('Enter a quantity used'); return }
    await supabase.from('prepared_batch_depletions').insert({
      batch_id: b.id, depleted_at: new Date().toISOString(),
      depleted_qty: qty, depleted_unit: useUnit || b.current_unit,
      source: useSource, source_ref: '', depleted_by: '', notes: '',
    })
    const newQty = b.current_qty - qty
    await supabase.from('prepared_batches').update({
      current_qty: newQty,
      status: newQty <= 0 ? 'depleted' : (b.status === 'active' ? 'partially_used' : b.status),
    }).eq('id', b.id)
    setLogUseId(null); setUseQty(''); setUseUnit(''); setUseSource('service_use')
    load()
  }

  async function saveNewBatch() {
    if (!newBatch || !locationId) return
    if (!newBatch.batch_name.trim()) { alert('Batch name is required'); return }
    if (newBatch.batch_qty === '' || isNaN(parseFloat(newBatch.batch_qty))) { alert('Qty made is required'); return }
    if (!newBatch.use_by_date) { alert('Use-by date is required'); return }
    setSaving(true)
    const qty = parseFloat(newBatch.batch_qty)
    await supabase.from('prepared_batches').insert({
      location_id: locationId,
      recipe_id: newBatch.recipe_id || null,
      batch_name: newBatch.batch_name.trim(),
      batch_qty: qty, batch_unit: newBatch.batch_unit,
      current_qty: qty, current_unit: newBatch.batch_unit,
      prep_date: new Date().toISOString().split('T')[0],
      use_by_date: new Date(newBatch.use_by_date).toISOString(),
      prep_by: newBatch.prep_by || '',
      storage_location: newBatch.storage_location || '',
      is_contract_kitchen: false, contract_batch_id: '',
      status: 'active', discarded_by: '', discard_reason: '', notes: '',
    })
    setSaving(false)
    setNewBatch(null)
    load()
  }

  const fi = 'text-xs border border-[--border-2] rounded-lg px-2 py-1 outline-none focus:border-[--accent] w-full'

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
        ) : tab === 'receiving' ? (
          <div className="space-y-5">
            <div className="flex justify-end">
              {!delivery && (
                <button onClick={openDelivery} className="px-3 py-1.5 text-xs font-medium bg-[--accent] text-white rounded-lg hover:bg-[--accent-dark]">+ Log delivery</button>
              )}
            </div>

            {/* Delivery form */}
            {delivery && (
              <div className="bg-white rounded-xl border border-[--border] p-4 space-y-3">
                <h3 className="font-serif text-sm font-medium text-[--text]">Log delivery</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="block text-[11px] font-medium text-[--muted] mb-1">Received by</label>
                    <input value={delivery.received_by} onChange={e => setDelivery(d => ({ ...d!, received_by: e.target.value }))} className={fi} /></div>
                  <div><label className="block text-[11px] font-medium text-[--muted] mb-1">Supplier</label>
                    <input value={delivery.supplier_name} onChange={e => setDelivery(d => ({ ...d!, supplier_name: e.target.value }))} className={fi} /></div>
                  <div><label className="block text-[11px] font-medium text-[--muted] mb-1">Invoice ref</label>
                    <input value={delivery.invoice_ref} onChange={e => setDelivery(d => ({ ...d!, invoice_ref: e.target.value }))} className={fi} /></div>
                  <div><label className="block text-[11px] font-medium text-[--muted] mb-1">Date</label>
                    <input type="datetime-local" value={delivery.received_at} onChange={e => setDelivery(d => ({ ...d!, received_at: e.target.value }))} className={fi} /></div>
                  <div className="col-span-2"><label className="block text-[11px] font-medium text-[--muted] mb-1">Notes</label>
                    <input value={delivery.notes} onChange={e => setDelivery(d => ({ ...d!, notes: e.target.value }))} className={fi} /></div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-wide text-[--hint]">
                        <th className="text-left py-1 pr-2">Item</th>
                        <th className="text-left py-1 pr-2 w-20">Ordered</th>
                        <th className="text-left py-1 pr-2 w-20">Received</th>
                        <th className="text-left py-1 pr-2 w-16">Unit</th>
                        <th className="text-left py-1 pr-2 w-20">Cost/unit</th>
                        <th className="text-left py-1 pr-2">Notes</th>
                        <th className="w-6"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {delivery.lines.map((l, i) => (
                        <tr key={i} className="border-t border-[--border]">
                          <td className="py-1 pr-2">
                            <input value={l.item_name} list="inv-lib"
                              onChange={e => {
                                const match = library.find(lib => lib.name === e.target.value)
                                setLine(i, { item_name: e.target.value, library_id: match?.id ?? l.library_id, unit: match && !l.unit ? (match.recipe_unit ?? '') : l.unit })
                              }} className={fi} /></td>
                          <td className="py-1 pr-2"><input type="number" step="any" value={l.ordered_qty} onChange={e => setLine(i, { ordered_qty: e.target.value })} className={fi} /></td>
                          <td className="py-1 pr-2"><input type="number" step="any" value={l.received_qty} onChange={e => setLine(i, { received_qty: e.target.value })} className={fi} /></td>
                          <td className="py-1 pr-2"><input value={l.unit} onChange={e => setLine(i, { unit: e.target.value })} className={fi} /></td>
                          <td className="py-1 pr-2"><input type="number" step="0.01" value={l.unit_cost} onChange={e => setLine(i, { unit_cost: e.target.value })} className={fi} /></td>
                          <td className="py-1 pr-2"><input value={l.notes} onChange={e => setLine(i, { notes: e.target.value })} className={fi} /></td>
                          <td className="py-1">
                            <button onClick={() => setDelivery(d => ({ ...d!, lines: d!.lines.filter((_, idx) => idx !== i) }))} className="text-red-400 hover:text-red-600" title="Remove">✕</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <datalist id="inv-lib">{library.map(l => <option key={l.id} value={l.name} />)}</datalist>
                </div>

                <button onClick={() => setDelivery(d => ({ ...d!, lines: [...d!.lines, blankLine()] }))}
                  className="text-[11px] text-[--accent] hover:text-[--accent-dark] font-medium">+ Add line</button>

                <div className="flex gap-2">
                  <button onClick={saveDelivery} disabled={saving}
                    className="px-4 py-1.5 text-xs font-medium bg-[--accent] text-white rounded-lg hover:bg-[--accent-dark] disabled:opacity-50">{saving ? 'Saving…' : 'Save delivery'}</button>
                  <button onClick={() => setDelivery(null)}
                    className="px-4 py-1.5 text-xs border border-[--border-2] text-[--muted] rounded-lg hover:bg-[--surface-2]">Cancel</button>
                </div>
              </div>
            )}

            {/* Receipts list */}
            <div>
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[--hint] mb-2">Recent deliveries (30 days)</h3>
              {receipts.length === 0 ? (
                <p className="text-sm text-[--muted]">No deliveries logged in the last 30 days.</p>
              ) : (
                <div className="bg-white rounded-xl border border-[--border] overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-[--border] bg-[--surface-2] text-[10px] uppercase tracking-wide text-[--hint]">
                        <th className="text-left px-3 py-2">Date</th>
                        <th className="text-left px-3 py-2">Supplier</th>
                        <th className="text-left px-3 py-2">Items</th>
                        <th className="text-left px-3 py-2">Invoice ref</th>
                        <th className="text-left px-3 py-2 w-16"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {receipts.map(r => {
                        const lines = receiptLines[r.id] ?? []
                        return (
                          <Fragment key={r.id}>
                            <tr className="border-b border-[--border]">
                              <td className="px-3 py-2.5 text-[--muted]">{fmtDate(r.received_at)}</td>
                              <td className="px-3 py-2.5 text-[--text]">{r.supplier_name || '—'}</td>
                              <td className="px-3 py-2.5 text-[--muted]">{lines.length}</td>
                              <td className="px-3 py-2.5 text-[--muted]">{r.invoice_ref || '—'}</td>
                              <td className="px-3 py-2.5">
                                <button onClick={() => setExpandedReceiptId(expandedReceiptId === r.id ? null : r.id)}
                                  className="px-2 py-0.5 text-[10px] border border-[--border-2] rounded text-[--muted] hover:text-[--text]">View</button>
                              </td>
                            </tr>
                            {expandedReceiptId === r.id && (
                              <tr className="border-b border-[--border] bg-[--surface-2]/40">
                                <td colSpan={5} className="px-3 py-2">
                                  <table className="w-full text-[11px]">
                                    <thead>
                                      <tr className="text-[10px] uppercase tracking-wide text-[--hint]">
                                        <th className="text-left py-1 pr-3">Item</th><th className="text-left py-1 pr-3">Ordered</th>
                                        <th className="text-left py-1 pr-3">Received</th><th className="text-left py-1 pr-3">Unit</th>
                                        <th className="text-left py-1 pr-3">Cost/unit</th><th className="text-left py-1 pr-3">Notes</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {lines.map(ln => {
                                        const short = ln.ordered_qty != null && ln.received_qty < ln.ordered_qty
                                        return (
                                          <tr key={ln.id} className={short ? 'bg-amber-50/60' : ''}>
                                            <td className="py-1 pr-3 text-[--text]">{ln.item_name}</td>
                                            <td className="py-1 pr-3 text-[--muted]">{ln.ordered_qty ?? '—'}</td>
                                            <td className="py-1 pr-3 text-[--muted]">{ln.received_qty}</td>
                                            <td className="py-1 pr-3 text-[--muted]">{ln.unit}</td>
                                            <td className="py-1 pr-3 text-[--muted]">{ln.unit_cost != null ? `$${ln.unit_cost}` : '—'}</td>
                                            <td className="py-1 pr-3 text-[--muted]">{ln.notes}</td>
                                          </tr>
                                        )
                                      })}
                                    </tbody>
                                  </table>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Order guide */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[--hint]">Current order guide — items below par</h3>
                {orderGuide.length > 0 && (
                  <button onClick={printOrderGuide} className="text-xs px-3 py-1.5 border border-[--border-2] text-[--muted] rounded-lg hover:bg-[--surface-2]">🖨 Print order guide</button>
                )}
              </div>
              {orderGuide.length === 0 ? (
                <p className="text-sm text-[--green]">✓ All items at or above par level</p>
              ) : (
                <div className="bg-white rounded-xl border border-[--border] overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-[--border] bg-[--surface-2] text-[10px] uppercase tracking-wide text-[--hint]">
                        <th className="text-left px-3 py-2">Category</th><th className="text-left px-3 py-2">Item</th>
                        <th className="text-left px-3 py-2">On hand</th><th className="text-left px-3 py-2">Par</th>
                        <th className="text-left px-3 py-2">Need to order</th><th className="text-left px-3 py-2">Unit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orderGuide.map(r => (
                        <tr key={r.p.id} className="border-b border-[--border] last:border-0">
                          <td className="px-3 py-2 text-[--muted]">{r.category}</td>
                          <td className="px-3 py-2 font-medium text-[--text]">{r.name}</td>
                          <td className="px-3 py-2 text-[--muted]">{r.onHand}</td>
                          <td className="px-3 py-2 text-[--muted]">{r.p.par_qty}</td>
                          <td className="px-3 py-2 text-[--accent] font-medium">{+r.need.toFixed(2)}</td>
                          <td className="px-3 py-2 text-[--muted]">{r.unit}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        ) : (
          // ── BATCHES ──
          <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex gap-1 flex-wrap">
                {([['all', 'All'], ['active', 'Active'], ['expiring', 'Expiring (48hr)'], ['expired', 'Expired'], ['depleted', 'Depleted/Discarded']] as [BatchFilter, string][]).map(([f, label]) => (
                  <button key={f} onClick={() => setBatchFilter(f)}
                    className={`text-[11px] px-3 py-1 rounded-full border transition-colors ${batchFilter === f ? 'bg-[--accent] text-white border-[--accent]' : 'border-[--border-2] text-[--muted] hover:bg-[--surface-2]'}`}>{label}</button>
                ))}
              </div>
              {!newBatch && (
                <button onClick={() => setNewBatch({ batch_name: '', recipe_id: '', batch_qty: '', batch_unit: 'portions', use_by_date: nowLocalDatetime(), prep_by: '', storage_location: '' })}
                  className="px-3 py-1.5 text-xs font-medium bg-[--accent] text-white rounded-lg hover:bg-[--accent-dark]">+ New batch</button>
              )}
            </div>

            {newBatch && (
              <div className="bg-white rounded-xl border border-[--border] p-4 space-y-3">
                <h3 className="font-serif text-sm font-medium text-[--text]">New batch</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2"><label className="block text-[11px] font-medium text-[--muted] mb-1">Batch name</label>
                    <input value={newBatch.batch_name} onChange={e => setNewBatch(b => ({ ...b!, batch_name: e.target.value }))} className={fi} autoFocus /></div>
                  <div><label className="block text-[11px] font-medium text-[--muted] mb-1">Recipe</label>
                    <select value={newBatch.recipe_id} onChange={e => setNewBatch(b => ({ ...b!, recipe_id: e.target.value }))} className={`${fi} bg-white`}>
                      <option value="">— none —</option>
                      {recipes.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select></div>
                  <div><label className="block text-[11px] font-medium text-[--muted] mb-1">Qty made</label>
                    <input type="number" step="any" value={newBatch.batch_qty} onChange={e => setNewBatch(b => ({ ...b!, batch_qty: e.target.value }))} className={fi} /></div>
                  <div><label className="block text-[11px] font-medium text-[--muted] mb-1">Unit</label>
                    <select value={newBatch.batch_unit} onChange={e => setNewBatch(b => ({ ...b!, batch_unit: e.target.value }))} className={`${fi} bg-white`}>
                      {BATCH_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                    </select></div>
                  <div><label className="block text-[11px] font-medium text-[--muted] mb-1">Use by</label>
                    <input type="datetime-local" value={newBatch.use_by_date} onChange={e => setNewBatch(b => ({ ...b!, use_by_date: e.target.value }))} className={fi} /></div>
                  <div><label className="block text-[11px] font-medium text-[--muted] mb-1">Prepared by</label>
                    <input value={newBatch.prep_by} onChange={e => setNewBatch(b => ({ ...b!, prep_by: e.target.value }))} className={fi} /></div>
                  <div className="col-span-2"><label className="block text-[11px] font-medium text-[--muted] mb-1">Storage location</label>
                    <input value={newBatch.storage_location} onChange={e => setNewBatch(b => ({ ...b!, storage_location: e.target.value }))} className={fi} /></div>
                </div>
                <div className="flex gap-2">
                  <button onClick={saveNewBatch} disabled={saving}
                    className="px-4 py-1.5 text-xs font-medium bg-[--accent] text-white rounded-lg hover:bg-[--accent-dark] disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
                  <button onClick={() => setNewBatch(null)}
                    className="px-4 py-1.5 text-xs border border-[--border-2] text-[--muted] rounded-lg hover:bg-[--surface-2]">Cancel</button>
                </div>
              </div>
            )}

            {filteredBatches.length === 0 ? (
              <p className="text-sm text-[--muted] py-4 text-center">No batches for this filter.</p>
            ) : (
              <div className="bg-white rounded-xl border border-[--border] overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[--border] bg-[--surface-2] text-[10px] uppercase tracking-wide text-[--hint]">
                      <th className="text-left px-3 py-2">Batch name</th><th className="text-left px-3 py-2">Made by</th>
                      <th className="text-left px-3 py-2">Prep date</th><th className="text-left px-3 py-2">Use by</th>
                      <th className="text-left px-3 py-2">Original</th><th className="text-left px-3 py-2">Remaining</th>
                      <th className="text-left px-3 py-2">Status</th><th className="text-left px-3 py-2">Storage</th>
                      <th className="text-left px-3 py-2 w-20">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredBatches.map(b => {
                      const bucket = batchBucket(b)
                      const bg = bucket === 'expired' ? 'bg-red-50/50' : bucket === 'expiring' ? 'bg-amber-50/40' : bucket === 'depleted' ? 'bg-[--surface-2]/40 text-[--hint]' : ''
                      return (
                        <Fragment key={b.id}>
                          <tr className={`border-b border-[--border] ${bg}`}>
                            <td className="px-3 py-2.5 font-medium text-[--text]">{b.batch_name}</td>
                            <td className="px-3 py-2.5 text-[--muted]">{b.prep_by || '—'}</td>
                            <td className="px-3 py-2.5 text-[--muted]">{fmtDay(b.prep_date)}</td>
                            <td className="px-3 py-2.5 text-[--muted]">{fmtDate(b.use_by_date)}</td>
                            <td className="px-3 py-2.5 text-[--muted]">{b.batch_qty} {b.batch_unit}</td>
                            <td className="px-3 py-2.5 text-[--muted]">{b.current_qty} {b.current_unit}</td>
                            <td className="px-3 py-2.5 capitalize text-[--muted]">{b.status.replace('_', ' ')}</td>
                            <td className="px-3 py-2.5 text-[--muted]">{b.storage_location || '—'}</td>
                            <td className="px-3 py-2.5">
                              {(bucket === 'active' || bucket === 'expiring') && (
                                <button onClick={() => { setUseUnit(b.current_unit); setUseQty(''); setUseSource('service_use'); setLogUseId(logUseId === b.id ? null : b.id) }}
                                  className="px-2 py-0.5 text-[10px] border border-[--border-2] rounded text-[--muted] hover:text-[--text]">Log use</button>
                              )}
                              {bucket === 'expired' && (
                                <button onClick={() => { setDiscardReason('Expired'); setDiscardValue(''); setDiscardId(discardId === b.id ? null : b.id) }}
                                  className="px-2 py-0.5 text-[10px] border border-red-300 text-red-600 rounded hover:bg-red-50">Discard</button>
                              )}
                            </td>
                          </tr>
                          {logUseId === b.id && (
                            <tr className="border-b border-[--accent] bg-[--accent-light]/20">
                              <td colSpan={9} className="px-3 py-2">
                                <div className="flex items-end gap-2 flex-wrap">
                                  <div><label className="block text-[10px] text-[--muted] mb-1">Qty used</label>
                                    <input type="number" step="any" value={useQty} onChange={e => setUseQty(e.target.value)} className="text-xs border border-[--border-2] rounded-lg px-2 py-1 outline-none focus:border-[--accent] w-24" /></div>
                                  <div><label className="block text-[10px] text-[--muted] mb-1">Unit</label>
                                    <input value={useUnit} onChange={e => setUseUnit(e.target.value)} className="text-xs border border-[--border-2] rounded-lg px-2 py-1 outline-none focus:border-[--accent] w-20" /></div>
                                  <div><label className="block text-[10px] text-[--muted] mb-1">Source</label>
                                    <select value={useSource} onChange={e => setUseSource(e.target.value as typeof useSource)} className="text-xs border border-[--border-2] rounded-lg px-2 py-1 bg-white outline-none focus:border-[--accent]">
                                      {USE_SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                                    </select></div>
                                  <button onClick={() => saveLogUse(b)} className="px-3 py-1 text-[11px] font-medium bg-[--accent] text-white rounded-lg hover:bg-[--accent-dark]">Save</button>
                                  <button onClick={() => setLogUseId(null)} className="px-3 py-1 text-[11px] border border-[--border-2] text-[--muted] rounded-lg hover:bg-white">Cancel</button>
                                </div>
                              </td>
                            </tr>
                          )}
                          {discardId === b.id && (
                            <tr className="border-b border-red-200 bg-red-50/40">
                              <td colSpan={9} className="px-3 py-2">
                                <div className="flex items-end gap-2 flex-wrap">
                                  <div><label className="block text-[10px] text-[--muted] mb-1">Reason</label>
                                    <select value={discardReason} onChange={e => setDiscardReason(e.target.value)} className="text-xs border border-[--border-2] rounded-lg px-2 py-1 bg-white outline-none focus:border-[--accent]">
                                      {DISCARD_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                                    </select></div>
                                  <div><label className="block text-[10px] text-[--muted] mb-1">Value ($)</label>
                                    <input type="number" step="0.01" value={discardValue} onChange={e => setDiscardValue(e.target.value)} className="text-xs border border-[--border-2] rounded-lg px-2 py-1 outline-none focus:border-[--accent] w-24" /></div>
                                  <button onClick={() => confirmDiscard(b)} className="px-3 py-1 text-[11px] font-medium bg-red-600 text-white rounded-lg hover:bg-red-700">Confirm discard</button>
                                  <button onClick={() => setDiscardId(null)} className="px-3 py-1 text-[11px] border border-[--border-2] text-[--muted] rounded-lg hover:bg-white">Cancel</button>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
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
