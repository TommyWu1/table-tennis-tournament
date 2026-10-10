import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

let client: SupabaseClient<Database> | undefined;

export class SupabaseConfigurationError extends Error {
  constructor() {
    super('Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to connect the shared tournament database.');
    this.name = 'SupabaseConfigurationError';
  }
}

export function isSupabaseConfigured(): boolean {
  return Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
}

export function getSupabase(): SupabaseClient<Database> {
  if (client) return client;
  const url = import.meta.env.VITE_SUPABASE_URL;
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) throw new SupabaseConfigurationError();
  client = createClient<Database>(url, publishableKey);
  return client;
}
