import type Anthropic from '@anthropic-ai/sdk'
import { WEEKDAYS, type Weekday } from './dates.ts'
import type { Exercise, Profile, WorkoutPlan, MealPlan, MealEstimate, WorkoutRow, WorkoutExercise } from './types.ts'

const hasBlock = (m: Anthropic.MessageParam, type: string) =>
  Array.isArray(m.content) && m.content.some(b => b.type === type)

// the API rejects a tool_use without its tool_result and a tool_result without its tool_use;
// a turn cut off by max_tokens or a closed tab can leave either behind, so drop orphans anywhere
export function trimWindow(msgs: Anthropic.MessageParam[]) {
  const out: Anthropic.MessageParam[] = []
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i]
    const next = msgs[i + 1]
    const prev = out[out.length - 1]
    if (m.role === 'assistant' && hasBlock(m, 'tool_use') && !(next?.role === 'user' && hasBlock(next, 'tool_result'))) continue
    if (m.role === 'user' && hasBlock(m, 'tool_result') && !(prev?.role === 'assistant' && hasBlock(prev, 'tool_use'))) continue
    out.push(m)
  }
  while (out.length && !(out[0].role === 'user' && !hasBlock(out[0], 'tool_result'))) out.shift()
  return out
}

export const PROFILE_FIELDS = [
  'name', 'sex', 'birth_date', 'height_cm', 'goal', 'activity_level', 'training_days',
  'equipment', 'injuries', 'dietary_prefs', 'targets', 'units',
] as const

export const REQUIRED = ['height_cm', 'birth_date', 'sex', 'goal', 'training_days'] as const
export const LEVELS = ['sedentary', 'light', 'moderate', 'active', 'very active'] as const

export const LB = 0.45359237
export const IN = 2.54
export const toKg = (n: number, imperial: boolean) => Math.round((imperial ? n * LB : n) * 100) / 100
export const fromKg = (kg: number, imperial: boolean) => Math.round((imperial ? kg / LB : kg) * 10) / 10

// optional YYYY-MM-DD and HH:MM from a tool call; anything malformed falls back to now
export function when(date?: string, time?: string) {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(date ?? '') ? new Date(date + 'T12:00:00') : new Date()
  const m = time?.match(/^([01]?\d|2[0-3]):([0-5]\d)$/)
  if (m) d.setHours(+m[1], +m[2], 0, 0)
  return d
}

export function pickProfileFields(input: Record<string, unknown>) {
  const out: Record<string, unknown> = {}
  for (const k of PROFILE_FIELDS) if (input[k] !== undefined) out[k] = input[k]
  if (Array.isArray(out.training_days)) {
    out.training_days = out.training_days.filter(d => (WEEKDAYS as readonly string[]).includes(d))
  }
  return out as Partial<Profile>
}

export function missingFields(p: Profile, hasWeight: boolean) {
  const missing: string[] = REQUIRED.filter(k => {
    const v = p[k]
    return v == null || v === '' || (Array.isArray(v) && v.length === 0)
  })
  if (!hasWeight) missing.push('weight_kg')
  return missing
}

export function validateWorkoutPlan(plan: WorkoutPlan, catalog: Exercise[], trainingDays: Weekday[]) {
  if (!Array.isArray(plan?.days) || !plan.days.length) return ['days must be a non-empty array']
  const ids = new Set(catalog.map(e => e.id))
  const errors: string[] = []
  for (const d of plan.days) {
    if (!trainingDays.includes(d.weekday)) {
      errors.push(`weekday ${d.weekday} is not one of the user's training days (${trainingDays.join(', ')}); call update_profile first if they agreed to change them`)
    }
    for (const x of d.exercises ?? []) {
      if (ids.has(x.exercise_id)) continue
      const word = (x.name ?? '').toLowerCase().split(' ').pop() ?? ''
      const near = catalog.filter(e => word && e.name.toLowerCase().includes(word)).slice(0, 3).map(e => e.id)
      errors.push(`unknown exercise_id ${x.exercise_id}; use search_exercises${near.length ? `, near matches: ${near.join(', ')}` : ''}`)
    }
  }
  return errors
}

