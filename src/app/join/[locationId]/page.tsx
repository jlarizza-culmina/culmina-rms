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
  const [lookingUp,  setLookingUp]  = useState(false)

  const phoneRef = useRef<HTMLInputElement>(null)

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
          preferredLocationId: prefLoc || locationId,
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
    <div style={{ minHeight:'100vh', background:'#F8F5F0', fontFamily:'system-ui,sans-serif' }}>
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

      <div style={{ maxWidth:460, margin:'0 auto', padding:'0 20px 40px' }}>

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
            <p style={{ color:'#7A7568', fontSize:14, lineHeight:1.6 }}>
              {info?.settings?.confirmation_msg || "We'll text you when your table is ready."}
            </p>
            <p style={{ marginTop:12, color:'#B0AB9E', fontSize:12 }}>Confirmed to {phone}</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="fade" style={{ background:'white', borderRadius:20, padding:24, boxShadow:'0 2px 16px rgba(0,0,0,.06)' }}>
            <h2 style={{ fontFamily:'Georgia,serif', fontSize:18, color:'#201C18', marginBottom:20 }}>
              {returning ? `Welcome back! 👋` : 'Join the waitlist'}
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
