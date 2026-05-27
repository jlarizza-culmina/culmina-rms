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
