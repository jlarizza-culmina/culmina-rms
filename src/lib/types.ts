// ── Core enums ────────────────────────────────────────────────
export type RecipeType      = 'food' | 'cocktail'
export type CookPhase       = 'mise' | 'cook' | 'plate'
export type CocktailTechnique = 'shake' | 'stir' | 'build' | 'blend' | 'throw'
export type Daypart         = 'all' | 'breakfast' | 'lunch' | 'dinner' | 'aperitivo' | 'late-night'
export type DishMode        = 'single' | 'composed'
export type UserRole        = 'super_admin' | 'admin' | 'chef' | 'manager' | 'foh'
export type MenuItemStatus  = 'not_on_menu' | 'orderable' | 'on_menu' | 'special'
export type RecipeStage     = 'development' | 'testing' | 'active' | 'specials_candidate' | 'retired'
export type AppModule       = 'home' | 'recipes' | 'menus' | 'library' | 'production' | 'schedule' | 'analytics' | 'settings' | 'superadmin' | 'queue' | 'staff' | 'haccp' | 'inventory'

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
  acquired_date?: string | null
  opened_date?: string | null
  end_date?: string | null
  seasons?: string[]
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
  is_garnish?: boolean   // marks ingredient as garnish component
}

export interface Step {
  id: string
  title: string
  description: string
  duration: number
  phase: CookPhase
  equipment?: ServiceWareRef[]
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
  menu_start_date?: string | null   // ISO date e.g. '2027-03-15'
  menu_end_date?: string | null     // ISO date e.g. '2027-09-30'
  menu_status?: MenuItemStatus
  dayparts?: Daypart[]
  ranking?: number | null     // 1–5
  // Sub-recipe / component
  is_sub_recipe?: boolean
  is_component_recipe?: boolean
  components?: ComponentRef[]       // component recipes embedded in this recipe
  sub_recipe_yield_amount?: number | null
  sub_recipe_yield_unit?: string
  // Costing
  target_food_cost_pct?: number | null
  // Lifecycle
  is_active?: boolean
  // Allergens & dietary
  allergens?: string[]
  dietary?: string[]
  // Structured allergen flags (Gap 1)
  allergen_milk?:        boolean
  allergen_eggs?:        boolean
  allergen_fish?:        boolean
  allergen_shellfish?:   boolean
  allergen_tree_nuts?:   boolean
  allergen_peanuts?:     boolean
  allergen_wheat?:       boolean
  allergen_soybeans?:    boolean
  allergen_sesame?:      boolean
  allergens_confirmed?:  boolean
  allergens_confirmed_by?: string
  allergens_confirmed_at?: string
  allergen_notes?:       string
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
  // Menu presentation (Phase 3)
  menu_description?: string
  internal_notes?: string
  menu_sections?: string[]
  // Service ware (Phase 4)
  service_ware?: ServiceWare
  equipment_needed?: ServiceWareRef[]
  created_at?: string
}

export type AIRecipe = Omit<Recipe, 'id' | 'user_id' | 'restaurant_id' | 'servings' | 'created_at'>

// ── Menu types (Phase 3) ──────────────────────────────────────
export interface Menu {
  id: string
  restaurant_id: string
  location_id?: string | null
  name: string
  description: string
  is_active: boolean
  created_at?: string
}

export interface MenuVersion {
  id: string
  menu_id: string
  version_number: number
  notes: string
  published_at?: string | null
  created_at?: string
}

export interface MenuVersionItem {
  id: string
  version_id: string
  recipe_id: string
  menu_price?: number | null
  sort_order: number
  date_added: string
  date_removed?: string | null
  notes: string
}

// ── Service ware types (Phase 4) ──────────────────────────────
export interface Garnish {
  id: string
  qty: number
  item: string
  prep: string         // expressed | skewered | fresh | dehydrated | flamed | etc.
  presentation: string // on rim | in drink | on pick | on side | floated | etc.
}

export interface ServiceWareRef {
  id: string
  name: string
  category?: string
}

