'use client'
// src/components/LocationCalendarSettings.tsx
// Settings page for a location's days-closed + events calendar, by year.
//
// ASSUMED SCHEMA (adjust here if the real tables differ):
//   location_closures: id, location_id, year, name, closure_date (date)
//   location_events:   id, location_id, year, name, event_date (date|null),
//                      event_type, is_date_specific, is_all_day,
//                      start_time (time|null), end_time (time|null), notes
import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { to12Hour, to24Hour } from '@/lib/timeFormat'

interface Props {
  locationId?: string
  locationName?: string
}

type CalTab = 'closed' | 'events'
type EventType = 'holiday' | 'local' | 'nyc_anchor' | 'corridor_wide'

interface Closure {
  id: string
  location_id: string
  year: number
  name: string
  closure_date: string
}

interface EventRow {
  id: string
  location_id: string
  year: number
  name: string
  event_date: string | null
  event_type: EventType
  is_date_specific: boolean
  is_all_day: boolean
  start_time: string | null
  end_time: string | null
  notes: string | null
}

const EVENT_TYPES: { value: EventType; label: string }[] = [
  { value: 'holiday',       label: 'Holiday' },
  { value: 'local',         label: 'Local' },
  { value: 'nyc_anchor',    label: 'NYC Anchor' },
  { value: 'corridor_wide', label: 'Corridor-wide' },
]
const TYPE_LABELS: Record<string, string> = Object.fromEntries(EVENT_TYPES.map(t => [t.value, t.label]))

function fmtMonthDay(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
}

interface ClosureDraft { name: string; closure_date: string }
interface EventDraft {
  name: string
  event_date: string
  is_date_specific: boolean
  is_all_day: boolean
  start_time: string
  end_time: string
  event_type: EventType
  notes: string
}
const blankEvent = (): EventDraft => ({
  name: '', event_date: '', is_date_specific: true, is_all_day: true,
  start_time: '', end_time: '', event_type: 'holiday', notes: '',
})

