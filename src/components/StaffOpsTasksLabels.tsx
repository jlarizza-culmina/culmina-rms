'use client'
// src/components/StaffOpsTasksLabels.tsx
// Build 2: Tasks — template builder + daily checklist + kitchen PIN mode
// Build 3: Labels — prep label creator + QR code + HACCP print

import { useState, useEffect, useCallback, useRef } from 'react'

interface Role  { id: string; name: string; color: string }
interface Staff { id: string; name: string; role_id: string | null; pin: string | null }
interface Recipe { id: string; name: string }

// ── Task types ─────────────────────────────────────────────
interface TaskTemplate {
  id: string
  name: string
  list_type: 'daily_prep' | 'opening' | 'closing' | 'custom'
  recurrence: 'daily' | 'weekly' | 'none'
  is_active: boolean
  sort_order: number
}
interface TemplateTask {
  id: string
  template_id: string
  title: string
  description: string
  role_id: string | null
  recipe_id: string | null
  estimated_minutes: number
  sort_order: number
  is_required: boolean
}
interface TaskCompletion {
  task_id: string
  completed_by: string | null
  completed_at: string
  is_skipped: boolean
  staff_name?: string
}

// ── Label types ────────────────────────────────────────────
interface PrepLabel {
  id: string
  item_name: string
  recipe_id: string | null
  batch_qty: number | null
  batch_unit: string
  prepared_by: string | null
  prepared_at: string
  use_by_at: string | null
  storage_temp_label: string
  storage_instructions: string
  notes: string
  printed_at: string | null
  qr_token: string
  staff_name?: string
}

const LIST_TYPES = [
  { key: 'daily_prep', label: '🥘 Daily Prep',    color: '#2A61A0' },
  { key: 'opening',    label: '🔓 Opening',        color: '#2E6B25' },
  { key: 'closing',    label: '🔒 Closing',        color: '#C05A2A' },
  { key: 'custom',     label: '📋 Custom',         color: '#7C3AED' },
] as const

