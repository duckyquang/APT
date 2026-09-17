import { toBase64 } from './image.ts'
import { dayKey, weekdayOf } from './dates.ts'
import { PERSONA, TOOLS, MEAL_SCHEMA } from './providers/defs.ts'
import { anthropic } from './providers/anthropic.ts'
import { openai } from './providers/openai.ts'
import { gemini } from './providers/gemini.ts'
import type { Provider, ChatOpts } from './providers/types.ts'
import type { Profile, PlanRow, DailyTotals, MealRow, MealEstimate, ProviderId } from './types.ts'

export type { ToolRunner } from './providers/types.ts'

// model ids are suggestions; the field in Settings is free text because names move
export const PROVIDERS: Record<ProviderId, { label: string; models: string[] }> = {
  anthropic: { label: 'Anthropic', models: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'] },
  openai: { label: 'OpenAI', models: ['gpt-6-astra'] },
  gemini: { label: 'Google Gemini', models: ['gemini-3.8-flash'] },
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
  try { k ? localStorage.setItem(`apt.key.${p}`, k) : localStorage.removeItem(`apt.key.${p}`) } catch {}
}

export const validateKey = (p: ProviderId, key: string, model: string) => impl[p].validateKey(key, model)

export function errorMessage(e: unknown) {
  const status = (e as { status?: number } | null)?.status
  const msg = e instanceof Error ? e.message : String(e)
  if (status === 401 || status === 403) return 'That API key was rejected. Check it in Settings.'
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
