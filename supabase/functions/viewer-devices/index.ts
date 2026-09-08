import { createDeviceHandler } from './handler.ts'
import { supabaseDevicePorts } from './supabasePorts.ts'

Deno.serve(createDeviceHandler(supabaseDevicePorts(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  (Deno.env.get('VIEWER_ALLOWED_ORIGINS') ?? '').split(',').map(value => value.trim()).filter(Boolean),
  Deno.env.get('VIEWER_TRUSTED_IP_HEADER'),
)))
