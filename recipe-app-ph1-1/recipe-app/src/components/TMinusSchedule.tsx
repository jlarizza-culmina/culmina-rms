'use client'
import { useState, useEffect, useMemo, useCallback } from 'react'
import type { Recipe, Staff, SubRecipeLink, PrepTask, CookPhase } from '@/lib/types'
import { createClient } from '@/lib/supabase'

// ── Time helpers ──────────────────────────────────────────────
function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + (m || 0)
}

function minutesToDisplay(min: number): string {
  const total = ((min % 1440) + 1440) % 1440
  const h = Math.floor(total / 60)
  const m = total % 60
  const ampm = h >= 12 ? 'PM' : 'AM'
  const dh = h > 12 ? h - 12 : h === 0 ? 12 : h
  return `${dh}:${m.toString().padStart(2, '0')} ${ampm}`
}

function tMinusLabel(taskStart: number, serviceTime: number): string {
  const diff = serviceTime - taskStart
  if (diff <= 0) return 'at service'
  const h = Math.floor(diff / 60)
  const m = diff % 60
  if (h === 0) return `T−${m}m`
  if (m === 0) return `T−${h}h`
  return `T−${h}h ${m}m`
}

function fmtDuration(min: number): string {
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

// ── Schedule algorithm ────────────────────────────────────────
const PHASE_ORDER: Record<string, number> = { mise: 0, cook: 1, plate: 2 }
const RECIPE_COLORS = ['#C05A2A','#2E6B25','#2A61A0','#7A4F6D','#8B6914','#3A6B5C','#B85C38','#5C3A6B']

function scheduleRecipe(
  recipe: Recipe,
  deadlineMinutes: number,
  colorIdx: number,
  serviceMinutes: number,
  parentName?: string
): PrepTask[] {
  const color = RECIPE_COLORS[colorIdx % RECIPE_COLORS.length]
  const steps = [...(recipe.steps ?? [])].sort((a, b) => {
    const pd = (PHASE_ORDER[a.phase ?? 'cook'] ?? 1) - (PHASE_ORDER[b.phase ?? 'cook'] ?? 1)
    return pd !== 0 ? pd : recipe.steps.indexOf(a) - recipe.steps.indexOf(b)
  })
  if (!steps.length) return []

  let cursor = deadlineMinutes
  const tasks: PrepTask[] = []

  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i]
    const dur = Math.max(step.duration ?? 0, 5)  // minimum 5 min per step
    const endMin   = cursor
    const startMin = cursor - dur
    cursor = startMin

    tasks.unshift({
      id: `${recipe.id}-${step.id}`,
      recipeId: recipe.id,
      recipeName: parentName
        ? `${recipe.name} (for ${parentName})`
        : recipe.name,
      stepId:          step.id,
      stepTitle:       step.title,
      stepDescription: step.description,
      phase:           step.phase ?? 'cook',
      durationMinutes: dur,
      startMinutes:    startMin,
      endMinutes:      endMin,
      displayStart:    minutesToDisplay(startMin),
      displayEnd:      minutesToDisplay(endMin),
      tMinusLabel:     tMinusLabel(startMin, serviceMinutes),
      isSubRecipe:     recipe.is_sub_recipe ?? false,
      parentRecipeName: parentName,
      color,
    })
  }
  return tasks
}

