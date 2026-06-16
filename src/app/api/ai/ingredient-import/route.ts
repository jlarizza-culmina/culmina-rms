// src/app/api/nutrition/update/route.ts
// Uses service role to bypass RLS — nutrition updates must work on global seed items (user_id=NULL)
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function POST(req: Request) {
  try {
    const { id, ...fields } = await req.json()
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    const { error } = await supabase
      .from('ingredient_library')
      .update({ ...fields, nutrition_updated_at: new Date().toISOString() })
      .eq('id', id)

    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[nutrition/update]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
