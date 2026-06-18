'use client'
import { useEffect, useState, useRef } from 'react'
import { useParams } from 'next/navigation'

interface LocationInfo {
  restaurant: { id: string; name: string; branding: Record<string, string> }
  location: { id: string; name: string; city: string; state: string }
  settings: { welcome_message: string; confirmation_msg: string; max_party_size: number; is_active: boolean; tos_text: string; tos_url: string }
  otherLocations: { id: string; name: string; city: string }[]
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

export default function JoinPage() {
  const params = useParams()
  const locationId = params?.locationId as string

  const [info,       setInfo]       = useState<LocationInfo | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [submitted,  setSubmitted]  = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error,      setError]      = useState('')
  const [result,     setResult]     = useState<{ position: number; total: number } | null>(null)
  const [showTos,    setShowTos]    = useState(false)
  const [returning,  setReturning]  = useState(false)

  // Form
  const [phone,      setPhone]      = useState('')
  const [firstName,  setFirstName]  = useState('')
  const [lastName,   setLastName]   = useState('')
  const [partySize,  setPartySize]  = useState(2)
  const [email,      setEmail]      = useState('')
  const [bdMonth,    setBdMonth]    = useState('')
  const [bdDay,      setBdDay]      = useState('')
  const [smsOptIn,   setSmsOptIn]   = useState(true)
  const [emailOptIn, setEmailOptIn] = useState(false)
  const [prefLoc,    setPrefLoc]    = useState(locationId)
  const [tosAgreed,  setTosAgreed]  = useState(true)
  const [marketingOptIn, setMarketingOptIn] = useState(false)  // optional, opt-in (TCPA)
  const [lookingUp,  setLookingUp]  = useState(false)

  const phoneRef = useRef<HTMLInputElement>(null)

  // Arrival picker
  const [step,          setStep]         = useState<'arrival-mode'|'arrival-time'|'form'>('arrival-mode')
  const [arrivalMode,   setArrivalMode]  = useState<'outbound'|'inbound'|'other'|null>(null)
  const [trains,        setTrains]       = useState<any[]>([])
  const [trainsLoading, setTrainsLoading]= useState(false)
  const [selectedTrain, setSelectedTrain]= useState<any|null>(null)
  const [walkMinutes,   setWalkMinutes]  = useState(5)

  async function loadTrains(dir: 'outbound'|'inbound') {
    setTrainsLoading(true)
    try {
      const res  = await fetch('/api/mta/arrivals')
      const data = await res.json()
      setTrains((data.trains ?? []).filter((t: any) => t.direction === dir).slice(0, 10))
    } catch { setTrains([]) }
    setTrainsLoading(false)
  }

  function pickMode(mode: 'outbound'|'inbound'|'other') {
    setArrivalMode(mode)
    setSelectedTrain(null)
    if (mode === 'other') { setStep('form') }
    else { loadTrains(mode); setStep('arrival-time') }
  }

  function pickTrain(train: any) {
    setSelectedTrain(train)
    setStep('form')
  }

  function arrivalSummary(): string {
    if (arrivalMode === 'other') return `🚶 ~${walkMinutes} min away`
    if (selectedTrain) {
      const dir = selectedTrain.direction === 'inbound' ? '→ Grand Central' : '→ New Haven'
      return `🚆 ${formatArrTime(selectedTrain.arrivalTime)} ${dir} (${selectedTrain.minsAway} min)`
    }
    return ''
  }

  function computedArrivalTime(): number | null {
    if (arrivalMode === 'other') return Math.floor(Date.now()/1000) + walkMinutes * 60
    if (selectedTrain) return selectedTrain.arrivalTime
    return null
  }

  function formatArrTime(unixSec: number): string {
    const d = new Date(unixSec * 1000)
    const h = d.getHours() % 12 || 12
    const m = String(d.getMinutes()).padStart(2,'0')
    return `${h}:${m} ${d.getHours()>=12?'PM':'AM'}`
  }

