import { createClient } from '@supabase/supabase-js'

// both public by design; RLS is the wall
export const SUPABASE_URL = 'https://YOUR-PROJECT-REF.supabase.co'
export const SUPABASE_KEY = 'sb_publishable_YOUR_KEY'

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { flowType: 'pkce' } })

export function signIn() {
  return sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: location.origin + location.pathname },
  })
}

export function signOut() {
  return sb.auth.signOut()
}

export async function ensureProfile(userId: string) {
  const { error } = await sb
    .from('profiles')
    .upsert({ user_id: userId }, { onConflict: 'user_id', ignoreDuplicates: true })
  if (error) throw error
}
