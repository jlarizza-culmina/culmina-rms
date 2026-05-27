import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

async function sendSMS(to: string, body: string) {
  const sid   = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  const from  = process.env.TWILIO_PHONE_NUMBER
  if (!sid || !token || !from) { console.log('Twilio not configured'); return }
  const creds = Buffer.from(`${sid}:${token}`).toString('base64')
  await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ From: from, To: to, Body: body }).toString(),
  })
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    const { sessionId, action } = await request.json()

    if (!sessionId || !action)
      return NextResponse.json({ error: 'Missing sessionId or action' }, { status: 400 })

    const { data: session, error: sessErr } = await supabase
      .from('waitlist_sessions')
      .select('*, restaurants(name)')
      .eq('id', sessionId)
      .single()

    if (sessErr || !session)
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })

    const now = new Date().toISOString()
    const restaurantName = (session.restaurants as unknown as { name: string })?.name ?? ''

    if (action === 'notify') {
      await supabase.from('waitlist_sessions').update({ status: 'notified', notified_at: now }).eq('id', sessionId)
      await sendSMS(session.phone, `${session.guest_name}, your table is ready at ${restaurantName}! Head over now. 🍷`)
    } else if (action === 'seat') {
      await supabase.from('waitlist_sessions').update({ status: 'seated', seated_at: now }).eq('id', sessionId)
    } else if (action === 'no_show') {
      await supabase.from('waitlist_sessions').update({ status: 'no_show' }).eq('id', sessionId)
    } else if (action === 'cancel') {
      await supabase.from('waitlist_sessions').update({ status: 'cancelled' }).eq('id', sessionId)
      await sendSMS(session.phone, `Your waitlist spot at ${restaurantName} has been cancelled. Hope to see you soon!`)
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Action error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
