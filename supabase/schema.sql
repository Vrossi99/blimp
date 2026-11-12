-- =====================================================================
-- BLIMP — database setup
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Safe to run again: it drops and recreates Blimp's own objects.
-- Money here is PLAY MONEY. Real payouts come later through Stripe.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- clean re-run ----------
drop table if exists public.cashouts cascade;
drop table if exists public.unlocks cascade;
drop table if exists public.claims cascade;
drop table if exists public.drop_owners cascade;
drop table if exists public.drops cascade;
drop table if exists public.wallets cascade;
drop table if exists public.profiles cascade;

-- ---------- tables ----------
-- Public part of a person: just their @name. Everyone can read it.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  handle text unique check (handle ~ '^[a-z0-9_.]{3,20}$'),
  created_at timestamptz not null default now()
);

-- Private part: balance, payout method, who they follow. Only they can read it.
create table public.wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance numeric(12,2) not null default 500 check (balance >= 0),
  payout_type text check (payout_type in ('card','bank')),
  payout_last4 text,
  follows uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

-- A drop. Who owns it lives in drop_owners so anonymous drops never leak the owner.
create table public.drops (
  id uuid primary key default gen_random_uuid(),
  official boolean not null default false,
  public_owner uuid references auth.users(id) on delete set null,  -- null when anonymous
  owner_handle text,                                                -- null when anonymous
  name text not null check (char_length(name) between 1 and 24),
  color text not null check (color in ('Green','Blue','Yellow','Orange','Red')),
  pool numeric(12,2) not null check (pool > 0),
  per numeric(12,2) not null check (per >= 1),
  max_people int not null check (max_people between 1 and 500),
  claimed_count int not null default 0,
  lat double precision not null,
  lng double precision not null,
  radius_m int not null check (radius_m in (100,160,400)),
  visibility text not null default 'public' check (visibility in ('public','code')),
  rule text not null default 'there' check (rule in ('there','anywhere')),
  code text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz,
  settled boolean not null default false,
  refund numeric(12,2) not null default 0
);

create table public.drop_owners (
  drop_id uuid primary key references public.drops(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade
);
create index on public.drop_owners(owner_id);

create table public.claims (
  id bigserial primary key,
  drop_id uuid not null references public.drops(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,  -- null = simulated test claim
  amount numeric(12,2) not null,
  lat double precision,
  lng double precision,
  simulated boolean not null default false,
  created_at timestamptz not null default now(),
  unique (drop_id, user_id)
);
create index on public.claims(user_id, created_at);

-- Code-only drops someone has unlocked by typing the code.
create table public.unlocks (
  user_id uuid not null references auth.users(id) on delete cascade,
  drop_id uuid not null references public.drops(id) on delete cascade,
  primary key (user_id, drop_id)
);

create table public.cashouts (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  amount numeric(12,2) not null,
  destination text not null,
  created_at timestamptz not null default now()
);

-- ---------- new people get a profile + $500 play wallet ----------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id) values (new.id) on conflict do nothing;
  insert into public.wallets(user_id) values (new.id) on conflict do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- row-level security (who can read what) ----------
alter table public.profiles enable row level security;
alter table public.wallets enable row level security;
alter table public.drops enable row level security;
alter table public.drop_owners enable row level security;
alter table public.claims enable row level security;
alter table public.unlocks enable row level security;
alter table public.cashouts enable row level security;

create policy "profiles readable" on public.profiles for select to authenticated using (true);
create policy "own wallet" on public.wallets for select to authenticated using (user_id = auth.uid());
create policy "own drop ownership" on public.drop_owners for select to authenticated using (owner_id = auth.uid());
create policy "visible drops" on public.drops for select to authenticated using (
  visibility = 'public'
  or exists (select 1 from public.drop_owners o where o.drop_id = drops.id and o.owner_id = auth.uid())
  or exists (select 1 from public.unlocks u where u.drop_id = drops.id and u.user_id = auth.uid())
);
create policy "own claims or claims on my drops" on public.claims for select to authenticated using (
  user_id = auth.uid()
  or exists (select 1 from public.drop_owners o where o.drop_id = claims.drop_id and o.owner_id = auth.uid())
);
create policy "own unlocks" on public.unlocks for select to authenticated using (user_id = auth.uid());
create policy "own cashouts" on public.cashouts for select to authenticated using (user_id = auth.uid());
-- No insert/update/delete policies: every change goes through the functions below.

-- ---------- helpers ----------
create or replace function public.blimp_distance_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision language sql immutable as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  ))
$$;

