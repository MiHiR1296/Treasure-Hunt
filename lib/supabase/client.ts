import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// V1 is optional; its credentials must not be needed to build or run V2.
let client: SupabaseClient | undefined;
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, property) {
    if (!client) {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!url || !key) throw new Error('Legacy V1 requires Supabase configuration.');
      client = createClient(url, key, { auth: { persistSession: false } });
    }
    const value = Reflect.get(client, property);
    return typeof value === 'function' ? value.bind(client) : value;
  },
});
