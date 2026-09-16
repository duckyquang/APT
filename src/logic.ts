import type Anthropic from '@anthropic-ai/sdk'
import { WEEKDAYS, type Weekday } from './dates.ts'
import type { Exercise, Profile, WorkoutPlan, MealPlan, MealEstimate } from './types.ts'

const hasBlock = (m: Anthropic.MessageParam, type: string) =>
  Array.isArray(m.content) && m.content.some(b => b.type === type)

// the API rejects a window that starts on a tool_result or ends on an unanswered tool_use
export function trimWindow(msgs: Anthropic.MessageParam[]) {
  let start = 0
  while (start < msgs.length && !(msgs[start].role === 'user' && !hasBlock(msgs[start], 'tool_result'))) start++
  let end = msgs.length
  if (end > start && msgs[end - 1].role === 'assistant' && hasBlock(msgs[end - 1], 'tool_use')) end--
  return msgs.slice(start, end)
}

export const PROFILE_FIELDS = [
  'name', 'sex', 'birth_date', 'height_cm', 'goal', 'activity_level', 'training_days',
  'equipment', 'injuries', 'dietary_prefs', 'targets', 'units',
] as const

export const REQUIRED = ['height_cm', 'birth_date', 'sex', 'goal', 'training_days'] as const

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
    return v == null || (Array.isArray(v) && v.length === 0)
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
  if (totals.kcal && Math.abs(fromMacros - totals.kcal) > totals.kcal * 0.3) {
    totals.kcal = Math.round(fromMacros)
    assumptions = `${assumptions} Calories recomputed from macros.`.trim()
  }
  return { items, totals, confidence: est.confidence ?? 'low', assumptions }
}
