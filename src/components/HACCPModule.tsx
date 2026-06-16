'use client'
// src/components/HACCPModule.tsx
// HACCP compliance: daily temperature logging + corrective action tracking.
import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase'
import type { HACCPEquipment, TemperatureLog, CorrectiveAction } from '@/lib/types'

interface Props {
  userId?: string
  restaurantId?: string
  locationId?: string
  locationName?: string
}

type HACCPTab = 'log' | 'corrective'
type LogSlot  = 'opening' | 'closing'
type StatusFilter = 'all' | 'open' | 'resolved'

const SLOT_LABELS: Record<LogSlot, string> = { opening: 'Opening', closing: 'Closing' }

function todayStr(): string { return new Date().toISOString().split('T')[0] }
function dateOf(iso: string): string { return iso.split('T')[0] }

function printTempLog(
  logs: TemperatureLog[],
  equipment: HACCPEquipment[],
  locationName: string,
  dateFrom: string,
  dateTo: string
) {
  const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric'
  })

  const rows = logs.map(log => {
    const eq = equipment.find(e => e.id === log.equipment_id)
    const compliant = log.is_compliant
    const tempCell = compliant === false
      ? `<span class="nc">${log.temp_value}°${log.temp_unit} ✗</span>`
      : `<span class="ok">${log.temp_value}°${log.temp_unit} ✓</span>`
    return `<tr>
      <td>${fmtDate(log.recorded_at)}</td>
      <td>${log.log_slot ?? '—'}</td>
      <td>${eq?.name ?? '—'}</td>
      <td>${tempCell}</td>
      <td>${log.recorded_by ?? '—'}</td>
      <td>${log.notes ?? ''}</td>
    </tr>`
  }).join('')

  const html = `<!DOCTYPE html><html><head>
    <title>Temperature Log</title>
    <style>
      body { font-family: Arial, sans-serif; font-size: 10px; margin: 20px; }
      h2 { font-size: 13px; margin-bottom: 2px; }
      p.meta { font-size: 9px; color: #555; margin-bottom: 10px; }
      table { width: 100%; border-collapse: collapse; }
      th { background: #f0ede8; text-align: left; padding: 3px 6px;
           font-size: 8px; text-transform: uppercase;
           border-bottom: 2px solid #ccc; }
      td { padding: 3px 6px; border-bottom: 1px solid #eee; }
      tr:nth-child(even) { background: #fafafa; }
      .nc { color: #c0392b; font-weight: bold; }
      .ok { color: #27ae60; }
      .footer { font-size: 8px; color: #999; margin-top: 16px; }
      @media print { body { margin: 0; } }
    </style></head><body>
    <h2>Temperature Log</h2>
    <p class="meta">${locationName} · ${dateFrom} – ${dateTo} ·
    Generated ${new Date().toLocaleDateString()}</p>
    <table>
      <thead><tr>
        <th>Date</th><th>Slot</th><th>Equipment</th>
        <th>Temp</th><th>Recorded By</th><th>Notes</th>
      </tr></thead>
      <tbody>${rows || '<tr><td colspan="6">No logs for this period</td></tr>'}</tbody>
    </table>
    <p class="footer">
      CT DPH requirement: temperature logs retained 90 days minimum.<br/>
      Non-compliant readings shown in red. Each requires a corrective action.
    </p>
    </body></html>`

  const w = window.open('', '_blank')
  if (w) { w.document.write(html); w.document.close(); w.print() }
}