export interface ServiceWare {
  // Legacy (kept for backwards compat)
  vessel?: string
  glass?: string
  // Library-linked multi-select
  plateware?: ServiceWareRef[]
  glassware?: ServiceWareRef[]
  flatware?: ServiceWareRef[]
  garnishes?: Garnish[]
}

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
  restaurant_id?: string | null
  name: string
  category: string
  sub_category?: string
  brand?: string
  description?: string
  vendor_id: string | null
  purchase_unit: string
  purchase_unit_qty?: number
  purchase_unit_label?: string
  purchase_unit_cost: number | null
  purchase_unit_size: number | null
  recipe_unit: string
  recipe_unit_is_metric?: boolean
  unit_conversion: number
  trim_factor: number
  allergens: string[]
  // Structured allergen flags & dietary (Gap 1)
  allergen_milk?:        boolean
  allergen_eggs?:        boolean
  allergen_fish?:        boolean
  allergen_shellfish?:   boolean
  allergen_tree_nuts?:   boolean
  allergen_peanuts?:     boolean
  allergen_wheat?:       boolean
  allergen_soybeans?:    boolean
  allergen_sesame?:      boolean
  allergens_confirmed?:  boolean
  allergens_confirmed_by?: string
  allergens_confirmed_at?: string
  is_gluten_free?:       boolean
  is_vegan?:             boolean
  is_vegetarian?:        boolean
  is_halal?:             boolean
  is_kosher?:            boolean
  allergen_notes?:       string
  notes: string
  is_active: boolean
  created_at?: string
  updated_at?: string
  vendor_name?: string
  // Nutrition (per 100g, from USDA FoodData Central)
  calories_per_100g?: number | null
  protein_g_per_100g?: number | null
  carbs_g_per_100g?: number | null
  fat_g_per_100g?: number | null
  fiber_g_per_100g?: number | null
  sodium_mg_per_100g?: number | null
  grams_per_recipe_unit?: number | null
  usda_fdc_id?: number | null
  nutrition_verified?: boolean
  nutrition_updated_at?: string | null
  nutrition_excluded?: boolean
}

export interface IngredientCostHistory {
  id: string
  ingredient_library_id: string
  restaurant_id?: string | null
  purchase_unit: string
  purchase_unit_cost: number
  recorded_at: string
  recorded_by?: string | null
}

