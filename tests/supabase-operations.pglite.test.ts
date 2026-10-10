import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import schemaSql from '../supabase/migrations/001_schema.sql?raw';
import operationsSql from '../supabase/migrations/002_operations.sql?raw';

const adminId = '10000000-0000-4000-8000-000000000001';
const scorerId = '10000000-0000-4000-8000-000000000002';
const eventId = '20000000-0000-4000-8000-000000000001';
const playerIds = [
  '30000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000003',
  '30000000-0000-4000-8000-000000000004',
];
const entryIds = [
  '40000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000002',
  '40000000-0000-4000-8000-000000000003',
  '40000000-0000-4000-8000-000000000004',
];

describe('Supabase tournament operations in PGlite', () => {
  let db: PGlite;

  beforeEach(async () => {
    db = new PGlite();
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create schema auth;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
    `);
    await db.exec(schemaSql);
    await db.exec(operationsSql);
    await db.exec(`
      insert into auth.users (id) values ('${adminId}'), ('${scorerId}');
      insert into public.profiles (id, display_name, role) values
        ('${adminId}', 'Organizer', 'admin'),
        ('${scorerId}', 'Scorekeeper', 'scorekeeper');
      insert into public.players (id, name) values
        ('${playerIds[0]}', 'Player 1'), ('${playerIds[1]}', 'Player 2'),
        ('${playerIds[2]}', 'Player 3'), ('${playerIds[3]}', 'Player 4');
      insert into public.tournaments (id, name, starts_at)
        values ('${eventId}', 'Smoke event', '2026-10-10T10:00:00Z');
      insert into public.entries (id, tournament_id, player_id, checked_in) values
        ('${entryIds[0]}', '${eventId}', '${playerIds[0]}', true),
        ('${entryIds[1]}', '${eventId}', '${playerIds[1]}', true),
        ('${entryIds[2]}', '${eventId}', '${playerIds[2]}', true),
        ('${entryIds[3]}', '${eventId}', '${playerIds[3]}', true);
    `);
  });

  afterEach(async () => {
    await db.close();
  });

  async function assumeUser(userId: string) {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
    await db.exec('set role authenticated');
  }

  async function admin() {
    await assumeUser(adminId);
  }

  it('keeps scorekeepers out of payments, validates saves, advances the event, and finalizes Elo once', async () => {
    await assumeUser(scorerId);
    const privateRows = await db.query<{ count: number }>('select count(*)::int as count from public.entries');
    expect(privateRows.rows[0].count).toBe(0);
    await expect(db.query(
      `select public.save_groups($1::uuid, 1, $2::jsonb)`,
      [eventId, JSON.stringify([{ groupIndex: 1, entryIds }])],
    )).rejects.toThrow(/admin role required/i);

    await admin();
    const { rows: [event] } = await db.query<{ revision: number }>(
      'select revision::int from public.tournaments where id = $1', [eventId],
    );
    await db.query(
      `select public.save_groups($1::uuid, $2::bigint, $3::jsonb, 17, 'balanced')`,
      [eventId, event.revision, JSON.stringify([{ groupIndex: 1, entryIds }])],
    );
    const { rows: [beforeLots] } = await db.query<{ revision: number }>(
      'select revision::int from public.tournaments where id = $1', [eventId],
    );
    await db.query(
      'update public.tournaments set lot_orders = $2::jsonb where id = $1',
      [eventId, JSON.stringify({ 1: [entryIds[0], entryIds[1]] })],
    );
    const { rows: [afterLots] } = await db.query<{ revision: number; lot_orders: Record<string, string[]> }>(
      'select revision::int, lot_orders from public.tournaments where id = $1', [eventId],
    );
    expect(afterLots.revision).toBe(beforeLots.revision + 1);
    expect(afterLots.lot_orders['1']).toEqual([entryIds[0], entryIds[1]]);
    const groupMatches = await db.query<{ id: string; version: number }>(
      `select id, version from public.matches where tournament_id = $1 and stage = 'groups' order by sequence`,
      [eventId],
    );
    expect(groupMatches.rows).toHaveLength(6);

    for (const match of groupMatches.rows) {
      await db.query(
        `select public.save_score($1::uuid, $2::integer, '[[11,0]]'::jsonb, 'played', null, null)`,
        [match.id, match.version],
      );
    }
    await db.query(
      `select public.save_score($1::uuid, $2::integer, '[[11,0]]'::jsonb, 'played', null, null)`,
      [groupMatches.rows[0].id, groupMatches.rows[0].version],
    );
    await expect(db.query(
      `select public.save_score($1::uuid, $2::integer, '[[0,11]]'::jsonb, 'played', null, null)`,
      [groupMatches.rows[0].id, groupMatches.rows[0].version],
    )).rejects.toThrow(/conflict: another score/i);

    const { rows: [afterGroups] } = await db.query<{ revision: number }>(
      'select revision::int from public.tournaments where id = $1', [eventId],
    );
    const plans = {
      championship: [
        { key: 'semi-1', round: 1, sequence: 1,
          a: { kind: 'entry', entryId: entryIds[0] }, b: { kind: 'entry', entryId: entryIds[1] }, bestOf: 1 },
        { key: 'semi-2', round: 1, sequence: 2,
          a: { kind: 'entry', entryId: entryIds[2] }, b: { kind: 'entry', entryId: entryIds[3] }, bestOf: 1 },
        { key: 'champ-final', round: 2, sequence: 1,
          a: { kind: 'winner', matchKey: 'semi-1' }, b: { kind: 'winner', matchKey: 'semi-2' }, bestOf: 3 },
      ],
      consolation: [],
    };
    await db.query(
      'select public.save_playoffs($1::uuid, $2::bigint, $3::jsonb)',
      [eventId, afterGroups.revision, JSON.stringify(plans)],
    );

    const { rows: semis } = await db.query<{ id: string; version: number; best_of: number }>(
      `select id, version, best_of from public.matches where tournament_id = $1 and division = 'championship' and round = 1 order by sequence`,
      [eventId],
    );
    const { rows: [championship] } = await db.query<{
      id: string; version: number; best_of: number; entry_a_id: string | null; entry_b_id: string | null;
    }>(
      `select id, version, best_of, entry_a_id, entry_b_id from public.matches where tournament_id = $1 and match_key = 'championship:champ-final'`,
      [eventId],
    );
    expect(semis).toHaveLength(2);
    expect(semis.every((match) => match.best_of === 1)).toBe(true);
    expect(championship.best_of).toBe(3);
    expect(championship.entry_a_id).toBeNull();
    expect(championship.entry_b_id).toBeNull();
    for (const semi of semis) {
      await db.query(
        `select public.save_score($1::uuid, $2::integer, '[[11,0]]'::jsonb, 'played', null, null)`,
        [semi.id, semi.version],
      );
    }
    const { rows: [advancedFinal] } = await db.query<{ entry_a_id: string; entry_b_id: string; version: number }>(
      'select entry_a_id, entry_b_id, version from public.matches where id = $1', [championship.id],
    );
    expect([advancedFinal.entry_a_id, advancedFinal.entry_b_id].sort()).toEqual([entryIds[0], entryIds[2]].sort());
    await db.query(
      `select public.save_score($1::uuid, $2::integer, '[[11,0],[11,0]]'::jsonb, 'played', null, null)`,
      [championship.id, advancedFinal.version],
    );

    await assumeUser(scorerId);
    const scoreboard = await db.query<{ result: { eventId: string; matches: unknown[] } }>(
      `select public.get_scoreboard(null) as result`,
    );
    expect(scoreboard.rows[0].result.eventId).toBe(eventId);
    expect(scoreboard.rows[0].result.matches).toHaveLength(9);

    await admin();
    const { rows: [beforeFinish] } = await db.query<{ revision: number }>(
      'select revision::int from public.tournaments where id = $1', [eventId],
    );
    await db.query('select public.finish_tournament($1::uuid, $2::bigint)', [eventId, beforeFinish.revision]);
    const { rows: ratingsAfterFirst } = await db.query<{ id: string; rating: string; rated_match_count: number }>(
      'select id, rating::text, rated_match_count from public.players order by id',
    );
    await db.query('select public.finish_tournament($1::uuid, 1)', [eventId]);
    const { rows: ratingsAfterRetry } = await db.query<{ id: string; rating: string; rated_match_count: number }>(
      'select id, rating::text, rated_match_count from public.players order by id',
    );
    expect(ratingsAfterRetry).toEqual(ratingsAfterFirst);
    expect(ratingsAfterRetry.map((row) => row.rated_match_count)).toEqual([5, 4, 5, 4]);
  });
});
