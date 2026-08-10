import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Read from the root .env so SUPABASE_URL / SUPABASE_ANON_KEY are shared
  envDir: '../',
  envPrefix: ['VITE_', 'SUPABASE_'],
})
