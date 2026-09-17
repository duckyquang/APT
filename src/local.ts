import { dayKey } from './dates.ts'
import { computeTotals, zeroTotals } from './logic.ts'
import type { Profile, PlanRow, MealRow, WorkoutPlan, MealPlan, WorkoutRow, Msg, MessageRow } from './types.ts'
import type { NewMeal } from './supabase.ts'

// ponytail: demo mode keeps each table as one JSON array in localStorage and photos in the Cache API.
// Plenty for one person's data; move to IndexedDB if it ever gets slow.
const FLAG = 'apt.demo'
const CACHE = 'apt-demo-photos'

export const isDemo = () => { try { return localStorage.getItem(FLAG) === '1' } catch { return false } }
export function startDemo() { localStorage.setItem(FLAG, '1'); location.reload() }
export async function resetDemo() {
  for (const k of Object.keys(localStorage)) if (k.startsWith('apt.demo.')) localStorage.removeItem(k)
  await caches.delete(CACHE)
  location.reload()
}

const key = (t: string) => `apt.demo.${t}`
function load<T>(t: string): T[] {
  try { return JSON.parse(localStorage.getItem(key(t)) ?? '[]') } catch { return [] }
}
const save = (t: string, rows: unknown[]) => localStorage.setItem(key(t), JSON.stringify(rows))
const now = () => new Date().toISOString()
const inRange = (from: string, to: string) => (r: { date: string }) => r.date >= from && r.date <= to

type WaterRow = { id: string; date: string; at: string; ml: number }
type LogRow = { date: string; weight_kg: number | null; progress_photo_path: string | null; notes: string | null }

export async function getSession(): Promise<{ user: { id: string } } | null> {
  return isDemo() ? { user: { id: 'demo' } } : null
}
export function onAuthChange(_cb: (s: { user: { id: string } } | null) => void) { return () => {} }
export async function signIn() { return { error: null as string | null } }
export async function signOut() { localStorage.removeItem(FLAG); location.reload() }

export async function ensureProfile(userId: string) {
  if (localStorage.getItem(key('profile'))) return
  const p: Profile = {
    user_id: userId, name: null, sex: null, birth_date: null, height_cm: null, goal: null, activity_level: null,
    training_days: [], equipment: null, injuries: null, dietary_prefs: null, targets: { water_ml: 2500 },
    units: 'metric', model: 'claude-opus-5', provider: 'anthropic', onboarded_at: null, updated_at: now(),
  }
  localStorage.setItem(key('profile'), JSON.stringify(p))
}
export async function loadProfile() {
  // profiles saved before providers existed have no provider field
  return { provider: 'anthropic', ...JSON.parse(localStorage.getItem(key('profile')) ?? 'null') } as Profile
}
export async function updateProfile(_userId: string, patch: Partial<Profile>) {
  const { user_id, ...rest } = patch
  localStorage.setItem(key('profile'), JSON.stringify({ ...(await loadProfile()), ...rest, updated_at: now() }))
}

export async function latestWeight() {
  const l = load<LogRow>('daily_logs').filter(l => l.weight_kg != null).sort((a, b) => b.date.localeCompare(a.date))[0]
  return l ? { date: l.date, weight_kg: l.weight_kg! } : null
}
export async function upsertDailyLog(date: string, patch: { weight_kg?: number; progress_photo_path?: string; notes?: string }) {
  const rows = load<LogRow>('daily_logs')
  const i = rows.findIndex(l => l.date === date)
  const row = { ...(rows[i] ?? { date, weight_kg: null, progress_photo_path: null, notes: null }), ...patch }
  if (i < 0) rows.push(row); else rows[i] = row
  save('daily_logs', rows)
}
export async function progressPhotoPath(date: string) {
  return load<LogRow>('daily_logs').find(l => l.date === date)?.progress_photo_path ?? null
}
export async function rangePhotos(from: string, to: string) {
  return load<LogRow>('daily_logs').filter(inRange(from, to)).filter(l => l.progress_photo_path)
    .sort((a, b) => a.date.localeCompare(b.date)).map(l => ({ date: l.date, progress_photo_path: l.progress_photo_path! }))
}

