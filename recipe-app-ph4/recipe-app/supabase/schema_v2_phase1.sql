-- ============================================================
-- Recipe Manager — Phase 1 Schema Migration
-- Full restaurant operations data model
--
-- HOW TO RUN:
--   If this is a FRESH project (no data yet):
--     Run schema_v1.sql first, then run this file.
--
--   If you already have recipes saved:
--     Run ONLY the ALTER TABLE section (marked below) first,
--     then run the rest. Your existing data is preserved.
--
-- Supabase Dashboard → SQL Editor → New query → paste → Run
-- ============================================================


-- ============================================================
-- SECTION 1 — LOOKUP & REFERENCE TABLES
-- These have no dependencies on other new tables.
-- ============================================================

-- ── Menu Categories ─────────────────────────────────────────
-- Configurable name/value pairs. Drives menu organization,
-- shopping list grouping, and bar vs. kitchen separation.
-- Pre-seeded with Corretto's actual menu structure below.

create table if not exists public.menu_categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade not null,
  name        text not null,         -- Display: "Pasta", "Negroni", "Salatini"
  value       text not null,         -- Slug:    "pasta", "negroni", "salatini"
  description text default '',       -- Optional: shown in UI tooltips
  color       text default '#C05A2A',-- Hex color for UI badges
  sort_order  integer default 0,     -- Controls menu print order
  is_bar      boolean default false, -- TRUE = routes to bar shopping list
  is_active   boolean default true,
  created_at  timestamptz default now(),
  unique (user_id, value)
);

-- ── Vendors / Suppliers ──────────────────────────────────────
-- One row per supplier. Referenced by ingredient_library.
-- Shopping list output can be grouped and sorted by vendor.

