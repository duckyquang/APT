import { GoogleGenAI, type Content, type FunctionCall, type Part } from '@google/genai'
import { MEAL_SYSTEM } from './defs.ts'
import type { Provider } from './types.ts'
import type { Block, Msg } from '../types.ts'

const client = (key: string) => new GoogleGenAI({ apiKey: key })

// Gemini wants strict user/model alternation, so consecutive same-role messages merge into one content
export function toContents(history: Msg[]): Content[] {
  const names = new Map<string, string>()
  const out: Content[] = []
  for (const m of history) {
    const parts: Part[] = []
    for (const b of m.content) {
      if (b.type === 'text') parts.push({ text: b.text })
      else if (b.type === 'tool_use') {
        names.set(b.id, b.name)
        parts.push({ functionCall: { id: b.id, name: b.name, args: (b.input ?? {}) as Record<string, unknown> } })
      } else if (b.type === 'tool_result') {
        parts.push({ functionResponse: { id: b.tool_use_id, name: names.get(b.tool_use_id) ?? 'tool', response: { result: b.content } } })
      }
    }
    if (!parts.length) continue
    const role = m.role === 'assistant' ? 'model' : 'user'
    const last = out[out.length - 1]
    if (last?.role === role) last.parts!.push(...parts)
    else out.push({ role, parts })
  }
  return out
}

export const gemini: Provider = {
  async validateKey(key, model) {
    await client(key).models.generateContent({ model, contents: 'hi', config: { maxOutputTokens: 1 } })
  },

  async chatTurn(key, o) {
    const ai = client(key)
    const config = {
      systemInstruction: o.system.join('\n\n'),
      tools: [{ functionDeclarations: o.tools.map(t => ({ name: t.name, description: t.description, parametersJsonSchema: t.input_schema })) }],
    }
    const contents = toContents(o.history)
    for (let round = 0; round < 8; round++) {
      const stream = await ai.models.generateContentStream({ model: o.model, contents, config })
      let text = ''
      const calls: FunctionCall[] = []
      const parts: Part[] = []
      let finish: string | undefined
      for await (const chunk of stream) {
        const t = chunk.text
        if (t) { text += t; o.onText(text) }
        for (const fc of chunk.functionCalls ?? []) calls.push(fc)
        // keep the candidate's parts verbatim: thinking models sign function-call parts and want them echoed back
        parts.push(...(chunk.candidates?.[0]?.content?.parts ?? []))
        finish = chunk.candidates?.[0]?.finishReason ?? finish
      }
      const ids = calls.map(fc => fc.id ?? crypto.randomUUID())
      const blocks: Block[] = []
      if (text) blocks.push({ type: 'text', text })
      calls.forEach((fc, i) => blocks.push({ type: 'tool_use', id: ids[i], name: fc.name ?? '', input: fc.args ?? {} }))
      const assistant: Msg = { role: 'assistant', content: blocks }
      if (!calls.length) {
        if (blocks.length) await o.onRound(assistant)
        return finish === 'MAX_TOKENS' ? 'max_tokens' : finish === 'SAFETY' || finish === 'PROHIBITED_CONTENT' ? 'refusal' : 'end_turn'
      }
      contents.push({ role: 'model', parts })
      const results: Block[] = []
      const resParts: Part[] = []
      for (let i = 0; i < calls.length; i++) {
        const r = await o.runTool(calls[i].name ?? '', calls[i].args ?? {})
        results.push({ type: 'tool_result', tool_use_id: ids[i], content: r.result, is_error: r.error })
        // only echo an id the model actually sent; a made-up one would not match anything on its side
        resParts.push({ functionResponse: { ...(calls[i].id ? { id: calls[i].id } : {}), name: calls[i].name, response: { result: r.result } } })
      }
      contents.push({ role: 'user', parts: resParts })
      await o.onRound(assistant, { role: 'user', content: results })
    }
    return 'max_rounds'
  },

  async analyzeMeal(key, model, jpeg, text, schema) {
    const r = await client(key).models.generateContent({
      model,
      contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/jpeg', data: jpeg } }, { text }] }],
      config: { systemInstruction: MEAL_SYSTEM, responseMimeType: 'application/json', responseJsonSchema: schema },
    })
    if (!r.text) throw new Error(r.candidates?.[0]?.finishReason === 'SAFETY' ? 'The model declined to analyse this photo.' : 'No estimate came back. Try again.')
    return JSON.parse(r.text)
  },
}
