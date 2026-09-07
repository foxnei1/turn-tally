import { loadEnv } from 'vite'

const env = { ...loadEnv('production', process.cwd(), 'VITE_'), ...process.env }
if (env.VITE_TURNTALLY_MODE !== 'hosted'
  || env.VITE_SUPABASE_URL !== 'https://trvzxycxwnuodicdkfjp.supabase.co'
  || !env.VITE_SUPABASE_PUBLISHABLE_KEY?.startsWith('sb_publishable_')) {
  console.error('Configure hosted mode, the TurnTally Supabase project URL, and its publishable key in .env.local before deploying. See docs/supabase-backend.md. No deployment was attempted.')
  process.exitCode = 1
}
