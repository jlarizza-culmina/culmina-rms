-- ============================================================
-- Culmina RMS — Phase 9B-1: Waitlist + Loyalty Capture
-- Run after schema_v8_phase6.sql
-- ============================================================

-- ── Guests (loyalty database) ─────────────────────────────────
create table if not exists public.guests (
  id                    uuid primary key default gen_random_uuid(),
  restaurant_id         uuid references public.restaurants(id) on delete cascade not null,
  first_name            text not null,
  last_name             text default '',
  phone                 text not null,
  email                 text default '',
  birthday_month        smallint check (birthday_month between 1 and 12),
  birthday_day          smallint check (birthday_day between 1 and 31),
  sms_opt_in            boolean default false,
  email_opt_in          boolean default false,
  preferred_location_id uuid references public.locations(id) on delete set null,
  first_visit_date      date default current_date,
  visit_count           integer default 1,
  last_visit_date       date default current_date,
  source                text default 'waitlist',  -- waitlist | manual | import
  notes                 text default '',
  created_at            timestamptz default now(),
  updated_at            timestamptz default now(),
  unique (restaurant_id, phone)
);

-- ── Waitlist sessions ─────────────────────────────────────────
create table if not exists public.waitlist_sessions (
  id                uuid primary key default gen_random_uuid(),
  restaurant_id     uuid references public.restaurants(id) on delete cascade not null,
  location_id       uuid references public.locations(id) on delete cascade not null,
  guest_id          uuid references public.guests(id) on delete set null,
  guest_name        text not null,
  party_size        smallint not null default 1,
  phone             text not null,
  status            text default 'waiting'
                    check (status in ('waiting','notified','seated','no_show','cancelled')),
  joined_at         timestamptz default now(),
  notified_at       timestamptz,
  seated_at         timestamptz,
  -- MTA fields (9B-2)
  train_id          text,
  estimated_arrival timestamptz,
  notes             text default '',
  created_at        timestamptz default now()
);

