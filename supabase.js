import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Public (publishable/anon) key only. Row-level security does the protecting.
// A service-role key must never appear in this app.
export const hasSupabaseConfig = Boolean(url && key);

export const supabase = hasSupabaseConfig
  ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } })
  : null;

// Add ?mock=1 to the address to force clearly labelled demo data.
export const forceMock =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('mock');
