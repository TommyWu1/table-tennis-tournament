export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Role = 'admin' | 'scorekeeper';
export type Experience = 'unknown' | 'beginner' | 'casual' | 'club' | 'varsity';
export type TournamentState = 'setup' | 'groups' | 'playoffs' | 'finished' | 'cancelled';
export type RegistrationStatus = 'registered' | 'waitlisted' | 'withdrawn';
export type PaymentMethod = 'cash' | 'card' | null;
export type TournamentStage = 'groups' | 'playoffs';
export type Division = 'championship' | 'consolation' | null;
export type MatchStatus = 'pending' | 'active' | 'completed' | 'bye' | 'void';
export type ResultKind = 'played' | 'walkover' | 'bye' | 'void';
export type BestOf = 1 | 3 | 5;
export type GameScore = readonly [number, number];

export interface ProfileRow extends Record<string, unknown> {
  id: string;
  display_name: string;
  role: Role;
  created_at: string;
}

export interface PlayerRow extends Record<string, unknown> {
  id: string;
  name: string;
  label: string | null;
  experience: Experience;
  rating: number;
  rated_match_count: number;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface TournamentRow extends Record<string, unknown> {
  id: string;
  name: string;
  starts_at: string;
  booking_minutes: number;
  entry_fee_cents: number;
  registration_cap: number;
  table_count: number;
  group_best_of: BestOf;
  playoff_best_of: BestOf;
  final_best_of: BestOf;
  qualifiers_per_group: number;
  consolation_enabled: boolean;
  state: TournamentState;
  draw_seed: number | null;
  draw_mode: 'random' | 'balanced' | null;
  lot_orders: Json;
  revision: number;
  finalized_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface EntryRow extends Record<string, unknown> {
  id: string;
  tournament_id: string;
  player_id: string;
  registration_status: RegistrationStatus;
  checked_in: boolean;
  paid: boolean;
  payment_method: PaymentMethod;
  amount_paid_cents: number;
  discount_cents: number;
  payment_note: string | null;
  base_fee_cents: number;
  group_index: number | null;
  seed_value: number | null;
  seed_position: number | null;
  rating_before: number | null;
  rating_after: number | null;
  created_at: string;
  updated_at: string;
}

export interface MatchRow extends Record<string, unknown> {
  id: string;
  tournament_id: string;
  stage: TournamentStage;
  division: Division;
  group_index: number | null;
  round: number;
  sequence: number;
  match_key: string;
  entry_a_id: string | null;
  entry_b_id: string | null;
  feeder_a_match_id: string | null;
  feeder_b_match_id: string | null;
  next_match_id: string | null;
  next_slot: 'a' | 'b' | null;
  best_of: BestOf;
  games: GameScore[] | null;
  result_kind: ResultKind | null;
  result_note: string | null;
  winner_entry_id: string | null;
  table_number: number | null;
  status: MatchStatus;
  version: number;
  updated_by: string | null;
  updated_at: string | null;
  created_at: string;
}

type TableShape<Row, Insert, Update> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export interface Database {
  public: {
    Tables: {
      profiles: TableShape<
        ProfileRow,
        Pick<ProfileRow, 'id' | 'display_name' | 'role'>,
        Partial<Pick<ProfileRow, 'display_name'>>
      >;
      players: TableShape<
        PlayerRow,
        Pick<PlayerRow, 'name'> & Partial<Pick<PlayerRow, 'label' | 'experience'>>,
        Partial<Pick<PlayerRow, 'name' | 'label' | 'experience' | 'archived'>>
      >;
      tournaments: TableShape<
        TournamentRow,
        Pick<TournamentRow, 'name' | 'starts_at'> &
          Partial<Pick<
            TournamentRow,
            | 'booking_minutes'
            | 'entry_fee_cents'
            | 'registration_cap'
            | 'table_count'
            | 'group_best_of'
            | 'playoff_best_of'
            | 'final_best_of'
            | 'qualifiers_per_group'
            | 'consolation_enabled'
          >>,
        Partial<Pick<
          TournamentRow,
          | 'name'
          | 'starts_at'
          | 'booking_minutes'
          | 'entry_fee_cents'
          | 'registration_cap'
          | 'table_count'
          | 'group_best_of'
          | 'playoff_best_of'
          | 'final_best_of'
          | 'qualifiers_per_group'
          | 'consolation_enabled'
            | 'lot_orders'
        >>
      >;
      entries: TableShape<
        EntryRow,
        Pick<EntryRow, 'tournament_id' | 'player_id'> &
          Partial<Pick<
            EntryRow,
            | 'registration_status'
            | 'checked_in'
            | 'paid'
            | 'payment_method'
            | 'amount_paid_cents'
            | 'discount_cents'
            | 'payment_note'
          >>,
        Partial<Pick<
          EntryRow,
          | 'player_id'
          | 'registration_status'
          | 'checked_in'
          | 'paid'
          | 'payment_method'
          | 'amount_paid_cents'
          | 'discount_cents'
          | 'payment_note'
        >>
      >;
      matches: TableShape<MatchRow, never, never>;
    };
    Views: Record<string, never>;
    Functions: {
      get_scoreboard: { Args: { p_tournament_id: string | null }; Returns: Json };
      save_groups: {
        Args: {
          p_tournament_id: string;
          p_expected_revision: number;
          p_plans: Json;
          p_draw_seed?: number | null;
          p_draw_mode?: string | null;
        };
        Returns: Json;
      };
      save_playoffs: {
        Args: { p_tournament_id: string; p_expected_revision: number; p_plans: Json };
        Returns: Json;
      };
      start_match: {
        Args: { p_match_id: string; p_table_number: number; p_expected_version: number };
        Returns: Json;
      };
      save_score: {
        Args: {
          p_match_id: string;
          p_expected_version: number;
          p_games: Json;
          p_kind?: ResultKind;
          p_winner_entry_id?: string | null;
          p_reason?: string | null;
        };
        Returns: Json;
      };
      clear_result: {
        Args: { p_match_id: string; p_expected_version: number };
        Returns: Json;
      };
      reset_playoffs: {
        Args: { p_tournament_id: string; p_expected_revision: number };
        Returns: Json;
      };
      finish_tournament: {
        Args: { p_tournament_id: string; p_expected_revision: number };
        Returns: Json;
      };
      cancel_tournament: {
        Args: { p_tournament_id: string; p_expected_revision: number };
        Returns: Json;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

export type TableRow<Name extends keyof Database['public']['Tables']> = Database['public']['Tables'][Name]['Row'];
