import { NextRequest, NextResponse } from 'next/server'

const RECIPE_SCHEMA = `{
  "name": "Recipe Name",
  "description": "1-2 sentence appetising description.",
  "recipe_type": "food",
  "base_servings": 4,
  "prep_time": 15,
  "cook_time": 25,
  "ingredients": [
    { "id": "i1", "name": "flour", "amount": 2, "unit": "cups", "category": "pantry" }
  ],
  "steps": [
    { "id": "s1", "title": "Brief title", "description": "Detail.", "duration": 5, "phase": "mise" }
  ],
  "nutrition": { "calories": 420, "protein": 22, "carbs": 48, "fat": 16, "fiber": 5, "sodium": 580 },
  "tags": ["italian", "quick"]
}`

const COCKTAIL_SCHEMA = `{
  "name": "Cocktail Name",
  "description": "1-2 sentence description.",
  "recipe_type": "cocktail",
  "base_servings": 1,
  "prep_time": 3,
  "cook_time": 0,
  "ingredients": [
    { "id": "i1", "name": "gin", "amount": 2, "unit": "oz", "category": "spirits" }
  ],
  "steps": [
    { "id": "s1", "title": "Combine", "description": "Add gin and vermouth to mixing glass.", "duration": 0, "phase": "mise" },
    { "id": "s2", "title": "Stir", "description": "Stir with ice for 30 seconds until chilled.", "duration": 1, "phase": "cook" },
    { "id": "s3", "title": "Strain & Garnish", "description": "Strain into chilled coupe. Express lemon peel and discard.", "duration": 0, "phase": "plate" }
  ],
  "nutrition": { "calories": 180, "protein": 0, "carbs": 2, "fat": 0, "fiber": 0, "sodium": 5 },
  "cocktail_details": {
    "baseSpirit": "Gin",
    "technique": "stir",
    "glassware": "Coupe",
    "garnish": "Lemon twist",
    "abv": 28,
    "ice": "up"
  },
  "tags": ["classic", "gin"]
}`

const RULES = `
Rules:
- step phase must be one of: mise (prep/gather/chop/measure — before cooking), cook (active stove/oven work), plate (plating/garnish/sauce/rest)
- ingredient category: produce dairy meat seafood pantry spices bakery frozen spirits mixers beverages other
- unit is empty string "" for countable items (3 eggs, 2 cloves)
- nutrition is per base serving
- 5–12 ingredients, 4–10 steps
- Return ONLY valid JSON, no markdown fences, no explanation`

const SYS_FOOD = `You are a culinary assistant. Return ONLY valid JSON matching this structure exactly:
${RECIPE_SCHEMA}
${RULES}`

const SYS_COCKTAIL = `You are a bar professional and cocktail expert. Return ONLY valid JSON matching this structure exactly:
${COCKTAIL_SCHEMA}
${RULES}`

const SYS_PARSE = `You are a culinary assistant. Parse the provided recipe text into structured JSON.
If it looks like a cocktail recipe, use recipe_type "cocktail" and include cocktail_details.
Otherwise use recipe_type "food".
Match this structure exactly:
${RECIPE_SCHEMA}
${RULES}
Infer phase for each step: gathering/chopping/measuring = mise, active cooking = cook, plating/finishing = plate.`

const SYS_IMPORT_CHAT = `You are a culinary assistant. The user will paste a conversation transcript (e.g. from Claude.ai or another AI chat).
Find ALL complete or partial recipes mentioned anywhere in the conversation.
For each recipe found, return a full Recipe object. Infer missing fields where possible.
Return a JSON array of Recipe objects. If nothing found, return [].
Each object must match:
${RECIPE_SCHEMA}
${RULES}`

function cleanJson(text: string): string {
  return text.trim().replace(/^```json\n?/, '').replace(/^```\n?/, '').replace(/\n?```$/, '').trim()
}

export async function POST(req: NextRequest) {
  try {
    const { action, input, iscocktail } = await req.json()

    if (!input?.trim()) {
      return NextResponse.json({ error: 'Input required' }, { status: 400 })
    }

    let system: string
    let userMessage: string
    let maxTokens = 2500

    switch (action) {
      case 'generate':
        system = iscocktail ? SYS_COCKTAIL : SYS_FOOD
        userMessage = `Generate a complete ${iscocktail ? 'cocktail' : 'recipe'} for: ${input}`
        break
      case 'parse':
        system = SYS_PARSE
        userMessage = `Parse this recipe:\n\n${input}`
        break
      case 'import-chat':
        system = SYS_IMPORT_CHAT
        userMessage = `Extract all recipes from this conversation transcript:\n\n${input}`
        maxTokens = 6000
        break
      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: userMessage }],
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      console.error('Anthropic error:', err)
      return NextResponse.json({ error: 'AI API error' }, { status: 502 })
    }

    const data = await response.json()
    const rawText = data.content?.find((b: { type: string }) => b.type === 'text')?.text || ''
    const cleaned = cleanJson(rawText)

    if (action === 'import-chat') {
      const recipes = JSON.parse(cleaned)
      return NextResponse.json({ recipes: Array.isArray(recipes) ? recipes : [] })
    } else {
      const recipe = JSON.parse(cleaned)
      return NextResponse.json({ recipe })
    }
  } catch (err) {
    console.error('Route error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
