import type { Recipe, LibraryIngredient } from './types'

const ALLERGEN_LABELS: Record<string, string> = {
  gluten: 'Gluten', dairy: 'Dairy', nuts: 'Tree Nuts', peanuts: 'Peanuts',
  shellfish: 'Shellfish', eggs: 'Eggs', soy: 'Soy', sesame: 'Sesame', fish: 'Fish',
}

const DIETARY_LABELS: Record<string, string> = {
  vegetarian: 'Vegetarian', vegan: 'Vegan', 'gluten-free': 'Gluten-Free',
  'dairy-free': 'Dairy-Free', halal: 'Halal', kosher: 'Kosher',
}

function scaleAmt(amount: number, ratio: number): string {
  const v = amount * ratio
  if (v <= 0) return '—'
  if (v >= 10) return String(Math.round(v))
  const fracs: [number, string][] = [[.125,'⅛'],[.25,'¼'],[.333,'⅓'],[.5,'½'],[.667,'⅔'],[.75,'¾']]
  for (const [f, sym] of fracs) if (Math.abs(v - f) < 0.06) return sym
  const r = Math.round(v * 4) / 4
  return r === Math.floor(r) ? String(r) : r.toFixed(2).replace(/0+$/, '')
}

function fmtDuration(min: number): string {
  if (min < 60) return `${min}min`
  const h = Math.floor(min / 60), m = min % 60
  return m === 0 ? `${h}h` : `${h}h ${m}min`
}

