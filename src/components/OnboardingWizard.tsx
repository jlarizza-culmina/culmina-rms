'use client'
import { useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase'
import type { AppUser, Restaurant, Location, DishMode } from '@/lib/types'

interface Props {
  user: User
  appUser: AppUser | null
  onComplete: (restaurant: Restaurant, location: Location) => void
}

type Step = 1 | 2 | 3 | 4

const CUISINE_TYPES = [
  'Italian', 'American', 'French', 'Japanese', 'Mexican',
  'Mediterranean', 'Modern European', 'Bar & Cocktails', 'Café', 'Other',
]

export default function OnboardingWizard({ user, appUser, onComplete }: Props) {
  const supabase = createClient()
  const [step,    setStep]    = useState<Step>(1)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')

  // Step 1 — Restaurant
  const [rName,        setRName]        = useState('')
  const [rDescription, setRDescription] = useState('')
  const [rCuisine,     setRCuisine]     = useState('Italian')

  // Step 2 — Location
  const [lName,    setLName]    = useState('Main')
  const [lAddress, setLAddress] = useState('')
  const [lCity,    setLCity]    = useState('')
  const [lState,   setLState]   = useState('')
  const [lZip,     setLZip]     = useState('')
  const [lTimezone,setLTimezone]= useState('America/New_York')

  // Step 3 — Dish mode
  const [dishMode, setDishMode] = useState<DishMode>('single')

  const TIMEZONES = [
    'America/New_York', 'America/Chicago', 'America/Denver',
    'America/Los_Angeles', 'America/Phoenix', 'Pacific/Honolulu',
    'Europe/London', 'Europe/Paris', 'Asia/Tokyo',
  ]

  async function handleComplete() {
    setSaving(true)
    setError('')
    try {
      const { data, error } = await supabase.rpc('create_restaurant_onboarding', {
        p_name:        rName.trim(),
        p_description: rDescription.trim(),
        p_cuisine:     rCuisine,
        p_dish_mode:   dishMode,
        p_loc_name:    lName.trim() || 'Main',
        p_address:     lAddress.trim(),
        p_city:        lCity.trim(),
        p_state:       lState.trim(),
        p_zip:         lZip.trim(),
        p_timezone:    lTimezone,
      })
      if (error) throw new Error(error.message)
      onComplete(data.restaurant as Restaurant, data.location as Location)
    } catch (e) {
      setError(String(e))
      setSaving(false)
    }
  }

  const canNext1 = rName.trim().length >= 2
  const canNext2 = lCity.trim().length >= 1

  const STEP_LABELS = ['Restaurant', 'Location', 'Setup', 'Done']

  return (
    <div className="min-h-screen bg-[--bg] flex items-center justify-center p-6">
      <div className="w-full max-w-lg">

        {/* Header */}
        <div className="text-center mb-8">
          <div className="text-4xl mb-3">🍳</div>
          <h1 className="font-serif text-2xl font-medium text-[--text] mb-1">
            Welcome to CulminaRMS
          </h1>
          <p className="text-sm text-[--muted]">
            Let&apos;s set up your restaurant. Takes about 2 minutes.
          </p>
        </div>

        {/* Progress */}
        <div className="flex items-center gap-2 mb-8">
          {([1,2,3,4] as Step[]).map((s, i) => (
            <div key={s} className="flex items-center flex-1">
              <div className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-medium flex-shrink-0 transition-colors
                ${step > s ? 'bg-[--green] text-white' : step === s ? 'bg-[--accent] text-white' : 'bg-[--surface-2] text-[--hint]'}`}>
                {step > s ? '✓' : s}
              </div>
              {i < 3 && <div className={`flex-1 h-0.5 mx-1 rounded ${step > s ? 'bg-[--green]' : 'bg-[--border]'}`} />}
            </div>
          ))}
        </div>
        <div className="flex justify-between mb-6 px-0.5">
          {STEP_LABELS.map((l, i) => (
            <span key={l} className={`text-[10px] flex-1 text-center ${step === i + 1 ? 'text-[--accent] font-medium' : 'text-[--hint]'}`}>
              {l}
            </span>
          ))}
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl border border-[--border] p-6 shadow-sm">

          {/* Step 1 — Restaurant basics */}
          {step === 1 && (
            <div className="space-y-4">
              <h2 className="font-serif text-lg font-medium text-[--text]">Your restaurant</h2>
              <div>
                <label className="block text-[11px] font-medium text-[--muted] mb-1.5">Restaurant name *</label>
                <input
                  value={rName}
                  onChange={e => setRName(e.target.value)}
                  placeholder="e.g. Corretto, Trattoria Roma, Bar Stella"
                  className="w-full px-3 py-2.5 text-sm border border-[--border-2] rounded-lg outline-none focus:border-[--accent]"
                  autoFocus
                  onKeyDown={e => e.key === 'Enter' && canNext1 && setStep(2)}
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-[--muted] mb-1.5">Cuisine type</label>
                <select
                  value={rCuisine}
                  onChange={e => setRCuisine(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm border border-[--border-2] rounded-lg outline-none focus:border-[--accent] bg-white"
                >
                  {CUISINE_TYPES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-[--muted] mb-1.5">Description <span className="text-[--hint]">(optional)</span></label>
                <textarea
                  value={rDescription}
                  onChange={e => setRDescription(e.target.value)}
                  placeholder="A brief description of your concept…"
                  rows={2}
                  className="w-full px-3 py-2.5 text-sm border border-[--border-2] rounded-lg outline-none focus:border-[--accent] resize-none"
                />
              </div>
            </div>
          )}

          {/* Step 2 — Location */}
          {step === 2 && (
            <div className="space-y-4">
              <h2 className="font-serif text-lg font-medium text-[--text]">Your location</h2>
              <p className="text-xs text-[--muted]">You can add more locations later in Settings.</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-[11px] font-medium text-[--muted] mb-1.5">Location name</label>
                  <input
                    value={lName}
                    onChange={e => setLName(e.target.value)}
                    placeholder="Main, Darien, Upstairs…"
                    className="w-full px-3 py-2.5 text-sm border border-[--border-2] rounded-lg outline-none focus:border-[--accent]"
                    autoFocus
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-[11px] font-medium text-[--muted] mb-1.5">Street address</label>
                  <input
                    value={lAddress}
                    onChange={e => setLAddress(e.target.value)}
                    placeholder="1 Station Place"
                    className="w-full px-3 py-2.5 text-sm border border-[--border-2] rounded-lg outline-none focus:border-[--accent]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-[--muted] mb-1.5">City *</label>
                  <input
                    value={lCity}
                    onChange={e => setLCity(e.target.value)}
                    placeholder="Darien"
                    className="w-full px-3 py-2.5 text-sm border border-[--border-2] rounded-lg outline-none focus:border-[--accent]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-[--muted] mb-1.5">State</label>
                  <input
                    value={lState}
                    onChange={e => setLState(e.target.value)}
                    placeholder="CT"
                    maxLength={2}
                    className="w-full px-3 py-2.5 text-sm border border-[--border-2] rounded-lg outline-none focus:border-[--accent]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-[--muted] mb-1.5">ZIP</label>
                  <input
                    value={lZip}
                    onChange={e => setLZip(e.target.value)}
                    placeholder="06820"
                    className="w-full px-3 py-2.5 text-sm border border-[--border-2] rounded-lg outline-none focus:border-[--accent]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-[--muted] mb-1.5">Timezone</label>
                  <select
                    value={lTimezone}
                    onChange={e => setLTimezone(e.target.value)}
                    className="w-full px-3 py-2.5 text-sm border border-[--border-2] rounded-lg outline-none focus:border-[--accent] bg-white"
                  >
                    {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz.replace('_', ' ')}</option>)}
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* Step 3 — Dish mode */}
          {step === 3 && (
            <div className="space-y-4">
              <h2 className="font-serif text-lg font-medium text-[--text]">How are your dishes structured?</h2>
              <p className="text-xs text-[--muted]">
                This controls how recipes and dishes work in Culmina. You can change this later in Settings.
              </p>
              <div className="space-y-3">
                <button
                  onClick={() => setDishMode('single')}
                  className={`w-full text-left p-4 rounded-xl border-2 transition-all ${dishMode === 'single' ? 'border-[--accent] bg-[--accent-light]' : 'border-[--border] hover:border-[--border-2]'}`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 mt-0.5 flex items-center justify-center ${dishMode === 'single' ? 'border-[--accent]' : 'border-[--border-2]'}`}>
                      {dishMode === 'single' && <div className="w-2 h-2 rounded-full bg-[--accent]" />}
                    </div>
                    <div>
                      <div className="text-sm font-medium text-[--text] mb-1">Single recipe per dish</div>
                      <div className="text-xs text-[--muted]">Each menu item is one recipe. Best for pasta bars, cafés, and focused menus. This is the default and recommended starting point.</div>
                    </div>
                  </div>
                </button>
                <button
                  onClick={() => setDishMode('composed')}
                  className={`w-full text-left p-4 rounded-xl border-2 transition-all ${dishMode === 'composed' ? 'border-[--accent] bg-[--accent-light]' : 'border-[--border] hover:border-[--border-2]'}`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 mt-0.5 flex items-center justify-center ${dishMode === 'composed' ? 'border-[--accent]' : 'border-[--border-2]'}`}>
                      {dishMode === 'composed' && <div className="w-2 h-2 rounded-full bg-[--accent]" />}
                    </div>
                    <div>
                      <div className="text-sm font-medium text-[--text] mb-1">Composed dishes (multiple recipes per dish)</div>
                      <div className="text-xs text-[--muted]">A dish is built from multiple component recipes — protein, sides, sauces. Best for full-service restaurants where each plate combines several preparations.</div>
                    </div>
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* Step 4 — Done */}
          {step === 4 && (
            <div className="text-center py-4 space-y-4">
              <div className="text-5xl">🎉</div>
              <h2 className="font-serif text-xl font-medium text-[--text]">You&apos;re all set</h2>
              <p className="text-sm text-[--muted]">
                <strong>{rName}</strong> is ready. Your existing recipes have been migrated automatically.
              </p>
              <div className="bg-[--surface-2] rounded-xl p-4 text-left text-xs text-[--muted] space-y-1.5">
                <div>✓ Restaurant created</div>
                <div>✓ Location: {lCity || lName}</div>
                <div>✓ Mode: {dishMode === 'single' ? 'Single recipe per dish' : 'Composed dishes'}</div>
                <div>✓ Existing recipes migrated</div>
              </div>
            </div>
          )}

          {error && (
            <div className="mt-4 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
          )}
        </div>

        {/* Navigation */}
        <div className="flex gap-3 mt-4">
          {step > 1 && step < 4 && (
            <button
              onClick={() => setStep(s => (s - 1) as Step)}
              className="px-4 py-2.5 text-sm border border-[--border-2] rounded-xl text-[--muted] hover:bg-[--surface-2] transition-colors"
            >
              ← Back
            </button>
          )}
          <div className="flex-1" />
          {step < 3 && (
            <button
              onClick={() => setStep(s => (s + 1) as Step)}
              disabled={step === 1 ? !canNext1 : !canNext2}
              className="px-6 py-2.5 text-sm font-medium bg-[--accent] text-white rounded-xl hover:bg-[--accent-dark] disabled:opacity-40 transition-colors"
            >
              Continue →
            </button>
          )}
          {step === 3 && (
            <button
              onClick={async () => { setStep(4); await handleComplete() }}
              disabled={saving}
              className="px-6 py-2.5 text-sm font-medium bg-[--accent] text-white rounded-xl hover:bg-[--accent-dark] disabled:opacity-50 flex items-center gap-2 transition-colors"
            >
              {saving ? <><span className="spinner" />Setting up…</> : 'Finish setup →'}
            </button>
          )}
          {step === 4 && (
            <button
              onClick={() => onComplete(
                { id: '', name: rName, description: rDescription, cuisine_type: rCuisine, dish_mode: dishMode, branding: {}, settings: {}, is_active: true },
                { id: '', restaurant_id: '', name: lName, address: lAddress, city: lCity, state: lState, zip: lZip, country: 'US', timezone: lTimezone, phone: '', email: '', is_primary: true, is_active: true }
              )}
              disabled={saving}
              className="px-6 py-2.5 text-sm font-medium bg-[--accent] text-white rounded-xl hover:bg-[--accent-dark] transition-colors"
            >
              Open CulminaRMS →
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
