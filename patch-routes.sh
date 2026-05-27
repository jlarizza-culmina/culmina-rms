#!/bin/bash
# Run from C:\Users\Joe\recipe-app in Git Bash
# Patches the 3 API routes in-place (no zip folder needed)

PROJECT="$(pwd)"

patch_file() {
  local dst="$PROJECT/$1"
  local dir=$(dirname "$dst")
  mkdir -p "$dir"
  cat > "$dst"
  echo "✓ $1"
}

patch_file "src/app/api/location-info/[locationId]/route.ts" << 'ENDOFFILE'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

export async function GET(
  _req: NextRequest,
  { params }: { params: { locationId: string } }
) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    const { locationId } = params
    const { data: location, error: locErr } = await supabase
      .from('locations')
      .select('*, restaurants(name, branding)')
      .eq('id', locationId).eq('is_active', true).single()
    if (locErr || !location)
      return NextResponse.json({ error: 'Location not found' }, { status: 404 })
    const { data: settings } = await supabase
      .from('location_waitlist_settings').select('*').eq('location_id', locationId).single()
    const { data: otherLocations } = await supabase
      .from('locations').select('id, name, city')
      .eq('restaurant_id', location.restaurant_id).eq('is_active', true).neq('id', locationId)
    return NextResponse.json({
      restaurant: location.restaurants,
      location: { id: location.id, name: location.name, city: location.city, state: location.state },
      settings: {
        is_active: settings?.is_active ?? true,
        walk_time_minutes: settings?.walk_time_minutes ?? 2,
        max_party_size: settings?.max_party_size ?? 10,
        welcome_message: settings?.welcome_message ?? '',
        confirmation_msg: settings?.confirmation_msg ?? "We'll text you when your table is ready.",
      },
      otherLocations: otherLocations ?? [],
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
ENDOFFILE

patch_file "src/app/api/waitlist/join/route.ts" << 'ENDOFFILE'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

async function sendSMS(to: string, body: string) {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  const from = process.env.TWILIO_PHONE_NUMBER
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
    const body = await request.json()
    const { locationId, firstName, lastName, phone, partySize, email,
            birthdayMonth, birthdayDay, smsOptIn, emailOptIn, preferredLocationId } = body
    if (!locationId || !firstName || !phone || !partySize)
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    const { data: location, error: locErr } = await supabase
      .from('locations').select('restaurant_id, name, restaurants(name)').eq('id', locationId).single()
    if (locErr || !location)
      return NextResponse.json({ error: 'Location not found' }, { status: 404 })
    const { data, error } = await supabase.rpc('join_waitlist', {
      p_restaurant_id: location.restaurant_id, p_location_id: locationId,
      p_first_name: firstName, p_last_name: lastName ?? '',
      p_phone: phone, p_party_size: partySize,
      p_email: email ?? '', p_birthday_month: birthdayMonth ?? null,
      p_birthday_day: birthdayDay ?? null, p_sms_opt_in: smsOptIn ?? false,
      p_email_opt_in: emailOptIn ?? false, p_preferred_loc_id: preferredLocationId ?? locationId,
    })
    if (error) throw error
    const restaurantName = (location.restaurants as unknown as { name: string })?.name ?? 'us'
    const position = data?.position ?? 1
    const ordinal = (n: number) => { const s=['th','st','nd','rd']; const v=n%100; return n+(s[(v-20)%10]||s[v]||s[0]) }
    await sendSMS(phone, `Hi ${firstName}! You're ${ordinal(position)} in line at ${restaurantName} (${location.name}) — party of ${partySize}. We'll text you when your table is ready.`)
    return NextResponse.json({ session_id: data?.session_id, position: data?.position ?? 1, total: data?.total ?? 1 })
  } catch (err) {
    console.error('Join error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
ENDOFFILE

patch_file "src/app/api/waitlist/action/route.ts" << 'ENDOFFILE'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

async function sendSMS(to: string, body: string) {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  const from = process.env.TWILIO_PHONE_NUMBER
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
      .from('waitlist_sessions').select('*, restaurants(name)').eq('id', sessionId).single()
    if (sessErr || !session)
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    const now = new Date().toISOString()
    const rName = (session.restaurants as unknown as { name: string })?.name ?? ''
    if (action === 'notify') {
      await supabase.from('waitlist_sessions').update({ status: 'notified', notified_at: now }).eq('id', sessionId)
      await sendSMS(session.phone, `${session.guest_name}, your table is ready at ${rName}! Head over now. 🍷`)
    } else if (action === 'seat') {
      await supabase.from('waitlist_sessions').update({ status: 'seated', seated_at: now }).eq('id', sessionId)
    } else if (action === 'no_show') {
      await supabase.from('waitlist_sessions').update({ status: 'no_show' }).eq('id', sessionId)
    } else if (action === 'cancel') {
      await supabase.from('waitlist_sessions').update({ status: 'cancelled' }).eq('id', sessionId)
      await sendSMS(session.phone, `Your waitlist spot at ${rName} has been cancelled. Hope to see you soon!`)
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Action error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
ENDOFFILE

echo ""
echo "✅ All 3 routes patched. Run:"
echo "   git add -A && git commit -m \"fix: nodejs runtime on waitlist API routes\" && git push && vercel --prod"
