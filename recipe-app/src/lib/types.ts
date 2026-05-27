export type RecipeType = 'food' | 'cocktail'
export type CookPhase = 'mise' | 'cook' | 'plate'
export type CocktailTechnique = 'shake' | 'stir' | 'build' | 'blend' | 'throw'
export type AppMode = 'cookbook' | 'library' | 'report'
export type Daypart = 'all' | 'breakfast' | 'lunch' | 'dinner' | 'aperitivo' | 'late-night'

export interface Ingredient {
  id: string
  name: string
  amount: number
  unit: string           // '' for countable items (2 eggs)
  category: string
  library_id?: string | null  // links to ingredient_library for cost calc
}

export interface Step {
  id: string
  title: string
  description: string
  duration: number
  phase: CookPhase
}

export interface Nutrition {
  calories: number
  protein: number
  carbs: number
  fat: number
  fiber: number
  sodium: number
}

export interface CocktailDetails {
  baseSpirit: string
  technique: CocktailTechnique
  glassware: string
  garnish: string
  abv: number
  ice: string
}

export interface Recipe {
  id: string
  user_id?: string
  name: string
  description: string
  recipe_type: RecipeType
  base_servings: number
  servings?: number
  prep_time: number
  cook_time: number
  ingredients: Ingredient[]
  steps: Step[]
  nutrition: Nutrition
  cocktail_details?: CocktailDetails
  tags: string[]
  // Phase 1 fields
  menu_name?: string
  menu_category_id?: string | null
  menu_start_date?: string | null
  menu_end_date?: string | null
  dayparts?: Daypart[]
  is_sub_recipe?: boolean
  sub_recipe_yield_amount?: number | null
  sub_recipe_yield_unit?: string
  target_food_cost_pct?: number | null
  is_active?: boolean
  created_at?: string
}

export type AIRecipe = Omit<Recipe, 'id' | 'user_id' | 'servings' | 'created_at'>

// ── Phase 2 types ─────────────────────────────────────────────

export interface Vendor {
  id: string
  user_id?: string
  name: string
  contact_name: string
  phone: string
  email: string
  address: string
  delivery_days: string[]
  order_cutoff: string
  account_number: string
  notes: string
  is_active: boolean
  created_at?: string
}

export interface LibraryIngredient {
  id: string
  user_id?: string
  name: string
  category: string
  vendor_id: string | null
  purchase_unit: string          // "lb", "case/6", "750ml bottle"
  purchase_unit_cost: number | null
  purchase_unit_size: number | null
  recipe_unit: string            // "g", "oz", "cup", "each"
  recipe_unit_is_metric: boolean
  unit_conversion: number        // recipe_units per purchase_unit (453.6 g/lb)
  trim_factor: number            // 0.85 = 15% waste (0 < x ≤ 1)
  allergens: string[]
  notes: string
  is_active: boolean
  created_at?: string
  // joined
  vendor_name?: string
}

export interface MenuPricing {
  id: string
  recipe_id: string
  user_id?: string
  daypart: Daypart
  serving_label: string          // "¼ lb", "single", "flight of 3"
  serving_multiplier: number     // relative to base_servings
  price: number
  is_active: boolean
  notes: string
  created_at?: string
}

export interface MenuCategory {
  id: string
  user_id?: string
  name: string
  value: string
  description: string
  color: string
  sort_order: number
  is_bar: boolean
  is_active: boolean
}

// Returned by recipe_cost_summary view
export interface RecipeCostSummary {
  id: string
  name: string
  menu_name: string
  user_id: string
  base_servings: number
  target_food_cost_pct: number | null
  total_cost: number
  cost_per_serving: number
}