function buildSchedule(
  selectedRecipes: Recipe[],
  serviceMinutes: number,
  subLinks: SubRecipeLink[],
  allRecipes: Recipe[]
): PrepTask[] {
  const allTasks: PrepTask[] = []
  const scheduledSubs = new Set<string>()

  selectedRecipes.forEach((recipe, idx) => {
    const recipeTasks = scheduleRecipe(recipe, serviceMinutes, idx, serviceMinutes)
    allTasks.push(...recipeTasks)

    // Sub-recipes must complete before parent's first cook step
    const links = subLinks.filter(l => l.parent_recipe_id === recipe.id)
    links.forEach(link => {
      if (scheduledSubs.has(link.sub_recipe_id)) return
      scheduledSubs.add(link.sub_recipe_id)

      const sub = allRecipes.find(r => r.id === link.sub_recipe_id)
      if (!sub) return

      const firstCook = recipeTasks.find(t => t.phase === 'cook')
      const subDeadline = firstCook ? firstCook.startMinutes : serviceMinutes

      const subTasks = scheduleRecipe(
        sub, subDeadline,
        idx + selectedRecipes.length,
        serviceMinutes,
        recipe.name
      )
      allTasks.push(...subTasks)
    })
  })

  return allTasks.sort((a, b) => a.startMinutes - b.startMinutes)
}

// ── Conflict detection ────────────────────────────────────────
function detectConflicts(
  tasks: PrepTask[],
  assignments: Record<string, string>
): Set<string> {
  const conflicts = new Set<string>()
  const byStaff: Record<string, PrepTask[]> = {}
  tasks.forEach(t => {
    const s = assignments[t.id]
    if (s) (byStaff[s] = byStaff[s] ?? []).push(t)
  })
  Object.values(byStaff).forEach(staffTasks => {
    for (let i = 0; i < staffTasks.length; i++) {
      for (let j = i + 1; j < staffTasks.length; j++) {
        const a = staffTasks[i], b = staffTasks[j]
        if (a.startMinutes < b.endMinutes && b.startMinutes < a.endMinutes) {
          conflicts.add(a.id)
          conflicts.add(b.id)
        }
      }
    }
  })
  return conflicts
}

// ── Phase badges ──────────────────────────────────────────────
const PHASE_META: Record<CookPhase, { label: string; icon: string; bg: string; text: string }> = {
  mise:  { label: 'Mise',  icon: '🔪', bg: 'bg-blue-50',   text: 'text-blue-700' },
  cook:  { label: 'Cook',  icon: '🔥', bg: 'bg-orange-50', text: 'text-orange-700' },
  plate: { label: 'Plate', icon: '✨', bg: 'bg-green-50',  text: 'text-green-700' },
}

function getToday(): string {
  return new Date().toISOString().split('T')[0]
}

// ── Props ─────────────────────────────────────────────────────
interface Props {
  recipes: Recipe[]
  userId: string
}

