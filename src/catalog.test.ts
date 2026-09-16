import { test } from 'node:test'
import assert from 'node:assert/strict'
import { searchExercises } from './catalog.ts'
import type { Exercise } from './types.ts'

const ex = (id: string, name: string, equipment: string | null, muscles: string[]): Exercise =>
  ({ id, name, equipment, primaryMuscles: muscles, secondaryMuscles: [], instructions: [], category: 'strength', images: [] })

const catalog = [
  ex('Barbell_Squat', 'Barbell Squat', 'barbell', ['quadriceps']),
  ex('Barbell_Squat_To_A_Bench', 'Barbell Squat To A Bench', 'barbell', ['quadriceps']),
  ex('Pushups', 'Pushups', 'body only', ['chest']),
]

test('filters by name, muscle and equipment', () => {
  assert.deepEqual(searchExercises(catalog, { q: 'push' }, {}).map(r => r.id), ['Pushups'])
  assert.deepEqual(searchExercises(catalog, { muscle: 'quad', equipment: 'barbell' }, {}).map(r => r.id),
    ['Barbell_Squat', 'Barbell_Squat_To_A_Bench'])
})

test('entries with a video come first, then shorter names', () => {
  const r = searchExercises(catalog, { muscle: 'quadriceps' }, { Barbell_Squat_To_A_Bench: 'abc' })
  assert.equal(r[0].id, 'Barbell_Squat_To_A_Bench')
  assert.equal(r[0].has_video, true)
  assert.equal(r[1].has_video, false)
})

test('limit', () => {
  assert.equal(searchExercises(catalog, {}, {}, 2).length, 2)
})
