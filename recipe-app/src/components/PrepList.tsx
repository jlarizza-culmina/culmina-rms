'use client'
import { useState, useMemo } from 'react'
import type { Recipe } from '@/lib/types'

const CAT_ORDER = ['produce','meat','seafood','dairy','bakery','pantry','spices','spirits','mixers','frozen','beverages','other']
const CAT_LABELS: Record<string, string> = {
  produce:'🥦 Produce', meat:'🥩 Meat', seafood:'🐟 Seafood', dairy:'🧀 Dairy',
  bakery:'🍞 Bakery', pantry:'🥫 Pantry', spices:'🌿 Spices', spirits:'🍶 Spirits',
  mixers:'🍋 Mixers', frozen:'❄️ Frozen', beverages:'🧃 Beverages', other:'📦 Other',
}

interface PrepTask {
  key: string
  text: string        // e.g. "Dice 1 medium onion"
  recipeNames: string[]
  stepTitle: string
  phase: 'mise' | 'cook' | 'plate'
  category: string
  duration: number
  done: boolean
}

function scaleAmt(amount: number, ratio: number): string {
  const v = amount * ratio
  if (v <= 0) return ''
  if (v >= 10) return String(Math.round(v))
  const fracs: [number, string][] = [[.125,'⅛'],[.25,'¼'],[.333,'⅓'],[.5,'½'],[.667,'⅔'],[.75,'¾']]
  for (const [f, sym] of fracs) if (Math.abs(v - f) < 0.06) return sym
  const r = Math.round(v * 4) / 4
  return r === Math.floor(r) ? String(r) : r.toFixed(2).replace(/0+$/, '')
}

interface Props {
  recipes: Recipe[]
  servings: Record<string, number>
  onClose: () => void
}

