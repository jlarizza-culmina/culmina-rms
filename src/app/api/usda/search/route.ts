// src/app/api/usda/search/route.ts
// Proxies USDA FoodData Central search — keeps API key server-side
// GET /api/usda/search?q=chicken+breast&pageSize=5

import { NextResponse } from 'next/server'

const FDC_BASE = 'https://api.nal.usda.gov/fdc/v1'
const NUTRIENT_IDS = [1008, 1003, 1005, 1004, 1079, 1093] // cal, protein, carbs, fat, fiber, sodium

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const q        = searchParams.get('q') ?? ''
  const pageSize = Math.min(parseInt(searchParams.get('pageSize') ?? '5'), 10)

  if (!q.trim()) return NextResponse.json({ foods: [] })

  const apiKey = process.env.USDA_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'USDA_API_KEY not configured' }, { status: 500 })
  }

  try {
    const url = new URL(`${FDC_BASE}/foods/search`)
    url.searchParams.set('query',    q.trim())
    url.searchParams.set('pageSize', String(pageSize))
    url.searchParams.set('api_key',  apiKey)
    // Prefer Foundation and SR Legacy data types (most complete nutrition)
    url.searchParams.set('dataType', 'Foundation,SR Legacy,Survey (FNDDS)')

    const res  = await fetch(url.toString(), { next: { revalidate: 3600 } })
    if (!res.ok) throw new Error(`USDA HTTP ${res.status}`)
    const data = await res.json()

    // Slim down the response — only send what we need
    const foods = (data.foods ?? []).map((food: any) => {
      const nutrients: Record<number, number> = {}
      for (const n of food.foodNutrients ?? []) {
        if (NUTRIENT_IDS.includes(n.nutrientId)) {
          nutrients[n.nutrientId] = n.value
        }
      }
      return {
        fdcId:       food.fdcId,
        description: food.description,
        dataType:    food.dataType,
        brandOwner:  food.brandOwner ?? null,
        calories:    nutrients[1008] ?? null,
        protein_g:   nutrients[1003] ?? null,
        carbs_g:     nutrients[1005] ?? null,
        fat_g:       nutrients[1004] ?? null,
        fiber_g:     nutrients[1079] ?? null,
        sodium_mg:   nutrients[1093] ?? null,
      }
    })

    return NextResponse.json({ foods, totalHits: data.totalHits })
  } catch (err) {
    console.error('[usda/search]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