// Component / sub-recipe reference — ingredient row that links to another recipe
export interface ComponentRef {
  id: string                   // row id in the parent recipe ingredients
  type: 'component'
  recipe_id: string            // the sub-recipe being referenced
  recipe_name: string          // snapshot of sub-recipe name
  amount: number               // e.g. 1 (batch), 0.5 (half batch)
  yield_unit: string           // e.g. 'batch', 'serving', 'oz'
  notes?: string
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

export interface Role {
  id:            string
  restaurant_id: string | null
  name:          string
  description:   string
  color:         string
  is_system:     boolean
  permissions:   Record<string, string>
  created_at:    string
  updated_at:    string
}

export interface StaffMember {
  id:                      string
  restaurant_id:           string
  app_user_id:             string | null
  name:                    string
  preferred_name:          string
  phone:                   string
  email:                   string
  photo_url:               string
  emergency_contact_name:  string
  emergency_contact_phone: string
  hire_date:               string | null
  employment_type:         'full_time' | 'part_time' | 'seasonal' | 'contractor' | null
  hourly_rate:             number | null
  status:                  'active' | 'inactive' | 'terminated'
  pin:                     string
  primary_location_id:     string | null
  notes:                   string
  created_at:              string
  updated_at:              string
}

export interface StaffLocationRole {
  id:                  string
  staff_id:            string
  location_id:         string
  role_id:             string
  is_primary_location: boolean
  effective_from:      string
  effective_until:     string | null
  created_at:          string
}

// Joined shapes returned by `select('*, staff_location_roles(*, roles(*))')`.
export interface StaffLocationRoleWithRole extends StaffLocationRole {
  roles?: { name: string } | null
}
export interface StaffMemberWithRoles extends StaffMember {
  staff_location_roles?: StaffLocationRoleWithRole[]
}

export interface InventoryParLevel {
  id:                 string
  location_id:        string
  library_id:         string
  track:              'beverage' | 'food'
  par_qty:            number
  par_unit:           string
  reorder_qty:        number | null
  reorder_threshold:  number | null
  supplier_name?:     string
  notes:              string
  created_at:         string
  updated_at:         string
}

export interface InventoryLevel {
  id:             string
  location_id:    string
  library_id:     string
  track:          'beverage' | 'food'
  on_hand_qty:    number
  on_hand_unit:   string
  last_count_qty: number | null
  last_count_at:  string | null
  last_count_by:  string | null
  updated_at:     string
}

export interface PreparedBatch {
  id:                  string
  location_id:         string
  recipe_id:           string | null
  batch_name:          string
  batch_qty:           number
  batch_unit:          string
  current_qty:         number
  current_unit:        string
  prep_date:           string
  use_by_date:         string
  prep_by:             string
  storage_location:    string
  is_contract_kitchen: boolean
  contract_batch_id:   string
  status:              'active' | 'partially_used' | 'depleted' |
                       'discarded' | 'expired'
  discarded_at:        string | null
  discarded_by:        string
  discard_reason:      string
  discard_value:       number | null
  notes:               string
  created_at:          string
  updated_at:          string
}

export interface PreparedBatchDepletion {
  id:            string
  batch_id:      string
  depleted_at:   string
  depleted_qty:  number
  depleted_unit: string
  source:        'production_plan' | 'service_use' |
                 'mise_en_place' | 'waste' | 'manual'
  source_ref:    string
  depleted_by:   string
  notes:         string
  created_at:    string
}

export interface InventoryReceipt {
  id:            string
  location_id:   string
  received_at:   string
  received_by:   string
  supplier_name: string
  invoice_ref:   string
  notes:         string
  created_at:    string
}

export interface InventoryReceiptLine {
  id:           string
  receipt_id:   string
  library_id:   string | null
  item_name:    string
  ordered_qty:  number | null
  received_qty: number
  unit:         string
  unit_cost:    number | null
  notes:        string
}

export interface HACCPEquipment {
  id:              string
  location_id:     string
  name:            string
  equipment_type:  'walk_in' | 'reach_in' | 'freezer' | 'hot_hold' | 'prep_surface' | 'other'
  physical_location?: string
  target_temp_min: number
  target_temp_max: number
  temp_unit:       'F' | 'C'
  log_slots:       string[]
  is_active:       boolean
  notes:           string
  sort_order:      number
  created_at:      string
}

export interface TemperatureLog {
  id:               string
  location_id:      string
  equipment_id:     string
  log_slot:         string
  recorded_at:      string
  temp_value:       number
  temp_unit:        'F' | 'C'
  recorded_by:      string
  recording_method: 'manual' | 'sensor'
  is_compliant:     boolean | null
  notes:            string
  created_at:       string
}

export interface CorrectiveAction {
  id:               string
  location_id:      string
  trigger_type:     'temperature_log' | 'receiving_log' | 'cooking_log' | 'batch_expiry' | 'manual'
  trigger_id:       string | null
  discovered_at:    string
  discovered_by:    string
  description:      string
  action_taken:     string
  items_affected:   string
  items_discarded:  boolean
  resolved_at:      string | null
  resolved_by:      string
  status:           'open' | 'resolved' | 'verified'
  notes:            string
  created_at:       string
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

// ── Waitlist + Loyalty types (Phase 9B) ───────────────────────
export interface Guest {
  id: string
  restaurant_id: string
  first_name: string
  last_name: string
  phone: string
  email: string
  birthday_month?: number | null
  birthday_day?: number | null
  sms_opt_in: boolean
  email_opt_in: boolean
  preferred_location_id?: string | null
  first_visit_date: string
  visit_count: number
  last_visit_date: string
  source: string
  notes: string
  created_at?: string
}

export interface WaitlistSession {
  id: string
  restaurant_id: string
  location_id: string
  guest_id?: string | null
  guest_name: string
  party_size: number
  phone: string
  status: 'waiting' | 'notified' | 'seated' | 'no_show' | 'cancelled'
  joined_at: string
  notified_at?: string | null
  seated_at?: string | null
  train_id?: string | null
  estimated_arrival?: string | null
  estimated_arrival_at?: string | null
  arrival_mode?: 'inbound' | 'outbound' | 'other' | null
  birthday_month?: number | null
  birthday_day?: number | null
  notes: string
  created_at?: string
}

export interface LocationWaitlistSettings {
  id: string
  location_id: string
  is_active: boolean
  walk_time_minutes: number
  max_party_size: number
  welcome_message: string
  confirmation_msg: string
  mta_station_id: string
}

// ── Service ware library types ────────────────────────────────
export type ServiceWareCategory = 'Plateware' | 'Glassware' | 'Flatware' | 'Cookware' | 'Bakeware' | 'Barware' | 'Kitchen Utensils' | 'Cooking Equipment'

export interface ServiceWareItem {
  id: string
  restaurant_id: string
  category: ServiceWareCategory
  name: string
  description: string
  brand: string
  size?: string
  is_active: boolean
  created_at?: string
  updated_at?: string
}

export interface ServiceWareInventory {
  id: string
  service_ware_item_id: string
  location_id: string
  quantity_on_hand: number
  notes: string
  updated_at?: string
  updated_by?: string | null
}