export default function TMinusSchedule({ recipes, userId }: Props) {
  const supabase = createClient()

  // ── State ──────────────────────────────────────────────────
  const [step,            setStep]           = useState<'configure'|'schedule'>('configure')
  const [serviceDate,     setServiceDate]    = useState(getToday())
  const [serviceTime,     setServiceTime]    = useState('18:00')
  const [selectedIds,     setSelectedIds]    = useState<Set<string>>(new Set())
  const [tasks,           setTasks]          = useState<PrepTask[]>([])
  const [assignments,     setAssignments]    = useState<Record<string,string>>({})
  const [view,            setView]           = useState<'time'|'staff'>('time')
  const [staff,           setStaff]          = useState<Staff[]>([])
  const [subLinks,        setSubLinks]       = useState<SubRecipeLink[]>([])
  const [loading,         setLoading]        = useState(true)
  const [saving,          setSaving]         = useState(false)
  const [saved,           setSaved]          = useState(false)
  const [newStaffName,    setNewStaffName]   = useState('')
  const [showAddStaff,    setShowAddStaff]   = useState(false)

  // ── Load staff + sub-recipe links ──────────────────────────
  useEffect(() => {
    async function load() {
      setLoading(true)
      const [{ data: staffData }, { data: linkData }] = await Promise.all([
        supabase.from('staff').select('*').eq('user_id', userId).eq('is_active', true).order('name'),
        supabase.from('recipe_sub_recipes').select('*'),
      ])
      setStaff(staffData ?? [])
      setSubLinks(linkData ?? [])

      // Default: select all non-sub-recipe active recipes
      const defaultIds = new Set(
        recipes.filter(r => !r.is_sub_recipe && r.is_active !== false).map(r => r.id)
      )
      setSelectedIds(defaultIds)
      setLoading(false)
    }
    load()
  }, [userId])

  // ── Add staff member ───────────────────────────────────────
  async function addStaff() {
    if (!newStaffName.trim()) return
    const { data } = await supabase.from('staff').insert({
      user_id: userId, name: newStaffName.trim(),
      role: '', shift: '', is_active: true,
    }).select().single()
    if (data) setStaff(prev => [...prev, data])
    setNewStaffName('')
    setShowAddStaff(false)
  }

  // ── Generate schedule ──────────────────────────────────────
  const generate = useCallback(() => {
    const serviceMinutes = timeToMinutes(serviceTime)
    const selected = recipes.filter(r => selectedIds.has(r.id))
    const generated = buildSchedule(selected, serviceMinutes, subLinks, recipes)
    setTasks(generated)
    setAssignments({})
    setStep('schedule')
  }, [recipes, selectedIds, serviceTime, subLinks])

  // ── Conflicts ──────────────────────────────────────────────
  const conflicts = useMemo(() => detectConflicts(tasks, assignments), [tasks, assignments])

  const serviceMinutes = timeToMinutes(serviceTime)
  const earliestStart  = tasks.length > 0 ? Math.min(...tasks.map(t => t.startMinutes)) : serviceMinutes - 120

  // ── Hours grouped for time view ────────────────────────────
  const byHour = useMemo(() => {
    const groups: Record<number, PrepTask[]> = {}
    tasks.forEach(t => {
      const h = Math.floor(((t.startMinutes % 1440) + 1440) % 1440 / 60)
      ;(groups[h] = groups[h] ?? []).push(t)
    })
    return Object.entries(groups)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([hour, ts]) => ({ hour: Number(hour), tasks: ts }))
  }, [tasks])

  // ── By-staff view ──────────────────────────────────────────
  const byStaff = useMemo(() => {
    const groups: Record<string, { label: string; tasks: PrepTask[] }> = {}
    tasks.forEach(t => {
      const sid = assignments[t.id] ?? '__unassigned__'
      if (!groups[sid]) {
        const s = staff.find(x => x.id === sid)
        groups[sid] = {
          label: s ? s.name : sid === '__unassigned__' ? '⚪ Unassigned' : sid,
          tasks: [],
        }
      }
      groups[sid].tasks.push(t)
    })
    // Sort: unassigned last
    return Object.entries(groups).sort(([a], [b]) => {
      if (a === '__unassigned__') return 1
      if (b === '__unassigned__') return -1
      return groups[a].label.localeCompare(groups[b].label)
    }).map(([id, g]) => ({ id, ...g }))
  }, [tasks, assignments, staff])

  // ── Save to Supabase ───────────────────────────────────────
  async function saveSchedule() {
    if (!tasks.length) return
    setSaving(true)
    const rows = tasks.map(t => {
      const staffId = assignments[t.id] ?? null
      const staffMember = staff.find(s => s.id === staffId)
      return {
        user_id: userId,
        production_date: serviceDate,
        recipe_id: t.recipeId,
        step_id: t.stepId,
        staff_id: staffId && staffMember ? staffId : null,
        service_time: serviceTime + ':00',
        scheduled_start: `${t.displayStart}`,
        scheduled_end:   `${t.displayEnd}`,
        duration_minutes: t.durationMinutes,
        status: 'pending',
        notes: '',
      }
    })
    // Upsert by deleting existing and re-inserting
    await supabase.from('prep_schedule')
      .delete().eq('user_id', userId).eq('production_date', serviceDate)
    await supabase.from('prep_schedule').insert(rows)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  // ── Print ──────────────────────────────────────────────────
  function printSchedule() {
    const dateLabel = new Date(serviceDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

    const rows = tasks.map(t => {
      const staffId = assignments[t.id]
      const staffName = staff.find(s => s.id === staffId)?.name ?? staffId ?? '—'
      const pm = PHASE_META[t.phase]
      return `<tr>
        <td style="white-space:nowrap">${t.displayStart}</td>
        <td style="color:#888;font-size:9px">${t.tMinusLabel}</td>
        <td><strong>${t.stepTitle}</strong><br><span style="font-size:9px;color:#666">${t.stepDescription.slice(0,80)}${t.stepDescription.length > 80 ? '…' : ''}</span></td>
        <td style="font-size:10px">${t.recipeName}</td>
        <td style="white-space:nowrap;font-size:10px">${fmtDuration(t.durationMinutes)}</td>
        <td><span style="background:${t.phase==='mise'?'#EBF4FF':t.phase==='cook'?'#FFF3E0':'#E8F5E9'};padding:2px 6px;border-radius:4px;font-size:9px">${pm.icon} ${pm.label}</span></td>
        <td style="font-size:10px">${staffName}</td>
        <td style="width:40px;border:1px solid #ddd">&nbsp;</td>
      </tr>`
    }).join('')

    const totalHours = Math.ceil((serviceMinutes - earliestStart) / 60)
    const win = window.open('', '_blank')
    if (!win) return
    win.document.write(`<!DOCTYPE html><html><head><title>Prep Schedule — ${dateLabel}</title>
    <style>
      body{font-family:Georgia,serif;font-size:11px;margin:24px;color:#201C18}
      h1{font-size:18px;margin-bottom:2px}
      h2{font-size:12px;font-weight:normal;color:#7A7568;margin-bottom:20px}
      table{width:100%;border-collapse:collapse;margin-top:8px}
      th{text-align:left;font-size:9px;text-transform:uppercase;letter-spacing:.07em;color:#B0AB9E;border-bottom:1px solid #ddd;padding:5px 8px 5px 4px}
      td{padding:6px 8px 6px 4px;border-bottom:.5px solid #eee;vertical-align:top}
      .hour-header{background:#F8F5F0;font-weight:bold;font-size:10px;letter-spacing:.05em}
      .hour-header td{padding:6px 4px;border-top:1px solid #ddd}
      @media print{body{margin:12px}.no-print{display:none}}
    </style></head><body>
    <h1>Prep Schedule — ${dateLabel}</h1>
    <h2>Service: ${minutesToDisplay(serviceMinutes)} &nbsp;·&nbsp; ${tasks.length} tasks &nbsp;·&nbsp; ~${totalHours}h prep window &nbsp;·&nbsp; ${staff.filter(s => Object.values(assignments).includes(s.id)).length} staff assigned</h2>
    <table>
      <tr><th>Start</th><th>T−</th><th>Task</th><th>Recipe</th><th>Duration</th><th>Phase</th><th>Staff</th><th>✓</th></tr>
      ${byHour.map(({ hour, tasks: hTasks }) => `
        <tr class="hour-header"><td colspan="8">${minutesToDisplay(hour * 60)}</td></tr>
        ${hTasks.map(t => {
          const s = staff.find(x => x.id === assignments[t.id])
          const pm = PHASE_META[t.phase]
          return `<tr>
            <td style="white-space:nowrap">${t.displayStart}</td>
            <td style="color:#888;font-size:9px">${t.tMinusLabel}</td>
            <td><strong>${t.stepTitle}</strong><br><span style="font-size:9px;color:#666">${t.stepDescription.slice(0,80)}${t.stepDescription.length>80?'…':''}</span></td>
            <td style="font-size:10px;color:${t.color}">${t.recipeName}</td>
            <td style="white-space:nowrap;font-size:10px">${fmtDuration(t.durationMinutes)}</td>
            <td><span style="font-size:9px">${pm.icon} ${pm.label}</span></td>
            <td style="font-size:10px">${s?.name ?? (assignments[t.id] ?? '—')}</td>
            <td style="border:1px solid #ddd">&nbsp;</td>
          </tr>`
        }).join('')}
      `).join('')}
    </table>
    </body></html>`)
    win.document.close()
    win.print()
  }

  // ── Task row component ────────────────────────────────────
  function TaskRow({ task }: { task: PrepTask }) {
    const pm = PHASE_META[task.phase]
    const isConflict = conflicts.has(task.id)
    const assignedStaff = assignments[task.id]

    return (
      <div className={`flex items-start gap-3 py-2.5 px-3 rounded-lg border transition-colors
        ${isConflict ? 'border-red-200 bg-red-50' : 'border-[--border] bg-white hover:border-[--border-2]'}`}>

        {/* Color stripe */}
        <div className="w-1 self-stretch rounded-full flex-shrink-0 mt-0.5" style={{ background: task.color }} />

        {/* Time */}
        <div className="flex-shrink-0 text-right w-20">
          <div className="text-xs font-medium text-[--text]">{task.displayStart}</div>
          <div className="text-[10px] text-[--hint]">{task.tMinusLabel}</div>
        </div>

        {/* Phase badge */}
        <div className="flex-shrink-0 mt-0.5">
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${pm.bg} ${pm.text}`}>
            {pm.icon} {pm.label}
          </span>
        </div>

        {/* Task details */}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-xs font-medium text-[--text]">{task.stepTitle}</span>
            <span className="text-[10px] text-[--hint]">{fmtDuration(task.durationMinutes)}</span>
          </div>
          <div className="text-[11px] text-[--muted] mt-0.5 leading-relaxed line-clamp-2">{task.stepDescription}</div>
          <div className="text-[10px] mt-0.5" style={{ color: task.color }}>
            {task.recipeName}
            {task.isSubRecipe && <span className="ml-1 text-[--hint]">(sub-recipe)</span>}
          </div>
          {isConflict && (
            <div className="text-[10px] text-red-500 mt-1 font-medium">⚠ Time conflict with another task assigned to this person</div>
          )}
        </div>

        {/* Duration bar */}
        <div className="flex-shrink-0 w-16 self-center">
          <div className="h-1.5 bg-[--surface-2] rounded-full overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${Math.min(task.durationMinutes / 120 * 100, 100)}%`, background: task.color }} />
          </div>
          <div className="text-[10px] text-center text-[--hint] mt-1">{task.displayEnd}</div>
        </div>

        {/* Staff assignment */}
        <div className="flex-shrink-0 w-36">
          <select
            value={assignedStaff ?? ''}
            onChange={e => setAssignments(prev => ({ ...prev, [task.id]: e.target.value }))}
            className={`w-full px-2 py-1.5 text-[11px] border rounded-lg outline-none bg-white transition-colors
              ${isConflict ? 'border-red-300 focus:border-red-400' : 'border-[--border-2] focus:border-[--accent]'}
              ${!assignedStaff ? 'text-[--hint]' : 'text-[--text]'}`}>
            <option value="">— Assign staff —</option>
            {staff.map(s => (
              <option key={s.id} value={s.id}>{s.name}{s.role ? ` · ${s.role}` : ''}</option>
            ))}
          </select>
        </div>
      </div>
    )
  }

  // ── Render: Step 1 — Configure ────────────────────────────
  if (step === 'configure') {
    const menuRecipes = recipes.filter(r => !r.is_sub_recipe && r.is_active !== false)
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="bg-white border-b border-[--border] px-6 py-4">
          <h1 className="font-serif text-xl font-medium text-[--text] mb-4">T-Minus Prep Schedule</h1>

          <div className="flex gap-4 items-end flex-wrap mb-2">
            <div>
              <label className="block text-[11px] font-medium text-[--muted] mb-1">Service date</label>
              <input type="date" value={serviceDate} onChange={e => setServiceDate(e.target.value)}
                className="px-3 py-1.5 text-xs border border-[--border-2] rounded-lg outline-none focus:border-[--accent] bg-white" />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-[--muted] mb-1">Service time</label>
              <input type="time" value={serviceTime} onChange={e => setServiceTime(e.target.value)}
                className="px-3 py-1.5 text-xs border border-[--border-2] rounded-lg outline-none focus:border-[--accent] bg-white" />
            </div>
            <div className="text-xs text-[--muted] self-center">
              = {minutesToDisplay(timeToMinutes(serviceTime))} service
            </div>
            <div className="ml-auto flex gap-1.5">
              <button onClick={() => setSelectedIds(new Set(menuRecipes.map(r => r.id)))}
                className="px-3 py-1.5 text-xs border border-[--border-2] rounded-lg text-[--muted] hover:bg-[--surface-2]">
                Select all
              </button>
              <button onClick={() => setSelectedIds(new Set())}
                className="px-3 py-1.5 text-xs border border-[--border-2] rounded-lg text-[--muted] hover:bg-[--surface-2]">
                Clear
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="text-center py-12 text-[--hint] text-sm">Loading…</div>
          ) : menuRecipes.length === 0 ? (
            <div className="text-center py-16 text-[--muted]">
              <div className="text-4xl opacity-20 mb-3">📅</div>
              <p className="text-sm">No recipes to schedule. Add recipes in the Cookbook first.</p>
            </div>
          ) : (
            <>
              <div className="text-xs font-medium text-[--muted] mb-3 uppercase tracking-wide">
                Select recipes to schedule
              </div>
              <div className="space-y-2">
                {menuRecipes.map(r => {
                  const isSelected = selectedIds.has(r.id)
                  const totalDuration = (r.steps ?? []).reduce((s, step) => s + (step.duration ?? 0), 0)
                  const latestStart = timeToMinutes(serviceTime) - totalDuration
                  const hasSubRecipes = subLinks.some(l => l.parent_recipe_id === r.id)
                  return (
                    <div key={r.id}
                      onClick={() => setSelectedIds(prev => {
                        const n = new Set(prev)
                        n.has(r.id) ? n.delete(r.id) : n.add(r.id)
                        return n
                      })}
                      className={`flex items-center gap-3 p-3.5 rounded-xl border cursor-pointer transition-all
                        ${isSelected ? 'border-[--accent] bg-[--accent-light]' : 'border-[--border] bg-white hover:border-[--border-2]'}`}>
                      <div className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center text-[10px]
                        ${isSelected ? 'bg-[--accent] border-[--accent] text-white' : 'border-[--border-2]'}`}>
                        {isSelected ? '✓' : ''}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-[--text]">
                            {r.recipe_type === 'cocktail' ? '🍸' : '🍽'} {r.name}
                          </span>
                          {hasSubRecipes && (
                            <span className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded-full">has sub-recipes</span>
                          )}
                        </div>
                        <div className="text-[10px] text-[--muted] mt-0.5">
                          {(r.steps ?? []).length} steps · {fmtDuration(totalDuration)} total prep
                          {isSelected && totalDuration > 0 && (
                            <span className="ml-2 text-[--accent]">
                              → earliest start {minutesToDisplay(latestStart)}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex-shrink-0 text-right">
                        <div className="text-[10px] text-[--muted]">{(r.steps ?? []).length} steps</div>
                        {totalDuration > 0 && <div className="text-xs font-medium text-[--accent]">{fmtDuration(totalDuration)}</div>}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Staff setup check */}
              <div className="mt-6 p-4 bg-[--surface-2] rounded-xl border border-[--border]">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-medium text-[--text]">
                    Staff ({staff.length} {staff.length === 1 ? 'person' : 'people'})
                  </div>
                  <button onClick={() => setShowAddStaff(s => !s)}
                    className="text-xs text-[--accent] hover:text-[--accent-dark]">
                    + Add staff
                  </button>
                </div>
                {staff.length === 0 ? (
                  <p className="text-[11px] text-[--muted]">
                    No staff set up yet. You can still generate the schedule and assign tasks by name, or add staff first.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {staff.map(s => (
                      <span key={s.id} className="text-[11px] bg-white border border-[--border] px-2 py-1 rounded-full text-[--text]">
                        {s.name}{s.role && <span className="text-[--hint] ml-1">· {s.role}</span>}
                      </span>
                    ))}
                  </div>
                )}
                {showAddStaff && (
                  <div className="flex gap-2 mt-2">
                    <input value={newStaffName} onChange={e => setNewStaffName(e.target.value)}
                      placeholder="Staff member name"
                      onKeyDown={e => e.key === 'Enter' && addStaff()}
                      className="flex-1 px-2.5 py-1.5 text-xs border border-[--border-2] rounded-lg outline-none focus:border-[--accent]"
                      autoFocus />
                    <button onClick={addStaff}
                      className="px-3 py-1.5 bg-[--accent] text-white text-xs rounded-lg hover:bg-[--accent-dark]">Add</button>
                    <button onClick={() => setShowAddStaff(false)} className="text-xs text-[--muted] underline">Cancel</button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="px-6 py-3 bg-white border-t border-[--border] flex items-center gap-3">
          <span className="text-xs text-[--muted]">
            {selectedIds.size} recipe{selectedIds.size !== 1 ? 's' : ''} selected
          </span>
          <button onClick={generate} disabled={selectedIds.size === 0}
            className="ml-auto px-5 py-2 bg-[--accent] text-white text-xs font-medium rounded-lg hover:bg-[--accent-dark] disabled:opacity-40 transition-colors">
            Generate Schedule →
          </button>
        </div>
      </div>
    )
  }

  // ── Render: Step 2 — Schedule ─────────────────────────────
  const assignedCount  = Object.keys(assignments).filter(k => assignments[k]).length
  const conflictCount  = conflicts.size
  const totalPrepHours = tasks.length > 0 ? Math.ceil((serviceMinutes - earliestStart) / 60) : 0
  const dateLabel      = new Date(serviceDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="bg-white border-b border-[--border] px-6 py-4">
        <div className="flex items-center gap-3 mb-3">
          <button onClick={() => setStep('configure')}
            className="text-xs text-[--muted] hover:text-[--text] flex items-center gap-1">
            ← Reconfigure
          </button>
          <h1 className="font-serif text-xl font-medium text-[--text]">Prep Schedule</h1>
          <div className="text-xs text-[--muted]">
            {dateLabel} · Service {minutesToDisplay(serviceMinutes)}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-3 mb-3">
          {[
            { label: 'Total tasks',   value: String(tasks.length),      sub: `${totalPrepHours}h prep window` },
            { label: 'Assigned',      value: `${assignedCount}/${tasks.length}`, sub: tasks.length - assignedCount > 0 ? `${tasks.length - assignedCount} unassigned` : 'all assigned ✓' },
            { label: 'Conflicts',     value: String(conflictCount / 2),  sub: conflictCount > 0 ? '⚠ needs attention' : 'no conflicts ✓' },
            { label: 'Earliest start',value: tasks.length > 0 ? minutesToDisplay(earliestStart) : '—', sub: `${totalPrepHours}h before service` },
          ].map(s => (
            <div key={s.label} className="bg-[--surface-2] rounded-xl p-3">
              <div className="text-[10px] text-[--muted] uppercase tracking-wide mb-1">{s.label}</div>
              <div className={`text-base font-medium leading-none ${s.label === 'Conflicts' && conflictCount > 0 ? 'text-red-500' : 'text-[--text]'}`}>{s.value}</div>
              <div className="text-[10px] text-[--hint] mt-1">{s.sub}</div>
            </div>
          ))}
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex bg-[--surface-2] rounded-lg p-0.5 gap-0.5">
            <button onClick={() => setView('time')}
              className={`px-4 py-1.5 text-xs font-medium rounded-md transition-all ${view === 'time' ? 'bg-white text-[--text] shadow-sm' : 'text-[--muted]'}`}>
              ⏰ By Time
            </button>
            <button onClick={() => setView('staff')}
              className={`px-4 py-1.5 text-xs font-medium rounded-md transition-all ${view === 'staff' ? 'bg-white text-[--text] shadow-sm' : 'text-[--muted]'}`}>
              👤 By Staff
            </button>
          </div>
          <div className="flex gap-1.5 ml-auto">
            <button onClick={printSchedule}
              className="px-3 py-1.5 text-xs border border-[--border-2] rounded-lg text-[--muted] hover:bg-[--surface-2]">
              🖨 Print
            </button>
            <button onClick={saveSchedule} disabled={saving}
              className={`px-3 py-1.5 text-xs border rounded-lg transition-colors flex items-center gap-1 ${saved ? 'border-[--green] text-[--green] bg-green-50' : 'border-[--border-2] text-[--muted] hover:bg-[--surface-2]'}`}>
              {saving ? <><span className="spinner" style={{ borderTopColor: 'var(--muted)' }} />Saving…</> : saved ? '✓ Saved' : '💾 Save to calendar'}
            </button>
          </div>
        </div>
      </div>

      {/* Schedule content */}
      <div className="flex-1 overflow-y-auto px-6 py-4">

        {/* ── By Time view ── */}
        {view === 'time' && (
          <div className="space-y-4">
            {byHour.map(({ hour, tasks: hourTasks }) => (
              <div key={hour}>
                {/* Hour divider */}
                <div className="flex items-center gap-3 mb-2">
                  <div className="text-xs font-semibold text-[--text]">{minutesToDisplay(hour * 60)}</div>
                  <div className="flex-1 h-px bg-[--border]" />
                  <div className="text-[10px] text-[--hint]">{hourTasks.length} task{hourTasks.length !== 1 ? 's' : ''}</div>
                </div>
                <div className="space-y-1.5">
                  {hourTasks.map(t => <TaskRow key={t.id} task={t} />)}
                </div>
              </div>
            ))}

            {/* Service time marker */}
            <div className="flex items-center gap-3">
              <div className="text-xs font-bold text-[--accent]">🔔 {minutesToDisplay(serviceMinutes)} — SERVICE</div>
              <div className="flex-1 h-0.5 bg-[--accent] rounded-full" />
            </div>
          </div>
        )}

        {/* ── By Staff view ── */}
        {view === 'staff' && (
          <div className="space-y-6">
            {byStaff.map(({ id, label, tasks: staffTasks }) => {
              const staffConflicts = staffTasks.filter(t => conflicts.has(t.id)).length
              const totalMin = staffTasks.reduce((s, t) => s + t.durationMinutes, 0)
              const s = staff.find(x => x.id === id)
              return (
                <div key={id}>
                  <div className="flex items-center gap-3 mb-2">
                    <div>
                      <div className="text-xs font-semibold text-[--text]">{label}</div>
                      {s?.shift && <div className="text-[10px] text-[--hint]">{s.shift}</div>}
                    </div>
                    <div className="flex gap-2 ml-2">
                      <span className="text-[10px] text-[--muted] bg-[--surface-2] px-2 py-0.5 rounded-full">
                        {staffTasks.length} tasks · {fmtDuration(totalMin)}
                      </span>
                      {staffConflicts > 0 && (
                        <span className="text-[10px] text-red-500 bg-red-50 px-2 py-0.5 rounded-full">
                          ⚠ {staffConflicts} conflict{staffConflicts !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 h-px bg-[--border]" />
                  </div>
                  <div className="space-y-1.5">
                    {staffTasks.sort((a, b) => a.startMinutes - b.startMinutes).map(t => <TaskRow key={t.id} task={t} />)}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