create or replace function public.blimp_new_code() returns text language plpgsql as $$
declare alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; c text; i int;
begin
  loop
    c := '';
    for i in 1..5 loop c := c || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1); end loop;
    exit when not exists (select 1 from public.drops where code = c);
  end loop;
  return c;
end $$;

create or replace function public.blimp_require_user() returns uuid language plpgsql as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  return auth.uid();
end $$;

-- Pays back whatever wasn't claimed once a drop is over. Safe to call repeatedly.
create or replace function public.blimp_settle(p_drop uuid) returns void
language plpgsql security definer set search_path = public as $$
declare d public.drops; o uuid; back numeric(12,2);
begin
  select * into d from public.drops where id = p_drop for update;
  if not found or d.settled then return; end if;
  if d.ended_at is null and d.expires_at > now() and d.claimed_count < d.max_people then return; end if;
  back := greatest(0, d.max_people - d.claimed_count) * d.per;
  select owner_id into o from public.drop_owners where drop_id = p_drop;
  if o is not null and back > 0 then
    update public.wallets set balance = balance + back where user_id = o;
  end if;
  update public.drops set settled = true, refund = back where id = p_drop;
end $$;

-- ---------- actions the app calls ----------
create or replace function public.set_handle(p_handle text) returns text
language plpgsql security definer set search_path = public as $$
declare me uuid := public.blimp_require_user(); h text := lower(regexp_replace(trim(p_handle), '^@+', ''));
begin
  if h !~ '^[a-z0-9_.]{3,20}$' then raise exception 'Use 3–20 letters, numbers, dots or underscores.'; end if;
  if exists (select 1 from public.profiles where handle = h and id <> me) then raise exception '@% is taken. Try another.', h; end if;
  update public.profiles set handle = h where id = me;
  return h;
end $$;

create or replace function public.create_drop(
  p_name text, p_color text, p_pool numeric, p_people int, p_radius int, p_minutes int,
  p_visibility text, p_rule text, p_anon boolean, p_lat double precision, p_lng double precision
) returns public.drops
language plpgsql security definer set search_path = public as $$
declare me uuid := public.blimp_require_user(); w public.wallets; h text;
  per numeric(12,2); used numeric(12,2); fee numeric(12,2); total numeric(12,2); d public.drops; anon boolean := coalesce(p_anon, true);
begin
  if coalesce(trim(p_name), '') = '' then raise exception 'Name your drop.'; end if;
  if p_people is null or p_people < 1 or p_people > 500 then raise exception 'Between 1 and 500 people can claim.'; end if;
  if p_pool is null or p_pool < 1 then raise exception 'The pool has to be at least $1.'; end if;
  if p_minutes not in (2, 10, 30, 60) then raise exception 'Pick a valid time.'; end if;
  per := floor(p_pool / p_people * 100) / 100;
  if per < 1 then raise exception 'Keep it to at least $1 per person.'; end if;
  used := per * p_people;
  fee := round(used * 0.05, 2);
  total := used + fee;
  select * into w from public.wallets where user_id = me for update;
  if w.balance < total then raise exception 'Not enough play money for that drop.'; end if;
  select handle into h from public.profiles where id = me;
  if h is null then anon := true; end if;
  update public.wallets set balance = balance - total where user_id = me;
  insert into public.drops(name, color, pool, per, max_people, lat, lng, radius_m, visibility, rule, code, expires_at, public_owner, owner_handle)
  values (left(trim(p_name), 24), p_color, used, per, p_people, p_lat, p_lng, p_radius, p_visibility, p_rule,
          public.blimp_new_code(), now() + make_interval(mins => p_minutes),
          case when anon then null else me end, case when anon then null else h end)
  returning * into d;
  insert into public.drop_owners(drop_id, owner_id) values (d.id, me);
  return d;
end $$;

