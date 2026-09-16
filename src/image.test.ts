import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fitSize, coverBox } from './image.ts'

test('fitSize scales the long edge down and never up', () => {
  assert.deepEqual(fitSize(4000, 3000, 1280), { w: 1280, h: 960 })
  assert.deepEqual(fitSize(3000, 4000, 1280), { w: 960, h: 1280 })
  assert.deepEqual(fitSize(800, 600, 1280), { w: 800, h: 600 })
})

test('coverBox picks the centred source rect that fills the target', () => {
  assert.deepEqual(coverBox(4000, 3000, 1080, 1350), { sx: 800, sy: 0, sw: 2400, sh: 3000 })
  assert.deepEqual(coverBox(1080, 1920, 1080, 1350), { sx: 0, sy: 285, sw: 1080, sh: 1350 })
})