export async function latestPlan(kind: 'workout' | 'meal') {
  return load<PlanRow>('plans').filter(p => p.kind === kind).sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null
}
export async function savePlan(kind: 'workout' | 'meal', title: string, content: WorkoutPlan | MealPlan) {
  save('plans', [...load<PlanRow>('plans'), { id: crypto.randomUUID(), kind, title, content, created_at: now() }])
}

function totals(from: string, to: string) {
  const meals = load<MealRow>('meals').filter(inRange(from, to))
  const water = load<WaterRow>('water').filter(inRange(from, to))
  const workouts = load<WorkoutRow>('workouts').filter(inRange(from, to))
  const logs = load<LogRow>('daily_logs').filter(inRange(from, to))
  const dates = [...new Set([...meals, ...water, ...workouts, ...logs].map(r => r.date))].sort().reverse()
  return dates.map(d => computeTotals(d, meals.filter(m => m.date === d), water.filter(w => w.date === d),
    workouts.filter(w => w.date === d), logs.find(l => l.date === d)))
}
export async function dayTotals(date: string) { return totals(date, date)[0] ?? zeroTotals(date) }
export async function rangeTotals(from: string, to: string) { return totals(from, to) }

export async function rangeMeals(from: string, to: string) {
  return load<MealRow>('meals').filter(inRange(from, to)).sort((a, b) => a.eaten_at.localeCompare(b.eaten_at))
}
export async function dayMeals(date: string) { return rangeMeals(date, date) }
export async function insertMeal(row: NewMeal) {
  save('meals', [...load<MealRow>('meals'), { id: crypto.randomUUID(), eaten_at: now(), ...row }])
}
export async function deleteMeal(id: string) { save('meals', load<MealRow>('meals').filter(m => m.id !== id)) }
export async function insertWater(ml: number, at = new Date()) {
  save('water', [...load<WaterRow>('water'), { id: crypto.randomUUID(), date: dayKey(at), at: at.toISOString(), ml }])
}

export async function loadMessages(limit = 40) { return load<MessageRow>('messages').slice(-limit) }
export async function insertMessages(rows: Msg[]) {
  const all = load<MessageRow>('messages')
  let id = all.length ? all[all.length - 1].id : 0
  const added: MessageRow[] = rows.map(r => ({ id: ++id, role: r.role, content: r.content }))
  save('messages', [...all, ...added])
  return added
}
export async function clearChat(_userId: string) { save('messages', []) }

export async function dayWorkout(date: string) {
  return load<WorkoutRow>('workouts').filter(w => w.date === date).sort((a, b) => a.created_at.localeCompare(b.created_at))[0] ?? null
}
export async function upsertWorkout(row: WorkoutRow) {
  const rows = load<WorkoutRow>('workouts')
  const i = rows.findIndex(w => w.id === row.id)
  if (i < 0) rows.push(row); else rows[i] = row
  save('workouts', rows)
}
export async function recentWorkouts(limit = 10) {
  return load<WorkoutRow>('workouts').sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit)
}
export async function rangeWorkouts(from: string, to: string) {
  return load<WorkoutRow>('workouts').filter(inRange(from, to)).sort((a, b) => b.date.localeCompare(a.date))
}

const urls = new Map<string, string>()
export async function uploadPhoto(bucket: 'meals' | 'progress', path: string, blob: Blob) {
  const k = `/${bucket}/${path}`
  await (await caches.open(CACHE)).put(k, new Response(blob))
  urls.delete(k)
}
export async function signedUrls(bucket: 'meals' | 'progress', paths: string[]) {
  const c = await caches.open(CACHE)
  const out: Record<string, string> = {}
  for (const p of paths) {
    const k = `/${bucket}/${p}`
    if (!urls.has(k)) {
      const r = await c.match(k)
      if (r) urls.set(k, URL.createObjectURL(await r.blob()))
    }
    if (urls.has(k)) out[p] = urls.get(k)!
  }
  return out
}