export default function PrepList({ recipes, servings, onClose }: Props) {
  const [doneTasks, setDoneTasks] = useState<Set<string>>(new Set())
  const [view, setView] = useState<'mise' | 'all'>('mise')

  // Build merged task list
  const tasks = useMemo<PrepTask[]>(() => {
    const all: PrepTask[] = []

    recipes.forEach(recipe => {
      const ratio = (servings[recipe.id] ?? recipe.base_servings) / recipe.base_servings
      const stepsToShow = view === 'mise'
        ? recipe.steps.filter(s => s.phase === 'mise')
        : recipe.steps

      stepsToShow.forEach(step => {
        // Find ingredients mentioned in this step
        const desc = step.description.toLowerCase()
        const relevantIngs = recipe.ingredients.filter(i =>
          desc.includes(i.name.toLowerCase().split(' ')[0])
        )

        const ingText = relevantIngs.length > 0
          ? relevantIngs.map(i => `${scaleAmt(i.amount, ratio)}${i.unit ? ' '+i.unit : ''} ${i.name}`.trim()).join(', ')
          : ''

        const key = `${recipe.id}-${step.id}`
        const category = relevantIngs[0]?.category ?? 'other'

        all.push({
          key,
          text: step.description,
          recipeNames: [recipe.name],
          stepTitle: step.title,
          phase: step.phase ?? 'cook',
          category,
          duration: step.duration,
          done: false,
        })
      })
    })

    return all
  }, [recipes, servings, view])

  // Group by category
  const grouped = useMemo(() => {
    const g: Record<string, PrepTask[]> = {}
    tasks.forEach(t => {
      ;(g[t.category] = g[t.category] ?? []).push(t)
    })
    return g
  }, [tasks])

  const ordered = CAT_ORDER.filter(c => grouped[c])
  Object.keys(grouped).forEach(c => { if (!CAT_ORDER.includes(c)) ordered.push(c) })

  const total = tasks.length
  const doneN = doneTasks.size
  const pct = total > 0 ? Math.round(doneN / total * 100) : 0

  function toggleTask(key: string) {
    setDoneTasks(prev => {
      const n = new Set(prev)
      n.has(key) ? n.delete(key) : n.add(key)
      return n
    })
  }

  const totalTime = tasks.reduce((s, t) => s + (doneTasks.has(t.key) ? 0 : t.duration || 0), 0)

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-end z-50" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="h-full w-full max-w-md bg-white shadow-2xl flex flex-col fade-in">

        {/* Header */}
        <div className="px-5 py-4 border-b border-[--border]">
          <div className="flex items-start justify-between mb-1">
            <div>
              <h2 className="font-serif text-lg font-medium text-[--text]">Prep List</h2>
              <p className="text-xs text-[--muted] mt-0.5">
                {recipes.map(r => r.name).join(' · ')}
              </p>
            </div>
            <button onClick={onClose} className="text-[--hint] hover:text-[--muted] text-lg transition-colors ml-3">✕</button>
          </div>

          {/* View toggle */}
          <div className="flex bg-[--surface-2] rounded-lg p-0.5 gap-0.5 mt-3">
            <button
              onClick={() => setView('mise')}
              className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-all ${view === 'mise' ? 'bg-white text-[--text] shadow-sm' : 'text-[--muted]'}`}
            >
              🔪 Mise en Place only
            </button>
            <button
              onClick={() => setView('all')}
              className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-all ${view === 'all' ? 'bg-white text-[--text] shadow-sm' : 'text-[--muted]'}`}
            >
              📋 All steps
            </button>
          </div>

          {/* Progress */}
          <div className="flex items-center gap-3 mt-3">
            <div className="flex-1 h-1.5 bg-[--surface-2] rounded-full overflow-hidden">
              <div className="h-full bg-[--green] rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-xs text-[--muted]">{doneN}/{total}</span>
            {totalTime > 0 && <span className="text-xs text-[--muted]">~{totalTime}min left</span>}
            {doneN > 0 && (
              <button onClick={() => setDoneTasks(new Set())} className="text-xs text-[--hint] hover:text-[--muted] underline">Reset</button>
            )}
          </div>
        </div>

        {/* Recipe color legend */}
        <div className="px-5 py-2 bg-[--surface-2] border-b border-[--border] flex gap-3 flex-wrap">
          {recipes.map((r, i) => {
            const colors = ['bg-[--accent-light] text-[--accent]', 'bg-blue-50 text-blue-600', 'bg-green-50 text-green-700', 'bg-purple-50 text-purple-700']
            return (
              <span key={r.id} className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${colors[i % colors.length]}`}>
                {r.name}
              </span>
            )
          })}
        </div>

        {/* Task list */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {tasks.length === 0 ? (
            <p className="text-sm text-[--muted] text-center py-8">No {view === 'mise' ? 'mise en place' : ''} steps found for these recipes.</p>
          ) : (
            <div className="space-y-5">
              {ordered.map(cat => (
                <div key={cat}>
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-[--muted] pb-1.5 border-b border-[--border] mb-2">
                    {CAT_LABELS[cat] ?? cat}
                  </div>
                  {grouped[cat].map(task => {
                    const isDone = doneTasks.has(task.key)
                    const recipeIdx = recipes.findIndex(r =>
                      r.steps.some(s => task.key.startsWith(r.id))
                    )
                    const dotColors = ['bg-[--accent]', 'bg-blue-500', 'bg-green-600', 'bg-purple-500']
                    return (
                      <div
                        key={task.key}
                        onClick={() => toggleTask(task.key)}
                        className="flex items-start gap-3 py-2.5 cursor-pointer group border-b border-[--border] last:border-0"
                      >
                        <div className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center mt-0.5 transition-all ${isDone ? 'bg-[--green] border-[--green]' : 'border-[--border-2] group-hover:border-[--muted]'}`}>
                          {isDone && <span className="text-white text-[9px]">✓</span>}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className={`text-xs font-medium mb-0.5 transition-colors ${isDone ? 'line-through text-[--hint]' : 'text-[--text]'}`}>
                            {task.stepTitle}
                          </div>
                          <div className={`text-[11px] leading-relaxed transition-colors ${isDone ? 'text-[--hint]' : 'text-[--muted]'}`}>
                            {task.text}
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <span className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotColors[recipeIdx % dotColors.length]}`} />
                            <span className="text-[10px] text-[--hint]">{task.recipeNames[0]}</span>
                            {task.duration > 0 && (
                              <span className="text-[10px] text-[--hint]">· {task.duration}min</span>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-[--border] bg-[--surface-2]">
          <p className="text-[10px] text-[--hint] text-center">
            Hover sidebar items and click the checkbox to add recipes to this list
          </p>
        </div>
      </div>
    </div>
  )
}
