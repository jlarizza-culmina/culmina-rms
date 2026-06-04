// src/app/api/recipes/import/route.ts
// Bulk-import recipes from Corretto JSON format
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

interface ImportIngredient {
  quantity: number; unit: string; name: string; prep_method?: string
}
interface ImportStep {
  phase?: string; instruction: string; timer_seconds?: number
}
interface ImportRecipe {
  name: string; menu_name?: string; menu_description?: string
  description?: string; stage?: string; daypart?: string[]
  price?: number; season?: string[]; rotation?: string
  allergens?: string[]; server_notes?: string; notes?: string
  base_servings?: number; recipe_type?: string
  ingredients?: ImportIngredient[]; steps?: ImportStep[]
}
interface ImportPayload {
  recipes: ImportRecipe[]
  category?: string; menu_section?: string; note?: string
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { recipes, restaurantId, userId, dryRun = false } = body as {
      recipes: ImportPayload; restaurantId: string; userId: string; dryRun?: boolean
    }

    if (!restaurantId || !userId) {
      return NextResponse.json({ error: 'restaurantId and userId required' }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const recipeList: ImportRecipe[] = Array.isArray(recipes)
      ? recipes
      : (recipes as any).recipes ?? []

    if (!recipeList.length) {
      return NextResponse.json({ error: 'No recipes found in payload' }, { status: 400 })
    }

    if (dryRun) {
      return NextResponse.json({
        preview: recipeList.map(r => ({
          name: r.name,
          menu_name: r.menu_name,
          ingredients: r.ingredients?.length ?? 0,
          steps: r.steps?.length ?? 0,
          price: r.price,
          allergens: r.allergens ?? [],
          season: r.season ?? [],
        }))
      })
    }

    const imported: string[] = []
    const errors: string[] = []

    for (const r of recipeList) {
      try {
        // Map stage → menu_status
        const menuStatus = r.stage === 'active' ? 'on_menu'
          : r.stage === 'development' ? 'development'
          : 'on_menu'

        // Build tags from allergens + daypart + rotation + category
        const tags = [
          ...(r.allergens ?? []),
          ...(r.daypart ?? []),
          r.rotation,
          (recipes as any).category,
          (recipes as any).menu_section,
        ].filter(Boolean) as string[]

        // Map ingredients
        const ingredients = (r.ingredients ?? []).map((ing, i) => ({
          id: crypto.randomUUID(),
          name: ing.name,
          amount: ing.quantity ?? 0,
          unit: ing.unit ?? '',
          prep_method: ing.prep_method ?? '',
          notes: '',
          sort_order: i,
          library_id: null,
          is_component: false,
        }))

        // Map steps
        const steps = (r.steps ?? []).map((step, i) => ({
          id: crypto.randomUUID(),
          instruction: step.instruction,
          phase: step.phase ?? 'cook',
          timer_seconds: step.timer_seconds ?? null,
          sort_order: i,
        }))

        const { data, error } = await supabase.from('recipes').insert({
          restaurant_id:    restaurantId,
          user_id:          userId,
          name:             r.name,
          description:      r.description ?? r.menu_description ?? '',
          menu_name:        r.menu_name ?? r.name,
          menu_description: r.menu_description ?? '',
          server_notes:     r.server_notes ?? '',
          recipe_type:      r.recipe_type ?? 'food',
          base_servings:    r.base_servings ?? 1,
          menu_status:      menuStatus,
          is_active:        true,
          tags,
          season:           r.season ?? [],
          ingredients,
          steps,
        }).select('id, name').single()

        if (error) {
          errors.push(`${r.name}: ${error.message}`)
        } else {
          imported.push(data.id)

          // Insert menu pricing if price provided
          if (r.price && data.id) {
            // Get default menu for this restaurant
            const { data: menus } = await supabase.from('menus')
              .select('id').eq('restaurant_id', restaurantId).limit(1)
            if (menus?.[0]) {
              await supabase.from('menu_items').insert({
                menu_id:   menus[0].id,
                recipe_id: data.id,
                price:     r.price,
                is_active: true,
              }).select()
            }
          }
        }
      } catch (e: any) {
        errors.push(`${r.name}: ${e.message}`)
      }
    }

    return NextResponse.json({
      imported: imported.length,
      errors,
      message: `Imported ${imported.length} of ${recipeList.length} recipes`,
    })
  } catch (err: any) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