  useEffect(() => {
    fetch(`/api/location-info/${locationId}`)
      .then(r => r.json())
      .then(d => {
        setInfo(d)
        setLoading(false)
        // Pre-fill from localStorage
        const saved = localStorage.getItem(`culmina_guest_${d.restaurant?.id}`)
        if (saved) {
          try {
            const g = JSON.parse(saved)
            setPhone(g.phone ?? '')
            setFirstName(g.firstName ?? '')
            setLastName(g.lastName ?? '')
            setEmail(g.email ?? '')
            setBdMonth(g.bdMonth ?? '')
            setBdDay(g.bdDay ?? '')
            setSmsOptIn(g.smsOptIn ?? true)
            setEmailOptIn(g.emailOptIn ?? false)
            if (g.phone) setReturning(true)
          } catch {}
        }
      })
      .catch(() => { setError('Unable to load.'); setLoading(false) })
  }, [locationId])

  async function lookupPhone(p: string) {
    if (!p.trim() || !info?.restaurant?.id) return
    setLookingUp(true)
    try {
      const res = await fetch('/api/waitlist/guest-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: p.trim(), restaurantId: info.restaurant.id }),
      })
      const { guest } = await res.json()
      if (guest) {
        setFirstName(guest.first_name ?? '')
        setLastName(guest.last_name ?? '')
        setEmail(guest.email ?? '')
        setBdMonth(guest.birthday_month ? String(guest.birthday_month) : '')
        setBdDay(guest.birthday_day ? String(guest.birthday_day) : '')
        setSmsOptIn(guest.sms_opt_in ?? true)
        setEmailOptIn(guest.email_opt_in ?? false)
        if (guest.preferred_location_id) setPrefLoc(guest.preferred_location_id)
        setReturning(true)
      }
    } finally {
      setLookingUp(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!firstName.trim() || !phone.trim() || !tosAgreed) return
    setSubmitting(true); setError('')
    try {
      const res = await fetch('/api/waitlist/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          firstName: firstName.trim(), lastName: lastName.trim(),
          phone: phone.trim(), partySize,
          email: email.trim(),
          birthdayMonth: bdMonth ? parseInt(bdMonth) : null,
          birthdayDay:   bdDay   ? parseInt(bdDay)   : null,
          smsOptIn, emailOptIn,
          marketing_opt_in: marketingOptIn,
          preferredLocationId: prefLoc || locationId,
          arrivalMode:         arrivalMode ?? 'other',
          estimatedArrivalAt:  computedArrivalTime(),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Something went wrong')
      // Save to localStorage
      if (info?.restaurant?.id) {
        localStorage.setItem(`culmina_guest_${info.restaurant.id}`, JSON.stringify({
          phone: phone.trim(), firstName: firstName.trim(), lastName: lastName.trim(),
          email: email.trim(), bdMonth, bdDay, smsOptIn, emailOptIn,
        }))
      }
      setResult({ position: data.position, total: data.total })
      setSubmitted(true)
    } catch (err) {
      setError(String(err).replace('Error: ', ''))
    } finally {
      setSubmitting(false)
    }
  }

  const accent = info?.restaurant?.branding?.primaryColor ?? '#C05A2A'
  const hasTos = !!(info?.settings?.tos_text || info?.settings?.tos_url)
  const smsNumber  = process.env.NEXT_PUBLIC_TWILIO_PHONE_NUMBER || '(our SMS number)'
  const privacyUrl = process.env.NEXT_PUBLIC_PRIVACY_URL || 'https://correttoristoro.com/privacy'

  if (loading) return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#F8F5F0' }}>
      <div style={{ width:24, height:24, borderRadius:'50%', border:`3px solid ${accent}20`, borderTopColor:accent, animation:'spin .8s linear infinite' }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )

  if (!info?.settings?.is_active) return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#F8F5F0', padding:24 }}>
      <div style={{ textAlign:'center' }}>
        <div style={{ fontSize:40, marginBottom:12 }}>⏸</div>
        <p style={{ fontFamily:'Georgia,serif', fontSize:20, marginBottom:8 }}>Waitlist is closed</p>
        <p style={{ color:'#7A7568', fontSize:14 }}>Please ask a staff member to join.</p>
      </div>
    </div>
  )