-- The claim: every rule is checked here on the server, not in the app.
create or replace function public.claim_drop(p_drop uuid, p_lat double precision, p_lng double precision, p_accuracy double precision default 0)
returns json language plpgsql security definer set search_path = public as $$
declare me uuid := public.blimp_require_user(); d public.drops; dist double precision; recent int; bal numeric(12,2);
begin
  select * into d from public.drops where id = p_drop for update;
  if not found then raise exception 'That drop doesn’t exist.'; end if;
  if d.visibility = 'code' and not exists (select 1 from public.unlocks where user_id = me and drop_id = p_drop)
     and not exists (select 1 from public.drop_owners where drop_id = p_drop and owner_id = me) then
    raise exception 'Enter the drop code first.';
  end if;
  if d.ended_at is not null or d.expires_at <= now() then raise exception 'This blimp drifted off.'; end if;
  if d.claimed_count >= d.max_people then raise exception 'Every claim is taken.'; end if;
  if exists (select 1 from public.drop_owners where drop_id = p_drop and owner_id = me) then raise exception 'This is your drop.'; end if;
  if exists (select 1 from public.claims where drop_id = p_drop and user_id = me) then raise exception 'You already claimed this one.'; end if;
  -- anti-farming: daily cap per person
  select count(*) into recent from public.claims where user_id = me and created_at > now() - interval '24 hours';
  if recent >= 25 then raise exception 'Daily claim limit reached. Try again tomorrow.'; end if;
  if d.rule = 'there' then
    if p_lat is null or p_lng is null then raise exception 'Turn on location to claim.'; end if;
    dist := public.blimp_distance_m(d.lat, d.lng, p_lat, p_lng);
    if dist > d.radius_m + least(coalesce(p_accuracy, 0), 30) then raise exception 'Get inside the zone to claim.'; end if;
  end if;
  insert into public.claims(drop_id, user_id, amount, lat, lng) values (p_drop, me, d.per, p_lat, p_lng);
  update public.drops set claimed_count = claimed_count + 1 where id = p_drop;
  update public.wallets set balance = balance + d.per where user_id = me returning balance into bal;
  if d.claimed_count + 1 >= d.max_people then perform public.blimp_settle(p_drop); end if;
  return json_build_object('amount', d.per, 'balance', bal, 'name', d.name);
end $$;