create table if not exists public.vendors (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references auth.users(id) on delete cascade not null,
  name            text not null,      -- "Borgatti's", "Teitel Brothers"
  contact_name    text default '',
  phone           text default '',
  email           text default '',
  address         text default '',
  delivery_days   text[] default '{}',-- ["monday","thursday"]
  order_cutoff    text default '',    -- "by 3pm day prior"
  account_number  text default '',
  notes           text default '',
  is_active       boolean default true,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- ── Staff ────────────────────────────────────────────────────
-- Simple staff list. Used to assign prep tasks in Phase 4.

create table if not exists public.staff (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete cascade not null,
  name       text not null,
  role       text default '',        -- "AM Barista", "PM Bartender", "Pasta Station"
  shift      text default '',        -- "Mon–Sat 5:15AM–1PM"
  is_active  boolean default true,
  created_at timestamptz default now()
);


-- ============================================================
-- SECTION 2 — INGREDIENT LIBRARY
-- Master ingredient list with costing and sourcing data.
-- Recipe ingredients (JSONB) optionally link here via
-- library_id for cost calculations. Not required — recipes
-- still work without it, cost just won't auto-calculate.
-- ============================================================

create table if not exists public.ingredient_library (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid references auth.users(id) on delete cascade not null,
  name                text not null,
  category            text not null default 'other',
                      -- produce|dairy|meat|seafood|pantry|spices|
                      -- bakery|frozen|spirits|mixers|beverages|other
  vendor_id           uuid references public.vendors(id) on delete set null,

  -- Purchase unit (how the vendor sells it)
  purchase_unit       text default '',   -- "lb", "case/6", "each", "750ml bottle"
  purchase_unit_cost  decimal(10,4),     -- cost per purchase unit in USD
  purchase_unit_size  decimal(10,4),     -- e.g. 6 (for a case of 6)

  -- Recipe unit (how recipes use it)
  recipe_unit         text default '',   -- "g", "oz", "cup", "each"
  recipe_unit_is_metric boolean default false,

  -- Conversion: how many recipe_units are in one purchase_unit
  -- e.g. 1 lb = 453.6g, so if purchase=lb and recipe=g, factor=453.6
  unit_conversion     decimal(10,4) default 1.0,

  -- Waste/trim factor: 0.85 means 15% waste after prep
  -- Purchase quantity = recipe quantity / trim_factor
  trim_factor         decimal(5,4) default 1.0
                      check (trim_factor > 0 and trim_factor <= 1),

  -- Allergen flags
  allergens           text[] default '{}',
  -- gluten|dairy|nuts|peanuts|shellfish|eggs|soy|sesame|fish

  notes               text default '',
  is_active           boolean default true,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);


-- ============================================================
-- SECTION 3 — RECIPES TABLE (ALTER EXISTING)
-- Adds all Phase 1–5 columns to the existing table.
-- Safe to run against a table with existing data.
-- ============================================================

-- Menu identity
alter table public.recipes
  add column if not exists menu_name         text default '',
  -- Display name on printed menu (can differ from recipe name)
  -- e.g. recipe_name="Ragù di Manzo 8-Hour" menu_name="Ragù"

  add column if not exists menu_category_id  uuid
    references public.menu_categories(id) on delete set null,

  add column if not exists menu_start_date   date,
  add column if not exists menu_end_date     date,
  -- NULL end_date = permanent menu item

  add column if not exists dayparts          text[] default '{}',
  -- all|breakfast|lunch|dinner|aperitivo|late-night
  -- Empty array = available all dayparts

  add column if not exists menu_position     integer default 0;
  -- Sort order within category on printed menu

-- Sub-recipe support
alter table public.recipes
  add column if not exists is_sub_recipe          boolean default false,
  -- TRUE = this recipe is a component (stock, sauce, dough)
  -- rather than a finished dish

  add column if not exists sub_recipe_yield_amount decimal(10,3),
  add column if not exists sub_recipe_yield_unit   text default '';
  -- e.g. yield_amount=1, yield_unit="gallon"
  -- e.g. yield_amount=500, yield_unit="g"
  -- e.g. yield_amount=12, yield_unit="portions"

-- Costing (Phase 2 — columns added now, populated in Phase 2 UI)
alter table public.recipes
  add column if not exists target_food_cost_pct  decimal(5,2),
  -- e.g. 28.0 = target 28% food cost

  add column if not exists notes                 text default '',
  add column if not exists plating_notes         text default '';
  -- Separate from steps — for FOH/expediter reference

-- Allergens & dietary (surfaced from ingredients, can also be set manually)
alter table public.recipes
  add column if not exists allergens   text[] default '{}',
  add column if not exists dietary     text[] default '{}';
  -- vegetarian|vegan|gluten-free|dairy-free|halal|kosher

-- Status & versioning (Phase 5 — columns added now)
alter table public.recipes
  add column if not exists is_active          boolean default true,
  add column if not exists version            integer default 1,
  add column if not exists parent_version_id  uuid
    references public.recipes(id) on delete set null;
  -- When a recipe is revised, old version is preserved with
  -- is_active=false, new version sets parent_version_id to old id


-- ============================================================
-- SECTION 4 — SUB-RECIPE LINKS
-- Many-to-many: a dish can use multiple sub-recipes,
-- and a sub-recipe (e.g. stock) can be used by many dishes.
-- ============================================================

create table if not exists public.recipe_sub_recipes (
  id                uuid primary key default gen_random_uuid(),
  parent_recipe_id  uuid references public.recipes(id) on delete cascade not null,
  sub_recipe_id     uuid references public.recipes(id) on delete restrict not null,
  -- RESTRICT prevents deleting a sub-recipe that's in use

  amount            decimal(10,3) not null,
  unit              text not null,
  -- How much of the sub-recipe this dish needs
  -- e.g. amount=2, unit="cups" (of stock)

  notes             text default '',
  sort_order        integer default 0,
  created_at        timestamptz default now(),

  unique (parent_recipe_id, sub_recipe_id),
  -- Prevent a recipe linking to itself
  check (parent_recipe_id != sub_recipe_id)
);


-- ============================================================
-- SECTION 5 — MENU PRICING
-- Multiple price points per recipe: by daypart and serving size.
-- e.g. Pasta: ¼lb lunch=$13, ½lb dinner=$20, 1lb family=$34
-- e.g. Negroni: aperitivo=$18, late-night=$18
-- ============================================================

create table if not exists public.menu_pricing (
  id           uuid primary key default gen_random_uuid(),
  recipe_id    uuid references public.recipes(id) on delete cascade not null,
  user_id      uuid references auth.users(id) on delete cascade not null,

  daypart      text not null default 'all',
  -- all|breakfast|lunch|dinner|aperitivo|late-night

  serving_label text default '',
  -- Display label: "¼ lb", "½ lb", "1 lb family", "single", "flight of 3"
  -- Empty = uses recipe base_servings

  serving_multiplier decimal(6,3) default 1.0,
  -- Relative to recipe base_servings
  -- ¼ lb from a ½ lb base recipe = 0.5

  price        decimal(8,2) not null,
  is_active    boolean default true,
  notes        text default '',
  created_at   timestamptz default now(),

  unique (recipe_id, daypart, serving_label)
);


-- ============================================================
-- SECTION 6 — DAILY PRODUCTION PLANNING
-- Cover counts by date and daypart drive shopping quantities
-- and batch scaling. The engine behind the master shopping list.
-- ============================================================

create table if not exists public.daily_production (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid references auth.users(id) on delete cascade not null,
  recipe_id        uuid references public.recipes(id) on delete cascade not null,

  production_date  date not null,
  daypart          text default 'all',

  expected_covers  integer default 0,
  -- How many portions to produce (informed by reservation count,
  -- historical data, day-of-week patterns)

  actual_covers    integer,
  -- Filled in after service — used to improve future forecasts

  batch_multiplier decimal(6,3),
  -- Auto-calculated: expected_covers / recipe.base_servings
  -- Rounded to sensible batch count (e.g. 3 batches of 16, not 47x)

  batch_count      integer,
  -- Suggested whole batches to make (ceiling of batch_multiplier)

  waste_buffer_pct decimal(5,2) default 10.0,
  -- Add X% to shopping quantities for waste/mistakes

  notes            text default '',
  created_at       timestamptz default now(),
  updated_at       timestamptz default now(),

  unique (recipe_id, production_date, daypart)
);


-- ============================================================
-- SECTION 7 — PREP SCHEDULE (T-MINUS TIMING)
-- Generated from daily_production + recipe step durations.
-- Each row = one prep task on one date, assigned to one person.
-- Timeline works backward from service_time through all
-- dependencies including sub-recipes.
-- ============================================================

create table if not exists public.prep_schedule (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid references auth.users(id) on delete cascade not null,
  production_date  date not null,

  recipe_id        uuid references public.recipes(id) on delete cascade,
  step_id          text not null,
  -- References step.id in recipe.steps JSONB

  staff_id         uuid references public.staff(id) on delete set null,
  -- NULL = unassigned

  -- Calculated times (set when schedule is generated)
  service_time     timetz,
  -- Target time this task must be COMPLETE by

  scheduled_start  timetz,
  -- service_time minus step.duration minus buffer

  scheduled_end    timetz,
  duration_minutes integer,

  -- Execution tracking
  status           text default 'pending'
                   check (status in ('pending','in-progress','complete','skipped')),
  actual_start     timestamptz,
  actual_end       timestamptz,

  notes            text default '',
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);


-- ============================================================
-- SECTION 8 — SHOPPING LIST SESSIONS
-- Named, dated shopping lists generated from daily_production.
-- Separate from per-recipe shopping_checks (which is ad hoc).
-- ============================================================

create table if not exists public.shopping_lists (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references auth.users(id) on delete cascade not null,
  name            text not null,          -- "Week of Jun 2 — Kitchen"
  list_date       date not null,
  list_type       text default 'kitchen'
                  check (list_type in ('kitchen','bar','both')),
  -- kitchen = food ingredients only
  -- bar = spirits/mixers/beverages only (routes to bar manager)
  -- both = everything

  date_from       date,                   -- covers production dates from→to
  date_to         date,
  status          text default 'draft'
                  check (status in ('draft','ordered','received')),
  notes           text default '',
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create table if not exists public.shopping_list_items (
  id               uuid primary key default gen_random_uuid(),
  shopping_list_id uuid references public.shopping_lists(id) on delete cascade not null,
  user_id          uuid references auth.users(id) on delete cascade not null,

  -- Ingredient identity
  ingredient_name  text not null,
  category         text default 'other',
  library_id       uuid references public.ingredient_library(id) on delete set null,
  vendor_id        uuid references public.vendors(id) on delete set null,

  -- Quantities
  recipe_quantity  decimal(10,3),       -- total needed by recipes (recipe units)
  recipe_unit      text default '',
  purchase_quantity decimal(10,3),      -- adjusted for trim factor + waste buffer
  purchase_unit    text default '',     -- vendor's unit (lb, case, each)

  -- Cost
  unit_cost        decimal(10,4),
  total_cost       decimal(10,2),

  -- Status
  is_checked       boolean default false,
  actual_quantity  decimal(10,3),       -- what was actually ordered/received
  notes            text default '',

  sort_order       integer default 0,
  created_at       timestamptz default now()
);


-- ============================================================
-- SECTION 9 — ROW LEVEL SECURITY
-- ============================================================

alter table public.menu_categories     enable row level security;
alter table public.vendors             enable row level security;
alter table public.staff               enable row level security;
alter table public.ingredient_library  enable row level security;
alter table public.recipe_sub_recipes  enable row level security;
alter table public.menu_pricing        enable row level security;
alter table public.daily_production    enable row level security;
alter table public.prep_schedule       enable row level security;
alter table public.shopping_lists      enable row level security;
alter table public.shopping_list_items enable row level security;

-- Pattern: users own their own rows across all tables
do $$
declare
  tbl text;
  pol text;
begin
  foreach tbl in array array[
    'menu_categories','vendors','staff','ingredient_library',
    'menu_pricing','daily_production','prep_schedule',
    'shopping_lists','shopping_list_items'
  ] loop
    pol := 'Users own their ' || tbl;
    execute format(
      'create policy %I on public.%I for all
       using (auth.uid() = user_id)
       with check (auth.uid() = user_id)',
      pol, tbl
    );
  end loop;
end $$;

-- recipe_sub_recipes is owned through the parent recipe's user_id
create policy "Users own their recipe_sub_recipes"
  on public.recipe_sub_recipes for all
  using (
    exists (
      select 1 from public.recipes r
      where r.id = recipe_sub_recipes.parent_recipe_id
        and r.user_id = auth.uid()
    )
  );


-- ============================================================
-- SECTION 10 — UPDATED_AT TRIGGERS
-- ============================================================

-- Reuse the existing set_updated_at() function from schema_v1

create trigger vendors_updated_at
  before update on public.vendors
  for each row execute function public.set_updated_at();

create trigger ingredient_library_updated_at
  before update on public.ingredient_library
  for each row execute function public.set_updated_at();

create trigger daily_production_updated_at
  before update on public.daily_production
  for each row execute function public.set_updated_at();

create trigger prep_schedule_updated_at
  before update on public.prep_schedule
  for each row execute function public.set_updated_at();

create trigger shopping_lists_updated_at
  before update on public.shopping_lists
  for each row execute function public.set_updated_at();


-- ============================================================
-- SECTION 11 — INDEXES
-- ============================================================

-- menu_categories
create index if not exists menu_cats_user_idx
  on public.menu_categories(user_id, sort_order);

-- vendors
create index if not exists vendors_user_idx
  on public.vendors(user_id);

-- ingredient_library
create index if not exists inglib_user_idx
  on public.ingredient_library(user_id);
create index if not exists inglib_vendor_idx
  on public.ingredient_library(vendor_id);
create index if not exists inglib_name_idx
  on public.ingredient_library(user_id, name);

-- recipes (new columns)
create index if not exists recipes_category_idx
  on public.recipes(menu_category_id);
create index if not exists recipes_dates_idx
  on public.recipes(menu_start_date, menu_end_date);
create index if not exists recipes_sub_recipe_idx
  on public.recipes(is_sub_recipe);

-- recipe_sub_recipes
create index if not exists rsr_parent_idx
  on public.recipe_sub_recipes(parent_recipe_id);
create index if not exists rsr_sub_idx
  on public.recipe_sub_recipes(sub_recipe_id);

-- daily_production
create index if not exists dp_date_idx
  on public.daily_production(user_id, production_date);
create index if not exists dp_recipe_idx
  on public.daily_production(recipe_id);

-- prep_schedule
create index if not exists ps_date_idx
  on public.prep_schedule(user_id, production_date);
create index if not exists ps_staff_idx
  on public.prep_schedule(staff_id);

-- shopping_lists
create index if not exists sl_user_date_idx
  on public.shopping_lists(user_id, list_date);

-- shopping_list_items
create index if not exists sli_list_idx
  on public.shopping_list_items(shopping_list_id);
create index if not exists sli_vendor_idx
  on public.shopping_list_items(vendor_id);


-- ============================================================
-- SECTION 12 — USEFUL VIEWS
-- Pre-built queries you'll call often in the app.
-- ============================================================

-- Active menu items for a given date
-- Usage: select * from active_menu where user_id = auth.uid()
--        and '$date' between menu_start_date and coalesce(menu_end_date, '2099-12-31')
create or replace view public.active_menu as
  select
    r.*,
    mc.name  as category_name,
    mc.value as category_value,
    mc.color as category_color,
    mc.is_bar,
    mc.sort_order as category_sort_order
  from public.recipes r
  left join public.menu_categories mc on mc.id = r.menu_category_id
  where r.is_active = true
     or r.is_active is null;  -- backwards compat with v1 rows

-- Recipe with sub-recipe details (one level deep)
create or replace view public.recipes_with_subs as
  select
    r.id,
    r.name,
    r.menu_name,
    r.user_id,
    rsr.sub_recipe_id,
    sub.name  as sub_recipe_name,
    rsr.amount as sub_amount,
    rsr.unit   as sub_unit,
    sub.sub_recipe_yield_amount,
    sub.sub_recipe_yield_unit
  from public.recipes r
  left join public.recipe_sub_recipes rsr on rsr.parent_recipe_id = r.id
  left join public.recipes sub on sub.id = rsr.sub_recipe_id;

-- Food cost view (joins recipes to ingredient_library costs)
-- Returns estimated cost per base serving where library data exists
create or replace view public.recipe_cost_summary as
  select
    r.id,
    r.name,
    r.menu_name,
    r.user_id,
    r.base_servings,
    r.target_food_cost_pct,
    (
      select coalesce(sum(
        -- ingredient amount × (library cost per recipe unit)
        (ing->>'amount')::decimal
        * coalesce(
            il.purchase_unit_cost / nullif(il.unit_conversion, 0) / nullif(il.trim_factor, 0),
            0
          )
      ), 0)
      from jsonb_array_elements(r.ingredients) as ing
      left join public.ingredient_library il
        on il.id = (ing->>'library_id')::uuid
    ) as total_cost,
    (
      select coalesce(sum(
        (ing->>'amount')::decimal
        * coalesce(
            il.purchase_unit_cost / nullif(il.unit_conversion, 0) / nullif(il.trim_factor, 0),
            0
          )
      ) / nullif(r.base_servings, 0), 0)
      from jsonb_array_elements(r.ingredients) as ing
      left join public.ingredient_library il
        on il.id = (ing->>'library_id')::uuid
    ) as cost_per_serving
  from public.recipes r;


-- ============================================================
-- SECTION 13 — SEED DATA (Corretto-specific)
-- Default menu categories seeded for the authenticated user.
-- Run this AFTER your first login so auth.uid() resolves.
--
-- Replace 'YOUR-USER-UUID' with your actual user ID from:
-- Supabase → Authentication → Users → copy your UUID
-- ============================================================

-- UNCOMMENT AND EDIT before running:

/*
insert into public.menu_categories (user_id, name, value, description, color, sort_order, is_bar)
values
  ('YOUR-USER-UUID', 'Caffetteria',         'caffetteria',  'Espresso drinks',                 '#4A3728', 1,  false),
  ('YOUR-USER-UUID', 'Pasticceria',         'pasticceria',  'AM pastries and baked goods',     '#8B6914', 2,  false),
  ('YOUR-USER-UUID', 'Salatini',            'salatini',     'Bar snacks',                      '#B85C38', 3,  false),
  ('YOUR-USER-UUID', 'Crostini',            'crostini',     'Crostini & pane',                 '#C49A3C', 4,  false),
  ('YOUR-USER-UUID', 'Pasta',              'pasta',        'Fresh pasta program',             '#C05A2A', 5,  false),
  ('YOUR-USER-UUID', 'Insalata',           'insalata',     'Salads',                          '#5C6B3A', 6,  false),
  ('YOUR-USER-UUID', 'Dolci',              'dolci',        'Desserts',                        '#7A4F6D', 7,  false),
  ('YOUR-USER-UUID', 'Spritz',             'spritz',       'Aperitivo spritz',                '#E8A020', 8,  true),
  ('YOUR-USER-UUID', 'Negroni',            'negroni',      'Negroni variations',              '#C03030', 9,  true),
  ('YOUR-USER-UUID', 'Amaro',             'amaro',        'Amaro program',                   '#6B3A5C', 10, true),
  ('YOUR-USER-UUID', 'Digestivi',         'digestivi',    'Digestivi & grappa',              '#2C4A6B', 11, true),
  ('YOUR-USER-UUID', 'Vini',              'vini',         'Wine by glass and bottle',        '#722F37', 12, true),
  ('YOUR-USER-UUID', 'Birra',             'birra',        'Beer',                            '#C49A3C', 13, true),
  ('YOUR-USER-UUID', 'Analcolici',        'analcolici',   'Non-alcoholic',                   '#3A6B5C', 14, true),
  ('YOUR-USER-UUID', 'Sub-Recipes',       'sub-recipes',  'Stocks, sauces, bases',           '#888780', 99, false);
*/

-- ============================================================
-- SECTION 14 — SEED VENDORS (Corretto suppliers)
-- Same instructions — replace YOUR-USER-UUID
-- ============================================================

/*
insert into public.vendors (user_id, name, contact_name, phone, address, delivery_days, notes)
values
  ('YOUR-USER-UUID', 'Borgatti''s Ravioli & Egg Noodles', '',        '(718) 367-3799', '632 E. 187th St, Bronx NY',     '{"thursday"}', 'Fresh pasta sheets + ravioli. Weekly Bronx run.'),
  ('YOUR-USER-UUID', 'Teitel Brothers',                    '',        '',               'Arthur Avenue, The Bronx',      '{"thursday"}', 'Prosciutto di Parma — hand-cut sheets. Same Bronx run as Borgatti''s.'),
  ('YOUR-USER-UUID', 'Arthur Avenue Market',               '',        '',               'The Bronx, NY',                 '{"thursday"}', 'Anchovies, lupini, biscotti, sardines. Same Bronx run.'),
  ('YOUR-USER-UUID', 'Gustiamo',                           '',        '',               'The Bronx, NY',                 '{"thursday"}', 'Nocellara olives, colatura, specialty pantry. Wholesale account.'),
  ('YOUR-USER-UUID', 'Prospero Winery',                    '',        '(914) 769-6252', '123 Castleton St, Pleasantville NY', '{}',   'House wine by carboy. Red/white/rosé. Subject to CT carboy confirmation.'),
  ('YOUR-USER-UUID', 'Colle Bereto',                       '',        '',               'Radda in Chianti, Tuscany',     '{}',           'Estate wine + EVOO. Personal relationship with owner. Irreplaceable.');
*/


-- ============================================================
-- END OF MIGRATION
-- ============================================================
--
-- WHAT'S NEXT (Phase 2 — costing UI):
--   1. Build ingredient_library management UI (add/edit ingredients with costs)
--   2. Link recipe ingredients to library entries (library_id in JSONB)
--   3. Display cost_per_serving from recipe_cost_summary view
--   4. Build menu_pricing UI (add price points per daypart)
--   5. Show food cost % vs. target on recipe view
--
-- WHAT THIS SCHEMA ENABLES RIGHT NOW (even before UI is built):
--   - menu_categories: categorize existing recipes immediately
--   - menu_start_date/end_date: mark seasonal items
--   - is_sub_recipe: flag stock/sauce recipes
--   - vendors: record your supplier list
--   - recipe_sub_recipes: link ragù to its stock base
-- ============================================================
