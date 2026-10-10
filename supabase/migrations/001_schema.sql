-- The five application tables. Supabase Auth owns auth.users.
-- Apply with the Supabase CLI/migration runner; never put a service-role key in Vite.

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (length(btrim(display_name)) between 1 and 100),
  role text not null check (role in ('admin', 'scorekeeper')),
  created_at timestamptz not null default now()
);

create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.role from public.profiles p where p.id = auth.uid()
$$;

create or replace function public.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(public.current_app_role() = 'admin', false)
$$;

create or replace function public.is_app_provisioned()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.current_app_role() in ('admin', 'scorekeeper')
$$;

revoke all on function public.current_app_role() from public, anon;
revoke all on function public.is_app_admin() from public, anon;
revoke all on function public.is_app_provisioned() from public, anon;
grant execute on function public.current_app_role() to authenticated;
grant execute on function public.is_app_admin() to authenticated;
grant execute on function public.is_app_provisioned() to authenticated;

create table public.players (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 100),
  label text check (label is null or length(label) <= 100),
  experience text not null default 'unknown'
    check (experience in ('unknown', 'beginner', 'casual', 'club', 'varsity')),
  rating numeric(12, 6) not null default 1000 check (rating >= 0),
  rated_match_count integer not null default 0 check (rated_match_count >= 0),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tournaments (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  starts_at timestamptz not null,
  booking_minutes integer not null default 240 check (booking_minutes between 30 and 1440),
  entry_fee_cents integer not null default 1000 check (entry_fee_cents >= 0),
  registration_cap integer not null default 20 check (registration_cap between 1 and 128),
  table_count integer not null default 3 check (table_count between 1 and 16),
  group_best_of smallint not null default 1 check (group_best_of in (1, 3, 5)),
  playoff_best_of smallint not null default 1 check (playoff_best_of in (1, 3, 5)),
  final_best_of smallint not null default 3 check (final_best_of in (1, 3, 5)),
  qualifiers_per_group smallint not null default 2 check (qualifiers_per_group between 1 and 4),
  consolation_enabled boolean not null default true,
  state text not null default 'setup'
    check (state in ('setup', 'groups', 'playoffs', 'finished', 'cancelled')),
  draw_seed bigint,
  draw_mode text check (draw_mode is null or draw_mode in ('random', 'balanced')),
  lot_orders jsonb not null default '{}'::jsonb check (jsonb_typeof(lot_orders) = 'object'),
  revision bigint not null default 1 check (revision > 0),
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index tournaments_one_competitive_event
  on public.tournaments ((1)) where state in ('groups', 'playoffs');

create table public.entries (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete restrict,
  registration_status text not null default 'registered'
    check (registration_status in ('registered', 'waitlisted', 'withdrawn')),
  checked_in boolean not null default false,
  paid boolean not null default false,
  payment_method text check (payment_method is null or payment_method in ('cash', 'card')),
  amount_paid_cents integer not null default 0 check (amount_paid_cents >= 0),
  discount_cents integer not null default 0 check (discount_cents between 0 and base_fee_cents),
  payment_note text check (payment_note is null or length(payment_note) <= 500),
  base_fee_cents integer not null default 1000 check (base_fee_cents >= 0),
  group_index integer check (group_index is null or group_index between 1 and 64),
  seed_value numeric(12, 6),
  seed_position integer check (seed_position is null or seed_position > 0),
  rating_before numeric(12, 6),
  rating_after numeric(12, 6),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tournament_id, player_id),
  unique (tournament_id, id),
  check (
    (paid and (amount_paid_cents = 0 or payment_method is not null))
    or (not paid and amount_paid_cents = 0 and payment_method is null)
  )
);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  stage text not null check (stage in ('groups', 'playoffs')),
  division text check (division is null or division in ('championship', 'consolation')),
  group_index integer,
  round integer not null check (round > 0),
  sequence integer not null check (sequence > 0),
  match_key text not null check (length(match_key) between 1 and 160),
  entry_a_id uuid,
  entry_b_id uuid,
  feeder_a_match_id uuid,
  feeder_b_match_id uuid,
  next_match_id uuid,
  next_slot text check (next_slot is null or next_slot in ('a', 'b')),
  best_of smallint not null check (best_of in (1, 3, 5)),
  games jsonb,
  result_kind text check (result_kind is null or result_kind in ('played', 'walkover', 'bye', 'void')),
  result_note text check (result_note is null or length(result_note) <= 240),
  winner_entry_id uuid,
  table_number integer,
  status text not null default 'pending'
    check (status in ('pending', 'active', 'completed', 'bye', 'void')),
  version integer not null default 1 check (version > 0),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tournament_id, id),
  unique (tournament_id, stage, match_key),
  foreign key (tournament_id, entry_a_id) references public.entries(tournament_id, id) on delete restrict,
  foreign key (tournament_id, entry_b_id) references public.entries(tournament_id, id) on delete restrict,
  foreign key (tournament_id, winner_entry_id) references public.entries(tournament_id, id) on delete restrict,
  foreign key (tournament_id, feeder_a_match_id) references public.matches(tournament_id, id) on delete cascade,
  foreign key (tournament_id, feeder_b_match_id) references public.matches(tournament_id, id) on delete cascade,
  foreign key (tournament_id, next_match_id) references public.matches(tournament_id, id) on delete cascade,
  check (
    (stage = 'groups' and division is null and group_index between 1 and 64
      and feeder_a_match_id is null and feeder_b_match_id is null and next_match_id is null and next_slot is null)
    or
    (stage = 'playoffs' and division in ('championship', 'consolation') and group_index is null)
  ),
  check ((next_match_id is null) = (next_slot is null)),
  check (entry_a_id is null or entry_a_id <> entry_b_id),
  check (table_number is null or table_number > 0),
  check (
    (status = 'pending' and result_kind is null and games is null and winner_entry_id is null and table_number is null)
    or (status = 'active' and result_kind is null and games is null and winner_entry_id is null and table_number is not null)
    or (status = 'completed' and result_kind in ('played', 'walkover') and winner_entry_id is not null and table_number is null)
    or (status = 'bye' and result_kind = 'bye' and winner_entry_id is not null and table_number is null and games is null)
    or (status = 'void' and result_kind = 'void' and winner_entry_id is null and table_number is null and games is null)
  ),
  check (
    (result_kind = 'played' and jsonb_typeof(games) = 'array' and jsonb_array_length(games) > 0)
    or (result_kind is distinct from 'played' and games is null)
    or (status in ('pending', 'active') and result_kind is null and games is null)
  )
);

