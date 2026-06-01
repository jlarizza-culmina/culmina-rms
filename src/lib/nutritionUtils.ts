// src/lib/nutritionUtils.ts
// Nutrition calculation from ingredient library data

import type { Recipe, LibraryIngredient } from './types'

export interface NutritionResult {
  calories: number
  protein_g: number
  carbs_g: number
  fat_g: number
  fiber_g: number
  sodium_mg: number
  covered_count: number   // ingredients with nutrition data
  total_count: number     // total linked ingredients
  coverage_pct: number    // % of ingredients with data
}

// Grams per common recipe units (fallback when grams_per_recipe_unit not on library item)
const UNIT_GRAMS: Record<string, number> = {
  oz: 28.35, 'fl_oz': 29.57, 'fl oz': 29.57,
  lb: 453.59,
  g: 1, kg: 1000,
  ml: 1, l: 1000,
  tsp: 4.2, tbsp: 14.2, cup: 236.6,
  pinch: 0.3,
  each: 100, slice: 30, sprig: 2, leaf: 0.5,
  clove: 3, head: 100, bunch: 100, batch: 500,
}

export function gramsPerUnit(unit: string, libItem?: LibraryIngredient | null): number {
  if (libItem?.grams_per_recipe_unit) return libItem.grams_per_recipe_unit
  return UNIT_GRAMS[unit?.toLowerCase() ?? ''] ?? 28.35
}

export function calculateRecipeNutrition(
  recipe: Recipe,
  library: LibraryIngredient[],
  servings: number = 1,
): NutritionResult {
  const baseServings = recipe.base_servings || 1
  const ratio = servings / baseServings

  let calories = 0, protein = 0, carbs = 0, fat = 0, fiber = 0, sodium = 0
  let covered = 0, total = 0

  for (const ing of recipe.ingredients ?? []) {
    if (!ing.library_id) continue
    total++
    const lib = library.find(l => l.id === ing.library_id)
    if (!lib || lib.calories_per_100g == null) continue
    covered++

    const gPerUnit = gramsPerUnit(ing.unit, lib)
    const grams    = ing.amount * gPerUnit
    const factor   = grams / 100

    calories += factor * (lib.calories_per_100g ?? 0)
    protein  += factor * (lib.protein_g_per_100g ?? 0)
    carbs    += factor * (lib.carbs_g_per_100g ?? 0)
    fat      += factor * (lib.fat_g_per_100g ?? 0)
    fiber    += factor * (lib.fiber_g_per_100g ?? 0)
    sodium   += factor * (lib.sodium_mg_per_100g ?? 0)
  }

  const r = ratio  // scale to requested serving count
  return {
    calories:       Math.round(calories * r),
    protein_g:      Math.round(protein  * r * 10) / 10,
    carbs_g:        Math.round(carbs    * r * 10) / 10,
    fat_g:          Math.round(fat      * r * 10) / 10,
    fiber_g:        Math.round(fiber    * r * 10) / 10,
    sodium_mg:      Math.round(sodium   * r),
    covered_count:  covered,
    total_count:    total,
    coverage_pct:   total > 0 ? Math.round(covered / total * 100) : 0,
  }
}

// USDA nutrient IDs we care about
export const USDA_NUTRIENT_IDS = {
  calories: 1008,    // Energy (kcal)
  protein:  1003,    // Protein (g)
  carbs:    1005,    // Carbohydrate (g)
  fat:      1004,    // Total Fat (g)
  fiber:    1079,    // Dietary Fiber (g)
  sodium:   1093,    // Sodium (mg)
}

export interface UsdaFood {
  fdcId: number
  description: string
  dataType: string
  calories?: number
  protein_g?: number
  carbs_g?: number
  fat_g?: number
  fiber_g?: number
  sodium_mg?: number
}

// Parse USDA API response into simplified format
export function parseUsdaFoods(data: any): UsdaFood[] {
  const foods: any[] = data?.foods ?? []
  return foods.map(food => {
    const nutrients: Record<number, number> = {}
    for (const n of food.foodNutrients ?? []) {
      nutrients[n.nutrientId] = n.value
    }
    return {
      fdcId:       food.fdcId,
      description: food.description,
      dataType:    food.dataType ?? '',
      calories:    nutrients[USDA_NUTRIENT_IDS.calories],
      protein_g:   nutrients[USDA_NUTRIENT_IDS.protein],
      carbs_g:     nutrients[USDA_NUTRIENT_IDS.carbs],
      fat_g:       nutrients[USDA_NUTRIENT_IDS.fat],
      fiber_g:     nutrients[USDA_NUTRIENT_IDS.fiber],
      sodium_mg:   nutrients[USDA_NUTRIENT_IDS.sodium],
    }
  })
}
