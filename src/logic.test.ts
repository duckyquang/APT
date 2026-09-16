import { test } from 'node:test'
import assert from 'node:assert/strict'
import type Anthropic from '@anthropic-ai/sdk'
import { trimWindow, pickProfileFields, missingFields, validateWorkoutPlan, validateMealPlan, sanitizeMeal } from './logic.ts'
import type { Exercise, Profile, MealEstimate } from './types.ts'

const user = (text: string): Anthropic.MessageParam => ({ role: 'user', content: [{ type: 'text', text }] })
const assistant = (text: string): Anthropic.MessageParam => ({ role: 'assistant', content: [{ type: 'text', text }] })
const toolUse: Anthropic.MessageParam = { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'log_water', input: { ml: 500 } }] }
const toolResult: Anthropic.MessageParam = { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] }

test('trimWindow never starts on a tool_result', () => {
  const w = trimWindow([toolResult, assistant('done'), user('next'), assistant('sure')])
  assert.equal(w.length, 2)
  assert.equal(w[0].role, 'user')
})

test('trimWindow drops a trailing unanswered tool_use', () => {
  const w = trimWindow([user('hi'), toolUse])
  assert.equal(w.length, 1)
})

test('trimWindow keeps a complete pair', () => {
  const w = trimWindow([user('hi'), toolUse, toolResult, assistant('logged')])
  assert.equal(w.length, 4)
})

test('pickProfileFields whitelists and cleans training_days', () => {
  const p = pickProfileFields({ name: 'Q', model: 'evil', onboarded_at: 'x', training_days: ['mon', 'funday'], weight_kg: 80 })
  assert.deepEqual(p, { name: 'Q', training_days: ['mon'] })
})

const profile: Profile = {
  user_id: 'u', name: null, sex: 'male', birth_date: '1990-01-01', height_cm: 180, goal: 'strength', activity_level: null,
  training_days: ['mon', 'wed'], equipment: null, injuries: null, dietary_prefs: null, targets: {}, units: 'metric',
  model: 'claude-opus-5', onboarded_at: null, updated_at: '',
}

test('missingFields', () => {
  assert.deepEqual(missingFields(profile, true), [])
  assert.deepEqual(missingFields({ ...profile, goal: null, training_days: [] }, false), ['goal', 'training_days', 'weight_kg'])
})

const catalog: Exercise[] = [
  { id: 'Barbell_Squat', name: 'Barbell Squat', equipment: 'barbell', primaryMuscles: ['quadriceps'], secondaryMuscles: [], instructions: [], category: 'strength', images: [] },
]

test('validateWorkoutPlan rejects unknown ids and off days', () => {
  const errors = validateWorkoutPlan(
    { days: [{ weekday: 'tue', name: 'Legs', exercises: [{ exercise_id: 'Squat', name: 'Barbell squat', sets: 3, reps: '5', rest_s: 120 }] }] },
    catalog, ['mon', 'wed'])
  assert.equal(errors.length, 2)
  assert.match(errors[0], /tue/)
  assert.match(errors[1], /Barbell_Squat/)
  assert.deepEqual(validateWorkoutPlan(
    { days: [{ weekday: 'mon', name: 'Legs', exercises: [{ exercise_id: 'Barbell_Squat', name: 'Barbell Squat', sets: 3, reps: '5', rest_s: 120 }] }] },
    catalog, ['mon', 'wed']), [])
})

test('validateMealPlan checks numbers and item sums', () => {
  const meal = { name: 'Lunch', items: [{ food: 'rice', qty: '1 cup', kcal: 200, protein_g: 4, carbs_g: 45, fat_g: 0 }], kcal: 600, protein_g: 4, carbs_g: 45, fat_g: 0 }
  assert.equal(validateMealPlan({ days: [{ weekday: 'mon', meals: [meal] }] }).length, 1)
  assert.equal(validateMealPlan({ days: [{ weekday: 'mon', meals: [{ ...meal, kcal: 210 }] }] }).length, 0)
  assert.equal(validateMealPlan({ days: [{ weekday: 'mon', meals: [{ ...meal, kcal: 210, fat_g: -1 }] }] }).length, 1)
})

const est: MealEstimate = {
  items: [
    { name: 'rice', portion_estimate: '1 cup', grams: 180, kcal: 230, protein_g: 4, carbs_g: 50, fat_g: 0.5, fiber_g: 1 },
    { name: 'chicken', portion_estimate: '150 g', grams: 150, kcal: 250, protein_g: 45, carbs_g: 0, fat_g: -3, fiber_g: 0 },
  ],
  totals: { kcal: 999, protein_g: 1, carbs_g: 1, fat_g: 1, fiber_g: 1 },
  confidence: 'medium',
  assumptions: 'grilled, no sauce',
}

test('sanitizeMeal clamps negatives and recomputes totals from items', () => {
  const s = sanitizeMeal(est)
  assert.equal(s.items[1].fat_g, 0)
  assert.equal(s.totals.kcal, 480)
  assert.equal(s.totals.protein_g, 49)
  assert.equal(s.assumptions, 'grilled, no sauce')
})

test('sanitizeMeal recomputes kcal from macros when they disagree badly', () => {
  const s = sanitizeMeal({ ...est, items: [{ ...est.items[0], kcal: 900 }] })
  assert.equal(s.totals.kcal, Math.round(4 * 4 + 4 * 50 + 9 * 0.5))
  assert.match(s.assumptions, /recomputed/)
})

test('sanitizeMeal keeps clamped totals when there are no items', () => {
  const s = sanitizeMeal({ ...est, items: [], totals: { kcal: 300, protein_g: -2, carbs_g: 30, fat_g: 20, fiber_g: 0 } })
  assert.deepEqual(s.totals, { kcal: 300, protein_g: 0, carbs_g: 30, fat_g: 20, fiber_g: 0 })
})