create or replace function public.end_drop(p_drop uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.blimp_require_user();
begin
  if not exists (select 1 from public.drop_owners where drop_id = p_drop and owner_id = me) then raise exception 'Not your drop.'; end if;
  update public.drops set ended_at = now() where id = p_drop and ended_at is null and expires_at > now();
  perform public.blimp_settle(p_drop);
end $$;

create or replace function public.settle_my_drops() returns int
language plpgsql security definer set search_path = public as $$
declare me uuid := public.blimp_require_user(); r record; n int := 0;
begin
  for r in select d.id from public.drops d join public.drop_owners o on o.drop_id = d.id
           where o.owner_id = me and not d.settled
             and (d.ended_at is not null or d.expires_at <= now() or d.claimed_count >= d.max_people) loop
    perform public.blimp_settle(r.id); n := n + 1;
  end loop;
  return n;
end $$;

-- Test helper: the owner can fake a claim to watch their drop fill. No money moves.
create or replace function public.simulate_claim(p_drop uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.blimp_require_user(); d public.drops; a double precision; r double precision;
begin
  if not exists (select 1 from public.drop_owners where drop_id = p_drop and owner_id = me) then raise exception 'Not your drop.'; end if;
  select * into d from public.drops where id = p_drop for update;
  if d.ended_at is not null or d.expires_at <= now() or d.claimed_count >= d.max_people then raise exception 'This drop is over.'; end if;
  a := random() * 2 * pi(); r := sqrt(random()) * d.radius_m * 0.9;
  insert into public.claims(drop_id, user_id, amount, lat, lng, simulated)
  values (p_drop, null, d.per, d.lat + (r * cos(a)) / 111320.0, d.lng + (r * sin(a)) / (111320.0 * cos(radians(d.lat))), true);
  update public.drops set claimed_count = claimed_count + 1 where id = p_drop;
  if d.claimed_count + 1 >= d.max_people then perform public.blimp_settle(p_drop); end if;
end $$;

create or replace function public.unlock_code(p_code text) returns public.drops
language plpgsql security definer set search_path = public as $$
declare me uuid := public.blimp_require_user(); d public.drops;
begin
  select * into d from public.drops where code = upper(trim(p_code));
  if not found then raise exception 'No drop with that code.'; end if;
  if (d.ended_at is not null or d.expires_at <= now())
     and not exists (select 1 from public.drop_owners where drop_id = d.id and owner_id = me) then
    raise exception 'That drop already drifted off.';
  end if;
  insert into public.unlocks(user_id, drop_id) values (me, d.id) on conflict do nothing;
  return d;
end $$;

create or replace function public.toggle_follow(p_user uuid) returns uuid[]
language plpgsql security definer set search_path = public as $$
declare me uuid := public.blimp_require_user(); f uuid[];
begin
  if p_user = me then raise exception 'You can’t follow yourself.'; end if;
  select follows into f from public.wallets where user_id = me for update;
  if p_user = any(f) then f := array_remove(f, p_user); else f := array_append(f, p_user); end if;
  update public.wallets set follows = f where user_id = me;
  return f;
end $$;

-- Demo payout method. Real version: Stripe Connect onboarding.
create or replace function public.set_payout(p_type text) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.blimp_require_user();
begin
  if p_type not in ('card','bank') then raise exception 'Pick a debit card or bank account.'; end if;
  update public.wallets set payout_type = p_type, payout_last4 = case when p_type = 'bank' then '6789' else '4242' end where user_id = me;
end $$;

create or replace function public.cash_out() returns numeric
language plpgsql security definer set search_path = public as $$
declare me uuid := public.blimp_require_user(); w public.wallets;
begin
  select * into w from public.wallets where user_id = me for update;
  if w.payout_type is null then raise exception 'Set up payouts first.'; end if;
  if w.balance <= 0 then raise exception 'Nothing to cash out yet.'; end if;
  insert into public.cashouts(user_id, amount, destination)
  values (me, w.balance, case when w.payout_type = 'bank' then 'Bank account' else 'Debit card' end || ' •••• ' || w.payout_last4 || ' (demo)');
  update public.wallets set balance = 0 where user_id = me;
  return w.balance;
end $$;

create or replace function public.add_play_money() returns numeric
language plpgsql security definer set search_path = public as $$
declare me uuid := public.blimp_require_user(); b numeric(12,2);
begin
  update public.wallets set balance = least(balance + 500, 100000) where user_id = me returning balance into b;
  return b;
end $$;

-- Only signed-in people can call the actions.
revoke all on function public.set_handle(text), public.create_drop(text,text,numeric,int,int,int,text,text,boolean,double precision,double precision),
  public.claim_drop(uuid,double precision,double precision,double precision), public.end_drop(uuid), public.settle_my_drops(),
  public.simulate_claim(uuid), public.unlock_code(text), public.toggle_follow(uuid), public.set_payout(text), public.cash_out(),
  public.add_play_money(), public.blimp_settle(uuid) from public, anon;
grant execute on function public.set_handle(text), public.create_drop(text,text,numeric,int,int,int,text,text,boolean,double precision,double precision),
  public.claim_drop(uuid,double precision,double precision,double precision), public.end_drop(uuid), public.settle_my_drops(),
  public.simulate_claim(uuid), public.unlock_code(text), public.toggle_follow(uuid), public.set_payout(text), public.cash_out(),
  public.add_play_money() to authenticated;

-- ---------- live updates ----------
do $$ begin
  begin alter publication supabase_realtime add table public.drops; exception when others then null; end;
  begin alter publication supabase_realtime add table public.claims; exception when others then null; end;
  begin alter publication supabase_realtime add table public.wallets; exception when others then null; end;
  begin alter publication supabase_realtime add table public.profiles; exception when others then null; end;
end $$;

-- ---------- starter drops in downtown Wilmington ----------
insert into public.drops(official, name, color, pool, per, max_people, lat, lng, radius_m, visibility, rule, code, expires_at)
values
  (true, 'Welcome to Blimp', 'Yellow', 500, 10, 50, 34.23573, -77.94782, 160, 'public', 'there', 'BLIMP', now() + interval '30 days'),
  (true, 'Secret on Front',  'Red',    100, 10, 10, 34.23860, -77.94900, 100, 'code',   'there', 'FRONT', now() + interval '30 days');
