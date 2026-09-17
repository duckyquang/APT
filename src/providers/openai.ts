import OpenAI from 'openai'
import { MEAL_SYSTEM } from './defs.ts'
import { parseArgs, type Provider } from './types.ts'
import type { Block, Msg } from '../types.ts'

const client = (key: string) => new OpenAI({ apiKey: key, dangerouslyAllowBrowser: true })

export function toInput(history: Msg[]): OpenAI.Responses.ResponseInputItem[] {
  const out: OpenAI.Responses.ResponseInputItem[] = []
  for (const m of history) {
    for (const b of m.content) {
      if (b.type === 'text') out.push({ role: m.role, content: b.text })
      else if (b.type === 'tool_use') out.push({ type: 'function_call', call_id: b.id, name: b.name, arguments: JSON.stringify(b.input ?? {}) })
      else if (b.type === 'tool_result') out.push({ type: 'function_call_output', call_id: b.tool_use_id, output: b.content })
    }
  }
  return out
}

export const openai: Provider = {
  async validateKey(key) {
    await client(key).models.list()
  },

  async chatTurn(key, o) {
    const c = client(key)
    const tools: OpenAI.Responses.FunctionTool[] = o.tools.map(t => ({ type: 'function', name: t.name, description: t.description, parameters: t.input_schema, strict: false }))
    const input = toInput(o.history)
    for (let round = 0; round < 8; round++) {
      const stream = await c.responses.create({ model: o.model, instructions: o.system.join('\n\n'), input, tools, stream: true })
      let text = ''
      let final: OpenAI.Responses.Response | undefined
      for await (const ev of stream) {
        if (ev.type === 'response.output_text.delta') { text += ev.delta; o.onText(text) }
        if (ev.type === 'response.completed') final = ev.response
      }
      if (!final) throw new Error('The provider closed the stream without a response.')
      const calls = final.output.filter((i): i is OpenAI.Responses.ResponseFunctionToolCall => i.type === 'function_call')
      const refused = final.output.some(i => i.type === 'message' && i.content.some(x => x.type === 'refusal'))
      const blocks: Block[] = []
      if (text) blocks.push({ type: 'text', text })
      for (const fc of calls) blocks.push({ type: 'tool_use', id: fc.call_id, name: fc.name, input: parseArgs(fc.arguments) })
      const assistant: Msg = { role: 'assistant', content: blocks }
      if (!calls.length) {
        if (blocks.length) await o.onRound(assistant)
        return refused ? 'refusal' : final.status === 'incomplete' ? 'max_tokens' : 'end_turn'
      }
      input.push(...(final.output as OpenAI.Responses.ResponseInputItem[]))
      const results: Block[] = []
      for (const fc of calls) {
        const r = await o.runTool(fc.name, parseArgs(fc.arguments))
        input.push({ type: 'function_call_output', call_id: fc.call_id, output: r.result })
        results.push({ type: 'tool_result', tool_use_id: fc.call_id, content: r.result, is_error: r.error })
      }
      await o.onRound(assistant, { role: 'user', content: results })
    }
    return 'max_rounds'
  },

  async analyzeMeal(key, model, jpeg, text, schema) {
    const r = await client(key).responses.create({
      model,
      instructions: MEAL_SYSTEM,
      input: [{
        role: 'user',
        content: [
          { type: 'input_image', image_url: `data:image/jpeg;base64,${jpeg}`, detail: 'auto' },
          { type: 'input_text', text },
        ],
      }],
      text: { format: { type: 'json_schema', name: 'meal', schema: schema as unknown as Record<string, unknown>, strict: true } },
    })
    if (r.output.some(i => i.type === 'message' && i.content.some(x => x.type === 'refusal'))) throw new Error('The model declined to analyse this photo.')
    if (!r.output_text) throw new Error('No estimate came back. Try again.')
    return JSON.parse(r.output_text)
  },
}
