import type { Recipe, LibraryIngredient } from './types'

export const ALLERGEN_KEYS = [
  'allergen_milk', 'allergen_eggs', 'allergen_fish',
  'allergen_shellfish', 'allergen_tree_nuts', 'allergen_peanuts',
  'allergen_wheat', 'allergen_soybeans', 'allergen_sesame',
] as const

export type AllergenKey = typeof ALLERGEN_KEYS[number]

export const ALLERGEN_LABELS: Record<AllergenKey, string> = {
  allergen_milk:       'Dairy',
  allergen_eggs:       'Eggs',
  allergen_fish:       'Fish',
  allergen_shellfish:  'Shellfish',
  allergen_tree_nuts:  'Tree Nuts',
  allergen_peanuts:    'Peanuts',
  allergen_wheat:      'Wheat',
  allergen_soybeans:   'Soy',
  allergen_sesame:     'Sesame',
}

export function computeRecipeAllergens(
  recipe: Recipe,
  library: LibraryIngredient[]
): {
  allergenFlags: Record<AllergenKey, boolean>
  unconfirmedCount: number
  unconfirmedNames: string[]
} {
  const flags = Object.fromEntries(
    ALLERGEN_KEYS.map(k => [k, false])
  ) as Record<AllergenKey, boolean>

  let unconfirmedCount = 0
  const unconfirmedNames: string[] = []
  const ingredients = (recipe.ingredients ?? []) as Array<{
    library_id?: string; name?: string
  }>

  for (const ing of ingredients) {
    if (!ing.library_id) continue
    const libItem = library.find(l => l.id === ing.library_id)
    if (!libItem) continue

    if (!libItem.allergens_confirmed) {
      unconfirmedCount++
      unconfirmedNames.push(ing.name ?? libItem.name ?? 'Unknown')
      continue
    }

    for (const key of ALLERGEN_KEYS) {
      if (libItem[key]) flags[key] = true
    }
  }

  return { allergenFlags: flags, unconfirmedCount, unconfirmedNames }
}
