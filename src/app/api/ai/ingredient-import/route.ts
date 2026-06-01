// src/app/api/ai/ingredient-import/route.ts
// Server-side proxy for AI ingredient generation — keeps API call off the client

import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const { category } = await req.json()
  if (!category?.trim()) {
    return NextResponse.json({ error: 'Category required' }, { status: 400 })
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: `You are a professional chef and restaurant supply expert. When given a food/beverage category, return a JSON array of ingredients for a professional restaurant kitchen. Each ingredient must follow this exact format:
{
  "name": "Ingredient - Descriptor (detail)",
  "category": "one of: Bar, Coffee & Beverage, Dairy & Eggs, Fruits, Herbs & Spices, Oils & Vinegars, Pantry, Pasta & Grains, Proteins, Stocks & Sauces, Vegetables",
  "sub_category": "specific sub-category or empty string",
  "brand": "specific brand if applicable, else empty string",
  "purchase_unit": "how it is purchased (e.g. lb, each, case/24, 750ml bottle)",
  "purchase_unit_cost": number,
  "recipe_unit": "unit used in recipes (oz, g, each, tsp, etc)",
  "unit_conversion": number,
  "notes": "brief sourcing or prep note"
}
Naming: always "Category - Descriptor (detail)" e.g. "Pork - Guanciale (cured)", "Cheese - Pecorino Romano".
Return ONLY a valid JSON array, no other text, no markdown.`,
      messages: [{ role: 'user', content: `Generate a comprehensive ingredient list for: ${category.trim()}` }],
    }),
  })

  const data = await res.json()

  // Handle Anthropic API errors
  if (data.error) {
    return NextResponse.json({ error: data.error.message ?? 'Anthropic API error' }, { status: 500 })
  }

  const text = data.content?.[0]?.text ?? ''

  try {
    // Strip code fences if present
    let clean = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
    // Extract the JSON array — find the outermost [ ... ]
    const start = clean.indexOf('[')
    const end   = clean.lastIndexOf(']')
    if (start === -1 || end === -1) throw new Error('No JSON array found in AI response')
    clean = clean.slice(start, end + 1)
    const ingredients = JSON.parse(clean)
    return NextResponse.json({ ingredients })
  } catch (e) {
    console.error('[ai/ingredient-import] parse error:', e, '\nRaw:', text.slice(0, 500))
    return NextResponse.json({ error: `AI returned invalid JSON: ${e}` }, { status: 500 })
  }
}
