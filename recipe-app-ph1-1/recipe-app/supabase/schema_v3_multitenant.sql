-- ============================================================
-- Culmina RMS — Phase 1 Multi-Tenant Schema Migration
-- Run AFTER schema_v1.sql and schema_v2_phase1.sql
-- Supabase Dashboard → SQL Editor → New query → Run
-- ============================================================


-- ============================================================
-- SECTION 1 — CORE TABLES
-- ============================================================

-- ── App Users (extends Supabase Auth) ──────────────────────
create table if not exists public.app_users (
  id             uuid primary key references auth.users(id) on delete cascade,
  display_name   text default '',
  avatar_url     text default '',
  is_super_admin boolean default false,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

-- Auto-create app_user row on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.app_users (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── Restaurants ─────────────────────────────────────────────
create table if not exists public.restaurants (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  slug         text,
  description  text default '',
  cuisine_type text default '',
  dish_mode    text default 'single'
               check (dish_mode in ('single', 'composed')),
  branding     jsonb default '{}',
  -- branding: { primaryColor, secondaryColor, logoUrl, displayName }
  settings     jsonb default '{}',
  is_active    boolean default true,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- ── Locations ───────────────────────────────────────────────
create table if not exists public.locations (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid references public.restaurants(id) on delete cascade not null,
  name          text not null,     -- "Darien", "Main", "Upstairs"
  address       text default '',
  city          text default '',
  state         text default '',
  zip           text default '',
  country       text default 'US',
  latitude      decimal(10, 6),
  longitude     decimal(10, 6),
  timezone      text default 'America/New_York',
  phone         text default '',
  email         text default '',
  is_primary    boolean default false,
  is_active     boolean default true,
  created_at    timestamptz default now()
);

-- ── Restaurant Members (user → restaurant with role) ────────
create table if not exists public.restaurant_members (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid references public.restaurants(id) on delete cascade not null,
  user_id       uuid references auth.users(id) on delete cascade not null,
  role          text default 'chef'
               check (role in ('super_admin', 'admin', 'chef', 'manager', 'foh')),
  is_active     boolean default true,
  invited_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz default now(),
  unique (restaurant_id, user_id)
);

-- ── Picklist Values ─────────────────────────────────────────
-- Global defaults: restaurant_id = null
-- Restaurant overrides: restaurant_id = their id
create table if not exists public.picklist_values (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid references public.restaurants(id) on delete cascade,
  list_name     text not null,
  -- ingredient_unit | prep_method | allergen | dietary | season
  -- recipe_stage | daypart | cocktail_technique | ingredient_category | dish_mode
  value         text not null,   -- internal key: 'g', 'finely_chopped'
  label         text not null,   -- display: 'Grams', 'Finely Chopped'
  sort_order    integer default 0,
  is_active     boolean default true,
  is_system     boolean default false,  -- true = ships with Culmina, not deletable
  created_at    timestamptz default now()
);

-- Unique indexes handling null restaurant_id correctly
create unique index if not exists picklist_global_unique
  on public.picklist_values (list_name, value)
  where restaurant_id is null;

create unique index if not exists picklist_restaurant_unique
  on public.picklist_values (restaurant_id, list_name, value)
  where restaurant_id is not null;


-- ============================================================
-- SECTION 2 — ALTER RECIPES TABLE
-- ============================================================

alter table public.recipes
  add column if not exists restaurant_id  uuid
    references public.restaurants(id) on delete cascade,

  add column if not exists menu_status    text default 'not_on_menu'
    check (menu_status in ('not_on_menu', 'orderable', 'on_menu', 'special')),

  add column if not exists ranking        smallint
    check (ranking >= 1 and ranking <= 5);
  -- 1–5 star chef ranking, null = unrated


-- ============================================================
-- SECTION 3 — HELPER FUNCTIONS
-- ============================================================

-- Get the current user's restaurant_id (first active membership)
create or replace function public.get_user_restaurant_id()
returns uuid language sql stable security definer as $$
  select restaurant_id
  from public.restaurant_members
  where user_id = auth.uid()
    and is_active = true
  limit 1;
$$;

-- Get the current user's role
create or replace function public.get_user_role()
returns text language sql stable security definer as $$
  select role
  from public.restaurant_members
  where user_id = auth.uid()
    and is_active = true
  limit 1;
$$;

-- Check if current user is super admin
create or replace function public.is_super_admin()
returns boolean language sql stable security definer as $$
  select coalesce(
    (select is_super_admin from public.app_users where id = auth.uid()),
    false
  );
$$;

-- Check if current user has role in (admin, super_admin)
create or replace function public.is_admin()
returns boolean language sql stable security definer as $$
  select coalesce(
    (select role in ('admin', 'super_admin')
     from public.restaurant_members
     where user_id = auth.uid() and is_active = true
     limit 1),
    false
  );
$$;


-- ============================================================
-- SECTION 4 — ROW LEVEL SECURITY
-- ============================================================

alter table public.app_users          enable row level security;
alter table public.restaurants        enable row level security;
alter table public.locations          enable row level security;
alter table public.restaurant_members enable row level security;
alter table public.picklist_values    enable row level security;

-- app_users: see own row + super admin sees all
create policy "Users see own profile"
  on public.app_users for all
  using (id = auth.uid() or public.is_super_admin());

-- restaurants: members can see their restaurant; super admin sees all
create policy "Members see their restaurant"
  on public.restaurants for select
  using (
    public.is_super_admin() or
    id in (
      select restaurant_id from public.restaurant_members
      where user_id = auth.uid() and is_active = true
    )
  );

create policy "Admins manage their restaurant"
  on public.restaurants for insert update delete
  using (
    public.is_super_admin() or
    (public.is_admin() and id = public.get_user_restaurant_id())
  );

-- locations: restaurant members can see; admins can manage
create policy "Members see their locations"
  on public.locations for select
  using (
    public.is_super_admin() or
    restaurant_id = public.get_user_restaurant_id()
  );

create policy "Admins manage locations"
  on public.locations for insert update delete
  using (
    public.is_super_admin() or
    (public.is_admin() and restaurant_id = public.get_user_restaurant_id())
  );

-- restaurant_members: members see their own restaurant's roster; admins manage
create policy "Members see their roster"
  on public.restaurant_members for select
  using (
    public.is_super_admin() or
    restaurant_id = public.get_user_restaurant_id()
  );

create policy "Admins manage members"
  on public.restaurant_members for insert update delete
  using (
    public.is_super_admin() or
    (public.is_admin() and restaurant_id = public.get_user_restaurant_id())
  );

-- picklist_values: see global + own restaurant's values; admins add/edit
create policy "See global and own picklists"
  on public.picklist_values for select
  using (
    restaurant_id is null or
    restaurant_id = public.get_user_restaurant_id() or
    public.is_super_admin()
  );

create policy "Admins manage picklists"
  on public.picklist_values for insert update delete
  using (
    public.is_super_admin() or
    (public.is_admin() and (
      restaurant_id is null or
      restaurant_id = public.get_user_restaurant_id()
    ))
  );

-- Update recipes RLS to support restaurant_id (while keeping user_id compat)
drop policy if exists "Users own their recipes" on public.recipes;

create policy "Users own their recipes"
  on public.recipes for all
  using (
    -- Legacy: single-user recipes scoped by user_id
    (restaurant_id is null and user_id = auth.uid()) or
    -- New: restaurant-scoped recipes
    (restaurant_id is not null and restaurant_id = public.get_user_restaurant_id()) or
    -- Super admin
    public.is_super_admin()
  )
  with check (
    (restaurant_id is null and user_id = auth.uid()) or
    (restaurant_id is not null and restaurant_id = public.get_user_restaurant_id()) or
    public.is_super_admin()
  );


-- ============================================================
-- SECTION 5 — INDEXES
-- ============================================================

create index if not exists app_users_super_idx
  on public.app_users (is_super_admin) where is_super_admin = true;

create index if not exists restaurants_active_idx
  on public.restaurants (is_active);

create index if not exists locations_restaurant_idx
  on public.locations (restaurant_id);

create index if not exists members_user_idx
  on public.restaurant_members (user_id, is_active);

create index if not exists members_restaurant_idx
  on public.restaurant_members (restaurant_id);

create index if not exists picklist_name_idx
  on public.picklist_values (list_name, restaurant_id);

create index if not exists recipes_restaurant_idx
  on public.recipes (restaurant_id);

create index if not exists recipes_menu_status_idx
  on public.recipes (restaurant_id, menu_status);

create index if not exists recipes_type_idx
  on public.recipes (restaurant_id, recipe_type);


-- ============================================================
-- SECTION 6 — UPDATED_AT TRIGGERS
-- ============================================================

create trigger app_users_updated_at
  before update on public.app_users
  for each row execute function public.set_updated_at();

create trigger restaurants_updated_at
  before update on public.restaurants
  for each row execute function public.set_updated_at();


-- ============================================================
-- SECTION 7 — PICKLIST SEED DATA (global defaults)
-- All inserted with restaurant_id = null, is_system = true
-- ============================================================

insert into public.picklist_values (restaurant_id, list_name, value, label, sort_order, is_system)
values
  -- ── Ingredient units ─────────────────────────────────────
  (null, 'ingredient_unit', 'each',    'Each',        1,  true),
  (null, 'ingredient_unit', 'g',       'Grams',        2,  true),
  (null, 'ingredient_unit', 'kg',      'Kilograms',    3,  true),
  (null, 'ingredient_unit', 'oz',      'Ounces',       4,  true),
  (null, 'ingredient_unit', 'lb',      'Pounds',       5,  true),
  (null, 'ingredient_unit', 'ml',      'Milliliters',  6,  true),
  (null, 'ingredient_unit', 'l',       'Liters',       7,  true),
  (null, 'ingredient_unit', 'tsp',     'Teaspoon',     8,  true),
  (null, 'ingredient_unit', 'tbsp',    'Tablespoon',   9,  true),
  (null, 'ingredient_unit', 'cup',     'Cup',          10, true),
  (null, 'ingredient_unit', 'fl_oz',   'Fl. Oz.',      11, true),
  (null, 'ingredient_unit', 'sprig',   'Sprig',        12, true),
  (null, 'ingredient_unit', 'pinch',   'Pinch',        13, true),
  (null, 'ingredient_unit', 'bunch',   'Bunch',        14, true),
  (null, 'ingredient_unit', 'clove',   'Clove',        15, true),
  (null, 'ingredient_unit', 'slice',   'Slice',        16, true),
  (null, 'ingredient_unit', 'sheet',   'Sheet',        17, true),
  (null, 'ingredient_unit', 'piece',   'Piece',        18, true),
  (null, 'ingredient_unit', 'to_taste','To Taste',     19, true),

  -- ── Prep methods ─────────────────────────────────────────
  (null, 'prep_method', 'whole',           'Whole',             1,  true),
  (null, 'prep_method', 'rough_chopped',   'Rough Chopped',     2,  true),
  (null, 'prep_method', 'chopped',         'Chopped',           3,  true),
  (null, 'prep_method', 'finely_chopped',  'Finely Chopped',    4,  true),
  (null, 'prep_method', 'minced',          'Minced',            5,  true),
  (null, 'prep_method', 'julienned',       'Julienned',         6,  true),
  (null, 'prep_method', 'diced',           'Diced',             7,  true),
  (null, 'prep_method', 'small_dice',      'Small Dice',        8,  true),
  (null, 'prep_method', 'medium_dice',     'Medium Dice',       9,  true),
  (null, 'prep_method', 'large_dice',      'Large Dice',        10, true),
  (null, 'prep_method', 'sliced',          'Sliced',            11, true),
  (null, 'prep_method', 'thinly_sliced',   'Thinly Sliced',     12, true),
  (null, 'prep_method', 'torn',            'Torn',              13, true),
  (null, 'prep_method', 'grated',          'Grated',            14, true),
  (null, 'prep_method', 'zested',          'Zested',            15, true),
  (null, 'prep_method', 'peeled',          'Peeled',            16, true),
  (null, 'prep_method', 'brunoise',        'Brunoise',          17, true),
  (null, 'prep_method', 'chiffonade',      'Chiffonade',        18, true),
  (null, 'prep_method', 'bias_cut',        'Bias Cut',          19, true),
  (null, 'prep_method', 'halved',          'Halved',            20, true),
  (null, 'prep_method', 'quartered',       'Quartered',         21, true),
  (null, 'prep_method', 'crushed',         'Crushed',           22, true),
  (null, 'prep_method', 'pressed',         'Pressed',           23, true),

  -- ── Allergens ─────────────────────────────────────────────
  (null, 'allergen', 'gluten',    'Gluten',     1, true),
  (null, 'allergen', 'dairy',     'Dairy',      2, true),
  (null, 'allergen', 'eggs',      'Eggs',       3, true),
  (null, 'allergen', 'nuts',      'Tree Nuts',  4, true),
  (null, 'allergen', 'peanuts',   'Peanuts',    5, true),
  (null, 'allergen', 'shellfish', 'Shellfish',  6, true),
  (null, 'allergen', 'soy',       'Soy',        7, true),
  (null, 'allergen', 'sesame',    'Sesame',     8, true),
  (null, 'allergen', 'fish',      'Fish',       9, true),

  -- ── Dietary ───────────────────────────────────────────────
  (null, 'dietary', 'vegetarian',  'Vegetarian',  1, true),
  (null, 'dietary', 'vegan',       'Vegan',        2, true),
  (null, 'dietary', 'gluten_free', 'Gluten-Free',  3, true),
  (null, 'dietary', 'dairy_free',  'Dairy-Free',   4, true),
  (null, 'dietary', 'halal',       'Halal',        5, true),
  (null, 'dietary', 'kosher',      'Kosher',       6, true),

  -- ── Seasons ───────────────────────────────────────────────
  (null, 'season', 'spring', 'Spring', 1, true),
  (null, 'season', 'summer', 'Summer', 2, true),
  (null, 'season', 'fall',   'Fall',   3, true),
  (null, 'season', 'winter', 'Winter', 4, true),

  -- ── Recipe lifecycle stages ───────────────────────────────
  (null, 'recipe_stage', 'development',      'Development',       1, true),
  (null, 'recipe_stage', 'testing',          'Testing',           2, true),
  (null, 'recipe_stage', 'active',           'Active',            3, true),
  (null, 'recipe_stage', 'specials_candidate','Specials Candidate',4, true),
  (null, 'recipe_stage', 'retired',          'Retired',           5, true),

  -- ── Menu item status ─────────────────────────────────────
  (null, 'menu_status', 'not_on_menu', 'Not on Menu',                 1, true),
  (null, 'menu_status', 'orderable',   'Orderable (not printed)',      2, true),
  (null, 'menu_status', 'on_menu',     'On Menu',                      3, true),
  (null, 'menu_status', 'special',     'Special',                      4, true),

  -- ── Dayparts ──────────────────────────────────────────────
  (null, 'daypart', 'all',        'All Day',    1, true),
  (null, 'daypart', 'breakfast',  'Breakfast',  2, true),
  (null, 'daypart', 'lunch',      'Lunch',      3, true),
  (null, 'daypart', 'dinner',     'Dinner',     4, true),
  (null, 'daypart', 'aperitivo',  'Aperitivo',  5, true),
  (null, 'daypart', 'late_night', 'Late Night', 6, true),

  -- ── Cocktail techniques ───────────────────────────────────
  (null, 'cocktail_technique', 'shake',  'Shake',  1, true),
  (null, 'cocktail_technique', 'stir',   'Stir',   2, true),
  (null, 'cocktail_technique', 'build',  'Build',  3, true),
  (null, 'cocktail_technique', 'blend',  'Blend',  4, true),
  (null, 'cocktail_technique', 'throw',  'Throw',  5, true),

  -- ── Ingredient categories ─────────────────────────────────
  (null, 'ingredient_category', 'produce',   'Produce',          1,  true),
  (null, 'ingredient_category', 'meat',      'Meat',             2,  true),
  (null, 'ingredient_category', 'seafood',   'Seafood',          3,  true),
  (null, 'ingredient_category', 'dairy',     'Dairy',            4,  true),
  (null, 'ingredient_category', 'bakery',    'Bakery',           5,  true),
  (null, 'ingredient_category', 'pantry',    'Pantry',           6,  true),
  (null, 'ingredient_category', 'spices',    'Spices & Herbs',   7,  true),
  (null, 'ingredient_category', 'spirits',   'Spirits',          8,  true),
  (null, 'ingredient_category', 'mixers',    'Mixers & Syrups',  9,  true),
  (null, 'ingredient_category', 'frozen',    'Frozen',           10, true),
  (null, 'ingredient_category', 'beverages', 'Beverages',        11, true),
  (null, 'ingredient_category', 'other',     'Other',            12, true)

on conflict do nothing;


-- ============================================================
-- SECTION 8 — MIGRATION HELPER
-- After running this migration, existing users need a restaurant.
-- The OnboardingWizard handles this in the UI.
-- To manually migrate an existing user's data after they create
-- a restaurant, run:
--
-- update public.recipes
-- set restaurant_id = 'NEW-RESTAURANT-UUID'
-- where user_id = 'YOUR-USER-UUID'
--   and restaurant_id is null;
-- ============================================================