create unique index matches_one_active_table
  on public.matches (tournament_id, table_number) where status = 'active';
create unique index matches_tournament_fixture_order
  on public.matches (tournament_id, stage, coalesce(division, ''), coalesce(group_index, 0), round, sequence);

create index entries_tournament_group on public.entries (tournament_id, group_index, id);
create index matches_tournament_order on public.matches (tournament_id, stage, division, group_index, round, sequence);
create index matches_entry_a_active on public.matches (tournament_id, entry_a_id) where status = 'active';
create index matches_entry_b_active on public.matches (tournament_id, entry_b_id) where status = 'active';

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

create trigger players_set_updated_at before update on public.players
  for each row execute function public.set_updated_at();
create trigger tournaments_set_updated_at before update on public.tournaments
  for each row execute function public.set_updated_at();
create trigger entries_set_updated_at before update on public.entries
  for each row execute function public.set_updated_at();

create or replace function public.guard_player_write()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user <> 'postgres' and not public.is_app_admin() then
    raise exception using errcode = '42501', message = 'forbidden: admin role required';
  end if;
  if current_user <> 'postgres' and tg_op = 'UPDATE'
    and (new.rating is distinct from old.rating or new.rated_match_count is distinct from old.rated_match_count) then
    raise exception using errcode = '42501', message = 'forbidden: ratings are function managed';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;

create trigger players_guard_write before insert or update or delete on public.players
  for each row execute function public.guard_player_write();

create or replace function public.guard_tournament_write()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  has_playoffs boolean;
  lot_order record;
