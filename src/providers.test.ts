import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toInput } from './providers/openai.ts'
import { toContents } from './providers/gemini.ts'
import type { Msg } from './types.ts'

const history: Msg[] = [
  { role: 'user', content: [{ type: 'text', text: 'log 500 ml' }] },
  { role: 'assistant', content: [{ type: 'text', text: 'on it' }, { type: 'tool_use', id: 'c1', name: 'log_water', input: { ml: 500 } }] },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: 'logged' }] },
  { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
]

test('openai input keeps call ids and serialises arguments', () => {
  const input = toInput(history)
  assert.deepEqual(input, [
    { role: 'user', content: 'log 500 ml' },
    { role: 'assistant', content: 'on it' },
    { type: 'function_call', call_id: 'c1', name: 'log_water', arguments: '{"ml":500}' },
    { type: 'function_call_output', call_id: 'c1', output: 'logged' },
    { role: 'assistant', content: 'done' },
  ])
})

test('gemini contents alternate roles and name function responses', () => {
  const c = toContents(history)
  assert.deepEqual(c.map(x => x.role), ['user', 'model', 'user', 'model'])
  assert.deepEqual(c[1].parts, [{ text: 'on it' }, { functionCall: { id: 'c1', name: 'log_water', args: { ml: 500 } } }])
  assert.deepEqual(c[2].parts, [{ functionResponse: { id: 'c1', name: 'log_water', response: { result: 'logged' } } }])
})

test('gemini merges consecutive same-role messages', () => {
  const c = toContents([
    { role: 'user', content: [{ type: 'text', text: 'a' }] },
    { role: 'user', content: [{ type: 'text', text: 'b' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'c' }] },
  ])
  assert.equal(c.length, 2)
  assert.deepEqual(c[0].parts, [{ text: 'a' }, { text: 'b' }])
})
