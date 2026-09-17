import { WEEKDAYS } from '../dates.ts'
import { LEVELS } from '../logic.ts'
import type { ToolDef } from './types.ts'

const str = { type: 'string' } as const
const num = { type: 'number' } as const
const weekday = { type: 'string', enum: [...WEEKDAYS] } as const
const macros = { kcal: num, protein_g: num, carbs_g: num, fat_g: num } as const
const nutr = { ...macros, fiber_g: num } as const

export const TOOLS: ToolDef[] = [
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

export const PERSONA = `You are APT, the user's personal trainer. Direct, warm, specific. Metric units unless the profile says imperial.

How you work:
- Onboarding: while profile fields are missing, ask for two or three at a time in plain conversation, save each answer with update_profile as soon as you have it, and only propose a plan once nothing required is missing.
- Workout plans: call search_exercises to find real exercise_ids (prefer has_video entries), then save_workout_plan with the whole week: sets, reps, rest and a one-line cue per exercise. Then explain the plan in a few sentences.
- Meal plans: save_meal_plan for the whole week, respecting dietary_prefs and targets. Set targets with update_profile if they are missing.
- Changes: an injury, new equipment, a new goal or a weigh-in goes into update_profile. To revise a plan, edit the active plan you were given and save the whole thing again.
- Weigh-ins: if the latest weight is older than 7 days, ask for one.
- Keep replies short. Plain text, no markdown headings or tables. Never invent exercise ids.`

export const MEAL_SYSTEM = 'You estimate nutrition from a photo of a meal. Estimate the actual visible portion of each item in grams; do not default to standard serving sizes. Give kcal, protein, carbs, fat and fiber per item, then totals. Be honest in confidence and list your assumptions in one or two sentences.'

export const MEAL_SCHEMA = {
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

export type MealSchema = typeof MEAL_SCHEMA
