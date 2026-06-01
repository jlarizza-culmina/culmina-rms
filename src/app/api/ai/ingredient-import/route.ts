// src/app/api/ai/ingredient-import/route.ts
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const { category } = await req.json()
  if (!category?.trim()) {
    return NextResponse.json({ error: 'Category required' }, { status: 400 })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not set in environment' }, { status: 500 })
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-20250514',
        max_tokens: 4000,
        system: `You are a professional chef and restaurant supply expert. When given a food/beverage category, return a JSON array of ingredients for a professional restaurant kitchen. Each item:
{
  "name": "Category - Descriptor (detail)",
  "category": "Bar|Coffee & Beverage|Dairy & Eggs|Fruits|Herbs & Spices|Oils & Vinegars|Pantry|Pasta & Grains|Proteins|Stocks & Sauces|Vegetables",
  "sub_category": "string or empty",
  "brand": "specific brand or empty",
  "purchase_unit": "lb|each|case/24|750ml bottle etc",
  "purchase_unit_cost": number,
  "recipe_unit": "oz|g|each|tsp etc",
  "unit_conversion": number,
  "notes": "brief note"
}
Naming: always "Category - Descriptor" e.g. "Pork - Guanciale (cured)".
Return ONLY a valid JSON array, no markdown, no preamble.`,
        messages: [{ role: 'user', content: `Generate a comprehensive ingredient list for: ${category.trim()}` }],
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      return NextResponse.json({ error: `Anthropic API error ${res.status}: ${err}` }, { status: 500 })
    }

    const data = await res.json()
    const text = data.content?.[0]?.text ?? ''
    const start = text.indexOf('[')
    const end   = text.lastIndexOf(']')
    if (start === -1 || end === -1) throw new Error('No JSON array in response')
    const ingredients = JSON.parse(text.slice(start, end + 1))
    return NextResponse.json({ ingredients })
  } catch (err) {
    console.error('[ai/ingredient-import]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
