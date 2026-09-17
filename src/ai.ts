import Anthropic from '@anthropic-ai/sdk'
import { jsonSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/json-schema'
import { dayKey, weekdayOf, WEEKDAYS } from './dates.ts'
import { LEVELS } from './logic.ts'
import { toBase64 } from './image.ts'
import type { Profile, PlanRow, DailyTotals, MealRow, MealEstimate } from './types.ts'

export const MODELS = ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'] as const

const KEY = 'apt.key'
export function getKey() {
  try { return localStorage.getItem(KEY) ?? '' } catch { return '' }
}
export function setKey(k: string) {
  try { k ? localStorage.setItem(KEY, k) : localStorage.removeItem(KEY) } catch {}
}

export const client = (key = getKey()) => new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true })

export async function validateKey(key: string) {
  await client(key).messages.create({ model: 'claude-haiku-4-5', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] })
}

export function errorMessage(e: unknown) {
  if (e instanceof Anthropic.AuthenticationError) return 'That API key was rejected. Check it in Settings.'
  if (e instanceof Anthropic.RateLimitError) return 'Rate limited by Anthropic. New keys start on a low tier; wait a minute or switch to claude-sonnet-5 in Settings.'
  if (e instanceof Anthropic.APIConnectionError) return 'Could not reach Anthropic. If your organisation has zero data retention, browser calls are not allowed.'
  if (e instanceof Anthropic.APIError && e.status === 529) return 'Anthropic is overloaded right now. Try again in a moment.'
  if (e instanceof Anthropic.APIError) return `Anthropic error ${e.status}: ${e.message}`
  return e instanceof Error ? e.message : String(e)
}

const str = { type: 'string' } as const
const num = { type: 'number' } as const
const weekday = { type: 'string', enum: [...WEEKDAYS] }
const macros = { kcal: num, protein_g: num, carbs_g: num, fat_g: num }

export const TOOLS: Anthropic.Tool[] = [
  {
    name: 'update_profile',
    description: 'Save what you learn about the user. Send only the fields that changed. weight_kg logs a weigh-in for today.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: str,
        sex: { type: 'string', enum: ['male', 'female', 'other'] },
        birth_date: { type: 'string', description: 'YYYY-MM-DD' },
        height_cm: num,
        weight_kg: num,
        goal: str,
        activity_level: { type: 'string', enum: [...LEVELS] },
        training_days: { type: 'array', items: weekday },
        equipment: str,
        injuries: str,
        dietary_prefs: str,
        targets: { type: 'object', additionalProperties: false, properties: { ...macros, water_ml: num } },
        units: { type: 'string', enum: ['metric', 'imperial'] },
      },
    },
  },
  {
    name: 'search_exercises',
    description: 'Search the exercise catalog. Plans may only use exercise_ids returned by this tool. Prefer entries with has_video.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        q: { type: 'string', description: 'part of the exercise name' },
        muscle: { type: 'string', description: 'e.g. chest, quadriceps, lats, abdominals, hamstrings, shoulders' },
        equipment: { type: 'string', description: 'e.g. barbell, dumbbell, body only, cable, machine, kettlebells' },
      },
    },
  },
  {
    name: 'save_workout_plan',
    description: 'Save a complete weekly workout plan; it replaces the current one. Every exercise_id must come from search_exercises. Explain the plan in prose after saving.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'days'],
      properties: {
        title: str,
        days: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['weekday', 'name', 'exercises'],
            properties: {
              weekday,
              name: str,
              exercises: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['exercise_id', 'name', 'sets', 'reps', 'rest_s'],
                  properties: {
                    exercise_id: str,
                    name: str,
                    sets: num,
                    reps: { type: 'string', description: 'e.g. "8-10" or "5"' },
                    rest_s: num,
                    notes: { type: 'string', description: 'one short form cue' },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  {
    name: 'save_meal_plan',
    description: 'Save a complete weekly meal plan; it replaces the current one. Respect dietary_prefs and targets. Explain it in prose after saving.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'days'],
      properties: {
        title: str,
        days: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['weekday', 'meals'],
            properties: {
              weekday,
              meals: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['name', 'items', 'kcal', 'protein_g', 'carbs_g', 'fat_g'],
                  properties: {
                    name: str,
                    ...macros,
                    items: {
                      type: 'array',
                      items: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['food', 'qty', 'kcal', 'protein_g', 'carbs_g', 'fat_g'],
                        properties: { food: str, qty: str, ...macros },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  {
    name: 'log_meal',
    description: 'Log food the user describes in text (not photos). Estimate the visible portion honestly.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'kcal', 'protein_g', 'carbs_g', 'fat_g'],
      properties: {
        name: str,
        ...macros,
        fiber_g: num,
        date: { type: 'string', description: 'YYYY-MM-DD, default today; use it for food eaten before midnight' },
        time: { type: 'string', description: 'HH:MM local, default now' },
      },
    },
  },
  {
    name: 'log_water',
    description: 'Log water the user drank.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['ml'],
      properties: { ml: num, date: { type: 'string', description: 'YYYY-MM-DD, default today' }, time: { type: 'string', description: 'HH:MM local, default now' } },
    },
  },
  {
    name: 'log_workout',
    description: 'Log a workout the user describes in text. Use exercise_id from search_exercises when you know it; otherwise leave it out.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['day_name', 'exercises'],
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD, default today' },
        day_name: str,
        duration_min: num,
        notes: str,
        exercises: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['name', 'sets'],
            properties: {
              exercise_id: str,
              name: str,
              sets: {
                type: 'array',
                items: { type: 'object', additionalProperties: false, required: ['reps', 'weight_kg'], properties: { reps: num, weight_kg: num } },
              },
            },
          },
        },
      },
    },
  },
  {
    name: 'get_history',
    description: 'Read daily totals and workouts for the last N days (default 14, max 90). Set include_meals for the meal list.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: { days: num, include_meals: { type: 'boolean' } },
    },
  },
]

const nutr = { kcal: num, protein_g: num, carbs_g: num, fat_g: num, fiber_g: num }
const MEAL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items', 'totals', 'confidence', 'assumptions'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'portion_estimate', 'grams', 'kcal', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g'],
        properties: { name: str, portion_estimate: str, grams: num, ...nutr },
      },
    },
    totals: { type: 'object', additionalProperties: false, required: ['kcal', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g'], properties: nutr },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    assumptions: str,
  },
} as const