export default function LocationCalendarSettings({ locationId, locationName }: Props) {
  const supabase = createClient()
  const [tab, setTab] = useState<CalTab>('closed')
  const [year, setYear] = useState(new Date().getFullYear())
  const [closures, setClosures] = useState<Closure[]>([])
  const [events, setEvents] = useState<EventRow[]>([])
  const [loading, setLoading] = useState(true)

  const [closureDraft, setClosureDraft] = useState<ClosureDraft | null>(null)
  const [eventDraft, setEventDraft] = useState<EventDraft | null>(null)
  const [dateEditId, setDateEditId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!locationId) { setLoading(false); return }
    setLoading(true)
    const [{ data: cl }, { data: ev }] = await Promise.all([
      supabase.from('location_closures').select('*')
        .eq('location_id', locationId).eq('year', year).order('closure_date'),
      supabase.from('location_events').select('*')
        .eq('location_id', locationId).eq('year', year)
        .order('event_date', { ascending: true, nullsFirst: false }).order('name'),
    ])
    setClosures((cl ?? []) as Closure[])
    setEvents((ev ?? []) as EventRow[])
    setLoading(false)
  }, [locationId, year, supabase])

  useEffect(() => { load() }, [load])

  const yearMin = `${year}-01-01`
  const yearMax = `${year}-12-31`
  const inputCls = 'text-xs border border-[--border-2] rounded-lg px-2 py-1 outline-none focus:border-[--accent]'

  // ── Closures ────────────────────────────────────────────────
  async function saveClosure() {
    if (!locationId || !closureDraft) return
    if (!closureDraft.name.trim() || !closureDraft.closure_date) { alert('Name and date are required'); return }
    await supabase.from('location_closures').insert({
      location_id: locationId, year, name: closureDraft.name.trim(), closure_date: closureDraft.closure_date,
    })
    setClosureDraft(null); load()
  }
  async function copyClosures() {
    if (!locationId) return
    const { data } = await supabase.from('location_closures').select('*')
      .eq('location_id', locationId).eq('year', year - 1).order('closure_date')
    const rows = (data ?? []) as Closure[]
    if (!rows.length) { alert(`No closures in ${year - 1} to copy.`); return }
    await supabase.from('location_closures').insert(rows.map(r => ({
      location_id: locationId, year, name: r.name,
      closure_date: `${year}${r.closure_date.slice(4)}`, // same month/day, this year
    })))
    load()
    alert(`Copied ${rows.length} closures from ${year - 1}.`)
  }
  async function deleteClosure(id: string) {
    if (!confirm('Remove this closure?')) return
    await supabase.from('location_closures').delete().eq('id', id)
    load()
  }

  // ── Events ──────────────────────────────────────────────────
  async function saveEvent() {
    if (!locationId || !eventDraft) return
    if (!eventDraft.name.trim()) { alert('Event name is required'); return }
    if (!eventDraft.event_date) { alert('Date is required'); return }
    await supabase.from('location_events').insert({
      location_id: locationId, year,
      name: eventDraft.name.trim(),
      event_date: eventDraft.event_date,
      event_type: eventDraft.event_type,
      is_date_specific: eventDraft.is_date_specific,
      is_all_day: eventDraft.is_all_day,
      start_time: eventDraft.is_all_day || !eventDraft.start_time ? null : to24Hour(eventDraft.start_time),
      end_time:   eventDraft.is_all_day || !eventDraft.end_time ? null : to24Hour(eventDraft.end_time),
      notes: eventDraft.notes || null,
    })
    setEventDraft(null); load()
  }
  async function copyEvents() {
    if (!locationId) return
    const { data } = await supabase.from('location_events').select('*')
      .eq('location_id', locationId).eq('year', year - 1)
    const rows = (data ?? []) as EventRow[]
    if (!rows.length) { alert(`No events in ${year - 1} to copy.`); return }
    await supabase.from('location_events').insert(rows.map(r => ({
      location_id: locationId, year,
      name: r.name,
      event_date: r.is_date_specific && r.event_date ? `${year}${r.event_date.slice(4)}` : null,
      event_type: r.event_type,
      is_date_specific: r.is_date_specific,
      is_all_day: r.is_all_day,
      start_time: r.start_time,
      end_time: r.end_time,
      notes: r.notes,
    })))
    load()
    alert(`Copied ${rows.length} events. Amber rows need dates — tap to set.`)
  }
  async function setEventDate(id: string, date: string) {
    if (!date) return
    await supabase.from('location_events').update({ event_date: date }).eq('id', id)
    setDateEditId(null); load()
  }
  async function deleteEvent(id: string) {
    if (!confirm('Remove this event?')) return
    await supabase.from('location_events').delete().eq('id', id)
    load()
  }

  if (!locationId) return <p className="text-sm text-[--muted]">No location selected.</p>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="font-serif text-lg font-medium text-[--text]">{locationName ? `${locationName} — ` : ''}Calendar</h2>
        <div className="flex items-center gap-2 text-xs">
          <button onClick={() => setYear(y => y - 1)} className="px-2 py-0.5 border border-[--border-2] rounded-lg text-[--muted] hover:bg-[--surface-2]">←</button>
          <span className="font-medium text-[--text] w-12 text-center">{year}</span>
          <button onClick={() => setYear(y => y + 1)} className="px-2 py-0.5 border border-[--border-2] rounded-lg text-[--muted] hover:bg-[--surface-2]">→</button>
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex bg-[--surface-2] rounded-lg p-0.5 gap-0.5 w-fit">
        {([['closed', 'Days Closed'], ['events', 'Events']] as [CalTab, string][]).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-1.5 text-xs font-medium rounded-md transition-all ${tab === t ? 'bg-white text-[--text] shadow-sm' : 'text-[--muted]'}`}>
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-sm text-[--muted] py-8">Loading…</div>
      ) : tab === 'closed' ? (
        // ── DAYS CLOSED ──
        <div className="space-y-3">
          <div className="flex justify-end gap-2">
            <button onClick={copyClosures}
              className="text-xs px-3 py-1.5 border border-[--border-2] text-[--muted] rounded-lg hover:bg-[--surface-2]">
              Copy from last year
            </button>
            {!closureDraft && (
              <button onClick={() => setClosureDraft({ name: '', closure_date: yearMin })}
                className="px-3 py-1.5 text-xs font-medium bg-[--accent] text-white rounded-lg hover:bg-[--accent-dark]">
                + Add closure
              </button>
            )}
          </div>

          {closures.length === 0 ? (
            <p className="text-sm text-[--muted] py-4 text-center">No closures for {year}.</p>
          ) : (
            <div className="bg-white rounded-xl border border-[--border] overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[--border] bg-[--surface-2] text-[10px] uppercase tracking-wide text-[--hint]">
                    <th className="text-left px-3 py-2">Name</th>
                    <th className="text-left px-3 py-2">Date</th>
                    <th className="text-left px-3 py-2 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {closures.map(c => (
                    <tr key={c.id} className="border-b border-[--border] last:border-0">
                      <td className="px-3 py-2.5 font-medium text-[--text]">{c.name}</td>
                      <td className="px-3 py-2.5 text-[--muted]">{fmtMonthDay(c.closure_date)}</td>
                      <td className="px-3 py-2.5">
                        <button onClick={() => deleteClosure(c.id)} className="text-red-400 hover:text-red-600" title="Delete">🗑</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {closureDraft && (
            <div className="bg-white rounded-xl border border-[--border] p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-[--muted] mb-1">Name</label>
                  <input value={closureDraft.name} onChange={e => setClosureDraft(d => ({ ...d!, name: e.target.value }))}
                    placeholder="e.g. Christmas Day" className={`${inputCls} w-full`} autoFocus />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-[--muted] mb-1">Date</label>
                  <input type="date" min={yearMin} max={yearMax} value={closureDraft.closure_date}
                    onChange={e => setClosureDraft(d => ({ ...d!, closure_date: e.target.value }))}
                    className={`${inputCls} w-full`} />
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={saveClosure} className="px-4 py-1.5 text-xs font-medium bg-[--accent] text-white rounded-lg hover:bg-[--accent-dark]">Save</button>
                <button onClick={() => setClosureDraft(null)} className="px-4 py-1.5 text-xs border border-[--border-2] text-[--muted] rounded-lg hover:bg-[--surface-2]">Cancel</button>
              </div>
            </div>
          )}
        </div>
      ) : (
        // ── EVENTS ──
        <div className="space-y-3">
          <div className="flex justify-end gap-2">
            <button onClick={copyEvents}
              className="text-xs px-3 py-1.5 border border-[--border-2] text-[--muted] rounded-lg hover:bg-[--surface-2]">
              Copy from last year
            </button>
            {!eventDraft && (
              <button onClick={() => setEventDraft(blankEvent())}
                className="px-3 py-1.5 text-xs font-medium bg-[--accent] text-white rounded-lg hover:bg-[--accent-dark]">
                + Add event
              </button>
            )}
          </div>

          {events.length === 0 ? (
            <p className="text-sm text-[--muted] py-4 text-center">No events for {year}.</p>
          ) : (
            <div className="bg-white rounded-xl border border-[--border] overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[--border] bg-[--surface-2] text-[10px] uppercase tracking-wide text-[--hint]">
                    <th className="text-left px-3 py-2">Name</th>
                    <th className="text-left px-3 py-2">Date</th>
                    <th className="text-left px-3 py-2">Type</th>
                    <th className="text-left px-3 py-2">All Day</th>
                    <th className="text-left px-3 py-2 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {events.map(ev => (
                    <tr key={ev.id}
                      className={`border-b border-[--border] last:border-0 ${ev.event_date === null ? 'cursor-pointer hover:bg-amber-50/40' : ''}`}
                      onClick={ev.event_date === null ? () => setDateEditId(ev.id) : undefined}>
                      <td className="px-3 py-2.5 font-medium text-[--text]">{ev.name}</td>
                      <td className="px-3 py-2.5">
                        {ev.event_date ? (
                          <span className="text-[--muted]">{fmtMonthDay(ev.event_date)}</span>
                        ) : dateEditId === ev.id ? (
                          <input type="date" min={yearMin} max={yearMax} autoFocus
                            onClick={e => e.stopPropagation()}
                            onChange={e => setEventDate(ev.id, e.target.value)}
                            className={inputCls} />
                        ) : (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 font-medium">Needs date</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-[--muted]">{TYPE_LABELS[ev.event_type] ?? ev.event_type}</td>
                      <td className="px-3 py-2.5 text-[--muted]">
                        {ev.is_all_day
                          ? 'Yes'
                          : `${to12Hour(ev.start_time ?? '') || '—'}–${to12Hour(ev.end_time ?? '') || '—'}`}
                      </td>
                      <td className="px-3 py-2.5">
                        <button onClick={e => { e.stopPropagation(); deleteEvent(ev.id) }} className="text-red-400 hover:text-red-600" title="Delete">🗑</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {eventDraft && (
            <div className="bg-white rounded-xl border border-[--border] p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-[11px] font-medium text-[--muted] mb-1">Event name</label>
                  <input value={eventDraft.name} onChange={e => setEventDraft(d => ({ ...d!, name: e.target.value }))}
                    className={`${inputCls} w-full`} autoFocus />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-[--muted] mb-1">Date</label>
                  <input type="date" min={yearMin} max={yearMax} value={eventDraft.event_date}
                    onChange={e => setEventDraft(d => ({ ...d!, event_date: e.target.value }))}
                    className={`${inputCls} w-full`} />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-[--muted] mb-1">Type</label>
                  <select value={eventDraft.event_type}
                    onChange={e => setEventDraft(d => ({ ...d!, event_type: e.target.value as EventType }))}
                    className={`${inputCls} w-full bg-white`}>
                    {EVENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input type="checkbox" checked={eventDraft.is_date_specific}
                    onChange={e => setEventDraft(d => ({ ...d!, is_date_specific: e.target.checked }))} className="accent-[--accent]" />
                  Always same date each year
                </label>
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input type="checkbox" checked={eventDraft.is_all_day}
                    onChange={e => setEventDraft(d => ({ ...d!, is_all_day: e.target.checked }))} className="accent-[--accent]" />
                  All day
                </label>
                {!eventDraft.is_all_day && (
                  <>
                    <div>
                      <label className="block text-[11px] font-medium text-[--muted] mb-1">Start time</label>
                      <input type="time" value={eventDraft.start_time}
                        onChange={e => setEventDraft(d => ({ ...d!, start_time: e.target.value }))}
                        className={`${inputCls} w-full`} />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-[--muted] mb-1">End time</label>
                      <input type="time" value={eventDraft.end_time}
                        onChange={e => setEventDraft(d => ({ ...d!, end_time: e.target.value }))}
                        className={`${inputCls} w-full`} />
                    </div>
                  </>
                )}
                <div className="col-span-2">
                  <label className="block text-[11px] font-medium text-[--muted] mb-1">Notes</label>
                  <input value={eventDraft.notes} onChange={e => setEventDraft(d => ({ ...d!, notes: e.target.value }))}
                    className={`${inputCls} w-full`} />
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={saveEvent} className="px-4 py-1.5 text-xs font-medium bg-[--accent] text-white rounded-lg hover:bg-[--accent-dark]">Save</button>
                <button onClick={() => setEventDraft(null)} className="px-4 py-1.5 text-xs border border-[--border-2] text-[--muted] rounded-lg hover:bg-[--surface-2]">Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
