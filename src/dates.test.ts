import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dayKey, weekdayOf } from './dates.ts'

test('dayKey is the local calendar date, not UTC', () => {
  assert.equal(dayKey(new Date(2026, 0, 31, 23, 30)), '2026-01-31')
  assert.equal(dayKey(new Date(2026, 8, 5, 0, 5)), '2026-09-05')
})

test('weekdayOf', () => {
  assert.equal(weekdayOf(new Date(2026, 8, 17)), 'thu')
  assert.equal(weekdayOf(new Date(2026, 8, 20)), 'sun')
})
