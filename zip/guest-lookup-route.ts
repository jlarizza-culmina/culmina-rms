import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    const { phone, restaurantId } = await request.json()
    if (!phone || !restaurantId) return NextResponse.json({ guest: null })

    const { data } = await supabase
      .from('guests')
      .select('first_name, last_name, email, birthday_month, birthday_day, sms_opt_in, email_opt_in, preferred_location_id, visit_count')
      .eq('restaurant_id', restaurantId)
      .eq('phone', phone.trim())
      .single()

    return NextResponse.json({ guest: data ?? null })
  } catch {
    return NextResponse.json({ guest: null })
  }
}
