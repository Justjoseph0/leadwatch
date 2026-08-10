import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

// Supabase's realtime client needs a global WebSocket. Supply it from the `ws`
// package directly so we don't depend on the runtime (Railway/Nixpacks) providing
// Node 22's built-in WebSocket.
if (!globalThis.WebSocket) {
  globalThis.WebSocket = WebSocket;
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_ANON_KEY;

if (!url || !key) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variables');
}

export const supabase = createClient(url, key);
