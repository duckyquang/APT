import type { Msg } from '../types.ts'
import type { MealSchema } from './defs.ts'

export type ToolDef = { name: string; description: string; input_schema: Record<string, unknown> }
export type ToolRunner = (name: string, input: unknown) => Promise<{ result: string; error?: boolean }>

export type ChatOpts = {
  model: string
  system: string[]
  history: Msg[]
  tools: ToolDef[]
  runTool: ToolRunner
  onText: (text: string) => void
  onRound: (assistant: Msg, toolResults?: Msg) => Promise<void>
}

export type Provider = {
  validateKey(key: string, model: string): Promise<void>
  chatTurn(key: string, o: ChatOpts): Promise<string>
  analyzeMeal(key: string, model: string, jpegBase64: string, text: string, schema: MealSchema): Promise<unknown>
}

export const parseArgs = (s: string) => { try { return JSON.parse(s) } catch { return {} } }