export function printRecipeCard(recipe: Recipe, library: LibraryIngredient[], servings: number) {
  const ratio = servings / recipe.base_servings
  const isCocktail = recipe.recipe_type === 'cocktail'

  // Auto-detect allergens from linked library ingredients
  const detectedAllergens = new Set<string>()
  recipe.ingredients.forEach(ing => {
    const lib = ing.library_id ? library.find(l => l.id === ing.library_id) : null
    lib?.allergens?.forEach(a => detectedAllergens.add(a))
  })
  const allAllergens = [...new Set([...(recipe.allergens ?? []), ...detectedAllergens])]
  const dietary = recipe.dietary ?? []

  // Group steps by phase
  const phaseOrder: Record<string, number> = { mise: 0, cook: 1, plate: 2 }
  const sortedSteps = [...(recipe.steps ?? [])].sort((a, b) =>
    (phaseOrder[a.phase ?? 'cook'] ?? 1) - (phaseOrder[b.phase ?? 'cook'] ?? 1)
  )
  const phases = [
    { key: 'mise',  label: '🔪 Mise en Place', color: '#E3F0FF', border: '#93C5FD' },
    { key: 'cook',  label: '🔥 Cook',          color: '#FFF3E0', border: '#FDBA74' },
    { key: 'plate', label: '✨ Plate & Finish', color: '#E8F5E9', border: '#86EFAC' },
  ]

  const ingredientRows = recipe.ingredients.map(ing => `
    <div class="ingredient">
      <span class="ing-amount">${scaleAmt(ing.amount, ratio)}${ing.unit ? ' ' + ing.unit : ''}</span>
      <span>${ing.name}</span>
    </div>`).join('')

  const stepRows = phases.map(phase => {
    const phaseSteps = sortedSteps.filter(s => (s.phase ?? 'cook') === phase.key)
    if (!phaseSteps.length) return ''
    return `
      <div class="phase-badge" style="background:${phase.color};border:1px solid ${phase.border};color:#333">${phase.label}</div>
      ${phaseSteps.map((s, i) => `
        <div class="step">
          <div class="step-title">${i + 1}. ${s.title}${s.duration > 0 ? ` <span class="step-time">⏱ ${fmtDuration(s.duration)}</span>` : ''}</div>
          <div class="step-desc">${s.description}</div>
        </div>`).join('')}`
  }).join('')

  const n = recipe.nutrition
  const nutritionSection = n && !isCocktail ? `
    <div class="section-title">Nutrition — per serving</div>
    <div class="nutrition">
      <div class="nut-item"><div class="nut-val">${Math.round(n.calories * ratio / servings)}</div><div class="nut-label">Calories</div></div>
      <div class="nut-item"><div class="nut-val">${Math.round(n.protein * ratio / servings)}g</div><div class="nut-label">Protein</div></div>
      <div class="nut-item"><div class="nut-val">${Math.round(n.carbs * ratio / servings)}g</div><div class="nut-label">Carbs</div></div>
      <div class="nut-item"><div class="nut-val">${Math.round(n.fat * ratio / servings)}g</div><div class="nut-label">Fat</div></div>
      <div class="nut-item"><div class="nut-val">${Math.round((n.fiber ?? 0) * ratio / servings)}g</div><div class="nut-label">Fiber</div></div>
      ${n.sodium ? `<div class="nut-item"><div class="nut-val">${Math.round(n.sodium * ratio / servings)}mg</div><div class="nut-label">Sodium</div></div>` : ''}
    </div>` : ''

  const allergenSection = allAllergens.length > 0 ? `
    <div class="allergen-bar">
      ⚠ <strong>Contains:</strong> ${allAllergens.map(a => ALLERGEN_LABELS[a] ?? a).join(' · ')}
    </div>` : ''

  const dietarySection = dietary.length > 0 ? `
    <div class="dietary-bar">
      ✓ ${dietary.map(d => DIETARY_LABELS[d] ?? d).join(' · ')}
    </div>` : ''

  const cocktailDetails = isCocktail && recipe.cocktail_details ? `
    <div class="section-title">Details</div>
    <div class="cocktail-grid">
      <div><span class="meta-label">Base spirit</span><br>${recipe.cocktail_details.baseSpirit}</div>
      <div><span class="meta-label">Technique</span><br>${recipe.cocktail_details.technique}</div>
      <div><span class="meta-label">Glassware</span><br>${recipe.cocktail_details.glassware}</div>
      <div><span class="meta-label">Garnish</span><br>${recipe.cocktail_details.garnish}</div>
      <div><span class="meta-label">Ice</span><br>${recipe.cocktail_details.ice}</div>
      <div><span class="meta-label">ABV</span><br>~${recipe.cocktail_details.abv}%</div>
    </div>` : ''

  const html = `<!DOCTYPE html><html lang="en"><head>
  <meta charset="UTF-8">
  <title>${recipe.name}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Georgia, 'Times New Roman', serif; max-width: 680px; margin: 40px auto; color: #201C18; font-size: 13px; line-height: 1.5; }
    h1 { font-size: 28px; font-weight: 600; letter-spacing: -.3px; margin-bottom: 4px; }
    .subtitle { color: #7A7568; font-style: italic; margin-bottom: 16px; }
    .meta { display: flex; gap: 20px; flex-wrap: wrap; font-size: 11px; color: #7A7568; border-top: 1px solid #E8E4DE; border-bottom: 1px solid #E8E4DE; padding: 8px 0; margin-bottom: 14px; }
    .meta-label { font-size: 9px; text-transform: uppercase; letter-spacing: .08em; color: #B0AB9E; }
    .allergen-bar { background: #FFF8E1; border: 1px solid #FFD54F; border-radius: 6px; padding: 8px 12px; font-size: 12px; margin-bottom: 8px; }
    .dietary-bar { background: #E8F5E9; border: 1px solid #A5D6A7; border-radius: 6px; padding: 8px 12px; font-size: 12px; color: #2E6B25; margin-bottom: 14px; }
    .section-title { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: .1em; color: #B0AB9E; margin: 22px 0 10px; padding-bottom: 5px; border-bottom: 1px solid #E8E4DE; }
    .ingredient { display: flex; gap: 12px; padding: 4px 0; border-bottom: .5px solid #F3EFE9; }
    .ing-amount { min-width: 80px; flex-shrink: 0; color: #C05A2A; font-weight: 600; font-family: 'Helvetica Neue', Arial, sans-serif; }
    .phase-badge { display: inline-block; font-size: 10px; padding: 3px 10px; border-radius: 20px; margin: 14px 0 8px; font-family: 'Helvetica Neue', Arial, sans-serif; }
    .step { margin-bottom: 10px; padding-left: 18px; position: relative; }
    .step-title { font-weight: 700; font-size: 13px; }
    .step-time { font-weight: 400; color: #C05A2A; font-size: 11px; }
    .step-desc { color: #7A7568; font-size: 12px; margin-top: 2px; line-height: 1.6; }
    .nutrition { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; background: #F8F5F0; padding: 16px; border-radius: 8px; text-align: center; font-family: 'Helvetica Neue', Arial, sans-serif; }
    .nut-val { font-size: 18px; font-weight: 700; color: #201C18; }
    .nut-label { font-size: 9px; text-transform: uppercase; letter-spacing: .08em; color: #B0AB9E; margin-top: 2px; }
    .cocktail-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; background: #F8F5F0; padding: 14px; border-radius: 8px; font-size: 12px; font-family: 'Helvetica Neue', Arial, sans-serif; }
    .version-note { font-size: 10px; color: #B0AB9E; margin-top: 32px; text-align: right; border-top: 1px solid #E8E4DE; padding-top: 8px; }
    @media print { body { margin: 16px; } .no-print { display: none; } }
  </style></head><body>
  <h1>${recipe.name}</h1>
  ${recipe.description ? `<div class="subtitle">${recipe.description}</div>` : ''}
  <div class="meta">
    <span>Serves <strong>${servings}</strong></span>
    ${recipe.prep_time > 0 ? `<span>Prep <strong>${fmtDuration(recipe.prep_time)}</strong></span>` : ''}
    ${recipe.cook_time > 0 ? `<span>${isCocktail ? 'Build' : 'Cook'} <strong>${fmtDuration(recipe.cook_time)}</strong></span>` : ''}
    ${recipe.version ? `<span>Version <strong>${recipe.version}</strong></span>` : ''}
    ${recipe.tags?.length ? `<span>${recipe.tags.join(' · ')}</span>` : ''}
  </div>
  ${allergenSection}${dietarySection}
  ${cocktailDetails}
  <div class="section-title">Ingredients</div>
  ${ingredientRows}
  <div class="section-title">${isCocktail ? 'Build' : 'Instructions'}</div>
  ${stepRows}
  ${nutritionSection}
  <div class="version-note">
    ${recipe.name}${recipe.version ? ` · v${recipe.version}` : ''} · Printed ${new Date().toLocaleDateString()}
  </div>
  </body></html>`

  const win = window.open('', '_blank')
  if (!win) { alert('Please allow popups to print recipe cards.'); return }
  win.document.write(html)
  win.document.close()
  setTimeout(() => win.print(), 400)
}

export function recipeToText(recipe: Recipe, servings: number): string {
  const ratio = servings / recipe.base_servings
  const lines: string[] = [
    recipe.name.toUpperCase(),
    '─'.repeat(recipe.name.length),
    '',
    recipe.description ?? '',
    '',
    `Serves: ${servings} · Prep: ${recipe.prep_time}min · Cook: ${recipe.cook_time}min`,
    '',
    'INGREDIENTS',
    '──────────────',
    ...recipe.ingredients.map(i => `  ${scaleAmt(i.amount, ratio)}${i.unit ? ' ' + i.unit : ''}\t${i.name}`),
    '',
    'INSTRUCTIONS',
    '──────────────',
    ...recipe.steps.map((s, i) => [`  ${i + 1}. ${s.title}`, `     ${s.description}`, '']).flat(),
  ]
  return lines.join('\n')
}