export function validateMealPlan(plan: MealPlan) {
  if (!Array.isArray(plan?.days) || !plan.days.length) return ['days must be a non-empty array']
  const errors: string[] = []
  for (const d of plan.days) {
    for (const m of d.meals ?? []) {
      if ([m.kcal, m.protein_g, m.carbs_g, m.fat_g].some(n => typeof n !== 'number' || n < 0)) {
        errors.push(`${m.name}: kcal and macros must be non-negative numbers`)
        continue
      }
      const sum = (m.items ?? []).reduce((a, i) => a + (i.kcal ?? 0), 0)
      if (m.items?.length && Math.abs(sum - m.kcal) > Math.max(100, m.kcal * 0.15)) {
        errors.push(`${m.name}: items add up to ${sum} kcal but the meal says ${m.kcal}`)
      }
    }
  }
  return errors
}

const nz = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0)
const r1 = (n: number) => Math.round(n * 10) / 10

// structured outputs cannot express minimum, so clamp here; totals come from items when there are any
export function sanitizeMeal(est: MealEstimate): MealEstimate {
  const items = (est.items ?? []).map(i => ({
    ...i, grams: nz(i.grams), kcal: nz(i.kcal), protein_g: nz(i.protein_g), carbs_g: nz(i.carbs_g), fat_g: nz(i.fat_g), fiber_g: nz(i.fiber_g),
  }))
  const sum = (k: 'kcal' | 'protein_g' | 'carbs_g' | 'fat_g' | 'fiber_g') => items.reduce((a, i) => a + i[k], 0)
  const t = est.totals ?? { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 }
  const totals = items.length
    ? { kcal: Math.round(sum('kcal')), protein_g: r1(sum('protein_g')), carbs_g: r1(sum('carbs_g')), fat_g: r1(sum('fat_g')), fiber_g: r1(sum('fiber_g')) }
    : { kcal: Math.round(nz(t.kcal)), protein_g: r1(nz(t.protein_g)), carbs_g: r1(nz(t.carbs_g)), fat_g: r1(nz(t.fat_g)), fiber_g: r1(nz(t.fiber_g)) }
  let assumptions = (est.assumptions ?? '').trim()
  const fromMacros = 4 * totals.protein_g + 4 * totals.carbs_g + 9 * totals.fat_g
  // alcohol and sugar alcohols carry energy outside the three macros, so flag a mismatch rather than rewrite it
  if (totals.kcal && Math.abs(fromMacros - totals.kcal) > totals.kcal * 0.3) {
    assumptions = `${assumptions} Calories and macros disagree; macros alone suggest about ${Math.round(fromMacros)} kcal.`.trim()
  }
  return { items, totals, confidence: est.confidence ?? 'low', assumptions }
}

export function parseReps(s: string) {
  const m = String(s).match(/\d+/)
  return m ? +m[0] : 0
}

export function lastWeights(rows: WorkoutRow[]) {
  const map = new Map<string, number>()
  for (const r of rows) {
    for (const x of r.exercises) {
      if (!x.exercise_id || map.has(x.exercise_id)) continue
      const w = [...x.sets].reverse().find(s => s.weight_kg > 0)?.weight_kg
      if (w) map.set(x.exercise_id, w)
    }
  }
  return map
}

export function sessionFromPlan(day: WorkoutPlan['days'][number], last: Map<string, number>): WorkoutExercise[] {
  return day.exercises.map(x => ({
    exercise_id: x.exercise_id,
    name: x.name,
    sets: Array.from({ length: x.sets }, () => ({ reps: parseReps(x.reps), weight_kg: last.get(x.exercise_id) ?? 0, done: false })),
  }))
}