// ══════════════════════════════════════════════════════════
// TASKS TAB
// ══════════════════════════════════════════════════════════
export function TasksTab({ restaurantId, locationId, roles, staff, supabase }: {
  restaurantId: string; locationId: string; roles: Role[]; staff: Staff[]; supabase: any
}) {
  const [view,      setView]      = useState<'builder'|'today'|'kitchen'>('today')
  const [templates, setTemplates] = useState<TaskTemplate[]>([])
  const [tasks,     setTasks]     = useState<Record<string, TemplateTask[]>>({}) // keyed by template_id
  const [selected,  setSelected]  = useState<TaskTemplate | null>(null)
  const [completions, setCompletions] = useState<TaskCompletion[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [loading,   setLoading]   = useState(true)
  const [kitchenPin,setKitchenPin]= useState('')
  const [kitchenStaff, setKitchenStaff] = useState<Staff | null>(null)
  const [pinError,  setPinError]  = useState('')

  // Template form state
  const [showAddTemplate, setShowAddTemplate] = useState(false)
  const [tmplForm, setTmplForm] = useState({ name: '', list_type: 'daily_prep' as TaskTemplate['list_type'], recurrence: 'daily' as TaskTemplate['recurrence'] })
  const [showAddTask, setShowAddTask] = useState(false)
  const [taskForm, setTaskForm] = useState({ title: '', description: '', role_id: '', estimated_minutes: 0, is_required: true })
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data: tmpl } = await supabase.from('task_list_templates')
      .select('*').eq('restaurant_id', restaurantId).order('sort_order')
    setTemplates(tmpl ?? [])
    if (tmpl?.length) setSelected(s => s ?? tmpl[0])

    // Load today's session for the first daily_prep template
    const today = new Date().toISOString().split('T')[0]
    const firstPrep = (tmpl ?? []).find((t: TaskTemplate) => t.list_type === 'daily_prep')
    if (firstPrep) {
      const { data: sess } = await supabase.from('task_sessions')
        .select('*').eq('template_id', firstPrep.id).eq('session_date', today).single()
      if (sess) {
        setSessionId(sess.id)
        const { data: comp } = await supabase.from('task_completions')
          .select('*, staff:completed_by(name)').eq('session_id', sess.id)
        setCompletions((comp ?? []).map((c: any) => ({ ...c, staff_name: c.staff?.name })))
      }
    }
    setLoading(false)
  }, [restaurantId])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!selected) return
    supabase.from('template_tasks').select('*').eq('template_id', selected.id).order('sort_order')
      .then(({ data }: any) => setTasks(t => ({ ...t, [selected.id]: data ?? [] })))
  }, [selected?.id])

  async function startTodaySession(templateId: string) {
    const today = new Date().toISOString().split('T')[0]
    const { data } = await supabase.from('task_sessions').upsert(
      { restaurant_id: restaurantId, location_id: locationId, template_id: templateId, session_date: today },
      { onConflict: 'template_id,session_date', ignoreDuplicates: false }
    ).select().single()
    if (data) { setSessionId(data.id); return data.id }
    return null
  }

  async function completeTask(taskId: string, skip = false) {
    let sid = sessionId
    if (!sid && selected) sid = await startTodaySession(selected.id)
    if (!sid) return
    const staffId = kitchenStaff?.id ?? null
    const { data } = await supabase.from('task_completions').upsert(
      { session_id: sid, task_id: taskId, completed_by: staffId, completed_at: new Date().toISOString(), is_skipped: skip },
      { onConflict: 'session_id,task_id' }
    ).select().single()
    if (data) setCompletions(c => [...c.filter(x => x.task_id !== taskId), { ...data, staff_name: kitchenStaff?.name }])
  }

  async function saveTemplate() {
    if (!tmplForm.name.trim()) return
    setSaving(true)
    await supabase.from('task_list_templates').insert({
      restaurant_id: restaurantId, ...tmplForm, sort_order: templates.length + 1
    })
    setSaving(false)
    setShowAddTemplate(false)
    setTmplForm({ name: '', list_type: 'daily_prep', recurrence: 'daily' })
    load()
  }

  async function saveTask() {
    if (!taskForm.title.trim() || !selected) return
    setSaving(true)
    const existing = tasks[selected.id] ?? []
    await supabase.from('template_tasks').insert({
      template_id: selected.id, ...taskForm,
      role_id: taskForm.role_id || null,
      sort_order: existing.length + 1
    })
    setSaving(false)
    setShowAddTask(false)
    setTaskForm({ title: '', description: '', role_id: '', estimated_minutes: 0, is_required: true })
    const { data } = await supabase.from('template_tasks').select('*').eq('template_id', selected.id).order('sort_order')
    setTasks(t => ({ ...t, [selected.id]: data ?? [] }))
  }

  async function deleteTask(taskId: string) {
    if (!selected) return
    await supabase.from('template_tasks').delete().eq('id', taskId)
    setTasks(t => ({ ...t, [selected.id]: (t[selected.id] ?? []).filter(x => x.id !== taskId) }))
  }

  function tryKitchenPin() {
    const match = staff.find(s => s.pin === kitchenPin)
    if (match) { setKitchenStaff(match); setPinError(''); setKitchenPin('') }
    else { setPinError('PIN not found'); setKitchenPin('') }
  }

  const selectedTasks = selected ? (tasks[selected.id] ?? []) : []
  const completedIds  = new Set(completions.filter(c => !c.is_skipped).map(c => c.task_id))
  const skippedIds    = new Set(completions.filter(c => c.is_skipped).map(c => c.task_id))
  const doneCount     = completedIds.size
  const totalRequired = selectedTasks.filter(t => t.is_required).length

  return (
    <div className="flex flex-col h-full">
      {/* Sub-nav */}
      <div className="flex items-center gap-3 mb-5">
        <div className="flex bg-[--surface-2] rounded-lg p-0.5 gap-0.5">
          {([['today','📋 Today'],['builder','🔧 Builder'],['kitchen','📱 Kitchen Mode']] as const).map(([key, label]) => (
            <button key={key} onClick={() => setView(key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${view === key ? 'bg-white text-[--text] shadow-sm' : 'text-[--muted]'}`}>
              {label}
            </button>
          ))}
        </div>
        {view === 'kitchen' && kitchenStaff && (
          <div className="flex items-center gap-2 text-xs text-[--muted]">
            <div className="w-6 h-6 rounded-full bg-[--accent] flex items-center justify-center text-white text-[10px] font-semibold">
              {kitchenStaff.name[0]}
            </div>
            {kitchenStaff.name}
            <button onClick={() => setKitchenStaff(null)} className="text-[10px] text-[--hint] hover:text-red-500">✕ Sign out</button>
          </div>
        )}
      </div>

      {/* ── TODAY VIEW ── */}
      {view === 'today' && (
        <div className="space-y-4 max-w-2xl">
          {loading ? <div className="text-sm text-[--muted]">Loading…</div> : templates.length === 0 ? (
            <div className="text-center py-12 text-[--muted]">
              <div className="text-4xl mb-3 opacity-20">📋</div>
              <p className="text-sm">No task lists yet.</p>
              <p className="text-xs mt-1">Go to Builder to create your first list.</p>
            </div>
          ) : templates.map(tmpl => {
            const tmplTasks = tasks[tmpl.id] ?? []
            const done = tmplTasks.filter(t => completedIds.has(t.id)).length
            const pct  = tmplTasks.length ? Math.round(done / tmplTasks.length * 100) : 0
            return (
              <div key={tmpl.id} className="bg-white rounded-xl border border-[--border]">
                <div className="flex items-center justify-between px-4 py-3 border-b border-[--border]">
                  <div>
                    <div className="text-sm font-medium text-[--text]">{tmpl.name}</div>
                    <div className="text-[10px] text-[--muted] mt-0.5">
                      {LIST_TYPES.find(l => l.key === tmpl.list_type)?.label} · {tmplTasks.length} tasks
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-xs font-semibold text-[--accent]">{done}/{tmplTasks.length}</div>
                    <div className="w-20 h-1.5 bg-[--surface-2] rounded-full overflow-hidden">
                      <div className="h-full bg-[--accent] rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                </div>
                <div className="divide-y divide-[--border]">
                  {tmplTasks.map(task => {
                    const done  = completedIds.has(task.id)
                    const skip  = skippedIds.has(task.id)
                    const comp  = completions.find(c => c.task_id === task.id)
                    const role  = roles.find(r => r.id === task.role_id)
                    return (
                      <div key={task.id} className={`flex items-center gap-3 px-4 py-2.5 ${done || skip ? 'opacity-60' : ''}`}>
                        <button onClick={() => selected?.id === tmpl.id ? completeTask(task.id) : (setSelected(tmpl), completeTask(task.id))}
                          className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 border-2 transition-all ${done ? 'bg-[--accent] border-[--accent]' : skip ? 'border-gray-300 bg-gray-100' : 'border-[--border-2] hover:border-[--accent]'}`}>
                          {done && <span className="text-white text-[10px]">✓</span>}
                          {skip && <span className="text-gray-400 text-[10px]">—</span>}
                        </button>
                        <div className="flex-1 min-w-0">
                          <div className={`text-xs font-medium ${done ? 'line-through text-[--muted]' : 'text-[--text]'}`}>{task.title}</div>
                          {task.description && <div className="text-[10px] text-[--hint] truncate">{task.description}</div>}
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {role && <span className="text-[9px] px-1.5 py-0.5 rounded-full text-white" style={{ background: role.color }}>{role.name}</span>}
                          {task.estimated_minutes > 0 && <span className="text-[10px] text-[--hint]">{task.estimated_minutes}m</span>}
                          {comp && <span className="text-[10px] text-[--muted]">{comp.staff_name ?? '—'}</span>}
                          {!done && !skip && (
                            <button onClick={() => completeTask(task.id, true)}
                              className="text-[10px] text-[--hint] hover:text-[--muted] px-1">Skip</button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── BUILDER VIEW ── */}
      {view === 'builder' && (
        <div className="flex gap-5 max-w-5xl">
          {/* Template list */}
          <div className="w-52 flex-shrink-0 space-y-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-[--hint] mb-2">Task Lists</div>
            {templates.map(t => (
              <button key={t.id} onClick={() => setSelected(t)}
                className={`w-full text-left px-3 py-2.5 rounded-xl border text-xs font-medium transition-colors ${selected?.id === t.id ? 'border-[--accent] bg-[--accent-light]/20 text-[--accent]' : 'border-[--border] bg-white text-[--text] hover:bg-[--surface-2]'}`}>
                <div>{LIST_TYPES.find(l => l.key === t.list_type)?.label.split(' ')[0]} {t.name}</div>
                <div className="text-[9px] text-[--hint] font-normal mt-0.5 capitalize">{t.recurrence}</div>
              </button>
            ))}
            <button onClick={() => setShowAddTemplate(s => !s)}
              className="w-full text-left px-3 py-2 rounded-xl border border-dashed border-[--border-2] text-[11px] text-[--hint] hover:border-[--accent] hover:text-[--accent] transition-colors">
              + New list
            </button>
            {showAddTemplate && (
              <div className="bg-white border border-[--accent]/40 rounded-xl p-3 space-y-2">
                <input value={tmplForm.name} onChange={e => setTmplForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="List name" className="w-full text-xs border border-[--border-2] rounded-lg px-2 py-1.5 outline-none focus:border-[--accent]" />
                <select value={tmplForm.list_type} onChange={e => setTmplForm(p => ({ ...p, list_type: e.target.value as any }))}
                  className="w-full text-xs border border-[--border-2] rounded-lg px-2 py-1.5 outline-none focus:border-[--accent]">
                  {LIST_TYPES.map(l => <option key={l.key} value={l.key}>{l.label}</option>)}
                </select>
                <select value={tmplForm.recurrence} onChange={e => setTmplForm(p => ({ ...p, recurrence: e.target.value as any }))}
                  className="w-full text-xs border border-[--border-2] rounded-lg px-2 py-1.5 outline-none focus:border-[--accent]">
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="none">One-time</option>
                </select>
                <div className="flex gap-1">
                  <button onClick={saveTemplate} disabled={!tmplForm.name || saving}
                    className="flex-1 py-1 bg-[--accent] text-white text-[11px] rounded-lg disabled:opacity-50">{saving ? '…' : 'Save'}</button>
                  <button onClick={() => setShowAddTemplate(false)}
                    className="flex-1 py-1 border border-[--border-2] text-[--muted] text-[11px] rounded-lg">Cancel</button>
                </div>
              </div>
            )}
          </div>

          {/* Task detail */}
          {selected && (
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="font-serif text-base font-medium text-[--text]">{selected.name}</h2>
                  <p className="text-xs text-[--muted] mt-0.5">{LIST_TYPES.find(l => l.key === selected.list_type)?.label} · {selected.recurrence}</p>
                </div>
                <button onClick={() => setShowAddTask(s => !s)}
                  className="px-3 py-1.5 bg-[--accent] text-white text-xs rounded-lg hover:bg-[--accent-dark]">+ Add task</button>
              </div>

              {showAddTask && (
                <div className="bg-[--accent-light]/20 border border-[--accent]/30 rounded-xl p-4 mb-4 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2">
                      <label className="block text-[10px] text-[--muted] mb-1">Task title *</label>
                      <input value={taskForm.title} onChange={e => setTaskForm(p => ({ ...p, title: e.target.value }))}
                        placeholder="e.g. Weigh and portion pasta dough" className="w-full text-xs border border-[--border-2] rounded-lg px-2.5 py-1.5 outline-none focus:border-[--accent]" />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-[10px] text-[--muted] mb-1">Description / instructions</label>
                      <textarea value={taskForm.description} onChange={e => setTaskForm(p => ({ ...p, description: e.target.value }))}
                        rows={2} placeholder="Optional detail…" className="w-full text-xs border border-[--border-2] rounded-lg px-2.5 py-1.5 outline-none focus:border-[--accent] resize-none" />
                    </div>
                    <div>
                      <label className="block text-[10px] text-[--muted] mb-1">Assign to role</label>
                      <select value={taskForm.role_id} onChange={e => setTaskForm(p => ({ ...p, role_id: e.target.value }))}
                        className="w-full text-xs border border-[--border-2] rounded-lg px-2.5 py-1.5 outline-none focus:border-[--accent]">
                        <option value="">Any role</option>
                        {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] text-[--muted] mb-1">Est. minutes</label>
                      <input type="number" min={0} max={480} value={taskForm.estimated_minutes}
                        onChange={e => setTaskForm(p => ({ ...p, estimated_minutes: parseInt(e.target.value) || 0 }))}
                        className="w-full text-xs border border-[--border-2] rounded-lg px-2.5 py-1.5 outline-none focus:border-[--accent]" />
                    </div>
                    <div className="col-span-2 flex items-center gap-2">
                      <input type="checkbox" id="req" checked={taskForm.is_required} onChange={e => setTaskForm(p => ({ ...p, is_required: e.target.checked }))} className="accent-[--accent]" />
                      <label htmlFor="req" className="text-xs text-[--muted]">Required task</label>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={saveTask} disabled={!taskForm.title || saving}
                      className="px-4 py-1.5 bg-[--accent] text-white text-xs rounded-lg disabled:opacity-50">{saving ? 'Saving…' : 'Add task'}</button>
                    <button onClick={() => setShowAddTask(false)}
                      className="px-4 py-1.5 border border-[--border-2] text-[--muted] text-xs rounded-lg">Cancel</button>
                  </div>
                </div>
              )}

              <div className="bg-white rounded-xl border border-[--border] overflow-hidden">
                {selectedTasks.length === 0 ? (
                  <div className="text-center py-8 text-[--muted] text-xs">No tasks yet. Add your first task above.</div>
                ) : selectedTasks.map((task, idx) => {
                  const role = roles.find(r => r.id === task.role_id)
                  return (
                    <div key={task.id} className={`flex items-center gap-3 px-4 py-3 border-b border-[--border] last:border-0 ${idx % 2 === 1 ? 'bg-[--surface-2]/30' : ''}`}>
                      <span className="text-[10px] text-[--hint] w-5 text-center">{idx + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-[--text] flex items-center gap-2">
                          {task.title}
                          {!task.is_required && <span className="text-[9px] text-[--hint] border border-[--border-2] px-1 rounded">optional</span>}
                        </div>
                        {task.description && <div className="text-[10px] text-[--hint] mt-0.5 truncate">{task.description}</div>}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {role && <span className="text-[9px] px-1.5 py-0.5 rounded-full text-white" style={{ background: role.color }}>{role.name}</span>}
                        {task.estimated_minutes > 0 && <span className="text-[10px] text-[--hint]">{task.estimated_minutes}m</span>}
                        <button onClick={() => deleteTask(task.id)}
                          className="text-[11px] text-[--hint] hover:text-red-500 px-1">✕</button>
                      </div>
                    </div>
                  )
                })}
              </div>
              {selectedTasks.length > 0 && (
                <p className="text-[10px] text-[--hint] mt-2">
                  Total est. time: {selectedTasks.reduce((s, t) => s + t.estimated_minutes, 0)} min ·{' '}
                  {selectedTasks.filter(t => t.is_required).length} required, {selectedTasks.filter(t => !t.is_required).length} optional
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── KITCHEN MODE ── */}
      {view === 'kitchen' && (
        <div className="max-w-lg mx-auto w-full">
          {!kitchenStaff ? (
            /* PIN entry */
            <div className="bg-white rounded-2xl border border-[--border] p-8 text-center shadow-sm">
              <div className="text-4xl mb-4">🔐</div>
              <h2 className="font-serif text-xl text-[--text] mb-2">Enter your PIN</h2>
              <p className="text-sm text-[--muted] mb-6">Sign in to track your task completions</p>
              <div className="flex justify-center gap-3 mb-4">
                {[0,1,2,3].map(i => (
                  <div key={i} className={`w-12 h-14 rounded-xl border-2 flex items-center justify-center text-2xl font-bold
                    ${kitchenPin.length > i ? 'border-[--accent] text-[--accent]' : 'border-[--border-2] text-[--surface-2]'}`}>
                    {kitchenPin.length > i ? '●' : '○'}
                  </div>
                ))}
              </div>
              {pinError && <p className="text-xs text-red-500 mb-3">{pinError}</p>}
              <div className="grid grid-cols-3 gap-3 max-w-xs mx-auto">
                {[1,2,3,4,5,6,7,8,9,'',0,'⌫'].map((k, i) => (
                  <button key={i} disabled={k === ''} onClick={() => {
                    if (k === '⌫') setKitchenPin(p => p.slice(0,-1))
                    else if (typeof k === 'number' && kitchenPin.length < 4) {
                      const next = kitchenPin + k
                      setKitchenPin(next)
                      if (next.length === 4) setTimeout(() => {
                        const match = staff.find(s => s.pin === next)
                        if (match) { setKitchenStaff(match); setPinError(''); setKitchenPin('') }
                        else { setPinError('PIN not found'); setKitchenPin('') }
                      }, 100)
                    }
                  }}
                    className={`h-14 rounded-xl text-lg font-semibold transition-colors ${k === '' ? 'invisible' : 'bg-[--surface-2] text-[--text] hover:bg-[--border] active:scale-95'}`}>
                    {k}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* Checklist */
            <div className="space-y-3">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h2 className="font-serif text-lg text-[--text]">{selected?.name ?? "Today's Tasks"}</h2>
                  <p className="text-xs text-[--muted]">{doneCount} of {selectedTasks.length} done · {totalRequired - Math.min(doneCount, totalRequired)} required remaining</p>
                </div>
                <div className="w-16 h-2 bg-[--surface-2] rounded-full overflow-hidden">
                  <div className="h-full bg-[--accent] rounded-full transition-all" style={{ width: `${selectedTasks.length ? doneCount/selectedTasks.length*100 : 0}%` }} />
                </div>
              </div>

              {/* Template picker */}
              {templates.length > 1 && (
                <div className="flex gap-2 flex-wrap mb-3">
                  {templates.map(t => (
                    <button key={t.id} onClick={() => setSelected(t)}
                      className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${selected?.id === t.id ? 'bg-[--accent] text-white border-transparent' : 'border-[--border-2] text-[--muted]'}`}>
                      {t.name}
                    </button>
                  ))}
                </div>
              )}

              {selectedTasks.map(task => {
                const done = completedIds.has(task.id)
                const skip = skippedIds.has(task.id)
                const comp = completions.find(c => c.task_id === task.id)
                const role = roles.find(r => r.id === task.role_id)
                return (
                  <button key={task.id} onClick={() => !done && !skip && completeTask(task.id)}
                    className={`w-full text-left p-4 rounded-xl border-2 transition-all ${done ? 'border-[--accent]/40 bg-[--accent-light]/20' : skip ? 'border-gray-200 bg-gray-50' : 'border-[--border] bg-white hover:border-[--accent] active:scale-[0.98]'}`}>
                    <div className="flex items-center gap-3">
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 border-2 ${done ? 'bg-[--accent] border-[--accent]' : skip ? 'border-gray-300 bg-gray-100' : 'border-[--border-2]'}`}>
                        {done && <span className="text-white text-xs">✓</span>}
                        {skip && <span className="text-gray-400 text-xs">—</span>}
                      </div>
                      <div className="flex-1">
                        <div className={`text-sm font-medium ${done ? 'line-through text-[--muted]' : 'text-[--text]'}`}>{task.title}</div>
                        {task.description && <div className="text-xs text-[--muted] mt-0.5">{task.description}</div>}
                        {done && comp && <div className="text-[10px] text-[--accent] mt-1">✓ {comp.staff_name ?? kitchenStaff.name} · {new Date(comp.completed_at).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}</div>}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {role && <span className="text-[9px] px-2 py-0.5 rounded-full text-white" style={{ background: role.color }}>{role.name}</span>}
                        {task.estimated_minutes > 0 && <span className="text-xs text-[--hint]">{task.estimated_minutes}m</span>}
                        {!done && !skip && (
                          <button onClick={e => { e.stopPropagation(); completeTask(task.id, true) }}
                            className="text-[10px] text-[--hint] border border-[--border-2] px-2 py-0.5 rounded hover:bg-[--surface-2]">Skip</button>
                        )}
                      </div>
                    </div>
                  </button>
                )
              })}

              {doneCount === selectedTasks.length && selectedTasks.length > 0 && (
                <div className="text-center py-6">
                  <div className="text-4xl mb-2">🎉</div>
                  <p className="text-sm font-medium text-[--text]">All done!</p>
                  <p className="text-xs text-[--muted] mt-1">Great work, {kitchenStaff.name}.</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}


// ══════════════════════════════════════════════════════════
// LABELS TAB
// ══════════════════════════════════════════════════════════
const STORAGE_TEMPS = ['Refrigerate (34–38°F)','Freeze (0°F or below)','Room temp (60–70°F)','Do not store — use immediately']
const BATCH_UNITS   = ['g','kg','oz','lb','ml','L','each','portions','trays','pans','cups']
const SHELF_LIFE: Record<string, number> = { 'Refrigerate (34–38°F)': 4, 'Freeze (0°F or below)': 90, 'Room temp (60–70°F)': 1 }

export function LabelsTab({ restaurantId, staff, recipes, supabase }: {
  restaurantId: string; staff: Staff[]; recipes: Recipe[]; supabase: any
}) {
  const [labels,     setLabels]     = useState<PrepLabel[]>([])
  const [printQueue, setPrintQueue] = useState<PrepLabel[]>([])
  const [loading,    setLoading]    = useState(true)
  const [tab,        setTab]        = useState<'create'|'history'>('create')
  const [saving,     setSaving]     = useState(false)
  const printRef = useRef<HTMLDivElement>(null)

  const [form, setForm] = useState({
    item_name: '', recipe_id: '', batch_qty: '', batch_unit: 'g',
    prepared_by: '', prepared_at: new Date().toISOString().slice(0,16),
    use_by_at: '', storage_temp_label: STORAGE_TEMPS[0],
    storage_instructions: '', notes: '',
  })

  const loadLabels = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('prep_labels')
      .select('*, staff:prepared_by(name)').eq('restaurant_id', restaurantId)
      .order('prepared_at', { ascending: false }).limit(50)
    setLabels((data ?? []).map((l: any) => ({ ...l, staff_name: l.staff?.name })))
    setLoading(false)
  }, [restaurantId])

  useEffect(() => { loadLabels() }, [loadLabels])

  // Auto-fill use_by when storage temp changes
  useEffect(() => {
    const days = SHELF_LIFE[form.storage_temp_label]
    if (days && form.prepared_at) {
      const d = new Date(form.prepared_at)
      d.setDate(d.getDate() + days)
      setForm(p => ({ ...p, use_by_at: d.toISOString().slice(0,16) }))
    }
  }, [form.storage_temp_label, form.prepared_at])

  // Auto-fill item name from recipe
  useEffect(() => {
    if (form.recipe_id) {
      const recipe = recipes.find(r => r.id === form.recipe_id)
      if (recipe) setForm(p => ({ ...p, item_name: recipe.name }))
    }
  }, [form.recipe_id])

  async function saveLabel() {
    if (!form.item_name.trim()) return
    setSaving(true)
    const payload = {
      restaurant_id: restaurantId,
      item_name: form.item_name.trim(),
      recipe_id: form.recipe_id || null,
      batch_qty: form.batch_qty ? parseFloat(form.batch_qty) : null,
      batch_unit: form.batch_unit,
      prepared_by: form.prepared_by || null,
      prepared_at: new Date(form.prepared_at).toISOString(),
      use_by_at: form.use_by_at ? new Date(form.use_by_at).toISOString() : null,
      storage_temp_label: form.storage_temp_label,
      storage_instructions: form.storage_instructions,
      notes: form.notes,
    }
    const { data } = await supabase.from('prep_labels').insert(payload).select('*, staff:prepared_by(name)').single()
    if (data) {
      const enriched = { ...data, staff_name: data.staff?.name }
      setPrintQueue(q => [...q, enriched])
      setLabels(l => [enriched, ...l])
      setForm(p => ({
        ...p, item_name: '', recipe_id: '', batch_qty: '', notes: '',
        prepared_at: new Date().toISOString().slice(0,16),
      }))
    }
    setSaving(false)
  }

  function printLabels() {
    if (!printRef.current) return
    const w = window.open('', '_blank', 'width=600,height=800')
    if (!w) return
    w.document.write(`<html><head><title>Prep Labels</title><style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:monospace;background:white}
      .page{display:flex;flex-wrap:wrap;gap:8px;padding:8px}
      .label{width:2in;height:2in;border:1px solid #000;padding:6px;font-size:8pt;display:flex;flex-direction:column;gap:2px;page-break-inside:avoid}
      .label-title{font-size:10pt;font-weight:bold;border-bottom:1px solid #000;padding-bottom:3px;margin-bottom:3px}
      .label-row{display:flex;justify-content:space-between}
      .use-by{font-size:11pt;font-weight:bold;color:#000;margin-top:auto;border-top:1px solid #000;padding-top:3px}
      .qr{text-align:center;margin-top:2px}
      @media print{@page{margin:0.25in}}
    </style></head><body><div class="page">`)
    for (const label of printQueue) {
      const prepDate = new Date(label.prepared_at)
      const useByDate = label.use_by_at ? new Date(label.use_by_at) : null
      const fmtDate = (d: Date) => `${d.getMonth()+1}/${d.getDate()}/${d.getFullYear().toString().slice(-2)} ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`
      w.document.write(`
        <div class="label">
          <div class="label-title">${label.item_name}</div>
          ${label.batch_qty ? `<div class="label-row"><span>Batch:</span><span>${label.batch_qty} ${label.batch_unit}</span></div>` : ''}
          <div class="label-row"><span>Prep:</span><span>${fmtDate(prepDate)}</span></div>
          <div class="label-row"><span>By:</span><span>${label.staff_name ?? '—'}</span></div>
          <div class="label-row"><span>Store:</span><span style="font-size:7pt">${label.storage_temp_label.split('(')[0].trim()}</span></div>
          ${label.notes ? `<div style="font-size:7pt;font-style:italic">${label.notes}</div>` : ''}
          ${useByDate ? `<div class="use-by">USE BY: ${fmtDate(useByDate)}</div>` : ''}
          <div class="qr"><img src="https://api.qrserver.com/v1/create-qr-code/?size=60x60&data=${label.qr_token}" width="60" height="60"/></div>
        </div>`)
    }
    w.document.write(`</div></body></html>`)
    w.document.close()
    w.focus()
    setTimeout(() => w.print(), 500)
  }

  function fmtDate(iso: string) {
    const d = new Date(iso)
    return d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'2-digit'}) + ' ' +
           d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})
  }

  return (
    <div className="space-y-5 max-w-4xl">
      {/* Sub-tabs */}
      <div className="flex bg-[--surface-2] rounded-lg p-0.5 gap-0.5 w-fit">
        {([['create','🏷 Create Label'],['history','📜 Label History']] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 py-1.5 text-xs font-medium rounded-md transition-all ${tab === key ? 'bg-white text-[--text] shadow-sm' : 'text-[--muted]'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'create' && (
        <div className="grid grid-cols-2 gap-5">
          {/* Create form */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[--hint]">Label Details</h3>

            <div>
              <label className="block text-[10px] text-[--muted] mb-1">Link to recipe (optional)</label>
              <select value={form.recipe_id} onChange={e => setForm(p => ({ ...p, recipe_id: e.target.value }))}
                className="w-full text-xs border border-[--border-2] rounded-lg px-2.5 py-2 outline-none focus:border-[--accent]">
                <option value="">— No recipe (freeform) —</option>
                {recipes.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-[10px] text-[--muted] mb-1">Item name *</label>
              <input value={form.item_name} onChange={e => setForm(p => ({ ...p, item_name: e.target.value }))}
                placeholder="e.g. Besciamella" className="w-full text-xs border border-[--border-2] rounded-lg px-2.5 py-2 outline-none focus:border-[--accent]" />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] text-[--muted] mb-1">Batch quantity</label>
                <input type="number" value={form.batch_qty} onChange={e => setForm(p => ({ ...p, batch_qty: e.target.value }))}
                  placeholder="500" className="w-full text-xs border border-[--border-2] rounded-lg px-2.5 py-2 outline-none focus:border-[--accent]" />
              </div>
              <div>
                <label className="block text-[10px] text-[--muted] mb-1">Unit</label>
                <select value={form.batch_unit} onChange={e => setForm(p => ({ ...p, batch_unit: e.target.value }))}
                  className="w-full text-xs border border-[--border-2] rounded-lg px-2.5 py-2 outline-none focus:border-[--accent]">
                  {BATCH_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[10px] text-[--muted] mb-1">Prepared by</label>
              <select value={form.prepared_by} onChange={e => setForm(p => ({ ...p, prepared_by: e.target.value }))}
                className="w-full text-xs border border-[--border-2] rounded-lg px-2.5 py-2 outline-none focus:border-[--accent]">
                <option value="">— Select staff —</option>
                {staff.filter(s => s.name).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-[10px] text-[--muted] mb-1">Prep date & time</label>
              <input type="datetime-local" value={form.prepared_at} onChange={e => setForm(p => ({ ...p, prepared_at: e.target.value }))}
                className="w-full text-xs border border-[--border-2] rounded-lg px-2.5 py-2 outline-none focus:border-[--accent]" />
            </div>

            <div>
              <label className="block text-[10px] text-[--muted] mb-1">Storage temperature</label>
              <select value={form.storage_temp_label} onChange={e => setForm(p => ({ ...p, storage_temp_label: e.target.value }))}
                className="w-full text-xs border border-[--border-2] rounded-lg px-2.5 py-2 outline-none focus:border-[--accent]">
                {STORAGE_TEMPS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-[10px] text-[--muted] mb-1">
                Use-by date & time
                <span className="text-[--hint] ml-1">(auto-calculated, editable)</span>
              </label>
              <input type="datetime-local" value={form.use_by_at} onChange={e => setForm(p => ({ ...p, use_by_at: e.target.value }))}
                className="w-full text-xs border border-[--border-2] rounded-lg px-2.5 py-2 outline-none focus:border-[--accent]" />
            </div>

            <div>
              <label className="block text-[10px] text-[--muted] mb-1">Notes / allergen warnings</label>
              <textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                rows={2} placeholder="Optional — e.g. Contains gluten, nuts" className="w-full text-xs border border-[--border-2] rounded-lg px-2.5 py-2 outline-none focus:border-[--accent] resize-none" />
            </div>

            <button onClick={saveLabel} disabled={!form.item_name || saving}
              className="w-full py-2.5 bg-[--accent] text-white text-xs font-medium rounded-lg hover:bg-[--accent-dark] disabled:opacity-50">
              {saving ? 'Saving…' : '+ Add to print queue'}
            </button>
          </div>

          {/* Print queue */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-[--hint]">
                Print Queue ({printQueue.length})
              </h3>
              <div className="flex gap-2">
                {printQueue.length > 0 && (
                  <>
                    <button onClick={() => setPrintQueue([])}
                      className="text-xs text-[--muted] hover:text-red-500">Clear</button>
                    <button onClick={printLabels}
                      className="px-3 py-1.5 bg-[--accent] text-white text-xs rounded-lg hover:bg-[--accent-dark]">
                      🖨 Print {printQueue.length} label{printQueue.length !== 1 ? 's' : ''}
                    </button>
                  </>
                )}
              </div>
            </div>

            {printQueue.length === 0 ? (
              <div className="bg-[--surface-2] rounded-xl p-6 text-center text-[--hint] text-xs">
                <div className="text-2xl mb-2 opacity-30">🏷</div>
                Labels added to the queue will appear here.<br/>Print up to 10 at once.
              </div>
            ) : (
              <div className="space-y-2" ref={printRef}>
                {printQueue.map((label, i) => (
                  <div key={label.id} className="bg-white border border-[--border] rounded-xl p-3 flex items-start gap-3">
                    <img src={`https://api.qrserver.com/v1/create-qr-code/?size=64x64&data=${label.qr_token}`}
                      alt="QR" className="w-12 h-12 rounded flex-shrink-0" />
                    <div className="flex-1 min-w-0 text-xs">
                      <div className="font-semibold text-[--text]">{label.item_name}</div>
                      {label.batch_qty && <div className="text-[--muted]">{label.batch_qty} {label.batch_unit}</div>}
                      <div className="text-[--muted]">Prep: {fmtDate(label.prepared_at)}</div>
                      {label.use_by_at && (
                        <div className="font-medium text-red-600 mt-0.5">Use by: {fmtDate(label.use_by_at)}</div>
                      )}
                      {label.staff_name && <div className="text-[--hint]">By: {label.staff_name}</div>}
                    </div>
                    <button onClick={() => setPrintQueue(q => q.filter((_, j) => j !== i))}
                      className="text-[--hint] hover:text-red-500 text-sm flex-shrink-0">✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'history' && (
        <div className="bg-white rounded-xl border border-[--border] overflow-hidden">
          <div className="bg-[--surface-2] border-b border-[--border] grid text-[10px] font-semibold uppercase tracking-wide text-[--hint]"
            style={{ gridTemplateColumns: '1fr 80px 80px 130px 130px 120px 80px' }}>
            {['Item','Batch','Unit','Prep date','Use by','By','Print'].map(h => (
              <div key={h} className="px-3 py-2.5">{h}</div>
            ))}
          </div>
          {loading ? (
            <div className="text-center py-8 text-[--muted] text-sm">Loading…</div>
          ) : labels.length === 0 ? (
            <div className="text-center py-8 text-[--hint] text-xs">No labels yet.</div>
          ) : labels.map((label, i) => (
            <div key={label.id}
              className={`grid items-center text-xs border-b border-[--border] last:border-0 ${i%2===1?'bg-[--surface-2]/30':''}`}
              style={{ gridTemplateColumns: '1fr 80px 80px 130px 130px 120px 80px' }}>
              <div className="px-3 py-2.5 font-medium text-[--text] truncate">{label.item_name}</div>
              <div className="px-3 py-2.5 text-[--muted]">{label.batch_qty ?? '—'}</div>
              <div className="px-3 py-2.5 text-[--muted]">{label.batch_unit}</div>
              <div className="px-3 py-2.5 text-[--muted] text-[11px]">{fmtDate(label.prepared_at)}</div>
              <div className={`px-3 py-2.5 text-[11px] font-medium ${label.use_by_at ? 'text-red-600' : 'text-[--hint]'}`}>
                {label.use_by_at ? fmtDate(label.use_by_at) : '—'}
              </div>
              <div className="px-3 py-2.5 text-[--muted] truncate">{label.staff_name ?? '—'}</div>
              <div className="px-3 py-2.5">
                <button onClick={() => setPrintQueue(q => q.find(l => l.id === label.id) ? q : [...q, label])}
                  className="text-[10px] border border-[--border-2] px-2 py-0.5 rounded text-[--muted] hover:text-[--accent] hover:border-[--accent]">
                  + Queue
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
