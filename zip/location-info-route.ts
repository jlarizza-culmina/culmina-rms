import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

// Uses service role to read public location data for the join form
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(
  _req: NextRequest,
  { params }: { params: { locationId: string } }
) {
  try {
    const { locationId } = params

    // Load location + restaurant
    const { data: location, error: locErr } = await supabaseAdmin
      .from('locations')
      .select('*, restaurants(name, branding)')
      .eq('id', locationId)
      .eq('is_active', true)
      .single()

    if (locErr || !location) {
      return NextResponse.json({ error: 'Location not found' }, { status: 404 })
    }

    // Load waitlist settings (or defaults)
    const { data: settings } = await supabaseAdmin
      .from('location_waitlist_settings')
      .select('*')
      .eq('location_id', locationId)
      .single()

    // Load other active locations for the same restaurant
    const { data: otherLocations } = await supabaseAdmin
      .from('locations')
      .select('id, name, city')
      .eq('restaurant_id', location.restaurant_id)
      .eq('is_active', true)
      .neq('id', locationId)

    return NextResponse.json({
      restaurant: location.restaurants,
      location: {
        id:   location.id,
        name: location.name,
        city: location.city,
        state: location.state,
      },
      settings: {
        is_active:        settings?.is_active       ?? true,
        walk_time_minutes: settings?.walk_time_minutes ?? 2,
        max_party_size:   settings?.max_party_size   ?? 10,
        welcome_message:  settings?.welcome_message  ?? '',
        confirmation_msg: settings?.confirmation_msg ?? "We'll text you when your table is ready.",
      },
      otherLocations: otherLocations ?? [],
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
