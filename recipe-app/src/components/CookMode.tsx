'use client'
import { useState, useEffect, useCallback } from 'react'
import type { Recipe, Step, CookPhase } from '@/lib/types'

const PHASE_META: Record<CookPhase, { label: string; icon: string }> = {
  mise:  { label: 'Mise en Place', icon: '🔪' },
  cook:  { label: 'Cook',         icon: '🔥' },
  plate: { label: 'Plate & Finish', icon: '✨' },
}

function scaleAmt(amount: number, ratio: number): string {
  const v = amount * ratio
  if (v <= 0) return '—'
  if (v >= 10) return String(Math.round(v))
  const fracs: [number, string][] = [[.125,'⅛'],[.25,'¼'],[.333,'⅓'],[.5,'½'],[.667,'⅔'],[.75,'¾']]
  for (const [f, sym] of fracs) if (Math.abs(v - f) < 0.06) return sym
  const r = Math.round(v * 4) / 4
  return r === Math.floor(r) ? String(r) : r.toFixed(2).replace(/0+$/, '')
}

function formatTime(secs: number): string {
  const m = Math.floor(secs / 60), s = secs % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

interface Props {
  recipe: Recipe
  servings: number
  onClose: () => void
}

export default function CookMode({ recipe, servings, onClose }: Props) {
  const ratio = servings / recipe.base_servings
  const steps: Step[] = recipe.steps ?? []
  const [idx, setIdx] = useState(0)
  const [timeLeft, setTimeLeft] = useState<number | null>(null)
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(false)

  const current = steps[idx]
  const isLast = idx === steps.length - 1

  // Reset timer when step changes
  useEffect(() => {
    if (current?.duration > 0) {
      setTimeLeft(current.duration * 60)
      setRunning(false)
    } else {
      setTimeLeft(null)
      setRunning(false)
    }
  }, [idx, current?.duration])

  // Countdown
  useEffect(() => {
    if (!running || timeLeft === null || timeLeft <= 0) return
    const id = setInterval(() => setTimeLeft(t => (t !== null ? Math.max(0, t - 1) : null)), 1000)
    return () => clearInterval(id)
  }, [running, timeLeft])

  useEffect(() => {
    if (running && timeLeft === 0) setRunning(false)
  }, [running, timeLeft])

  const next = useCallback(() => {
    if (isLast) { setDone(true); return }
    setIdx(i => i + 1)
  }, [isLast])

  const prev = useCallback(() => {
    if (idx > 0) setIdx(i => i - 1)
  }, [idx])

  // Keyboard
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'Enter') next()
      if (e.key === 'ArrowLeft') prev()
      if (e.key === 'Escape') onClose()
      if (e.key === ' ') { e.preventDefault(); if (timeLeft !== null) setRunning(r => !r) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [next, prev, onClose, timeLeft])

  const phase = PHASE_META[current?.phase ?? 'cook']
  const timerPct = current?.duration > 0 && timeLeft !== null ? (timeLeft / (current.duration * 60)) * 100 : 100
  const timerDone = timeLeft === 0

  return (
    <div className="fixed inset-0 bg-[--text] z-50 flex flex-col slide-up">

      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-4">
        <div className="text-white/60 text-sm font-serif italic">{recipe.name}</div>
        <div className="flex items-center gap-3">
          <span className="text-white/40 text-xs">{idx + 1} / {steps.length}</span>
          <button onClick={onClose} className="text-white/50 hover:text-white transition-colors text-xl leading-none">✕</button>
        </div>
      </div>

      {/* Step indicators */}
      <div className="flex gap-1 px-6 mb-6">
        {steps.map((_, i) => (
          <div
            key={i}
            onClick={() => setIdx(i)}
            className={`h-0.5 flex-1 rounded-full cursor-pointer transition-all ${i < idx ? 'bg-white' : i === idx ? 'bg-[--accent]' : 'bg-white/20'}`}
          />
        ))}
      </div>

      {/* Done state */}
      {done ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
          <div className="text-6xl mb-4">🍽</div>
          <h2 className="font-serif text-3xl text-white font-medium mb-2">Ready to serve</h2>
          <p className="text-white/50 text-sm mb-8">Enjoy your {recipe.name}.</p>
          <button onClick={onClose} className="px-6 py-3 bg-[--accent] text-white rounded-xl font-medium hover:bg-[--accent-dark] transition-colors">
            Done
          </button>
        </div>
      ) : (
        <div className="flex-1 flex flex-col px-6 pb-6 overflow-hidden">

          {/* Phase badge */}
          <div className="flex items-center gap-2 mb-4">
            <span className="text-base">{phase.icon}</span>
            <span className="text-white/50 text-sm uppercase tracking-wider text-xs">{phase.label}</span>
          </div>

          {/* Step title */}
          <h2 className="font-serif text-3xl text-white font-medium mb-4 leading-snug">{current?.title}</h2>

          {/* Step description */}
          <p className="text-white/70 text-lg leading-relaxed flex-1 overflow-y-auto">
            {current?.description}
          </p>

          {/* Timer */}
          {timeLeft !== null && (
            <div className="my-6">
              <div className="h-1 bg-white/10 rounded-full overflow-hidden mb-4">
                <div
                  className="h-full bg-[--accent] rounded-full transition-all duration-1000"
                  style={{ width: `${timerPct}%` }}
                />
              </div>
              <div className="flex items-center justify-between">
                <div className={`font-mono text-5xl font-light ${timerDone ? 'text-[--accent] pulse-red' : 'text-white'}`}>
                  {timerDone ? '✓ Done' : formatTime(timeLeft)}
                </div>
                <button
                  onClick={() => {
                    if (timeLeft === 0) {
                      setTimeLeft(current.duration * 60)
                      setRunning(false)
                    } else {
                      setRunning(r => !r)
                    }
                  }}
                  className={`px-5 py-2.5 rounded-xl text-sm font-medium transition-colors ${running ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-[--accent] text-white hover:bg-[--accent-dark]'}`}
                >
                  {timerDone ? '↺ Reset' : running ? '⏸ Pause' : '▶ Start'}
                </button>
              </div>
            </div>
          )}

          {/* Relevant ingredients for this step */}
          {current && (() => {
            const desc = current.description.toLowerCase()
            const relevant = recipe.ingredients.filter(i => desc.includes(i.name.toLowerCase()))
            if (!relevant.length) return null
            return (
              <div className="mt-2 mb-4 flex flex-wrap gap-2">
                {relevant.map(i => (
                  <span key={i.id} className="text-xs text-white/60 bg-white/10 px-2.5 py-1 rounded-full">
                    {scaleAmt(i.amount, ratio)}{i.unit ? ` ${i.unit}` : ''} {i.name}
                  </span>
                ))}
              </div>
            )
          })()}

          {/* Navigation */}
          <div className="flex gap-3 mt-2">
            <button
              onClick={prev}
              disabled={idx === 0}
              className="flex-1 py-4 rounded-2xl border border-white/20 text-white text-sm font-medium hover:bg-white/10 transition-colors disabled:opacity-30"
            >
              ← Back
            </button>
            <button
              onClick={next}
              className="flex-[2] py-4 rounded-2xl bg-[--accent] text-white text-sm font-medium hover:bg-[--accent-dark] transition-colors"
            >
              {isLast ? 'Finish →' : 'Next →'}
            </button>
          </div>
          <p className="text-white/20 text-[10px] text-center mt-2">← → arrow keys · Space = timer</p>
        </div>
      )}
    </div>
  )
}
