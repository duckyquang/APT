import { createClient } from '@supabase/supabase-js'
import type Anthropic from '@anthropic-ai/sdk'
import { dayKey } from './dates.ts'
import type { Profile, PlanRow, DailyTotals, MealRow, WorkoutPlan, MealPlan } from './types.ts'

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

function unwrap<T>({ data, error }: { data: T; error: { message: string } | null }) {
  if (error) throw new Error(error.message)
  return data
}

export async function loadProfile() {
  return unwrap(await sb.from('profiles').select('*').single()) as Profile
}

export async function updateProfile(userId: string, patch: Partial<Profile>) {
  const { user_id, ...rest } = patch
  unwrap(await sb.from('profiles').update({ ...rest, updated_at: new Date().toISOString() }).eq('user_id', userId))
}

export async function latestWeight() {
  const rows = unwrap(
    await sb.from('daily_logs').select('date, weight_kg').not('weight_kg', 'is', null).order('date', { ascending: false }).limit(1),
  ) as { date: string; weight_kg: number }[]
  return rows[0] ?? null
}

export async function upsertDailyLog(date: string, patch: { weight_kg?: number; progress_photo_path?: string; notes?: string }) {
  unwrap(await sb.from('daily_logs').upsert({ date, ...patch }, { onConflict: 'user_id,date' }))
}

export async function latestPlan(kind: 'workout' | 'meal') {
  const rows = unwrap(
    await sb.from('plans').select('*').eq('kind', kind).order('created_at', { ascending: false }).limit(1),
  ) as PlanRow[]
  return rows[0] ?? null
}

export async function savePlan(kind: 'workout' | 'meal', title: string, content: WorkoutPlan | MealPlan) {
  unwrap(await sb.from('plans').insert({ kind, title, content }))
}

export async function dayTotals(date: string) {
  const rows = unwrap(await sb.from('daily_totals').select('*').eq('date', date)) as DailyTotals[]
  return rows[0] ?? null
}

export async function dayMeals(date: string) {
  return unwrap(await sb.from('meals').select('*').eq('date', date).order('eaten_at')) as MealRow[]
}

export type MessageRow = { id: number; role: 'user' | 'assistant'; content: Anthropic.MessageParam['content'] }

export async function loadMessages(limit = 40) {
  const rows = unwrap(
    await sb.from('messages').select('id, role, content').order('id', { ascending: false }).limit(limit),
  ) as MessageRow[]
  return rows.reverse()
}

export async function insertMessages(rows: Anthropic.MessageParam[]) {
  return unwrap(
    await sb.from('messages').insert(rows.map(r => ({ role: r.role, content: r.content }))).select('id, role, content'),
  ) as MessageRow[]
}

export async function clearChat(userId: string) {
  unwrap(await sb.from('messages').delete().eq('user_id', userId))
}

export type NewMeal = Omit<MealRow, 'id' | 'eaten_at'> & { eaten_at?: string }

export async function insertMeal(row: NewMeal) {
  unwrap(await sb.from('meals').insert(row))
}

export async function deleteMeal(id: string) {
  unwrap(await sb.from('meals').delete().eq('id', id))
}

export async function insertWater(ml: number, at = new Date()) {
  unwrap(await sb.from('water').insert({ ml, at: at.toISOString(), date: dayKey(at) }))
}

export async function dayLog(date: string) {
  const rows = unwrap(
    await sb.from('daily_logs').select('weight_kg, progress_photo_path').eq('date', date),
  ) as { weight_kg: number | null; progress_photo_path: string | null }[]
  return rows[0] ?? null
}

export async function uploadPhoto(bucket: 'meals' | 'progress', path: string, blob: Blob) {
  const { error } = await sb.storage.from(bucket).upload(path, blob, { contentType: 'image/jpeg', upsert: true })
  if (error) throw new Error(error.message)
}

export async function signedUrls(bucket: 'meals' | 'progress', paths: string[]) {
  if (!paths.length) return {}
  const { data, error } = await sb.storage.from(bucket).createSignedUrls(paths, 3600)
  if (error) throw new Error(error.message)
  return Object.fromEntries(data.filter(d => d.path && d.signedUrl).map(d => [d.path as string, d.signedUrl as string]))
}
