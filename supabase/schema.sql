-- ============================================================
-- Recipe Manager — Supabase Schema
-- Run this in: Supabase Dashboard > SQL Editor > New query
-- ============================================================

-- Recipes table
create table if not exists public.recipes (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references auth.users(id) on delete cascade not null,
  name            text not null,
  description     text default '',
  recipe_type     text default 'food' check (recipe_type in ('food','cocktail')),
  base_servings   integer default 4,
  prep_time       integer default 0,
  cook_time       integer default 0,
  ingredients     jsonb default '[]'::jsonb,
  steps           jsonb default '[]'::jsonb,
  nutrition       jsonb default '{}'::jsonb,
  cocktail_details jsonb default null,
  tags            text[] default '{}',
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- Shopping checklist state (persisted per user per recipe)
create table if not exists public.shopping_checks (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references auth.users(id) on delete cascade not null,
  recipe_id       uuid references public.recipes(id) on delete cascade not null,
  ingredient_id   text not null,
  checked         boolean default false,
  created_at      timestamptz default now(),
  unique (user_id, recipe_id, ingredient_id)
);

-- ── Row Level Security ──────────────────────────────────────

alter table public.recipes enable row level security;
alter table public.shopping_checks enable row level security;

-- Users can only see/edit their own recipes
create policy "Users own their recipes"
  on public.recipes for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Users can only see/edit their own shopping checks
create policy "Users own their shopping checks"
  on public.shopping_checks for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── Auto-update updated_at ──────────────────────────────────

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger recipes_updated_at
  before update on public.recipes
  for each row execute function public.set_updated_at();

-- ── Indexes ─────────────────────────────────────────────────

create index if not exists recipes_user_id_idx on public.recipes(user_id);
create index if not exists recipes_created_at_idx on public.recipes(created_at desc);
create index if not exists shopping_checks_user_recipe_idx on public.shopping_checks(user_id, recipe_id);
