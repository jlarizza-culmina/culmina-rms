-- ============================================================
-- Culmina RMS — Phase 2: Recipe Intelligence
-- Run after schema_v3_multitenant.sql
-- ============================================================

alter table public.recipes
  add column if not exists seasons             text[]  default '{}',
  add column if not exists recipe_stage        text    default 'development'
    check (recipe_stage in ('development','testing','active','specials_candidate','retired')),
  add column if not exists is_special          boolean default false,
  add column if not exists server_notes        text    default '',
  add column if not exists parent_recipe_id    uuid    references public.recipes(id) on delete set null,
  add column if not exists variation_overrides jsonb   default null;

-- Index for finding variations by parent
create index if not exists recipes_parent_idx
  on public.recipes (parent_recipe_id)
  where parent_recipe_id is not null;

-- Index for filtering by stage
create index if not exists recipes_stage_idx
  on public.recipes (restaurant_id, recipe_stage);

-- Index for specials
create index if not exists recipes_special_idx
  on public.recipes (restaurant_id, is_special)
  where is_special = true;

-- Back-fill existing active recipes to 'active' stage
-- (Only recipes that are already on_menu or orderable should be active)
update public.recipes
  set recipe_stage = 'active'
  where menu_status in ('on_menu', 'orderable', 'special')
    and recipe_stage = 'development';
