import { createDeviceHandler } from './handler.ts'
import { supabaseDevicePorts } from './supabasePorts.ts'

Deno.serve(createDeviceHandler(supabaseDevicePorts(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  // The pilot origin is public configuration; operators can override it.
  (Deno.env.get('VIEWER_ALLOWED_ORIGINS') ?? 'https://turntally-pilot.turntally-family.workers.dev').split(',').map(value => value.trim()).filter(Boolean),
  Deno.env.get('VIEWER_TRUSTED_IP_HEADER'),
)))
