import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.SUPABASE_URL
const key = import.meta.env.SUPABASE_ANON_KEY

if (!url || !key) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY — check the root .env')
}

export const supabase = createClient(url, key)