begin
  if current_user <> 'postgres' and not public.is_app_admin() then
    raise exception using errcode = '42501', message = 'forbidden: admin role required';
  end if;

  if tg_op = 'INSERT' then
    if current_user <> 'postgres' and new.state <> 'setup' then
      raise exception using errcode = '42501', message = 'forbidden: tournaments start in setup';
    end if;
    return new;
  end if;

  if current_user = 'postgres' then
    return new;
  end if;

  if new.state is distinct from old.state
    or new.finalized_at is distinct from old.finalized_at
    or new.draw_seed is distinct from old.draw_seed
    or new.draw_mode is distinct from old.draw_mode
    or new.revision is distinct from old.revision then
    raise exception using errcode = '42501', message = 'forbidden: event state and draw fields are function managed';
  end if;

  if old.state = 'setup' then
    new.revision := old.revision + 1;
  elsif old.state = 'groups' then
    select exists (
      select 1 from public.matches m where m.tournament_id = old.id and m.stage = 'playoffs'
    ) into has_playoffs;
    if has_playoffs or new.name is distinct from old.name or new.starts_at is distinct from old.starts_at
      or new.booking_minutes is distinct from old.booking_minutes
      or new.entry_fee_cents is distinct from old.entry_fee_cents
      or new.registration_cap is distinct from old.registration_cap
      or new.table_count is distinct from old.table_count
      or new.group_best_of is distinct from old.group_best_of
      or new.qualifiers_per_group is distinct from old.qualifiers_per_group
      or new.consolation_enabled is distinct from old.consolation_enabled then
      raise exception using errcode = '42501', message = 'blocked: event settings are locked after groups start';
    end if;
    if new.lot_orders is distinct from old.lot_orders then
      if jsonb_typeof(new.lot_orders) <> 'object' or exists (
        select 1 from jsonb_each(new.lot_orders) x
        where x.key !~ '^[1-9][0-9]*$' or jsonb_typeof(x.value) <> 'array'
      ) then
        raise exception using errcode = '22023', message = 'invalid: tie lots must map group numbers to entry id arrays';
      end if;
      for lot_order in select key, value from jsonb_each(new.lot_orders) loop
        if exists (
          select 1 from jsonb_array_elements_text(lot_order.value) e(value)
          where not exists (
            select 1 from public.entries en
            where en.tournament_id = old.id
              and en.group_index = lot_order.key::integer
              and en.id = e.value::uuid
          )
        ) then
          raise exception using errcode = '22023', message = 'invalid: tie lots must contain entries from their group';
        end if;
        if (select count(*) from jsonb_array_elements_text(lot_order.value)) <>
           (select count(distinct value) from jsonb_array_elements_text(lot_order.value)) then
          raise exception using errcode = '22023', message = 'invalid: an entry can appear once in a tie lot';
        end if;
      end loop;
    end if;
    new.revision := old.revision + 1;
  else
    raise exception using errcode = '42501', message = 'blocked: event settings are locked in this state';
  end if;

  return new;
end
$$;

create trigger tournaments_guard_write before insert or update on public.tournaments
  for each row execute function public.guard_tournament_write();

