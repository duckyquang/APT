import { toBase64 } from './image.ts'
import { dayKey, weekdayOf } from './dates.ts'
import { PERSONA, TOOLS, MEAL_SCHEMA } from './providers/defs.ts'
import { anthropic } from './providers/anthropic.ts'
import { openai } from './providers/openai.ts'
import { gemini } from './providers/gemini.ts'
import type { Provider, ChatOpts } from './providers/types.ts'
import type { Profile, PlanRow, DailyTotals, MealRow, MealEstimate, ProviderId, ModelOption } from './types.ts'

export type { ToolRunner } from './providers/types.ts'

// model lists as of 2026-09-17 from each provider's docs; Settings also takes any id typed by hand
export const PROVIDERS: Record<ProviderId, { label: string; def: string; models: ModelOption[] }> = {
  anthropic: {
    label: 'Anthropic', def: 'claude-opus-5',
    models: [
      { id: 'claude-opus-5', name: 'Claude Opus 5', blurb: 'The default. Best plans, most careful onboarding.', tier: 'best' },
      { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', blurb: 'Nearly as good, cheaper, higher rate limits on a new key.', tier: 'balanced' },
      { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', blurb: 'Fast and cheap. Meal photo estimates get rougher.', tier: 'fast' },
      { id: 'claude-fable-5-1', name: 'Claude Fable 5.1', blurb: 'The most capable Anthropic model. Pricey, and your org needs standard retention.', tier: 'best' },
      { id: 'claude-opus-4-8', name: 'Claude Opus 4.8', blurb: 'Previous Opus generation.', tier: 'balanced' },
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', blurb: 'Previous Sonnet generation.', tier: 'fast' },
    ],
  },
  openai: {
    label: 'OpenAI', def: 'gpt-5.6-terra',
    models: [
      { id: 'gpt-6-astra', name: 'GPT-6 Astra', blurb: 'The most capable OpenAI model, for the hardest work.', tier: 'best' },
      { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', blurb: 'Flagship for complex professional work.', tier: 'best' },
      { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra', blurb: 'The default here. Balances intelligence and cost.', tier: 'balanced' },
      { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', blurb: 'Built for cost-sensitive, high-volume use.', tier: 'fast' },
    ],
  },
  gemini: {
    label: 'Google Gemini', def: 'gemini-3.8-flash',
    models: [
      { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro', blurb: 'Deepest reasoning in the Gemini line. Preview.', tier: 'best' },
      { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', blurb: 'The default here. Strong at tool use, fast.', tier: 'balanced' },
      { id: 'gemini-3.6-flash', name: 'Gemini 3.6 Flash', blurb: 'Everyday speed and multimodal balance.', tier: 'balanced' },
      { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash-Lite', blurb: 'Fastest and cheapest.', tier: 'fast' },
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', blurb: 'Previous generation Pro.', tier: 'balanced' },
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', blurb: 'Previous generation Flash.', tier: 'fast' },
    ],
  },
}

const impl: Record<ProviderId, Provider> = { anthropic, openai, gemini }

export function getKey(p: ProviderId) {
  try {
    return localStorage.getItem(`apt.key.${p}`) ?? (p === 'anthropic' ? localStorage.getItem('apt.key') ?? '' : '')
  } catch {
    return ''
  }
}
export function setKey(p: ProviderId, k: string) {
  try {
    k ? localStorage.setItem(`apt.key.${p}`, k) : localStorage.removeItem(`apt.key.${p}`)
    if (p === 'anthropic') localStorage.removeItem('apt.key')
  } catch {}
}

export const validateKey = (p: ProviderId, key: string, model: string) => impl[p].validateKey(key, model)

export function errorMessage(e: unknown) {
  const status = (e as { status?: number } | null)?.status
  const msg = e instanceof Error ? e.message : String(e)
  if (status === 401 || status === 403 || (status === 400 && /api key/i.test(msg))) return 'That API key was rejected. Check it in Settings.'
  if (status === 429) return 'Rate limited by the provider. Wait a minute or switch to a cheaper model in Settings.'
  if (status === 529 || (status && status >= 500)) return 'The provider is overloaded right now. Try again in a moment.'
  if (/connection|failed to fetch|network/i.test(msg)) return 'Could not reach the provider. Check your connection; some organisations block browser calls.'
  return msg
}

export type Context = {
  profile: Profile
  latestWeight: { weight_kg: number; date: string } | null
  totals: DailyTotals
  meals: MealRow[]
  workout: PlanRow | null
  meal: PlanRow | null
  missing: string[]
}

export function buildSystem(c: Context) {
  const { user_id, updated_at, ...profile } = c.profile
  const lines = [
    `Today is ${dayKey()} (${weekdayOf()}).`,
    `Profile: ${JSON.stringify({ ...profile, latest_weight: c.latestWeight })}`,
    `Today so far: ${JSON.stringify(c.totals)}`,
    `Today's meals: ${JSON.stringify(c.meals.map(m => ({ name: m.name, kcal: m.kcal, source: m.source })))}`,
    `Active workout plan: ${c.workout ? JSON.stringify({ title: c.workout.title, ...c.workout.content }) : 'none yet'}`,
    `Active meal plan: ${c.meal ? JSON.stringify({ title: c.meal.title, ...c.meal.content }) : 'none yet'}`,
    c.missing.length ? `Missing profile fields, onboarding not finished: ${c.missing.join(', ')}` : 'Onboarding complete.',
  ]
  return [PERSONA, lines.join('\n')]
}

export function chatTurn(p: ProviderId, key: string, o: Omit<ChatOpts, 'tools'>) {
  return impl[p].chatTurn(key, { ...o, tools: TOOLS })
}

export async function analyzeMeal(p: ProviderId, key: string, model: string, jpeg: Blob, note: string): Promise<MealEstimate> {
  const data = await toBase64(jpeg)
  const text = note.trim() ? `Note from the user: ${note.trim()}` : 'Estimate this meal.'
  return (await impl[p].analyzeMeal(key, model, data, text, MEAL_SCHEMA)) as MealEstimate
}
