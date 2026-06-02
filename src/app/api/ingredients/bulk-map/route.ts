// src/app/api/ingredients/bulk-map/route.ts
// Maps an ingredient name to a library_id across ALL recipes
// Uses service role to bypass RLS

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function POST(req: Request) {
  try {
    const { restaurant_id, ingredient_name, library_id } = await req.json()
    if (!restaurant_id || !ingredient_name || !library_id) {
      return NextResponse.json({ error: 'restaurant_id, ingredient_name, library_id required' }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // Fetch all recipes for this restaurant that have ingredients
    const { data: recipes, error: fetchError } = await supabase
      .from('recipes')
      .select('id, ingredients')
      .eq('restaurant_id', restaurant_id)
      .not('ingredients', 'is', null)

    if (fetchError) throw fetchError

    const nameLower = ingredient_name.toLowerCase().trim()
    let updatedCount = 0

    // Update each recipe that has this ingredient name
    for (const recipe of recipes ?? []) {
      const ingredients: any[] = recipe.ingredients ?? []
      let changed = false

      const updated = ingredients.map((ing: any) => {
        if (!ing) return ing
        if ((ing.name ?? '').toLowerCase().trim() === nameLower) {
          changed = true
          return { ...ing, library_id }
        }
        return ing
      })

      if (changed) {
        await supabase
          .from('recipes')
          .update({ ingredients: updated })
          .eq('id', recipe.id)
        updatedCount++
      }
    }

    return NextResponse.json({ ok: true, recipes_updated: updatedCount })
  } catch (err) {
    console.error('[ingredients/bulk-map]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
