import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickMime } from './video.ts'

test('pickMime prefers mp4, then vp9, then vp8, and gives up cleanly', () => {
  assert.equal(pickMime(() => true), 'video/mp4;codecs=avc1')
  assert.equal(pickMime(m => m.startsWith('video/webm')), 'video/webm;codecs=vp9')
  assert.equal(pickMime(m => m === 'video/webm'), 'video/webm')
  assert.equal(pickMime(() => false), '')
})