create or replace function public.bump_tournament_revision(p_tournament_id uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.tournaments set revision = revision + 1 where id = p_tournament_id
$$;

revoke all on function public.bump_tournament_revision(uuid) from public, anon, authenticated;

create or replace function public.guard_entry_write()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  event_row public.tournaments%rowtype;
  registered_count integer;
begin
  if tg_op = 'DELETE' then
    select * into event_row from public.tournaments where id = old.tournament_id for update;
  else
    select * into event_row from public.tournaments where id = new.tournament_id for update;
  end if;

  if not found then
    raise exception using errcode = '22023', message = 'invalid: tournament does not exist';
  end if;
  if current_user <> 'postgres' and not public.is_app_admin() then
    raise exception using errcode = '42501', message = 'forbidden: admin role required';
  end if;
  if current_user = 'postgres' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    if event_row.state <> 'setup' then
      raise exception using errcode = '42501', message = 'blocked: entries are locked after groups start';
    end if;
    new.base_fee_cents := event_row.entry_fee_cents;
    if new.registration_status = 'registered' then
      select count(*) into registered_count from public.entries e
        where e.tournament_id = new.tournament_id and e.registration_status = 'registered';
      if registered_count >= event_row.registration_cap then
        raise exception using errcode = '22023', message = 'invalid: registration cap reached; add to waitlist';
      end if;
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    if event_row.state <> 'setup' then
      raise exception using errcode = '42501', message = 'blocked: entries cannot be removed after groups start';
    end if;
    return old;
  end if;

  if new.tournament_id is distinct from old.tournament_id
    or new.base_fee_cents is distinct from old.base_fee_cents
    or new.group_index is distinct from old.group_index
    or new.seed_position is distinct from old.seed_position
    or new.rating_before is distinct from old.rating_before
    or new.rating_after is distinct from old.rating_after then
    raise exception using errcode = '42501', message = 'forbidden: entry snapshots and event links are function managed';
  end if;

  if new.seed_value is distinct from old.seed_value and event_row.state <> 'setup' then
    raise exception using errcode = '42501', message = 'blocked: seed values are locked after groups start';
  end if;

  if event_row.state = 'setup' then
    if new.registration_status = 'registered' and old.registration_status <> 'registered' then
      select count(*) into registered_count from public.entries e
        where e.tournament_id = new.tournament_id and e.id <> old.id and e.registration_status = 'registered';
      if registered_count >= event_row.registration_cap then
        raise exception using errcode = '22023', message = 'invalid: registration cap reached; keep entry waitlisted';
      end if;
    end if;
  elsif event_row.state in ('groups', 'playoffs') then
    if new.player_id is distinct from old.player_id or new.checked_in is distinct from old.checked_in
      or new.seed_value is distinct from old.seed_value
      or (new.registration_status is distinct from old.registration_status and new.registration_status <> 'withdrawn') then
      raise exception using errcode = '42501', message = 'blocked: roster changes are locked after groups start';
    end if;
  else
    raise exception using errcode = '42501', message = 'blocked: finished or cancelled events are read only';
  end if;

  return new;
end
$$;

create trigger entries_guard_write before insert or update or delete on public.entries
  for each row execute function public.guard_entry_write();

create or replace function public.bump_entry_revision()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_id uuid;
  changed boolean := false;
begin
  if tg_op = 'INSERT' then
    target_id := new.tournament_id;
    changed := true;
  elsif tg_op = 'DELETE' then
    target_id := old.tournament_id;
    changed := true;
  else
    target_id := new.tournament_id;
    changed := new.player_id is distinct from old.player_id
      or new.registration_status is distinct from old.registration_status
      or new.checked_in is distinct from old.checked_in;
  end if;
  if changed then
    perform public.bump_tournament_revision(target_id);
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;

create trigger entries_bump_revision after insert or update or delete on public.entries
  for each row execute function public.bump_entry_revision();

create or replace function public.guard_match_direct_write()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'forbidden: match changes require a tournament operation';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;

create trigger matches_guard_write before insert or update or delete on public.matches
  for each row execute function public.guard_match_direct_write();

alter table public.profiles enable row level security;
alter table public.players enable row level security;
alter table public.tournaments enable row level security;
alter table public.entries enable row level security;
alter table public.matches enable row level security;

create policy profiles_select_self_or_admin on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_app_admin());
create policy players_admin_all on public.players
  for all to authenticated using (public.is_app_admin()) with check (public.is_app_admin());
create policy tournaments_admin_all on public.tournaments
  for all to authenticated using (public.is_app_admin()) with check (public.is_app_admin());
create policy entries_admin_all on public.entries
  for all to authenticated using (public.is_app_admin()) with check (public.is_app_admin());
create policy matches_admin_select on public.matches
  for select to authenticated using (public.is_app_admin());

revoke all on public.profiles, public.players, public.tournaments, public.entries, public.matches from anon, authenticated;
grant select on public.profiles to authenticated;
grant select on public.players to authenticated;
grant insert (name, label, experience), update (name, label, experience, archived) on public.players to authenticated;
grant select on public.tournaments to authenticated;
grant insert (name, starts_at, booking_minutes, entry_fee_cents, registration_cap, table_count,
  group_best_of, playoff_best_of, final_best_of, qualifiers_per_group, consolation_enabled)
  on public.tournaments to authenticated;
grant update (name, starts_at, booking_minutes, entry_fee_cents, registration_cap, table_count,
  group_best_of, playoff_best_of, final_best_of, qualifiers_per_group, consolation_enabled)
  on public.tournaments to authenticated;
grant update (lot_orders) on public.tournaments to authenticated;
grant select on public.entries to authenticated;
grant insert (tournament_id, player_id, registration_status, checked_in, paid, payment_method,
  amount_paid_cents, discount_cents, payment_note) on public.entries to authenticated;
grant update (player_id, registration_status, checked_in, paid, payment_method, amount_paid_cents,
  discount_cents, payment_note, seed_value) on public.entries to authenticated;
grant delete on public.entries to authenticated;
grant select on public.matches to authenticated;

comment on table public.profiles is 'Manually provisioned Supabase Auth users and their non-self-editable app role.';
comment on table public.players is 'Persistent player directory; Elo fields are only changed by finish_tournament.';
comment on table public.tournaments is 'Tournament setup, lifecycle, draw metadata, and optimistic revision.';
comment on table public.entries is 'Event roster and small payment record; private to admins.';
comment on table public.matches is 'Fixtures and results; all writes go through checked database functions.';