export default function HACCPModule({ locationId, locationName }: Props) {
  const supabase = createClient()
  const [tab, setTab] = useState<HACCPTab>('log')

  // ── Equipment + log state ─────────────────────────────────────
  const [equipment, setEquipment] = useState<HACCPEquipment[]>([])
  const [loading,   setLoading]   = useState(true)
  const [activeSlot, setActiveSlot] = useState<LogSlot | null>(null)
  const [entries,    setEntries]    = useState<Record<string, { temp: string; notes: string }>>({})
  const [recordedBy, setRecordedBy] = useState('')
  const [saving,     setSaving]     = useState(false)
  const [summary,    setSummary]    = useState<
    { slot: LogSlot; compliant: number; nonCompliant: number; ncNames: string[]; correctiveCount: number } | null
  >(null)
  const [recentLogs, setRecentLogs] = useState<TemperatureLog[]>([])
  const [printFrom, setPrintFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().split('T')[0] })
  const [printTo,   setPrintTo]   = useState(() => todayStr())

  // ── Corrective action state ───────────────────────────────────
  const [actions,    setActions]    = useState<CorrectiveAction[]>([])
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [actionDraft, setActionDraft] = useState<Record<string, string>>({})

  const loadEquipment = useCallback(async () => {
    if (!locationId) { setLoading(false); return }
    setLoading(true)
    const { data } = await supabase.from('haccp_equipment').select('*')
      .eq('location_id', locationId).eq('is_active', true).order('sort_order')
    setEquipment((data ?? []) as HACCPEquipment[])
    setLoading(false)
  }, [locationId, supabase])

  const loadRecentLogs = useCallback(async () => {
    if (!locationId) return
    const since = new Date(Date.now() - 7 * 86400000).toISOString()
    const { data } = await supabase.from('temperature_logs').select('*')
      .eq('location_id', locationId).gte('recorded_at', since)
    setRecentLogs((data ?? []) as TemperatureLog[])
  }, [locationId, supabase])

  const loadActions = useCallback(async () => {
    if (!locationId) return
    const { data } = await supabase.from('corrective_actions').select('*')
      .eq('location_id', locationId).order('created_at', { ascending: false })
    setActions((data ?? []) as CorrectiveAction[])
  }, [locationId, supabase])

  useEffect(() => { loadEquipment(); loadRecentLogs(); loadActions() }, [loadEquipment, loadRecentLogs, loadActions])

  // ── Compliance preview for a single input ─────────────────────
  function compliance(eq: HACCPEquipment, tempStr: string | undefined): 'ok' | 'bad' | null {
    if (!tempStr || isNaN(parseFloat(tempStr))) return null
    const t = parseFloat(tempStr)
    return t >= eq.target_temp_min && t <= eq.target_temp_max ? 'ok' : 'bad'
  }

  function openForm(slot: LogSlot) {
    setActiveSlot(slot)
    setEntries({})
    setSummary(null)
  }

  function setEntry(id: string, field: 'temp' | 'notes', value: string) {
    setEntries(prev => ({ ...prev, [id]: { temp: prev[id]?.temp ?? '', notes: prev[id]?.notes ?? '', [field]: value } }))
  }

  async function saveLog() {
    if (!activeSlot || !locationId) return
    for (const eq of equipment) {
      const e = entries[eq.id]
      if (!e || e.temp === '' || isNaN(parseFloat(e.temp))) {
        alert('Please enter temperature for all equipment')
        return
      }
    }
    if (!recordedBy.trim()) { alert('Please enter your name in "Recorded by"') ; return }

    setSaving(true)
    const nowIso = new Date().toISOString()
    let compliant = 0, nonCompliant = 0, correctiveCount = 0
    const ncNames: string[] = []

    for (const eq of equipment) {
      const temp = parseFloat(entries[eq.id].temp)
      const isComp = temp >= eq.target_temp_min && temp <= eq.target_temp_max
      const { data: logRow, error } = await supabase.from('temperature_logs').insert({
        location_id:      locationId,
        equipment_id:     eq.id,
        log_slot:         activeSlot,
        recorded_at:      nowIso,
        temp_value:       temp,
        temp_unit:        'F',
        recorded_by:      recordedBy.trim(),
        recording_method: 'manual',
        is_compliant:     isComp,
        notes:            entries[eq.id].notes || '',
      }).select().single()
      if (error) { console.error('[haccp] temp log insert failed:', error); continue }

      if (isComp) { compliant++; continue }

      nonCompliant++
      ncNames.push(`${eq.name}: ${temp}°${eq.temp_unit}`)
      const { error: caErr } = await supabase.from('corrective_actions').insert({
        location_id:   locationId,
        trigger_type:  'temperature_log',
        trigger_id:    (logRow as any)?.id ?? null,
        discovered_at: nowIso,
        discovered_by: recordedBy.trim(),
        description:   `${eq.name}: ${temp}°${eq.temp_unit} is outside safe range (${eq.target_temp_min}–${eq.target_temp_max}°${eq.temp_unit})`,
        action_taken:  '',
        status:        'open',
      })
      if (caErr) console.error('[haccp] corrective action insert failed:', caErr)
      else correctiveCount++
    }

    setSaving(false)
    setSummary({ slot: activeSlot, compliant, nonCompliant, ncNames, correctiveCount })
    setActiveSlot(null)
    setEntries({})
    setRecordedBy('')
    loadRecentLogs()
    loadActions()
  }

  // ── 7-day compliance history ──────────────────────────────────
  const history = useMemo(() => {
    const today = todayStr()
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() - i)
      return d
    })
    function slotStatus(dateStr: string, slot: LogSlot): 'ok' | 'warn' | 'missing' {
      const rows = recentLogs.filter(l => dateOf(l.recorded_at) === dateStr && l.log_slot === slot)
      if (rows.length === 0) return 'missing'
      return rows.some(r => r.is_compliant === false) ? 'warn' : 'ok'
    }
    return days.map(d => {
      const dateStr = d.toISOString().split('T')[0]
      return {
        dateStr,
        label: d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
        isPast: dateStr < today,
        opening: slotStatus(dateStr, 'opening'),
        closing: slotStatus(dateStr, 'closing'),
      }
    })
  }, [recentLogs])

  // Missing logs for past days (today-1 .. today-7); today is not flagged.
  const missingSlots = useMemo(() => {
    const result: { date: string; slot: LogSlot }[] = []
    for (let i = 1; i <= 7; i++) {
      const d = new Date(); d.setDate(d.getDate() - i)
      const dateStr = d.toISOString().split('T')[0]
      const label = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
      for (const slot of ['opening', 'closing'] as LogSlot[]) {
        const has = recentLogs.some(l => dateOf(l.recorded_at) === dateStr && l.log_slot === slot)
        if (!has) result.push({ date: label, slot })
      }
    }
    return result
  }, [recentLogs])

  async function doPrintTempLog() {
    if (!locationId) return
    const { data } = await supabase.from('temperature_logs').select('*')
      .eq('location_id', locationId)
      .gte('recorded_at', `${printFrom}T00:00:00`)
      .lte('recorded_at', `${printTo}T23:59:59`)
      .order('recorded_at', { ascending: true })
    printTempLog((data ?? []) as TemperatureLog[], equipment, locationName ?? 'Location', printFrom, printTo)
  }

  // ── Corrective actions: filter + print ────────────────────────
  const filteredActions = useMemo(() =>
    actions.filter(a => statusFilter === 'all' ? true : a.status === statusFilter),
    [actions, statusFilter]
  )

  async function resolveAction(a: CorrectiveAction) {
    const name = prompt('Resolved by (your name):')
    if (name === null || !name.trim()) return
    await supabase.from('corrective_actions').update({
      action_taken: actionDraft[a.id] ?? a.action_taken,
      status:       'resolved',
      resolved_at:  new Date().toISOString(),
      resolved_by:  name.trim(),
    }).eq('id', a.id)
    setExpandedId(null)
    loadActions()
  }

  function printActions() {
    const dates = actions.map(a => dateOf(a.created_at)).sort()
    const range = dates.length ? `${dates[0]} – ${dates[dates.length - 1]}` : todayStr()
    const rows = filteredActions.map(a => `
      <tr>
        <td>${dateOf(a.discovered_at)}</td>
        <td>${a.items_affected || '—'}</td>
        <td>${a.description}</td>
        <td>${a.action_taken || '—'}</td>
        <td>${a.resolved_by || '—'}</td>
        <td>${a.resolved_at ? dateOf(a.resolved_at) : '—'}</td>
      </tr>`).join('')
    const w = window.open('', '_blank', 'width=900,height=900')
    if (!w) return
    w.document.write(`<!DOCTYPE html><html><head><title>Corrective Action Log</title>
      <style>
        body { font-family: Georgia, serif; font-size: 12px; padding: 28px; color: #1a1a1a; }
        h2 { font-size: 15px; margin: 0 0 4px; }
        table { width: 100%; border-collapse: collapse; margin-top: 12px; }
        th { background: #f0ede8; text-align: left; padding: 5px 8px; font-size: 9px; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid #ccc; }
        td { padding: 5px 8px; border-bottom: 1px solid #eee; vertical-align: top; }
        p.foot { margin-top: 20px; font-size: 10px; color: #666; }
      </style></head><body>
      <h2>Corrective Action Log</h2>
      <table>
        <thead><tr>
          <th>Date</th><th>Equipment/Item</th><th>Description</th><th>Action Taken</th><th>Resolved By</th><th>Date Resolved</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="foot">Corrective Action Log · ${locationName ?? 'Location'} · ${range} · CT retention: 1 year</p>
      </body></html>`)
    w.document.close()
    w.focus()
    setTimeout(() => w.print(), 300)
  }

  const statusBadge = (status: CorrectiveAction['status']) => {
    const map: Record<string, string> = {
      open:     'bg-red-50 text-red-700 border-red-200',
      resolved: 'bg-amber-50 text-amber-700 border-amber-200',
      verified: 'bg-green-50 text-green-700 border-green-200',
    }
    const label = status.charAt(0).toUpperCase() + status.slice(1)
    return <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium capitalize ${map[status] ?? ''}`}>{label}</span>
  }

  if (loading) return <div className="flex items-center justify-center h-full text-[--hint] text-sm">Loading HACCP…</div>

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header + tabs */}
      <div className="bg-white border-b border-[--border] px-6 py-4 flex-shrink-0">
        <h1 className="font-serif text-xl font-medium text-[--text] mb-3">Compliance — HACCP</h1>
        <div className="flex bg-[--surface-2] rounded-lg p-0.5 gap-0.5 w-fit">
          {([['log','📋 Log Temps'],['corrective','⚠ Corrective Actions']] as [HACCPTab,string][]).map(([t, label]) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-1.5 text-xs font-medium rounded-md transition-all ${tab === t ? 'bg-white text-[--text] shadow-sm' : 'text-[--muted]'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── LOG TEMPS TAB ── */}
      {tab === 'log' && (
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {!locationId ? (
            <p className="text-sm text-[--muted]">No location selected.</p>
          ) : (
            <>
              {/* Slot buttons */}
              <div className="flex gap-3 mb-5">
                <button onClick={() => openForm('opening')}
                  className={`px-4 py-2.5 text-sm font-medium rounded-xl border transition-colors ${activeSlot === 'opening' ? 'bg-[--accent] text-white border-[--accent]' : 'border-[--border-2] text-[--text] hover:bg-[--surface-2]'}`}>
                  🌅 Log Opening Temps
                </button>
                <button onClick={() => openForm('closing')}
                  className={`px-4 py-2.5 text-sm font-medium rounded-xl border transition-colors ${activeSlot === 'closing' ? 'bg-[--accent] text-white border-[--accent]' : 'border-[--border-2] text-[--text] hover:bg-[--surface-2]'}`}>
                  🌙 Log Closing Temps
                </button>
              </div>

              {/* Save summary */}
              {summary && (
                <div className="mb-5 p-4 rounded-xl border border-[--border] bg-white">
                  <div className="text-sm font-medium text-[--text]">
                    ✓ {SLOT_LABELS[summary.slot]} log saved — {summary.compliant} compliant, {summary.nonCompliant} non-compliant
                  </div>
                  {summary.ncNames.length > 0 && (
                    <div className="text-[12px] text-red-600 mt-1.5">{summary.ncNames.join(' · ')}</div>
                  )}
                  {summary.correctiveCount > 0 && (
                    <div className="text-[12px] text-amber-700 mt-1.5">
                      ⚠ {summary.correctiveCount} corrective action{summary.correctiveCount === 1 ? '' : 's'} opened. See Corrective Actions tab.
                    </div>
                  )}
                </div>
              )}

              {/* Log entry form */}
              {activeSlot && (
                <div className="mb-6 bg-white rounded-xl border border-[--border] overflow-hidden">
                  <div className="px-4 py-3 border-b border-[--border] bg-[--surface-2]">
                    <h2 className="font-serif text-sm font-medium text-[--text]">
                      {SLOT_LABELS[activeSlot]} Temperature Log — {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                    </h2>
                  </div>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-[--border] text-[10px] uppercase tracking-wide text-[--hint]">
                        <th className="text-left px-4 py-2">Equipment</th>
                        <th className="text-left px-4 py-2">Target range</th>
                        <th className="text-left px-4 py-2">Temp</th>
                        <th className="text-left px-4 py-2">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {equipment.map(eq => {
                        const c = compliance(eq, entries[eq.id]?.temp)
                        return (
                          <tr key={eq.id} className="border-b border-[--border]">
                            <td className="px-4 py-2.5 font-medium text-[--text]">{eq.name}</td>
                            <td className="px-4 py-2.5 text-[--muted]">{eq.target_temp_min}–{eq.target_temp_max}°{eq.temp_unit}</td>
                            <td className="px-4 py-2.5">
                              <div className="flex items-center gap-2">
                                <input type="number" step="0.1" placeholder="--"
                                  value={entries[eq.id]?.temp ?? ''}
                                  onChange={e => setEntry(eq.id, 'temp', e.target.value)}
                                  className="w-20 text-xs border border-[--border-2] rounded-lg px-2 py-1 outline-none focus:border-[--accent]" />
                                <span className="text-[--hint]">°{eq.temp_unit}</span>
                                {c === 'ok' && <span className="text-green-600 font-semibold">✓</span>}
                                {c === 'bad' && <span className="text-red-600 font-semibold">✗</span>}
                              </div>
                            </td>
                            <td className="px-4 py-2.5">
                              <input value={entries[eq.id]?.notes ?? ''}
                                onChange={e => setEntry(eq.id, 'notes', e.target.value)}
                                className="w-full text-xs border border-[--border-2] rounded-lg px-2 py-1 outline-none focus:border-[--accent]" />
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  <div className="px-4 py-3 border-t border-[--border] flex items-center gap-3 flex-wrap">
                    <input value={recordedBy} onChange={e => setRecordedBy(e.target.value)}
                      placeholder="Your name"
                      className="text-xs border border-[--border-2] rounded-lg px-2.5 py-1.5 outline-none focus:border-[--accent] w-44" />
                    <button onClick={saveLog} disabled={saving}
                      className="px-4 py-1.5 text-xs font-medium bg-[--accent] text-white rounded-lg hover:bg-[--accent-dark] disabled:opacity-50">
                      {saving ? 'Saving…' : 'Save Temperature Log'}
                    </button>
                  </div>
                </div>
              )}

              {/* Missing log alert */}
              {missingSlots.length > 0 && (
                <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                  <div className="text-xs font-medium text-amber-800">⚠ Missing temperature logs:</div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {missingSlots.map((s, i) => (
                      <span key={i} className="text-[11px] px-2 py-0.5 rounded-full bg-white border border-amber-200 text-amber-700 capitalize">
                        {s.date} — {s.slot}
                      </span>
                    ))}
                  </div>
                  <div className="text-[11px] text-amber-700 mt-2">Missing logs must be explained to a health inspector.</div>
                </div>
              )}

              {/* Print temperature log */}
              <div className="flex items-center gap-2 mb-4 flex-wrap">
                <span className="text-[11px] text-[--muted]">Print log for:</span>
                <input type="date" value={printFrom} onChange={e => setPrintFrom(e.target.value)}
                  className="text-xs border border-[--border-2] rounded-lg px-2 py-1 outline-none focus:border-[--accent]" />
                <span className="text-[11px] text-[--hint]">to</span>
                <input type="date" value={printTo} onChange={e => setPrintTo(e.target.value)}
                  className="text-xs border border-[--border-2] rounded-lg px-2 py-1 outline-none focus:border-[--accent]" />
                <button onClick={doPrintTempLog}
                  className="text-xs px-3 py-1.5 border border-[--border-2] text-[--muted] rounded-lg hover:bg-[--surface-2]">
                  🖨 Print Temperature Log
                </button>
              </div>

              {/* Compliance history */}
              <div>
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[--hint] mb-2">Last 7 days</h3>
                <div className="bg-white rounded-xl border border-[--border] overflow-hidden">
                  {history.map(d => (
                    <div key={d.dateStr} className="flex items-center gap-4 px-4 py-2 border-b border-[--border] last:border-0 text-xs">
                      <span className="w-28 text-[--text]">{d.label}</span>
                      <SlotCell label="Opening" status={d.opening} isPast={d.isPast} />
                      <SlotCell label="Closing" status={d.closing} isPast={d.isPast} />
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── CORRECTIVE ACTIONS TAB ── */}
      {tab === 'corrective' && (
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div className="flex gap-1">
              {(['all','open','resolved'] as StatusFilter[]).map(f => (
                <button key={f} onClick={() => setStatusFilter(f)}
                  className={`text-[11px] px-3 py-1 rounded-full border capitalize transition-colors ${statusFilter === f ? 'bg-[--accent] text-white border-[--accent]' : 'border-[--border-2] text-[--muted] hover:bg-[--surface-2]'}`}>
                  {f}
                </button>
              ))}
            </div>
            <button onClick={printActions}
              className="text-xs px-3 py-1.5 border border-[--border-2] text-[--muted] rounded-lg hover:bg-[--surface-2]">
              🖨 Print
            </button>
          </div>

          {filteredActions.length === 0 ? (
            <p className="text-sm text-[--muted] py-8 text-center">No corrective actions.</p>
          ) : (
            <div className="bg-white rounded-xl border border-[--border] overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[--border] bg-[--surface-2] text-[10px] uppercase tracking-wide text-[--hint]">
                    <th className="text-left px-4 py-2 w-24">Date</th>
                    <th className="text-left px-4 py-2 w-32">Type</th>
                    <th className="text-left px-4 py-2">Description</th>
                    <th className="text-left px-4 py-2 w-24">Status</th>
                    <th className="text-left px-4 py-2">Action taken</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredActions.map(a => (
                    <FragmentRow key={a.id}>
                      <tr onClick={() => setExpandedId(expandedId === a.id ? null : a.id)}
                        className="border-b border-[--border] hover:bg-[--surface-2]/40 cursor-pointer">
                        <td className="px-4 py-2.5 text-[--muted]">{dateOf(a.discovered_at)}</td>
                        <td className="px-4 py-2.5 text-[--muted]">{a.trigger_type.replace(/_/g, ' ')}</td>
                        <td className="px-4 py-2.5 text-[--text]">{a.description}</td>
                        <td className="px-4 py-2.5">{statusBadge(a.status)}</td>
                        <td className="px-4 py-2.5 text-[--muted]">{a.action_taken || '—'}</td>
                      </tr>
                      {expandedId === a.id && (
                        <tr className="border-b border-[--accent] bg-[--accent-light]/20">
                          <td colSpan={5} className="px-4 py-3">
                            <div className="grid grid-cols-2 gap-3 text-[11px] text-[--muted] mb-3">
                              <div><span className="font-medium text-[--text]">Discovered:</span> {new Date(a.discovered_at).toLocaleString()}</div>
                              <div><span className="font-medium text-[--text]">Discovered by:</span> {a.discovered_by || '—'}</div>
                              <div className="col-span-2"><span className="font-medium text-[--text]">Description:</span> {a.description}</div>
                              {a.items_affected && <div className="col-span-2"><span className="font-medium text-[--text]">Items affected:</span> {a.items_affected}</div>}
                              {a.resolved_at && (
                                <div className="col-span-2"><span className="font-medium text-[--text]">Resolved:</span> {new Date(a.resolved_at).toLocaleString()} by {a.resolved_by || '—'}</div>
                              )}
                            </div>
                            <label className="block text-[10px] font-medium text-[--muted] mb-1 uppercase tracking-wide">Action taken</label>
                            <textarea rows={2}
                              defaultValue={a.action_taken}
                              onChange={e => setActionDraft(prev => ({ ...prev, [a.id]: e.target.value }))}
                              className="w-full text-xs border border-[--border-2] rounded-lg px-2.5 py-1.5 outline-none focus:border-[--accent] resize-none"
                              placeholder="Describe the corrective action taken…" />
                            {a.status === 'open' && (
                              <button onClick={() => resolveAction(a)}
                                className="mt-2 px-3 py-1.5 text-[11px] font-medium bg-[--accent] text-white rounded-lg hover:bg-[--accent-dark]">
                                Mark as Resolved
                              </button>
                            )}
                          </td>
                        </tr>
                      )}
                    </FragmentRow>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SlotCell({ label, status, isPast }: { label: string; status: 'ok' | 'warn' | 'missing'; isPast: boolean }) {
  const icon = status === 'ok' ? '✓' : status === 'warn' ? '⚠' : '—'
  const color = status === 'ok' ? 'text-green-600'
    : status === 'warn' ? 'text-amber-600'
    : isPast ? 'text-red-500' : 'text-[--hint]'
  return (
    <span className={`flex items-center gap-1 ${color}`}>
      <span className="text-[--muted] text-[11px]">{label}</span>
      <span className="font-semibold">{icon}</span>
    </span>
  )
}

// Wrapper so an expandable row pair shares one key without an extra DOM node.
function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