  return (
    <div style={{ minHeight:'100vh', background:'#F8F5F0', fontFamily:'system-ui,sans-serif', overflowY:'auto' }}>
      <style>{`
        *{box-sizing:border-box;margin:0;padding:0}
        input,select,textarea{font-family:inherit}
        .field{width:100%;padding:12px 14px;font-size:16px;border:1.5px solid #E3DDD5;border-radius:10px;background:white;outline:none;transition:border-color .15s}
        .field:focus{border-color:${accent}}
        .btn{width:100%;padding:14px;font-size:15px;font-weight:600;color:white;border:none;border-radius:12px;cursor:pointer;transition:opacity .15s}
        .btn:disabled{opacity:.5}
        @keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
        .fade{animation:fadeUp .4s ease both}
      `}</style>

      <div style={{ maxWidth:460, margin:'0 auto', padding:'0 20px 40px', boxSizing:'border-box', width:'100%' }}>

        {/* Header */}
        <div style={{ textAlign:'center', padding:'40px 0 28px' }}>
          {info?.restaurant?.branding?.logoUrl ? (
            <img src={info.restaurant.branding.logoUrl} alt="" style={{ height:56, marginBottom:12 }} />
          ) : (
            <div style={{ width:52, height:52, borderRadius:14, background:accent, display:'flex', alignItems:'center', justifyContent:'center', fontSize:22, fontWeight:700, color:'white', margin:'0 auto 12px', fontFamily:'Georgia,serif' }}>
              {info?.restaurant?.name?.charAt(0)}
            </div>
          )}
          <h1 style={{ fontFamily:'Georgia,serif', fontSize:26, fontWeight:500, color:'#201C18', marginBottom:4 }}>
            {info?.restaurant?.name}
          </h1>
          <p style={{ color:'#7A7568', fontSize:14 }}>
            {info?.location?.name}{info?.location?.city ? ` · ${info.location.city}` : ''}
          </p>
          {info?.settings?.welcome_message && (
            <p style={{ marginTop:10, color:'#7A7568', fontSize:13, fontStyle:'italic' }}>{info.settings.welcome_message}</p>
          )}
        </div>

        {submitted && result ? (
          <div className="fade" style={{ background:'white', borderRadius:20, padding:28, textAlign:'center', boxShadow:'0 2px 16px rgba(0,0,0,.06)' }}>
            <div style={{ fontSize:48, marginBottom:16 }}>🎉</div>
            <h2 style={{ fontFamily:'Georgia,serif', fontSize:22, color:'#201C18', marginBottom:8 }}>You're on the list!</h2>
            <div style={{ background:`${accent}12`, border:`1px solid ${accent}30`, borderRadius:12, padding:'14px 20px', margin:'16px 0' }}>
              <div style={{ fontSize:36, fontWeight:700, color:accent, fontFamily:'Georgia,serif' }}>#{result.position}</div>
              <div style={{ color:'#7A7568', fontSize:13, marginTop:2 }}>
                {result.total > 1 ? `of ${result.total} parties waiting` : 'party in line'}
              </div>
            </div>
            {arrivalSummary() && (
              <div style={{ background:'#F8F5F0', borderRadius:10, padding:'10px 14px', marginBottom:12, fontSize:13, color:'#7A7568' }}>
                {arrivalSummary()}
              </div>
            )}
            <p style={{ color:'#7A7568', fontSize:14, lineHeight:1.6 }}>
              {info?.settings?.confirmation_msg || "We'll text you when your table is ready."}
            </p>
            <p style={{ marginTop:12, color:'#B0AB9E', fontSize:12 }}>Confirmed to {phone}</p>
          </div>

        ) : step === 'arrival-mode' ? (
          /* ── Step 1: How are you arriving? ── */
          <div className="fade" style={{ background:'white', borderRadius:20, padding:24, boxShadow:'0 2px 16px rgba(0,0,0,.06)' }}>
            <h2 style={{ fontFamily:'Georgia,serif', fontSize:20, color:'#201C18', marginBottom:6 }}>
              How are you getting here?
            </h2>
            <p style={{ color:'#B0AB9E', fontSize:13, marginBottom:20 }}>
              So we can time your table perfectly.
            </p>
            <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
              {[
                { key:'outbound', icon:'🚆', title:'New Haven Line', sub:'Heading toward Connecticut', badge:'→ New Haven' },
                { key:'inbound',  icon:'🚆', title:'New Haven Line', sub:'Heading to the city', badge:'→ Grand Central' },
                { key:'other',    icon:'🚗', title:'By foot, wheel, or sheer willpower', sub:'Walking, driving, biking, etc.', badge:null },
              ].map(opt => (
                <button key={opt.key} type="button" onClick={() => pickMode(opt.key as any)}
                  style={{ display:'flex', alignItems:'center', gap:14, padding:'14px 16px', borderRadius:14, border:`2px solid #E3DDD5`, background:'white', cursor:'pointer', textAlign:'left', transition:'all .15s' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = accent; (e.currentTarget as HTMLButtonElement).style.background = `${accent}08` }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#E3DDD5'; (e.currentTarget as HTMLButtonElement).style.background = 'white' }}>
                  <span style={{ fontSize:28, flexShrink:0 }}>{opt.icon}</span>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:15, fontWeight:600, color:'#201C18' }}>{opt.title}</div>
                    <div style={{ fontSize:12, color:'#7A7568', marginTop:2 }}>{opt.sub}</div>
                  </div>
                  {opt.badge && (
                    <span style={{ fontSize:11, fontWeight:600, color:accent, background:`${accent}15`, padding:'3px 8px', borderRadius:20, flexShrink:0 }}>
                      {opt.badge}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

        ) : step === 'arrival-time' && arrivalMode !== 'other' ? (
          /* ── Step 2: Pick your train ── */
          <div className="fade" style={{ background:'white', borderRadius:20, padding:24, boxShadow:'0 2px 16px rgba(0,0,0,.06)' }}>
            <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:20 }}>
              <button type="button" onClick={() => setStep('arrival-mode')}
                style={{ background:'none', border:'none', cursor:'pointer', color:'#B0AB9E', fontSize:20, padding:0, lineHeight:1 }}>←</button>
              <div>
                <h2 style={{ fontFamily:'Georgia,serif', fontSize:20, color:'#201C18' }}>Pick your train</h2>
                <p style={{ color:'#B0AB9E', fontSize:12, marginTop:2 }}>
                  {arrivalMode === 'inbound' ? '→ Grand Central' : '→ New Haven'} · next arrivals at Darien
                </p>
              </div>
            </div>
            {trainsLoading ? (
              <div style={{ textAlign:'center', padding:'32px 0', color:'#B0AB9E', fontSize:13 }}>
                <div style={{ width:20, height:20, borderRadius:'50%', border:`2px solid ${accent}30`, borderTopColor:accent, animation:'spin .7s linear infinite', margin:'0 auto 10px' }} />
                Loading train times…
              </div>
            ) : trains.length === 0 ? (
              <div style={{ textAlign:'center', padding:'24px 0' }}>
                <div style={{ fontSize:32, marginBottom:8 }}>🔍</div>
                <p style={{ color:'#7A7568', fontSize:13 }}>No trains found right now.</p>
                <button type="button" onClick={() => loadTrains(arrivalMode!)}
                  style={{ marginTop:12, color:accent, background:'none', border:'none', cursor:'pointer', fontSize:13, textDecoration:'underline' }}>
                  Try again
                </button>
              </div>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                {trains.map((t: any, i: number) => (
                  <button key={i} type="button" onClick={() => pickTrain(t)}
                    style={{ display:'flex', alignItems:'center', gap:12, padding:'14px 16px', borderRadius:14,
                      border:`2px solid ${selectedTrain===t ? accent : '#E3DDD5'}`,
                      background: selectedTrain===t ? `${accent}10` : 'white',
                      cursor:'pointer', transition:'all .15s' }}
                    onMouseEnter={e => { if(selectedTrain!==t)(e.currentTarget as HTMLButtonElement).style.borderColor=accent }}
                    onMouseLeave={e => { if(selectedTrain!==t)(e.currentTarget as HTMLButtonElement).style.borderColor='#E3DDD5' }}>
                    <div style={{ width:48, height:48, borderRadius:12, background:t.minsAway<=2?'#FEF2F2':t.minsAway<=5?'#FFFBEB':'#F8F5F0', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                      <span style={{ fontSize:17, fontWeight:700, color:t.minsAway<=2?'#DC2626':t.minsAway<=5?'#D97706':accent, lineHeight:1 }}>
                        {t.minsAway <= 0 ? 'NOW' : t.minsAway}
                      </span>
                      {t.minsAway > 0 && <span style={{ fontSize:9, color:'#B0AB9E', marginTop:1 }}>min</span>}
                    </div>
                    <div style={{ flex:1, textAlign:'left' }}>
                      <div style={{ fontSize:16, fontWeight:600, color:'#201C18' }}>{formatArrTime(t.arrivalTime)}</div>
                      <div style={{ fontSize:12, color:'#7A7568', marginTop:1 }}>
                        {arrivalMode === 'inbound' ? '→ Grand Central' : '→ New Haven'}
                      </div>
                    </div>
                    <span style={{ fontSize:18 }}>🚆</span>
                  </button>
                ))}
              </div>
            )}
          </div>

        ) : (
          /* ── Step 3: Minute picker (non-train) + Main form ── */
          <form onSubmit={handleSubmit} className="fade" style={{ background:'white', borderRadius:20, padding:24, boxShadow:'0 2px 16px rgba(0,0,0,.06)' }}>
            <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:20 }}>
              <button type="button" onClick={() => setStep('arrival-mode')}
                style={{ background:'none', border:'none', cursor:'pointer', color:'#B0AB9E', fontSize:20, padding:0, lineHeight:1 }}>←</button>
              <h2 style={{ fontFamily:'Georgia,serif', fontSize:18, color:'#201C18' }}>
                {returning ? `Welcome back! 👋` : step === 'form' && arrivalMode === 'other' ? "How far out are you? 🚶" : 'Join the waitlist'}
              </h2>
            </div>

            {/* Arrival summary chip or minute picker */}
            {arrivalMode === 'other' ? (
              <div style={{ marginBottom:20 }}>
                <div style={{ background:'#F8F5F0', borderRadius:14, padding:16, marginBottom:10 }}>
                  <div style={{ fontSize:13, color:'#7A7568', marginBottom:12, textAlign:'center' }}>
                    Minutes until you arrive
                  </div>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:20 }}>
                    <button type="button" onClick={() => setWalkMinutes(m => Math.max(1, m-1))}
                      style={{ width:40, height:40, borderRadius:'50%', border:`2px solid #E3DDD5`, background:'white', fontSize:22, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:'#7A7568' }}>−</button>
                    <div style={{ textAlign:'center', minWidth:60 }}>
                      <div style={{ fontSize:48, fontWeight:700, color:accent, fontFamily:'Georgia,serif', lineHeight:1 }}>{walkMinutes}</div>
                      <div style={{ fontSize:11, color:'#B0AB9E', marginTop:2 }}>min</div>
                    </div>
                    <button type="button" onClick={() => setWalkMinutes(m => Math.min(10, m+1))}
                      style={{ width:40, height:40, borderRadius:'50%', border:`2px solid #E3DDD5`, background:'white', fontSize:22, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:'#7A7568' }}>+</button>
                  </div>
                  <div style={{ display:'flex', justifyContent:'space-between', marginTop:12 }}>
                    {[1,2,3,5,7,10].map(n => (
                      <button key={n} type="button" onClick={() => setWalkMinutes(n)}
                        style={{ padding:'4px 10px', borderRadius:20, border:`1.5px solid ${walkMinutes===n?accent:'#E3DDD5'}`, background:walkMinutes===n?`${accent}12`:'white', color:walkMinutes===n?accent:'#7A7568', fontSize:12, cursor:'pointer' }}>
                        {n}m
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ background:`${accent}10`, borderRadius:10, padding:'8px 12px', fontSize:12, color:accent }}>
                  ⓘ Tables can only be requested up to 10 minutes in advance without a train reservation.
                </div>
              </div>
            ) : selectedTrain ? (
              <div style={{ display:'flex', alignItems:'center', gap:10, background:'#F0FDF4', border:'1.5px solid #BBF7D0', borderRadius:12, padding:'10px 14px', marginBottom:16 }}>
                <span style={{ fontSize:20 }}>🚆</span>
                <div>
                  <div style={{ fontSize:13, fontWeight:600, color:'#166534' }}>{formatArrTime(selectedTrain.arrivalTime)} · {selectedTrain.minsAway} min</div>
                  <div style={{ fontSize:11, color:'#166534', opacity:.7 }}>{arrivalMode === 'inbound' ? '→ Grand Central' : '→ New Haven'}</div>
                </div>
                <button type="button" onClick={() => setStep('arrival-time')}
                  style={{ marginLeft:'auto', fontSize:11, color:'#166534', background:'none', border:'none', cursor:'pointer', textDecoration:'underline' }}>
                  Change
                </button>
              </div>
            ) : null}

            <h2 style={{ fontFamily:'Georgia,serif', fontSize:16, color:'#201C18', marginBottom:16 }}>
              Your details
            </h2>

            {/* ── Phone first ── */}
            <div style={{ marginBottom:12 }}>
              <label style={{ display:'block', fontSize:11, fontWeight:600, textTransform:'uppercase', letterSpacing:'.06em', color:'#B0AB9E', marginBottom:6 }}>Mobile number *</label>
              <input ref={phoneRef} type="tel" value={phone}
                onChange={e => { setPhone(e.target.value); setReturning(false) }}
                onBlur={e => lookupPhone(e.target.value)}
                placeholder="(203) 555-0100" required className="field"
                style={{ fontSize:18, letterSpacing:'.02em' }} />
              <p style={{ fontSize:11, color:'#B0AB9E', marginTop:5 }}>
                {lookingUp ? '🔍 Looking up your profile…' : returning ? `✓ Welcome back! Your info is pre-filled.` : "We'll text you when your table is ready"}
              </p>
            </div>

            {/* ── Name row ── */}
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:12 }}>
              <div>
                <label style={{ display:'block', fontSize:11, fontWeight:600, textTransform:'uppercase', letterSpacing:'.06em', color:'#B0AB9E', marginBottom:6 }}>First name *</label>
                <input value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="Joe" required className="field" />
              </div>
              <div>
                <label style={{ display:'block', fontSize:11, fontWeight:600, textTransform:'uppercase', letterSpacing:'.06em', color:'#B0AB9E', marginBottom:6 }}>Last name</label>
                <input value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Smith" className="field" />
              </div>
            </div>

            {/* ── Party size ── */}
            <div style={{ marginBottom:16 }}>
              <label style={{ display:'block', fontSize:11, fontWeight:600, textTransform:'uppercase', letterSpacing:'.06em', color:'#B0AB9E', marginBottom:6 }}>Party size *</label>
              <div style={{ display:'flex', gap:8 }}>
                {Array.from({ length: Math.min(info?.settings?.max_party_size ?? 10, 8) }, (_,i) => i+1).map(n => (
                  <button key={n} type="button" onClick={() => setPartySize(n)}
                    style={{ flex:1, padding:'10px 0', fontSize:15, fontWeight:600, borderRadius:10, border:`2px solid ${partySize===n?accent:'#E3DDD5'}`, background:partySize===n?`${accent}12`:'white', color:partySize===n?accent:'#7A7568', cursor:'pointer', transition:'all .15s' }}>
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Loyalty — always visible ── */}
            <div style={{ background:'#F8F5F0', borderRadius:12, padding:16, marginBottom:16 }}>
              <div style={{ fontSize:12, fontWeight:600, color:'#7A7568', marginBottom:12 }}>
                🎁 Loyalty & rewards
              </div>

              <div style={{ marginBottom:12 }}>
                <label style={{ display:'block', fontSize:11, fontWeight:600, textTransform:'uppercase', letterSpacing:'.06em', color:'#B0AB9E', marginBottom:6 }}>Email</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="joe@example.com" className="field" />
              </div>

              <div style={{ marginBottom:12 }}>
                <label style={{ display:'block', fontSize:11, fontWeight:600, textTransform:'uppercase', letterSpacing:'.06em', color:'#B0AB9E', marginBottom:6 }}>Birthday 🎂</label>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                  <select value={bdMonth} onChange={e => setBdMonth(e.target.value)} className="field">
                    <option value="">Month</option>
                    {MONTHS.map((m,i) => <option key={i+1} value={i+1}>{m}</option>)}
                  </select>
                  <select value={bdDay} onChange={e => setBdDay(e.target.value)} className="field">
                    <option value="">Day</option>
                    {Array.from({length:31},(_,i)=>i+1).map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
              </div>

              {info?.otherLocations && info.otherLocations.length > 0 && (
                <div style={{ marginBottom:12 }}>
                  <label style={{ display:'block', fontSize:11, fontWeight:600, textTransform:'uppercase', letterSpacing:'.06em', color:'#B0AB9E', marginBottom:6 }}>Preferred location</label>
                  <select value={prefLoc} onChange={e => setPrefLoc(e.target.value)} className="field">
                    <option value={locationId}>{info.location.name} (here)</option>
                    {info.otherLocations.map(l => <option key={l.id} value={l.id}>{l.name}{l.city?` — ${l.city}`:''}</option>)}
                  </select>
                </div>
              )}

              <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                {[
                  { checked:smsOptIn, onChange:setSmsOptIn, label:'Text me about specials & events', note:'Msg & data rates may apply. Reply STOP to opt out.' },
                  { checked:emailOptIn, onChange:setEmailOptIn, label:'Email me about specials & events' },
                ].map((opt,i) => (
                  <label key={i} style={{ display:'flex', alignItems:'flex-start', gap:10, cursor:'pointer' }}>
                    <input type="checkbox" checked={opt.checked} onChange={e => opt.onChange(e.target.checked)}
                      style={{ marginTop:2, accentColor:accent, width:16, height:16 }} />
                    <div>
                      <div style={{ fontSize:13, color:'#201C18' }}>{opt.label}</div>
                      {opt.note && <div style={{ fontSize:11, color:'#B0AB9E', marginTop:2 }}>{opt.note}</div>}
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* ── ToS checkbox ── */}
            {hasTos && (
              <div style={{ marginBottom:16 }}>
                <label style={{ display:'flex', alignItems:'flex-start', gap:10, cursor:'pointer' }}>
                  <input type="checkbox" checked={tosAgreed} onChange={e => setTosAgreed(e.target.checked)}
                    style={{ marginTop:3, accentColor:accent, width:16, height:16 }} />
                  <div style={{ fontSize:12, color:'#7A7568', lineHeight:1.5 }}>
                    I agree to the{' '}
                    {info.settings.tos_url ? (
                      <a href={info.settings.tos_url} target="_blank" rel="noopener noreferrer"
                        style={{ color:accent, textDecoration:'underline' }}>
                        Waitlist Terms of Service
                      </a>
                    ) : (
                      <button type="button" onClick={() => setShowTos(s => !s)}
                        style={{ color:accent, textDecoration:'underline', background:'none', border:'none', cursor:'pointer', font:'inherit', fontSize:12 }}>
                        Waitlist Terms of Service
                      </button>
                    )}
                  </div>
                </label>
                {showTos && info.settings.tos_text && (
                  <div style={{ marginTop:10, padding:'12px 14px', background:'#F8F5F0', borderRadius:10, fontSize:11, color:'#7A7568', lineHeight:1.7, maxHeight:200, overflowY:'auto' }}
                    dangerouslySetInnerHTML={{ __html: info.settings.tos_text }} />
                )}
              </div>
            )}

            {error && (
              <div style={{ background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:10, padding:'10px 14px', fontSize:13, color:'#B91C1C', marginBottom:14 }}>
                {error}
              </div>
            )}

            {/* ── Marketing opt-in (optional, unchecked by default) ── */}
            <label style={{ display:'flex', alignItems:'flex-start', gap:10, cursor:'pointer', marginBottom:12 }}>
              <input type="checkbox" checked={marketingOptIn} onChange={e => setMarketingOptIn(e.target.checked)}
                style={{ marginTop:3, accentColor:accent, width:16, height:16 }} />
              <span style={{ fontSize:12, color:'#7A7568', lineHeight:1.5 }}>
                Yes, send me occasional updates about specials and events at Corretto. Reply STOP to unsubscribe at any time.
              </span>
            </label>

            {/* ── Privacy / operational SMS consent (always visible) ── */}
            <p style={{ fontSize:11, color:'#9A958C', lineHeight:1.6, marginBottom:14, paddingTop:12, borderTop:'1px solid #EFEAE3' }}>
              By joining the waitlist, you agree to receive a text message about your table. Text FORGET to {smsNumber} to delete your data or STOP to unsubscribe.{' '}
              Privacy policy:{' '}
              <a href={privacyUrl} target="_blank" rel="noopener noreferrer" style={{ color:accent, textDecoration:'underline' }}>{privacyUrl}</a>
            </p>

            <button type="submit" disabled={submitting || !firstName.trim() || !phone.trim() || (hasTos && !tosAgreed)}
              className="btn" style={{ background:accent }}>
              {submitting ? 'Joining…' : `Join waitlist — party of ${partySize}`}
            </button>

            <p style={{ textAlign:'center', fontSize:11, color:'#B0AB9E', marginTop:14 }}>Powered by CulminaRMS</p>
          </form>
        )}
      </div>
    </div>
  )
}
