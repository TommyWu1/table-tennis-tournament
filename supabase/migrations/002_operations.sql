-- Atomic tournament operations. Every definer function uses a fixed search_path,
-- checks the caller's provisioned profile, and is executable only by authenticated.

create or replace function public._require_provisioned()
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := public.current_app_role();
begin
  if v_role is null then
    raise exception using errcode = '42501', message = 'forbidden: account is not provisioned';
  end if;
  return v_role;
end
$$;

create or replace function public._require_admin()
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if public._require_provisioned() <> 'admin' then
    raise exception using errcode = '42501', message = 'forbidden: admin role required';
  end if;
end
$$;

create or replace function public._match_output(p_match_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', m.id,
    'version', m.version,
    'eventId', m.tournament_id,
    'label', case when m.stage = 'groups'
      then 'Group ' || m.group_index::text || ' · Round ' || m.round::text
      else initcap(m.division) || ' · Round ' || m.round::text end,
    'nameA', pa.name,
    'nameB', pb.name,
    'tableNumber', m.table_number,
    'bestOf', m.best_of,
    'state', m.status,
    'kind', m.result_kind,
    'games', coalesce(m.games, '[]'::jsonb),
    'winner', case when m.winner_entry_id = m.entry_a_id then 'a'
      when m.winner_entry_id = m.entry_b_id then 'b' else null end,
    'ready', (
      m.status = 'pending'
      and (m.entry_a_id is not null or m.entry_b_id is not null)
      and (m.feeder_a_match_id is null or exists (
        select 1 from public.matches fa where fa.id = m.feeder_a_match_id and fa.status in ('completed', 'bye', 'void')
      ))
      and (m.feeder_b_match_id is null or exists (
        select 1 from public.matches fb where fb.id = m.feeder_b_match_id and fb.status in ('completed', 'bye', 'void')
      ))
      and not exists (
        select 1 from public.matches active_m
        where active_m.tournament_id = m.tournament_id and active_m.status = 'active'
          and active_m.id <> m.id
          and (active_m.entry_a_id in (m.entry_a_id, m.entry_b_id)
            or active_m.entry_b_id in (m.entry_a_id, m.entry_b_id))
      )
    )
  )
  from public.matches m
  left join public.entries ea on ea.id = m.entry_a_id
  left join public.entries eb on eb.id = m.entry_b_id
  left join public.players pa on pa.id = ea.player_id
  left join public.players pb on pb.id = eb.player_id
  where m.id = p_match_id
$$;

create or replace function public._validate_games(p_best_of smallint, p_games jsonb)
returns text
language plpgsql
immutable
security definer
set search_path = public, pg_temp
as $$
declare
  v_game jsonb;
  v_a integer;
  v_b integer;
  v_wins_a integer := 0;
  v_wins_b integer := 0;
  v_need integer := (p_best_of + 1) / 2;
  v_index integer := 0;
begin
  if p_best_of not in (1, 3, 5) or jsonb_typeof(p_games) <> 'array' or jsonb_array_length(p_games) = 0 then
    raise exception using errcode = '22023', message = 'invalid: enter a complete series';
  end if;
  for v_game in select value from jsonb_array_elements(p_games) loop
    v_index := v_index + 1;
    if jsonb_typeof(v_game) <> 'array' or jsonb_array_length(v_game) <> 2
      or jsonb_typeof(v_game -> 0) <> 'number' or jsonb_typeof(v_game -> 1) <> 'number' then
      raise exception using errcode = '22023', message = 'invalid: each game needs two integer point totals';
    end if;
    begin
      v_a := (v_game ->> 0)::integer;
      v_b := (v_game ->> 1)::integer;
    exception when others then
      raise exception using errcode = '22023', message = 'invalid: point totals must be integers';
    end;
    if v_a < 0 or v_b < 0 or v_a = v_b then
      raise exception using errcode = '22023', message = 'invalid: games need nonnegative points and a winner';
    end if;
    if not ((v_a = 11 and v_b <= 9) or (v_a >= 12 and v_a - v_b = 2)
      or (v_b = 11 and v_a <= 9) or (v_b >= 12 and v_b - v_a = 2)) then
      raise exception using errcode = '22023', message = 'invalid: a game must be won to 11 by two';
    end if;
    if v_a > v_b then v_wins_a := v_wins_a + 1; else v_wins_b := v_wins_b + 1; end if;
    if greatest(v_wins_a, v_wins_b) >= v_need and v_index < jsonb_array_length(p_games) then
      raise exception using errcode = '22023', message = 'invalid: the series has games after it was clinched';
    end if;
  end loop;
  if greatest(v_wins_a, v_wins_b) <> v_need then
    raise exception using errcode = '22023', message = 'invalid: the submitted series is incomplete';
  end if;
  return case when v_wins_a > v_wins_b then 'a' else 'b' end;
end
$$;

