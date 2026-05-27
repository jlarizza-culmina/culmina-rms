// ── Core enums ────────────────────────────────────────────────
export type RecipeType      = 'food' | 'cocktail'
export type CookPhase       = 'mise' | 'cook' | 'plate'
export type CocktailTechnique = 'shake' | 'stir' | 'build' | 'blend' | 'throw'
export type Daypart         = 'all' | 'breakfast' | 'lunch' | 'dinner' | 'aperitivo' | 'late-night'
export type DishMode        = 'single' | 'composed'
export type UserRole        = 'super_admin' | 'admin' | 'chef' | 'manager' | 'foh'
export type MenuItemStatus  = 'not_on_menu' | 'orderable' | 'on_menu' | 'special'
export type RecipeStage     = 'development' | 'testing' | 'active' | 'specials_candidate' | 'retired'
export type AppModule       = 'home' | 'recipes' | 'menus' | 'library' | 'production' | 'schedule' | 'analytics' | 'settings' | 'superadmin'

// ── Multi-tenant types ────────────────────────────────────────
export interface AppUser {
  id: string
  display_name: string
  avatar_url: string
  is_super_admin: boolean
  created_at?: string
}

export interface Restaurant {
  id: string
  name: string
  slug?: string
  description: string
  cuisine_type: string
  dish_mode: DishMode
  branding: {
    primaryColor?: string
    secondaryColor?: string
    logoUrl?: string
    displayName?: string
  }
  settings: Record<string, unknown>
  is_active: boolean
  created_at?: string
}

export interface Location {
  id: string
  restaurant_id: string
  name: string
  address: string
  city: string
  state: string
  zip: string
  country: string
  latitude?: number | null
  longitude?: number | null
  timezone: string
  phone: string
  email: string
  is_primary: boolean
  is_active: boolean
  created_at?: string
}

export interface RestaurantMember {
  id: string
  restaurant_id: string
  user_id: string
  role: UserRole
  is_active: boolean
  created_at?: string
}

export interface PicklistValue {
  id: string
  restaurant_id: string | null
  list_name: string
  value: string
  label: string
  sort_order: number
  is_active: boolean
  is_system: boolean
}

// ── Recipe types ──────────────────────────────────────────────
export interface Ingredient {
  id: string
  name: string
  amount: number
  unit: string
  category: string
  library_id?: string | null
  prep_method?: string   // 'chopped', 'diced', 'julienned', etc.
  prep_notes?: string    // 'from Teitel', 'brunoise for service'
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
  restaurant_id?: string | null
  name: string
  description: string
  recipe_type: RecipeType
  base_servings: number
  servings?: number        // client-only
  prep_time: number
  cook_time: number
  ingredients: Ingredient[]
  steps: Step[]
  nutrition: Nutrition
  cocktail_details?: CocktailDetails
  tags: string[]
  // Menu & status
  menu_name?: string
  menu_category_id?: string | null
  menu_start_date?: string | null
  menu_end_date?: string | null
  menu_status?: MenuItemStatus
  dayparts?: Daypart[]
  ranking?: number | null     // 1–5
  // Sub-recipe
  is_sub_recipe?: boolean
  sub_recipe_yield_amount?: number | null
  sub_recipe_yield_unit?: string
  // Costing
  target_food_cost_pct?: number | null
  // Lifecycle
  is_active?: boolean
  // Allergens & dietary
  allergens?: string[]
  dietary?: string[]
  // Versioning
  version?: number
  parent_version_id?: string | null
  notes?: string
  // Lifecycle & curation (Phase 2)
  seasons?: string[]
  recipe_stage?: RecipeStage
  is_special?: boolean
  server_notes?: string
  parent_recipe_id?: string | null
  variation_overrides?: Record<string, unknown> | null
  created_at?: string
}

export type AIRecipe = Omit<Recipe, 'id' | 'user_id' | 'restaurant_id' | 'servings' | 'created_at'>

// ── Vendor & library types ────────────────────────────────────
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
  purchase_unit: string
  purchase_unit_cost: number | null
  purchase_unit_size: number | null
  recipe_unit: string
  recipe_unit_is_metric: boolean
  unit_conversion: number
  trim_factor: number
  allergens: string[]
  notes: string
  is_active: boolean
  created_at?: string
  vendor_name?: string
}

export interface MenuPricing {
  id: string
  recipe_id: string
  user_id?: string
  daypart: Daypart
  serving_label: string
  serving_multiplier: number
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

// ── Production types ──────────────────────────────────────────
export interface DailyProduction {
  id: string
  user_id?: string
  recipe_id: string
  production_date: string
  daypart: Daypart
  expected_covers: number
  actual_covers?: number | null
  batch_count?: number | null
  waste_buffer_pct: number
  notes: string
  created_at?: string
}

export interface ShoppingListItem {
  key: string
  name: string
  category: string
  is_bar: boolean
  total_recipe_amount: number
  unit: string
  library_id?: string | null
  vendor_id?: string | null
  vendor_name?: string
  purchase_unit?: string
  purchase_amount?: number
  unit_cost?: number | null
  total_cost?: number
  recipe_names: string[]
}

export interface BatchSuggestion {
  batches: number
  total_portions: number
  waste: number
  multiplier: number
}

// ── Schedule types ────────────────────────────────────────────
export interface Staff {
  id: string
  user_id?: string
  name: string
  role: string
  shift: string
  is_active: boolean
  created_at?: string
}

export interface SubRecipeLink {
  id: string
  parent_recipe_id: string
  sub_recipe_id: string
  amount: number
  unit: string
  notes?: string
}

export interface PrepTask {
  id: string
  recipeId: string
  recipeName: string
  stepId: string
  stepTitle: string
  stepDescription: string
  phase: CookPhase
  durationMinutes: number
  startMinutes: number
  endMinutes: number
  displayStart: string
  displayEnd: string
  tMinusLabel: string
  isSubRecipe: boolean
  parentRecipeName?: string
  color: string
}
