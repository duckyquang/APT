import Anthropic from '@anthropic-ai/sdk'
import { jsonSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/json-schema'
import { MEAL_SYSTEM } from './defs.ts'
import type { Provider } from './types.ts'
import type { Block } from '../types.ts'

const client = (key: string) => new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true })

export const anthropic: Provider = {
  async validateKey(key) {
    await client(key).messages.create({ model: 'claude-haiku-4-5', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] })
  },

  async chatTurn(key, o) {
    const [persona, context] = o.system
    const system: Anthropic.TextBlockParam[] = [
      { type: 'text', text: persona, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: context },
    ]
    const tools = o.tools as unknown as Anthropic.Tool[]
    const messages: Anthropic.MessageParam[] = o.history.map(m => ({ role: m.role, content: m.content as Anthropic.ContentBlockParam[] }))
    for (let round = 0; round < 8; round++) {
      const stream = client(key).messages.stream({ model: o.model, max_tokens: 8192, system, tools, messages })
      let text = ''
      stream.on('text', t => { text += t; o.onText(text) })
      const msg = await stream.finalMessage()
      const uses = msg.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
      if (msg.stop_reason !== 'tool_use' || !uses.length) {
        // a turn cut off by max_tokens can carry a half-written tool_use; never persist one without a result
        const content = msg.content.filter(b => b.type !== 'tool_use')
        if (content.some(b => b.type === 'text')) await o.onRound({ role: 'assistant', content: content as unknown as Block[] })
        return msg.stop_reason ?? 'end_turn'
      }
      messages.push({ role: 'assistant', content: msg.content })
      const results: Anthropic.ToolResultBlockParam[] = []
      for (const u of uses) {
        const r = await o.runTool(u.name, u.input)
        results.push({ type: 'tool_result', tool_use_id: u.id, content: r.result, is_error: r.error })
      }
      messages.push({ role: 'user', content: results })
      await o.onRound({ role: 'assistant', content: msg.content as unknown as Block[] }, { role: 'user', content: results as unknown as Block[] })
    }
    return 'max_rounds'
  },

  async analyzeMeal(key, model, jpeg, text, schema) {
    const res = await client(key).messages.parse({
      model,
      max_tokens: 4096,
      system: MEAL_SYSTEM,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpeg } },
          { type: 'text', text },
        ],
      }],
      output_config: { format: jsonSchemaOutputFormat(schema) },
    })
    if (!res.parsed_output) {
      throw new Error(res.stop_reason === 'refusal' ? 'The model declined to analyse this photo.' : 'No estimate came back. Try again.')
    }
    return res.parsed_output
  },
}