create or replace function public._invalidate_descendants(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  child public.matches%rowtype;
begin
  for child in
    select * from public.matches c
    where c.feeder_a_match_id = p_match_id or c.feeder_b_match_id = p_match_id
    for update
  loop
    if child.feeder_a_match_id = p_match_id then child.entry_a_id := null; end if;
    if child.feeder_b_match_id = p_match_id then child.entry_b_id := null; end if;
    update public.matches set
      entry_a_id = child.entry_a_id,
      entry_b_id = child.entry_b_id,
      games = null,
      result_kind = null,
      winner_entry_id = null,
      table_number = null,
      status = 'pending',
      version = version + 1,
      updated_by = null,
      updated_at = now()
    where id = child.id;
    perform public._invalidate_descendants(child.id);
  end loop;
end
$$;

create or replace function public._propagate_match_result(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  source public.matches%rowtype;
  child public.matches%rowtype;
  resolved boolean;
  only_true_bye boolean;
  v_winner uuid;
begin
  select * into source from public.matches where id = p_match_id;
  if not found or source.next_match_id is null then return; end if;
  select * into child from public.matches where id = source.next_match_id for update;
  if not found then
    raise exception using errcode = '22023', message = 'invalid: next match is missing';
  end if;

  if source.next_slot = 'a' then child.entry_a_id := source.winner_entry_id;
  else child.entry_b_id := source.winner_entry_id; end if;

  update public.matches set
    entry_a_id = child.entry_a_id,
    entry_b_id = child.entry_b_id,
    games = null,
    result_kind = null,
    winner_entry_id = null,
    table_number = null,
    status = 'pending',
    version = version + 1,
    updated_by = null,
    updated_at = now()
  where id = child.id;

  select
    (child.feeder_a_match_id is null or exists (
      select 1 from public.matches fa where fa.id = child.feeder_a_match_id and fa.status in ('completed', 'bye', 'void')
    ))
    and (child.feeder_b_match_id is null or exists (
      select 1 from public.matches fb where fb.id = child.feeder_b_match_id and fb.status in ('completed', 'bye', 'void')
    ))
  into resolved;

  only_true_bye := resolved and (
    (child.entry_a_id is not null and child.entry_b_id is null and child.feeder_b_match_id is null)
    or (child.entry_b_id is not null and child.entry_a_id is null and child.feeder_a_match_id is null)
  );
  if only_true_bye then
    v_winner := coalesce(child.entry_a_id, child.entry_b_id);
    update public.matches set status = 'bye', result_kind = 'bye', winner_entry_id = v_winner,
      version = version + 1, updated_by = null, updated_at = now()
    where id = child.id;
    perform public._propagate_match_result(child.id);
  end if;
end
$$;

create or replace function public.get_scoreboard(p_tournament_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  t public.tournaments%rowtype;
  v_role text := public._require_provisioned();
  v_matches jsonb;
begin
  if p_tournament_id is null then
    select * into t from public.tournaments where state in ('groups', 'playoffs') limit 1;
  else
    select * into t from public.tournaments where id = p_tournament_id;
  end if;
  if not found then
    raise exception using errcode = '22023', message = 'invalid: tournament not found';
  end if;
  if v_role = 'scorekeeper' and t.state not in ('groups', 'playoffs') then
    raise exception using errcode = '42501', message = 'forbidden: no active scoreboard';
  end if;

  select coalesce(jsonb_agg(public._match_output(m.id) order by
    case when m.stage = 'groups' then 1 else 2 end, m.division, m.group_index, m.round, m.sequence), '[]'::jsonb)
    into v_matches
  from public.matches m where m.tournament_id = t.id;

  return jsonb_build_object('eventId', t.id, 'eventName', t.name, 'stage', t.state,
    'revision', t.revision, 'matches', v_matches);
end
$$;

create or replace function public.save_groups(
  p_tournament_id uuid,
  p_expected_revision bigint,
  p_plans jsonb,
  p_draw_seed bigint default null,
  p_draw_mode text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  t public.tournaments%rowtype;
  plan jsonb;
  entry_json jsonb;
  members uuid[];
  slots uuid[];
  v_group integer;
  v_count integer;
  v_slot_count integer;
  v_round integer;
  v_pair integer;
  v_sequence integer;
  v_a uuid;
  v_b uuid;
  v_tmp uuid;
  v_seen uuid[] := '{}'::uuid[];
  v_eligible uuid[];
  v_id uuid;
  v_effective numeric(12,6);
  v_revision bigint;
begin
  perform public._require_admin();
  select * into t from public.tournaments where id = p_tournament_id for update;
  if not found then raise exception using errcode = '22023', message = 'invalid: tournament not found'; end if;
  if t.revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'conflict: tournament changed; refresh the draw';
  end if;
  if t.state not in ('setup', 'groups') then
    raise exception using errcode = '42501', message = 'blocked: groups cannot be changed in this event state';
  end if;
  if p_draw_mode is not null and p_draw_mode not in ('random', 'balanced') then
    raise exception using errcode = '22023', message = 'invalid: draw mode must be random or balanced';
  end if;
  if jsonb_typeof(p_plans) <> 'array' or jsonb_array_length(p_plans) = 0 then
    raise exception using errcode = '22023', message = 'invalid: add group assignments before starting';
  end if;
  if exists (select 1 from public.matches m where m.tournament_id = t.id and m.stage = 'groups'
    and m.status <> 'pending') then
    raise exception using errcode = '42501', message = 'blocked: a group match has started or been resolved';
  end if;

  select coalesce(array_agg(e.id order by e.id), '{}'::uuid[]) into v_eligible
  from public.entries e where e.tournament_id = t.id and e.registration_status = 'registered' and e.checked_in;
  if cardinality(v_eligible) < 4 or cardinality(v_eligible) > 64 then
    raise exception using errcode = '22023', message = 'invalid: groups require 4 to 64 checked-in entrants';
  end if;

  delete from public.matches where tournament_id = t.id and stage = 'groups';
  v_sequence := 0;
  for plan in select value from jsonb_array_elements(p_plans) loop
    begin
      v_group := (plan ->> 'groupIndex')::integer;
    exception when others then
      raise exception using errcode = '22023', message = 'invalid: each group needs an integer groupIndex';
    end;
    if v_group < 1 or v_group > 64 or jsonb_typeof(plan -> 'entryIds') <> 'array' then
      raise exception using errcode = '22023', message = 'invalid: group assignments need entryIds';
    end if;
    members := '{}'::uuid[];
    for entry_json in select value from jsonb_array_elements(plan -> 'entryIds') loop
      begin
        v_id := (entry_json #>> '{}')::uuid;
      exception when others then
        raise exception using errcode = '22023', message = 'invalid: group entry id is not a UUID';
      end;
      if v_id = any(v_seen) then
        raise exception using errcode = '22023', message = 'invalid: an entrant appears in more than one group';
      end if;
      if not (v_id = any(v_eligible)) then
        raise exception using errcode = '22023', message = 'invalid: groups must contain checked-in registered entrants';
      end if;
      v_seen := array_append(v_seen, v_id);
      members := array_append(members, v_id);
    end loop;
    v_count := cardinality(members);
    if v_count < 3 or v_count > 5 then
      raise exception using errcode = '22023', message = 'invalid: group sizes must be 3 to 5';
    end if;

    for v_pair in 1..v_count loop
      select coalesce(e.seed_value,
        case when p.rated_match_count >= 5 then p.rating
          else case p.experience when 'beginner' then 800 when 'casual' then 1000
            when 'club' then 1200 when 'varsity' then 1400 else 1000 end end)
      into v_effective
      from public.entries e join public.players p on p.id = e.player_id where e.id = members[v_pair];
      update public.entries set group_index = v_group, seed_position = v_pair, seed_value = v_effective
        where id = members[v_pair];
    end loop;

    slots := members;
    if v_count % 2 = 1 then slots := array_append(slots, null::uuid); end if;
    v_slot_count := cardinality(slots);
    for v_round in 1..(v_slot_count - 1) loop
      for v_pair in 1..(v_slot_count / 2) loop
        v_a := slots[v_pair];
        v_b := slots[v_slot_count + 1 - v_pair];
        if v_a is not null and v_b is not null then
          v_sequence := v_sequence + 1;
          insert into public.matches (tournament_id, stage, group_index, round, sequence, match_key,
            entry_a_id, entry_b_id, best_of)
          values (t.id, 'groups', v_group, v_round, v_sequence,
            format('group-%s-round-%s-pair-%s', v_group, v_round, v_pair), v_a, v_b, t.group_best_of);
        end if;
      end loop;
      v_tmp := slots[v_slot_count];
      for v_pair in reverse v_slot_count..3 loop slots[v_pair] := slots[v_pair - 1]; end loop;
      slots[2] := v_tmp;
    end loop;
  end loop;

  if cardinality(v_seen) <> cardinality(v_eligible)
    or (select count(distinct (value ->> 'groupIndex')) from jsonb_array_elements(p_plans)) <> jsonb_array_length(p_plans) then
    raise exception using errcode = '22023', message = 'invalid: groups must assign every checked-in entrant exactly once';
  end if;
  if jsonb_array_length(p_plans) = 1 and cardinality(v_seen) not in (4, 5) then
    raise exception using errcode = '22023', message = 'invalid: one group is allowed only for 4 or 5 entrants';
  end if;

  update public.tournaments set state = 'groups', draw_seed = coalesce(p_draw_seed, draw_seed),
    draw_mode = coalesce(p_draw_mode, draw_mode), revision = revision + 1 where id = t.id;
  select revision into v_revision from public.tournaments where id = t.id;
  return jsonb_build_object('revision', v_revision);
end
$$;

create or replace function public.save_playoffs(
  p_tournament_id uuid,
  p_expected_revision bigint,
  p_plans jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  t public.tournaments%rowtype;
  v_division text;
  v_plan jsonb;
  v_node jsonb;
  v_slot jsonb;
  v_key text;
  v_match_id uuid;
  v_feeder_id uuid;
  v_entry_a uuid;
  v_entry_b uuid;
  v_feeder_a uuid;
  v_feeder_b uuid;
  v_round integer;
  v_sequence integer;
  v_max_round integer;
  v_best_of smallint;
  v_seen_keys text[] := '{}'::text[];
  v_seen_entries uuid[] := '{}'::uuid[];
  v_resolved boolean;
  v_winner uuid;
  v_revision bigint;
  m public.matches%rowtype;
begin
  perform public._require_admin();
  select * into t from public.tournaments where id = p_tournament_id for update;
  if not found then raise exception using errcode = '22023', message = 'invalid: tournament not found'; end if;
  if t.revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'conflict: tournament changed; refresh playoff preview';
  end if;
  if t.state <> 'groups' then
    raise exception using errcode = '42501', message = 'blocked: playoffs can be created after groups only';
  end if;
  if exists (select 1 from public.matches g where g.tournament_id = t.id and g.stage = 'groups'
    and g.status not in ('completed', 'void')) then
    raise exception using errcode = '42501', message = 'blocked: resolve every group match before playoffs';
  end if;
  if jsonb_typeof(p_plans) <> 'object'
    or jsonb_typeof(p_plans -> 'championship') <> 'array'
    or jsonb_typeof(p_plans -> 'consolation') <> 'array' then
    raise exception using errcode = '22023', message = 'invalid: provide championship and consolation match arrays';
  end if;
  if not t.consolation_enabled and jsonb_array_length(p_plans -> 'consolation') > 0 then
    raise exception using errcode = '22023', message = 'invalid: this tournament has no consolation division';
  end if;
  if exists (select 1 from public.matches p where p.tournament_id = t.id and p.stage = 'playoffs') then
    raise exception using errcode = '42501', message = 'blocked: playoff matches already exist';
  end if;

  for v_division in select unnest(array['championship', 'consolation']) loop
    v_plan := p_plans -> v_division;
    select coalesce(max((x.value ->> 'round')::integer), 0)
      into v_max_round from jsonb_array_elements(v_plan) x;
    for v_node in select value from jsonb_array_elements(v_plan) loop
      begin
        v_key := btrim(v_node ->> 'key');
        v_round := (v_node ->> 'round')::integer;
        v_sequence := (v_node ->> 'sequence')::integer;
        v_best_of := (v_node ->> 'bestOf')::smallint;
      exception when others then
        raise exception using errcode = '22023', message = 'invalid: playoff matches need key, round, sequence and bestOf';
      end;
      if v_key is null or v_key = '' or v_round < 1 or v_sequence < 1 or v_best_of not in (1, 3, 5)
        or jsonb_typeof(v_node -> 'a') <> 'object' or jsonb_typeof(v_node -> 'b') <> 'object' then
        raise exception using errcode = '22023', message = 'invalid: malformed playoff match';
      end if;
      if (v_division || ':' || v_key) = any(v_seen_keys) then
        raise exception using errcode = '22023', message = 'invalid: playoff match keys must be unique';
      end if;
      v_seen_keys := array_append(v_seen_keys, v_division || ':' || v_key);
      v_entry_a := null;
      v_entry_b := null;
      foreach v_slot in array array[v_node -> 'a', v_node -> 'b'] loop
        if v_slot ->> 'kind' not in ('entry', 'winner', 'empty') then
          raise exception using errcode = '22023', message = 'invalid: playoff slot kind must be entry, winner or empty';
        end if;
        if v_slot ->> 'kind' = 'entry' then
          begin
            v_match_id := (v_slot ->> 'entryId')::uuid;
          exception when others then
            raise exception using errcode = '22023', message = 'invalid: playoff entry id is not a UUID';
          end;
          if v_match_id = any(v_seen_entries) then
            raise exception using errcode = '22023', message = 'invalid: an entrant appears more than once in the playoff draw';
          end if;
          if not exists (select 1 from public.entries e where e.id = v_match_id
            and e.tournament_id = t.id and e.group_index is not null and e.registration_status <> 'withdrawn') then
            raise exception using errcode = '22023', message = 'invalid: playoff entrant must be an active participant in this tournament';
          end if;
          v_seen_entries := array_append(v_seen_entries, v_match_id);
          if v_slot = v_node -> 'a' then v_entry_a := v_match_id; else v_entry_b := v_match_id; end if;
        elsif v_slot ->> 'kind' = 'winner' then
          if nullif(btrim(v_slot ->> 'matchKey'), '') is null then
            raise exception using errcode = '22023', message = 'invalid: winner slot needs a matchKey';
          end if;
        end if;
      end loop;

      insert into public.matches (tournament_id, stage, division, round, sequence, match_key,
        entry_a_id, entry_b_id, best_of)
      values (t.id, 'playoffs', v_division, v_round, v_sequence, v_division || ':' || v_key,
        v_entry_a, v_entry_b,
        case when v_division = 'championship' and v_round = v_max_round then t.final_best_of else t.playoff_best_of end);
    end loop;
  end loop;

  -- Resolve each winner-key slot after all nodes exist, then link each source to its next slot.
  for v_division in select unnest(array['championship', 'consolation']) loop
    v_plan := p_plans -> v_division;
    for v_node in select value from jsonb_array_elements(v_plan) loop
      v_key := v_division || ':' || (v_node ->> 'key');
      select id into v_match_id from public.matches
        where tournament_id = t.id and stage = 'playoffs' and match_key = v_key;
      v_feeder_a := null;
      v_feeder_b := null;
      for v_sequence in 1..2 loop
        v_slot := case when v_sequence = 1 then v_node -> 'a' else v_node -> 'b' end;
        if v_slot ->> 'kind' = 'winner' then
          select id, round into v_feeder_id, v_round from public.matches
            where tournament_id = t.id and stage = 'playoffs' and division = v_division
              and match_key = v_division || ':' || (v_slot ->> 'matchKey');
          if not found or v_feeder_id = v_match_id or v_round >= (v_node ->> 'round')::integer then
            raise exception using errcode = '22023', message = 'invalid: winner slot must refer to an earlier match in its division';
          end if;
          if v_sequence = 1 then v_feeder_a := v_feeder_id; else v_feeder_b := v_feeder_id; end if;
          update public.matches set next_match_id = v_match_id,
            next_slot = case when v_sequence = 1 then 'a' else 'b' end
          where id = v_feeder_id and next_match_id is null;
          if not found then
            raise exception using errcode = '22023', message = 'invalid: a match winner cannot feed more than one slot';
          end if;
        end if;
      end loop;
      update public.matches set feeder_a_match_id = v_feeder_a, feeder_b_match_id = v_feeder_b
        where id = v_match_id;
    end loop;
  end loop;

  -- A bye exists only opposite a literal empty slot. A void feeder stays unresolved for admin resolution.
  for m in select * from public.matches where tournament_id = t.id and stage = 'playoffs'
    order by division, round, sequence for update
  loop
    if m.entry_a_id is null and m.feeder_a_match_id is null
      and m.entry_b_id is null and m.feeder_b_match_id is null then
      raise exception using errcode = '22023', message = 'invalid: playoff match cannot have two empty slots';
    end if;
    select
      (m.feeder_a_match_id is null or exists (select 1 from public.matches x where x.id = m.feeder_a_match_id and x.status in ('completed', 'bye', 'void')))
      and (m.feeder_b_match_id is null or exists (select 1 from public.matches x where x.id = m.feeder_b_match_id and x.status in ('completed', 'bye', 'void')))
    into v_resolved;
    if v_resolved and (
      (m.entry_a_id is not null and m.entry_b_id is null and m.feeder_b_match_id is null)
      or (m.entry_b_id is not null and m.entry_a_id is null and m.feeder_a_match_id is null)
    ) then
      v_winner := coalesce(m.entry_a_id, m.entry_b_id);
      update public.matches set status = 'bye', result_kind = 'bye', winner_entry_id = v_winner,
        updated_at = now() where id = m.id;
      perform public._propagate_match_result(m.id);
    end if;
  end loop;

  update public.tournaments set state = 'playoffs', revision = revision + 1 where id = t.id;
  select revision into v_revision from public.tournaments where id = t.id;
  return jsonb_build_object('revision', v_revision);
end
$$;

create or replace function public.start_match(
  p_match_id uuid,
  p_table_number integer,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.matches%rowtype;
  t public.tournaments%rowtype;
begin
  perform public._require_admin();
  select tournament_id into t.id from public.matches where id = p_match_id;
  if not found then raise exception using errcode = '22023', message = 'invalid: match not found'; end if;
  select * into t from public.tournaments where id = t.id for update;
  select * into m from public.matches where id = p_match_id for update;
  if m.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'conflict: match changed; refresh before assigning a table';
  end if;
  if t.state not in ('groups', 'playoffs')
    or (m.stage = 'groups' and t.state <> 'groups')
    or (m.stage = 'playoffs' and t.state <> 'playoffs') then
    raise exception using errcode = '42501', message = 'blocked: this match is not in the current stage';
  end if;
  if m.status <> 'pending' or m.entry_a_id is null or m.entry_b_id is null then
    raise exception using errcode = '42501', message = 'blocked: match is not ready for a table';
  end if;
  if p_table_number < 1 or p_table_number > t.table_count then
    raise exception using errcode = '22023', message = 'invalid: table number is outside this event';
  end if;
  if exists (select 1 from public.matches other_m where other_m.tournament_id = t.id and other_m.status = 'active'
    and other_m.id <> m.id and other_m.table_number = p_table_number) then
    raise exception using errcode = '40001', message = 'conflict: table is already in use';
  end if;
  if exists (select 1 from public.matches other_m where other_m.tournament_id = t.id and other_m.status = 'active'
    and other_m.id <> m.id and (other_m.entry_a_id in (m.entry_a_id, m.entry_b_id)
      or other_m.entry_b_id in (m.entry_a_id, m.entry_b_id))) then
    raise exception using errcode = '40001', message = 'conflict: one of these players is already playing';
  end if;
  update public.matches set status = 'active', table_number = p_table_number,
    version = version + 1, updated_by = auth.uid(), updated_at = now() where id = m.id;
  update public.tournaments set revision = revision + 1 where id = t.id;
  return public._match_output(m.id);
end
$$;

create or replace function public.save_score(
  p_match_id uuid,
  p_expected_version integer,
  p_games jsonb default null,
  p_kind text default 'played',
  p_winner_entry_id uuid default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := public._require_provisioned();
  m public.matches%rowtype;
  t public.tournaments%rowtype;
  v_winner_side text;
  v_winner uuid;
  v_same_result boolean := false;
  v_old_winner uuid;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if p_kind is null or p_kind not in ('played', 'walkover', 'void') then
    raise exception using errcode = '22023', message = 'invalid: result kind must be played, walkover or void';
  end if;
  select tournament_id into t.id from public.matches where id = p_match_id;
  if not found then raise exception using errcode = '22023', message = 'invalid: match not found'; end if;
  select * into t from public.tournaments where id = t.id for update;
  select * into m from public.matches where id = p_match_id for update;
  if t.state not in ('groups', 'playoffs')
    or (m.stage = 'groups' and t.state <> 'groups')
    or (m.stage = 'playoffs' and t.state <> 'playoffs') then
    raise exception using errcode = '42501', message = 'blocked: match scoring is locked in this event state';
  end if;
  if m.status = 'bye' then
    raise exception using errcode = '42501', message = 'blocked: automatic byes cannot be scored';
  end if;

  if p_kind = 'played' then
    if p_winner_entry_id is not null or p_reason is not null then
      raise exception using errcode = '22023', message = 'invalid: played winners come from game scores';
    end if;
    if m.entry_a_id is null or m.entry_b_id is null then
      raise exception using errcode = '42501', message = 'blocked: both players must be resolved for a played result';
    end if;
    v_winner_side := public._validate_games(m.best_of, p_games);
    v_winner := case when v_winner_side = 'a' then m.entry_a_id else m.entry_b_id end;
    v_same_result := m.result_kind = 'played' and m.games = p_games and m.winner_entry_id = v_winner;
  elsif p_kind = 'walkover' then
    if v_role <> 'admin' then
      raise exception using errcode = '42501', message = 'forbidden: only an admin can resolve an unplayed match';
    end if;
    if p_games is not null or p_winner_entry_id is null or v_reason is null or length(v_reason) > 240 then
      raise exception using errcode = '22023', message = 'invalid: a walkover needs a participant winner and a short reason';
    end if;
    if (p_winner_entry_id is distinct from m.entry_a_id and p_winner_entry_id is distinct from m.entry_b_id)
      or not exists (select 1 from public.entries e where e.id = p_winner_entry_id and e.registration_status <> 'withdrawn') then
      raise exception using errcode = '22023', message = 'invalid: walkover winner must be an available participant';
    end if;
    v_winner := p_winner_entry_id;
    v_same_result := m.result_kind = 'walkover' and m.winner_entry_id = v_winner and m.result_note = v_reason;
  else
    if v_role <> 'admin' then
      raise exception using errcode = '42501', message = 'forbidden: only an admin can resolve an unplayed match';
    end if;
    if p_games is not null or p_winner_entry_id is not null or v_reason is null or length(v_reason) > 240 then
      raise exception using errcode = '22023', message = 'invalid: a void result needs a reason and has no games or winner';
    end if;
    if exists (select 1 from public.entries e where e.id in (m.entry_a_id, m.entry_b_id)
      and e.registration_status <> 'withdrawn') then
      raise exception using errcode = '22023', message = 'invalid: void requires no available participant';
    end if;
    v_winner := null;
    v_same_result := m.result_kind = 'void' and m.winner_entry_id is null and m.result_note is not distinct from v_reason;
  end if;

  -- Identical replay is a no-op, even though its opened version is now stale.
  if v_same_result and m.status in ('completed', 'void') then
    return public._match_output(m.id);
  end if;
  if m.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'conflict: another score or assignment was saved; refresh this match';
  end if;

  if v_role = 'scorekeeper' then
    if p_kind <> 'played' or m.status not in ('pending', 'active') then
      raise exception using errcode = '42501', message = 'forbidden: scorekeepers can submit played results for unresolved matches only';
    end if;
    if exists (select 1 from public.entries e where e.id in (m.entry_a_id, m.entry_b_id)
      and e.registration_status = 'withdrawn') then
      raise exception using errcode = '42501', message = 'blocked: a withdrawn player needs an admin result';
    end if;
  elsif m.status in ('completed', 'void') then
    if m.stage = 'playoffs' and m.winner_entry_id is distinct from v_winner then
      if exists (
        with recursive descendants(id) as (
          select id from public.matches where feeder_a_match_id = m.id or feeder_b_match_id = m.id
          union all
          select c.id from public.matches c join descendants d
            on c.feeder_a_match_id = d.id or c.feeder_b_match_id = d.id
        )
        select 1 from public.matches d join descendants x on x.id = d.id
        where d.status in ('active', 'completed', 'void')
      ) then
        raise exception using errcode = 'P0001', message = 'blocked: clear started or resolved dependent matches in reverse order first';
      end if;
      perform public._invalidate_descendants(m.id);
    end if;
  elsif m.status not in ('pending', 'active') then
    raise exception using errcode = '42501', message = 'blocked: this match cannot accept a result';
  end if;

  if m.stage = 'playoffs' and m.feeder_a_match_id is not null and not exists (
      select 1 from public.matches f where f.id = m.feeder_a_match_id and f.status in ('completed', 'bye', 'void')) then
    raise exception using errcode = '42501', message = 'blocked: first resolve the match feeding player A';
  end if;
  if m.stage = 'playoffs' and m.feeder_b_match_id is not null and not exists (
      select 1 from public.matches f where f.id = m.feeder_b_match_id and f.status in ('completed', 'bye', 'void')) then
    raise exception using errcode = '42501', message = 'blocked: first resolve the match feeding player B';
  end if;
  if exists (select 1 from public.matches other_m where other_m.tournament_id = t.id and other_m.status = 'active'
    and other_m.id <> m.id and (other_m.entry_a_id in (m.entry_a_id, m.entry_b_id)
      or other_m.entry_b_id in (m.entry_a_id, m.entry_b_id))) then
    raise exception using errcode = '40001', message = 'conflict: one of these players is already playing';
  end if;

  v_old_winner := m.winner_entry_id;
  update public.matches set
    games = case when p_kind = 'played' then p_games else null end,
    result_kind = p_kind,
    result_note = case when p_kind in ('walkover', 'void') then v_reason else null end,
    winner_entry_id = v_winner,
    status = case when p_kind = 'void' then 'void' else 'completed' end,
    table_number = null,
    version = version + 1,
    updated_by = auth.uid(),
    updated_at = now()
  where id = m.id;

  if m.stage = 'playoffs' and v_old_winner is distinct from v_winner then
    perform public._propagate_match_result(m.id);
  elsif m.status in ('pending', 'active') and v_winner is not null then
    perform public._propagate_match_result(m.id);
  elsif p_kind = 'void' then
    perform public._propagate_match_result(m.id);
  end if;

  update public.tournaments set revision = revision + 1 where id = t.id;
  return public._match_output(m.id);
end
$$;

create or replace function public.clear_result(p_match_id uuid, p_expected_version integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.matches%rowtype;
  t public.tournaments%rowtype;
begin
  perform public._require_admin();
  select tournament_id into t.id from public.matches where id = p_match_id;
  if not found then raise exception using errcode = '22023', message = 'invalid: match not found'; end if;
  select * into t from public.tournaments where id = t.id for update;
  select * into m from public.matches where id = p_match_id for update;
  if m.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'conflict: match changed; refresh before clearing';
  end if;
  if t.state not in ('groups', 'playoffs') or (m.stage = 'groups' and t.state <> 'groups')
    or (m.stage = 'playoffs' and t.state <> 'playoffs') then
    raise exception using errcode = '42501', message = 'blocked: this result is locked in the current event state';
  end if;
  if m.status not in ('completed', 'void') then
    raise exception using errcode = '42501', message = 'blocked: only a saved result can be cleared';
  end if;
  if exists (
    with recursive descendants(id) as (
      select id from public.matches where feeder_a_match_id = m.id or feeder_b_match_id = m.id
      union all
      select c.id from public.matches c join descendants d
        on c.feeder_a_match_id = d.id or c.feeder_b_match_id = d.id
    )
    select 1 from public.matches d join descendants x on x.id = d.id
    where d.status in ('active', 'completed', 'void')
  ) then
    raise exception using errcode = 'P0001', message = 'blocked: clear started or resolved dependent matches in reverse order first';
  end if;
  perform public._invalidate_descendants(m.id);
  update public.matches set games = null, result_kind = null, result_note = null, winner_entry_id = null,
    status = 'pending', table_number = null, version = version + 1,
    updated_by = auth.uid(), updated_at = now() where id = m.id;
  update public.tournaments set revision = revision + 1 where id = t.id;
  return public._match_output(m.id);
end
$$;

create or replace function public.reset_playoffs(p_tournament_id uuid, p_expected_revision bigint)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  t public.tournaments%rowtype;
  v_revision bigint;
begin
  perform public._require_admin();
  select * into t from public.tournaments where id = p_tournament_id for update;
  if not found then raise exception using errcode = '22023', message = 'invalid: tournament not found'; end if;
  if t.state <> 'playoffs' then
    raise exception using errcode = '42501', message = 'blocked: playoffs are not active';
  end if;
  if t.revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'conflict: tournament changed; refresh before resetting playoffs';
  end if;
  if exists (select 1 from public.matches where tournament_id = t.id and stage = 'playoffs' and status = 'active') then
    raise exception using errcode = 'P0001', message = 'blocked: stop active playoff matches before resetting';
  end if;
  delete from public.matches where tournament_id = t.id and stage = 'playoffs';
  update public.tournaments set state = 'groups', revision = revision + 1 where id = t.id;
  select revision into v_revision from public.tournaments where id = t.id;
  return jsonb_build_object('revision', v_revision);
end
$$;

create or replace function public.finish_tournament(p_tournament_id uuid, p_expected_revision bigint)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  t public.tournaments%rowtype;
  m public.matches%rowtype;
  v_player_a uuid;
  v_player_b uuid;
  v_entry_a uuid;
  v_entry_b uuid;
  v_rating_a numeric(12,6);
  v_rating_b numeric(12,6);
  v_expected_a numeric;
  v_delta numeric(12,6);
  v_after_a numeric(12,6);
  v_after_b numeric(12,6);
  v_score_a numeric;
  v_revision bigint;
begin
  perform public._require_admin();
  select * into t from public.tournaments where id = p_tournament_id for update;
  if not found then raise exception using errcode = '22023', message = 'invalid: tournament not found'; end if;
  if t.state = 'finished' then
    return jsonb_build_object('revision', t.revision);
  end if;
  if t.state <> 'playoffs' then
    raise exception using errcode = '42501', message = 'blocked: create playoffs before finishing the event';
  end if;
  if t.revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'conflict: tournament changed; refresh before finishing';
  end if;
  if exists (select 1 from public.matches mm where mm.tournament_id = t.id and mm.status in ('pending', 'active')) then
    raise exception using errcode = 'P0001', message = 'blocked: resolve every match before finishing';
  end if;

  perform 1 from public.players p
  where p.id in (
    select distinct e.player_id from public.entries e
    join public.matches mm on mm.tournament_id = e.tournament_id
      and e.id in (mm.entry_a_id, mm.entry_b_id)
    where e.tournament_id = t.id and mm.result_kind = 'played'
  ) order by p.id for update;

  for m in select * from public.matches mm where mm.tournament_id = t.id and mm.result_kind = 'played'
    order by case when mm.stage = 'groups' then 1 else 2 end, mm.division, mm.group_index,
      mm.round, mm.sequence, mm.id
  loop
    select ea.id, eb.id, ea.player_id, eb.player_id
      into v_entry_a, v_entry_b, v_player_a, v_player_b
    from public.entries ea join public.entries eb on eb.id = m.entry_b_id
    where ea.id = m.entry_a_id;
    select rating into v_rating_a from public.players where id = v_player_a;
    select rating into v_rating_b from public.players where id = v_player_b;
    v_score_a := case when m.winner_entry_id = v_entry_a then 1 else 0 end;
    v_expected_a := 1 / (1 + power(10::numeric, (v_rating_b - v_rating_a) / 400));
    v_delta := round((32 * (v_score_a - v_expected_a))::numeric, 6);
    v_after_a := v_rating_a + v_delta;
    v_after_b := v_rating_b - v_delta;
    update public.players set rating = v_after_a, rated_match_count = rated_match_count + 1 where id = v_player_a;
    update public.players set rating = v_after_b, rated_match_count = rated_match_count + 1 where id = v_player_b;
    update public.entries set rating_before = coalesce(rating_before, v_rating_a), rating_after = v_after_a where id = v_entry_a;
    update public.entries set rating_before = coalesce(rating_before, v_rating_b), rating_after = v_after_b where id = v_entry_b;
  end loop;

  update public.tournaments set state = 'finished', finalized_at = now(), revision = revision + 1 where id = t.id;
  select revision into v_revision from public.tournaments where id = t.id;
  return jsonb_build_object('revision', v_revision);
end
$$;

create or replace function public.cancel_tournament(p_tournament_id uuid, p_expected_revision bigint)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  t public.tournaments%rowtype;
  v_revision bigint;
begin
  perform public._require_admin();
  select * into t from public.tournaments where id = p_tournament_id for update;
  if not found then raise exception using errcode = '22023', message = 'invalid: tournament not found'; end if;
  if t.state = 'cancelled' then
    return jsonb_build_object('revision', t.revision);
  end if;
  if t.state = 'finished' then
    raise exception using errcode = '42501', message = 'blocked: a finished tournament cannot be cancelled';
  end if;
  if t.revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'conflict: tournament changed; refresh before cancelling';
  end if;
  update public.matches set status = 'pending', table_number = null, version = version + 1,
    updated_by = auth.uid(), updated_at = now()
  where tournament_id = t.id and status = 'active';
  update public.tournaments set state = 'cancelled', revision = revision + 1 where id = t.id;
  select revision into v_revision from public.tournaments where id = t.id;
  return jsonb_build_object('revision', v_revision);
end
$$;

revoke all on function public._require_provisioned() from public, anon, authenticated;
revoke all on function public._require_admin() from public, anon, authenticated;
revoke all on function public._match_output(uuid) from public, anon, authenticated;
revoke all on function public._validate_games(smallint, jsonb) from public, anon, authenticated;
revoke all on function public._invalidate_descendants(uuid) from public, anon, authenticated;
revoke all on function public._propagate_match_result(uuid) from public, anon, authenticated;

revoke all on function public.get_scoreboard(uuid) from public, anon;
revoke all on function public.save_groups(uuid, bigint, jsonb, bigint, text) from public, anon;
revoke all on function public.save_playoffs(uuid, bigint, jsonb) from public, anon;
revoke all on function public.start_match(uuid, integer, integer) from public, anon;
revoke all on function public.save_score(uuid, integer, jsonb, text, uuid, text) from public, anon;
revoke all on function public.clear_result(uuid, integer) from public, anon;
revoke all on function public.reset_playoffs(uuid, bigint) from public, anon;
revoke all on function public.finish_tournament(uuid, bigint) from public, anon;
revoke all on function public.cancel_tournament(uuid, bigint) from public, anon;

grant execute on function public.get_scoreboard(uuid) to authenticated;
grant execute on function public.save_groups(uuid, bigint, jsonb, bigint, text) to authenticated;
grant execute on function public.save_playoffs(uuid, bigint, jsonb) to authenticated;
grant execute on function public.start_match(uuid, integer, integer) to authenticated;
grant execute on function public.save_score(uuid, integer, jsonb, text, uuid, text) to authenticated;
grant execute on function public.clear_result(uuid, integer) to authenticated;
grant execute on function public.reset_playoffs(uuid, bigint) to authenticated;
grant execute on function public.finish_tournament(uuid, bigint) to authenticated;
grant execute on function public.cancel_tournament(uuid, bigint) to authenticated;
