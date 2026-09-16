import { test } from 'node:test'
import assert from 'node:assert/strict'
import type Anthropic from '@anthropic-ai/sdk'
import { trimWindow, pickProfileFields, missingFields, validateWorkoutPlan, validateMealPlan } from './logic.ts'
import type { Exercise, Profile } from './types.ts'

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