-- ── Location waitlist settings ────────────────────────────────
create table if not exists public.location_waitlist_settings (
  id                uuid primary key default gen_random_uuid(),
  location_id       uuid references public.locations(id) on delete cascade not null unique,
  is_active         boolean default true,
  walk_time_minutes smallint default 2,
  max_party_size    smallint default 10,
  welcome_message   text default '',
  -- Shown on join confirmation
  confirmation_msg  text default 'We''ll text you when your table is ready.',
  -- MTA settings (9B-2)
  mta_station_id    text default '',
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

-- ── Public read access for join form ─────────────────────────
-- Guests need to read restaurant + location info without auth
alter table public.restaurants enable row level security;
alter table public.locations    enable row level security;

-- Allow public to read active restaurant names + branding (for join page)
drop policy if exists "Public read active restaurants" on public.restaurants;
create policy "Public read active restaurants"
  on public.restaurants for select
  using (is_active = true);

-- Allow public to read active location names (for join page)
drop policy if exists "Public read active locations" on public.locations;
create policy "Public read active locations"
  on public.locations for select
  using (is_active = true);

-- ── RLS for waitlist tables ───────────────────────────────────
alter table public.guests                   enable row level security;
alter table public.waitlist_sessions        enable row level security;
alter table public.location_waitlist_settings enable row level security;

-- Restaurant members can see their guests
create policy "Members see their guests"
  on public.guests for select
  using (restaurant_id = public.get_user_restaurant_id() or public.is_super_admin());

create policy "Admins manage guests"
  on public.guests for all
  using (public.is_super_admin() or restaurant_id = public.get_user_restaurant_id());

-- Restaurant members can see their sessions
create policy "Members see their waitlist"
  on public.waitlist_sessions for select
  using (restaurant_id = public.get_user_restaurant_id() or public.is_super_admin());

create policy "Members manage their waitlist"
  on public.waitlist_sessions for all
  using (public.is_super_admin() or restaurant_id = public.get_user_restaurant_id());

-- Location waitlist settings
create policy "Members see their waitlist settings"
  on public.location_waitlist_settings for select
  using (
    location_id in (select id from public.locations where restaurant_id = public.get_user_restaurant_id())
    or public.is_super_admin()
  );

create policy "Admins manage waitlist settings"
  on public.location_waitlist_settings for all
  using (
    public.is_super_admin() or
    location_id in (select id from public.locations where restaurant_id = public.get_user_restaurant_id())
  );

-- ── Indexes ───────────────────────────────────────────────────
create index if not exists guests_restaurant_idx     on public.guests (restaurant_id);
create index if not exists guests_phone_idx          on public.guests (restaurant_id, phone);
create index if not exists guests_birthday_idx       on public.guests (restaurant_id, birthday_month, birthday_day);
create index if not exists sessions_location_idx     on public.waitlist_sessions (location_id, status, joined_at);
create index if not exists sessions_status_idx       on public.waitlist_sessions (restaurant_id, status);

-- ── Join waitlist RPC (SECURITY DEFINER — bypasses RLS) ──────
create or replace function public.join_waitlist(
  p_restaurant_id       uuid,
  p_location_id         uuid,
  p_first_name          text,
  p_last_name           text,
  p_phone               text,
  p_party_size          int,
  p_email               text default '',
  p_birthday_month      int  default null,
  p_birthday_day        int  default null,
  p_sms_opt_in          boolean default false,
  p_email_opt_in        boolean default false,
  p_preferred_loc_id    uuid default null
) returns json language plpgsql security definer as $$
declare
  v_guest_id   uuid;
  v_session_id uuid;
  v_position   int;
  v_wait_count int;
begin
  -- Upsert guest by phone+restaurant
  insert into public.guests (
    restaurant_id, first_name, last_name, phone, email,
    birthday_month, birthday_day, sms_opt_in, email_opt_in,
    preferred_location_id, source,
    first_visit_date, last_visit_date, visit_count
  ) values (
    p_restaurant_id, p_first_name, p_last_name, p_phone, p_email,
    p_birthday_month, p_birthday_day, p_sms_opt_in, p_email_opt_in,
    p_preferred_loc_id, 'waitlist',
    current_date, current_date, 1
  )
  on conflict (restaurant_id, phone) do update set
    last_visit_date       = current_date,
    visit_count           = guests.visit_count + 1,
    email                 = coalesce(nullif(excluded.email, ''), guests.email),
    birthday_month        = coalesce(excluded.birthday_month, guests.birthday_month),
    birthday_day          = coalesce(excluded.birthday_day, guests.birthday_day),
    sms_opt_in            = excluded.sms_opt_in or guests.sms_opt_in,
    email_opt_in          = excluded.email_opt_in or guests.email_opt_in,
    preferred_location_id = coalesce(excluded.preferred_location_id, guests.preferred_location_id),
    updated_at            = now()
  returning id into v_guest_id;

  -- Create session
  insert into public.waitlist_sessions (
    restaurant_id, location_id, guest_id,
    guest_name, party_size, phone, status, joined_at
  ) values (
    p_restaurant_id, p_location_id, v_guest_id,
    trim(p_first_name || ' ' || p_last_name), p_party_size, p_phone,
    'waiting', now()
  ) returning id into v_session_id;

  -- Queue position (count waiting ahead of this session)
  select count(*) into v_position
  from public.waitlist_sessions
  where location_id = p_location_id
    and status = 'waiting'
    and joined_at <= (select joined_at from public.waitlist_sessions where id = v_session_id);

  -- Total waiting
  select count(*) into v_wait_count
  from public.waitlist_sessions
  where location_id = p_location_id and status = 'waiting';

  return json_build_object(
    'session_id', v_session_id,
    'guest_id',   v_guest_id,
    'position',   v_position,
    'total',      v_wait_count
  );
end;
$$;