export async function analyzeMeal(jpeg: Blob, note: string, model: string): Promise<MealEstimate> {
  const data = await toBase64(jpeg)
  const res = await client().messages.parse({
    model,
    max_tokens: 4096,
    system: 'You estimate nutrition from a photo of a meal. Estimate the actual visible portion of each item in grams; do not default to standard serving sizes. Give kcal, protein, carbs, fat and fiber per item, then totals. Be honest in confidence and list your assumptions in one or two sentences.',
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } },
        { type: 'text', text: note.trim() ? `Note from the user: ${note.trim()}` : 'Estimate this meal.' },
      ],
    }],
    output_config: { format: jsonSchemaOutputFormat(MEAL_SCHEMA) },
  })
  if (!res.parsed_output) {
    throw new Error(res.stop_reason === 'refusal' ? 'The model declined to analyse this photo.' : 'No estimate came back. Try again.')
  }
  return res.parsed_output as MealEstimate
}

const PERSONA = `You are APT, the user's personal trainer. Direct, warm, specific. Metric units unless the profile says imperial.

How you work:
- Onboarding: while profile fields are missing, ask for two or three at a time in plain conversation, save each answer with update_profile as soon as you have it, and only propose a plan once nothing required is missing.
- Workout plans: call search_exercises to find real exercise_ids (prefer has_video entries), then save_workout_plan with the whole week: sets, reps, rest and a one-line cue per exercise. Then explain the plan in a few sentences.
- Meal plans: save_meal_plan for the whole week, respecting dietary_prefs and targets. Set targets with update_profile if they are missing.
- Changes: an injury, new equipment, a new goal or a weigh-in goes into update_profile. To revise a plan, edit the active plan you were given and save the whole thing again.
- Weigh-ins: if the latest weight is older than 7 days, ask for one.
- Keep replies short. Plain text, no markdown headings or tables. Never invent exercise ids.`

export type Context = {
  profile: Profile
  latestWeight: { weight_kg: number; date: string } | null
  totals: DailyTotals
  meals: MealRow[]
  workout: PlanRow | null
  meal: PlanRow | null
  missing: string[]
}

export function buildSystem(c: Context): Anthropic.TextBlockParam[] {
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
  return [
    { type: 'text', text: PERSONA, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: lines.join('\n') },
  ]
}

export type ToolRunner = (name: string, input: unknown) => Promise<{ result: string; error?: boolean }>

export async function chatTurn(opts: {
  model: string
  system: Anthropic.TextBlockParam[]
  history: Anthropic.MessageParam[]
  runTool: ToolRunner
  onText: (text: string) => void
  onRound: (assistant: Anthropic.MessageParam, toolResults?: Anthropic.MessageParam) => Promise<void>
}) {
  const messages = [...opts.history]
  for (let round = 0; round < 8; round++) {
    const stream = client().messages.stream({
      model: opts.model,
      max_tokens: 8192,
      system: opts.system,
      tools: TOOLS,
      messages,
    })
    let text = ''
    stream.on('text', t => { text += t; opts.onText(text) })
    const msg = await stream.finalMessage()
    const uses = msg.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
    if (msg.stop_reason !== 'tool_use' || !uses.length) {
      // a turn cut off by max_tokens can carry a half-written tool_use; never persist one without a result
      const content = msg.content.filter(b => b.type !== 'tool_use')
      if (content.some(b => b.type === 'text')) await opts.onRound({ role: 'assistant', content })
      return msg.stop_reason ?? 'end_turn'
    }
    const assistant: Anthropic.MessageParam = { role: 'assistant', content: msg.content }
    messages.push(assistant)
    const results: Anthropic.ToolResultBlockParam[] = []
    for (const u of uses) {
      const r = await opts.runTool(u.name, u.input)
      results.push({ type: 'tool_result', tool_use_id: u.id, content: r.result, is_error: r.error })
    }
    const user: Anthropic.MessageParam = { role: 'user', content: results }
    messages.push(user)
    await opts.onRound(assistant, user)
  }
  return 'max_rounds'
}
