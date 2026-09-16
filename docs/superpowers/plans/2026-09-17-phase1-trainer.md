# Phase 1: The Trainer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The chat trainer works end to end: API key in Settings, onboarding conversation that fills the profile, workout and meal plans written through tools and rendered on the Plan tab with instructions, stills and YouTube.

**Architecture:** One agent loop in `src/ai.ts` calling the Anthropic API from the browser with the user's key. Tools are plain JSON Schema; the browser runs them against Supabase and a bundled exercise catalog. Chat history lives in the `messages` table and is replayed verbatim. Views are React components under `src/views/`; `src/App.tsx` wires the key gate, onboarding routing and a `version` counter that re-fetches tiles after every tool call.

**Tech Stack:** Everything from Phase 0 plus `@anthropic-ai/sdk` 0.126.0. Catalog is free-exercise-db `dist/exercises.json` (Unlicense).

## Global Constraints

- Repo: `/Users/buno/Documents/coding/APT`, branch `main`. Push directly to main after each task's commit. No PRs. Git identity is Quang Bui; no AI attribution in commits.
- Runtime dependencies are exactly `react`, `react-dom`, `@supabase/supabase-js`, `@anthropic-ai/sdk`. Pin exact versions.
- No router, no state library, no Tailwind, no component library, no markdown renderer, no zod.
- Model ids are exactly `claude-opus-5` (default), `claude-sonnet-5`, `claude-haiku-4-5`. Never append date suffixes. The `thinking` parameter is omitted on every call.
- Chat rows store the SDK's returned `content` array verbatim, thinking blocks included. Never image blocks.
- The assistant `tool_use` message and the user `tool_result` message are inserted into `messages` together, after the tool has run. Never the `tool_use` alone.
- All dates use `dayKey()` / `weekdayOf()` from `src/dates.ts`.
- `npm run check` (tsc + node tests) must pass before every commit. Tests run with `node --test src/*.test.ts` and must import with `.ts` extensions.
- Code style: match Phase 0. No obvious comments, no over-long names, no TODO noise. Mark deliberate shortcuts with `// ponytail:`.
- Phase 0 interfaces this plan consumes: `dayKey()`, `weekdayOf()`, `WEEKDAYS`, `Weekday` from `src/dates.ts`; `sb`, `signIn()`, `signOut()`, `ensureProfile()` from `src/db.ts`; `TABS`, `Tab`, `tabFromHash()` and the `.shell`/`.gate`/`.fab` markup from `src/App.tsx`; tokens and `button.primary` from `src/app.css`.

---

### Task 1: Exercise catalog, row types, search

**Files:**
- Create: `public/exercises.json` (downloaded), `public/videos.json` (empty object for now), `src/types.ts`, `src/catalog.ts`, `src/catalog.test.ts`

**Interfaces:**
- Produces: types `Exercise Videos Targets Profile PlanExercise WorkoutPlan MealItem PlanMeal MealPlan PlanRow DailyTotals MealRow`; `STILLS` URL prefix; `loadCatalog(): Promise<{ catalog: Exercise[]; videos: Videos }>`; `searchExercises(catalog, { q?, muscle?, equipment? }, videos, limit = 20)` returning `{ id, name, equipment, primaryMuscles, has_video }[]`.

- [ ] **Step 1: Download the catalog and create the empty video map**

```bash
cd /Users/buno/Documents/coding/APT
curl -sL -o public/exercises.json https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json
echo '{}' > public/videos.json
node -e "const d=require('./public/exercises.json'); console.log(d.length, Object.keys(d[0]).sort().join(','))"
```

Expected: `876 category,equipment,force,id,images,instructions,level,mechanic,name,primaryMuscles,secondaryMuscles`.

- [ ] **Step 2: Write src/types.ts**

```ts
import type { Weekday } from './dates.ts'

export type Exercise = {
  id: string
  name: string
  equipment: string | null
  primaryMuscles: string[]
  secondaryMuscles: string[]
  instructions: string[]
  category: string
  images: string[]
}

export type Videos = Record<string, string>

export type Targets = { kcal?: number; protein_g?: number; carbs_g?: number; fat_g?: number; water_ml?: number }

export type Profile = {
  user_id: string
  name: string | null
  sex: string | null
  birth_date: string | null
  height_cm: number | null
  goal: string | null
  activity_level: string | null
  training_days: Weekday[]
  equipment: string | null
  injuries: string | null
  dietary_prefs: string | null
  targets: Targets
  units: 'metric' | 'imperial'
  model: string
  onboarded_at: string | null
  updated_at: string
}

export type PlanExercise = { exercise_id: string; name: string; sets: number; reps: string; rest_s: number; notes?: string }
export type WorkoutPlan = { days: { weekday: Weekday; name: string; exercises: PlanExercise[] }[] }
export type MealItem = { food: string; qty: string; kcal: number; protein_g: number; carbs_g: number; fat_g: number }
export type PlanMeal = { name: string; items: MealItem[]; kcal: number; protein_g: number; carbs_g: number; fat_g: number }
export type MealPlan = { days: { weekday: Weekday; meals: PlanMeal[] }[] }
export type PlanRow = { id: string; kind: 'workout' | 'meal'; title: string | null; content: WorkoutPlan | MealPlan; created_at: string }

export type DailyTotals = {
  date: string
  kcal: number
  protein_g: number
  carbs_g: number
  fat_g: number
  water_ml: number
  workout_done: boolean
  weight_kg: number | null
}

export type MealRow = {
  id: string
  date: string
  eaten_at: string
  photo_path: string | null
  name: string | null
  items: unknown[]
  kcal: number
  protein_g: number
  carbs_g: number
  fat_g: number
  fiber_g: number
  confidence: string | null
  assumptions: string | null
  source: 'photo' | 'manual' | 'agent' | 'plan'
}
```

- [ ] **Step 3: Write the failing test src/catalog.test.ts**

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { searchExercises } from './catalog.ts'
import type { Exercise } from './types.ts'

const ex = (id: string, name: string, equipment: string | null, muscles: string[]): Exercise =>
  ({ id, name, equipment, primaryMuscles: muscles, secondaryMuscles: [], instructions: [], category: 'strength', images: [] })

const catalog = [
  ex('Barbell_Squat', 'Barbell Squat', 'barbell', ['quadriceps']),
  ex('Barbell_Squat_To_A_Bench', 'Barbell Squat To A Bench', 'barbell', ['quadriceps']),
  ex('Pushups', 'Pushups', 'body only', ['chest']),
]

test('filters by name, muscle and equipment', () => {
  assert.deepEqual(searchExercises(catalog, { q: 'push' }, {}).map(r => r.id), ['Pushups'])
  assert.deepEqual(searchExercises(catalog, { muscle: 'quad', equipment: 'barbell' }, {}).map(r => r.id),
    ['Barbell_Squat', 'Barbell_Squat_To_A_Bench'])
})

test('entries with a video come first, then shorter names', () => {
  const r = searchExercises(catalog, { muscle: 'quadriceps' }, { Barbell_Squat_To_A_Bench: 'abc' })
  assert.equal(r[0].id, 'Barbell_Squat_To_A_Bench')
  assert.equal(r[0].has_video, true)
  assert.equal(r[1].has_video, false)
})

test('limit', () => {
  assert.equal(searchExercises(catalog, {}, {}, 2).length, 2)
})
```

- [ ] **Step 4: Run it to verify it fails**

Run: `node --test src/catalog.test.ts`
Expected: FAIL, cannot find module `./catalog.ts`.

- [ ] **Step 5: Write src/catalog.ts**

```ts
import type { Exercise, Videos } from './types.ts'

export const STILLS = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/'

export async function loadCatalog(): Promise<{ catalog: Exercise[]; videos: Videos }> {
  const base = import.meta.env.BASE_URL
  const [catalog, videos] = await Promise.all([
    fetch(base + 'exercises.json').then(r => r.json()),
    fetch(base + 'videos.json').then(r => r.json()),
  ])
  return { catalog, videos }
}

export type Search = { q?: string; muscle?: string; equipment?: string }

export function searchExercises(catalog: Exercise[], s: Search, videos: Videos, limit = 20) {
  const q = s.q?.toLowerCase().trim()
  const muscle = s.muscle?.toLowerCase().trim()
  const equipment = s.equipment?.toLowerCase().trim()
  const hits = catalog.filter(e =>
    (!q || e.name.toLowerCase().includes(q)) &&
    (!muscle || e.primaryMuscles.some(m => m.includes(muscle))) &&
    (!equipment || (e.equipment ?? '').includes(equipment)))
  // videos first, then shorter names so "Barbell Squat" beats "Barbell Squat To A Bench"
  hits.sort((a, b) => Number(b.id in videos) - Number(a.id in videos) || a.name.length - b.name.length)
  return hits.slice(0, limit).map(e => ({
    id: e.id,
    name: e.name,
    equipment: e.equipment,
    primaryMuscles: e.primaryMuscles,
    has_video: e.id in videos,
  }))
}
```

- [ ] **Step 6: Run the tests and the type check**

Run: `npm run check`
Expected: tsc clean; 5 tests passing (2 from dates, 3 from catalog).

- [ ] **Step 7: Commit and push**

```bash
git add -A && git commit -m "Bundle exercise catalog with search" && git push
```

---

### Task 2: Chat window trimming, plan validation, profile whitelist

**Files:**
- Create: `src/logic.ts`, `src/logic.test.ts`
- Modify: `package.json` (install the SDK, needed for its types)

**Interfaces:**
- Produces: `trimWindow(msgs: Anthropic.MessageParam[]): Anthropic.MessageParam[]`; `PROFILE_FIELDS`, `REQUIRED`; `pickProfileFields(input: Record<string, unknown>): Partial<Profile>`; `missingFields(p: Profile, hasWeight: boolean): string[]`; `validateWorkoutPlan(plan: WorkoutPlan, catalog: Exercise[], trainingDays: Weekday[]): string[]`; `validateMealPlan(plan: MealPlan): string[]`. Empty array means valid.

- [ ] **Step 1: Install the Anthropic SDK**

```bash
npm install --save-exact @anthropic-ai/sdk@0.126.0
```

- [ ] **Step 2: Write the failing test src/logic.test.ts**

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type Anthropic from '@anthropic-ai/sdk'
import { trimWindow, pickProfileFields, missingFields, validateWorkoutPlan, validateMealPlan } from './logic.ts'
import type { Exercise, Profile } from './types.ts'

const user = (text: string): Anthropic.MessageParam => ({ role: 'user', content: [{ type: 'text', text }] })
const assistant = (text: string): Anthropic.MessageParam => ({ role: 'assistant', content: [{ type: 'text', text }] })
const toolUse: Anthropic.MessageParam = { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'log_water', input: { ml: 500 } }] }
const toolResult: Anthropic.MessageParam = { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] }

test('trimWindow never starts on a tool_result', () => {
  const w = trimWindow([toolResult, assistant('done'), user('next'), assistant('sure')])
  assert.equal(w.length, 2)
  assert.equal(w[0].role, 'user')
})

test('trimWindow drops a trailing unanswered tool_use', () => {
  const w = trimWindow([user('hi'), toolUse])
  assert.equal(w.length, 1)
})

test('trimWindow keeps a complete pair', () => {
  const w = trimWindow([user('hi'), toolUse, toolResult, assistant('logged')])
  assert.equal(w.length, 4)
})

test('pickProfileFields whitelists and cleans training_days', () => {
  const p = pickProfileFields({ name: 'Q', model: 'evil', onboarded_at: 'x', training_days: ['mon', 'funday'], weight_kg: 80 })
  assert.deepEqual(p, { name: 'Q', training_days: ['mon'] })
})

const profile: Profile = {
  user_id: 'u', name: null, sex: 'male', birth_date: '1990-01-01', height_cm: 180, goal: 'strength', activity_level: null,
  training_days: ['mon', 'wed'], equipment: null, injuries: null, dietary_prefs: null, targets: {}, units: 'metric',
  model: 'claude-opus-5', onboarded_at: null, updated_at: '',
}

test('missingFields', () => {
  assert.deepEqual(missingFields(profile, true), [])
  assert.deepEqual(missingFields({ ...profile, goal: null, training_days: [] }, false), ['goal', 'training_days', 'weight_kg'])
})

const catalog: Exercise[] = [
  { id: 'Barbell_Squat', name: 'Barbell Squat', equipment: 'barbell', primaryMuscles: ['quadriceps'], secondaryMuscles: [], instructions: [], category: 'strength', images: [] },
]

test('validateWorkoutPlan rejects unknown ids and off days', () => {
  const errors = validateWorkoutPlan(
    { days: [{ weekday: 'tue', name: 'Legs', exercises: [{ exercise_id: 'Squat', name: 'Barbell squat', sets: 3, reps: '5', rest_s: 120 }] }] },
    catalog, ['mon', 'wed'])
  assert.equal(errors.length, 2)
  assert.match(errors[0], /tue/)
  assert.match(errors[1], /Barbell_Squat/)
  assert.deepEqual(validateWorkoutPlan(
    { days: [{ weekday: 'mon', name: 'Legs', exercises: [{ exercise_id: 'Barbell_Squat', name: 'Barbell Squat', sets: 3, reps: '5', rest_s: 120 }] }] },
    catalog, ['mon', 'wed']), [])
})

test('validateMealPlan checks numbers and item sums', () => {
  const meal = { name: 'Lunch', items: [{ food: 'rice', qty: '1 cup', kcal: 200, protein_g: 4, carbs_g: 45, fat_g: 0 }], kcal: 600, protein_g: 4, carbs_g: 45, fat_g: 0 }
  assert.equal(validateMealPlan({ days: [{ weekday: 'mon', meals: [meal] }] }).length, 1)
  assert.equal(validateMealPlan({ days: [{ weekday: 'mon', meals: [{ ...meal, kcal: 210 }] }] }).length, 0)
  assert.equal(validateMealPlan({ days: [{ weekday: 'mon', meals: [{ ...meal, kcal: 210, fat_g: -1 }] }] }).length, 1)
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `node --test src/logic.test.ts`
Expected: FAIL, cannot find module `./logic.ts`.

- [ ] **Step 4: Write src/logic.ts**

```ts
import type Anthropic from '@anthropic-ai/sdk'
import { WEEKDAYS, type Weekday } from './dates.ts'
import type { Exercise, Profile, WorkoutPlan, MealPlan } from './types.ts'

const hasBlock = (m: Anthropic.MessageParam, type: string) =>
  Array.isArray(m.content) && m.content.some(b => b.type === type)

// the API rejects a window that starts on a tool_result or ends on an unanswered tool_use
export function trimWindow(msgs: Anthropic.MessageParam[]) {
  let start = 0
  while (start < msgs.length && !(msgs[start].role === 'user' && !hasBlock(msgs[start], 'tool_result'))) start++
  let end = msgs.length
  if (end > start && msgs[end - 1].role === 'assistant' && hasBlock(msgs[end - 1], 'tool_use')) end--
  return msgs.slice(start, end)
}

export const PROFILE_FIELDS = [
  'name', 'sex', 'birth_date', 'height_cm', 'goal', 'activity_level', 'training_days',
  'equipment', 'injuries', 'dietary_prefs', 'targets', 'units',
] as const

export const REQUIRED = ['height_cm', 'birth_date', 'sex', 'goal', 'training_days'] as const

export function pickProfileFields(input: Record<string, unknown>) {
  const out: Record<string, unknown> = {}
  for (const k of PROFILE_FIELDS) if (input[k] !== undefined) out[k] = input[k]
  if (Array.isArray(out.training_days)) {
    out.training_days = out.training_days.filter(d => (WEEKDAYS as readonly string[]).includes(d))
  }
  return out as Partial<Profile>
}

export function missingFields(p: Profile, hasWeight: boolean) {
  const missing: string[] = REQUIRED.filter(k => {
    const v = p[k]
    return v == null || (Array.isArray(v) && v.length === 0)
  })
  if (!hasWeight) missing.push('weight_kg')
  return missing
}

export function validateWorkoutPlan(plan: WorkoutPlan, catalog: Exercise[], trainingDays: Weekday[]) {
  if (!Array.isArray(plan?.days) || !plan.days.length) return ['days must be a non-empty array']
  const ids = new Set(catalog.map(e => e.id))
  const errors: string[] = []
  for (const d of plan.days) {
    if (!trainingDays.includes(d.weekday)) {
      errors.push(`weekday ${d.weekday} is not one of the user's training days (${trainingDays.join(', ')}); call update_profile first if they agreed to change them`)
    }
    for (const x of d.exercises ?? []) {
      if (ids.has(x.exercise_id)) continue
      const word = (x.name ?? '').toLowerCase().split(' ').pop() ?? ''
      const near = catalog.filter(e => word && e.name.toLowerCase().includes(word)).slice(0, 3).map(e => e.id)
      errors.push(`unknown exercise_id ${x.exercise_id}; use search_exercises${near.length ? `, near matches: ${near.join(', ')}` : ''}`)
    }
  }
  return errors
}

export function validateMealPlan(plan: MealPlan) {
  if (!Array.isArray(plan?.days) || !plan.days.length) return ['days must be a non-empty array']
  const errors: string[] = []
  for (const d of plan.days) {
    for (const m of d.meals ?? []) {
      if ([m.kcal, m.protein_g, m.carbs_g, m.fat_g].some(n => typeof n !== 'number' || n < 0)) {
        errors.push(`${m.name}: kcal and macros must be non-negative numbers`)
        continue
      }
      const sum = (m.items ?? []).reduce((a, i) => a + (i.kcal ?? 0), 0)
      if (m.items?.length && Math.abs(sum - m.kcal) > Math.max(100, m.kcal * 0.15)) {
        errors.push(`${m.name}: items add up to ${sum} kcal but the meal says ${m.kcal}`)
      }
    }
  }
  return errors
}
```

- [ ] **Step 5: Run the check**

Run: `npm run check`
Expected: tsc clean; 12 tests passing.

- [ ] **Step 6: Commit and push**

```bash
git add -A && git commit -m "Add chat window trimming and plan validation" && git push
```

---

### Task 3: Anthropic client, tools, system prompt, agent loop

**Files:**
- Create: `src/ai.ts`

**Interfaces:**
- Consumes: `dayKey weekdayOf WEEKDAYS` from `src/dates.ts`; types from `src/types.ts`.
- Produces: `MODELS`; `getKey(): string`; `setKey(k: string)`; `client(key?)`; `validateKey(key): Promise<void>`; `errorMessage(e: unknown): string`; `TOOLS: Anthropic.Tool[]`; `Context` type; `buildSystem(c: Context): Anthropic.TextBlockParam[]`; `ToolRunner` type `(name: string, input: unknown) => Promise<{ result: string; error?: boolean }>`; `chatTurn(opts): Promise<string>` returning the final `stop_reason` or `'max_rounds'`.

- [ ] **Step 1: Write src/ai.ts**

```ts
import Anthropic from '@anthropic-ai/sdk'
import { dayKey, weekdayOf, WEEKDAYS } from './dates.ts'
import type { Profile, PlanRow, DailyTotals, MealRow } from './types.ts'

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

const str = { type: 'string' }
const num = { type: 'number' }
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
        activity_level: { type: 'string', enum: ['sedentary', 'light', 'moderate', 'active', 'very active'] },
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
]

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
  totals: DailyTotals | null
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
    `Today so far: ${JSON.stringify(c.totals ?? { kcal: 0, water_ml: 0, workout_done: false })}`,
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
    const assistant: Anthropic.MessageParam = { role: 'assistant', content: msg.content }
    messages.push(assistant)
    const uses = msg.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
    if (msg.stop_reason !== 'tool_use' || !uses.length) {
      await opts.onRound(assistant)
      return msg.stop_reason ?? 'end_turn'
    }
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
```

- [ ] **Step 2: Type-check**

Run: `npm run check`
Expected: clean. If tsc rejects `content: msg.content` on the assistant message, change that line to `content: msg.content as Anthropic.ContentBlockParam[]`. If it rejects `is_error: r.error` because `undefined` is not allowed, change it to `...(r.error ? { is_error: true } : {})`. Nothing else in this file should need changing.

- [ ] **Step 3: Commit and push**

```bash
git add -A && git commit -m "Add Anthropic client, tools and agent loop" && git push
```

---

### Task 4: Queries and the tool runner

**Files:**
- Modify: `src/db.ts`
- Create: `src/tools.ts`

**Interfaces:**
- Produces in `src/db.ts`: `loadProfile(): Promise<Profile>`; `updateProfile(userId, patch: Partial<Profile>)`; `latestWeight(): Promise<{ weight_kg: number; date: string } | null>`; `upsertDailyLog(date, patch)`; `latestPlan(kind): Promise<PlanRow | null>`; `savePlan(kind, title, content)`; `dayTotals(date): Promise<DailyTotals | null>`; `dayMeals(date): Promise<MealRow[]>`; `MessageRow` type; `loadMessages(limit = 40): Promise<MessageRow[]>` oldest first; `insertMessages(rows: Anthropic.MessageParam[]): Promise<MessageRow[]>`; `clearChat(userId)`.
- Produces in `src/tools.ts`: `applyProfile(userId, patch, weightKg?): Promise<string[]>` (returns the still-missing fields and stamps `onboarded_at` when none remain); `makeToolRunner({ userId, catalog, videos, onChange }): ToolRunner`.

- [ ] **Step 1: Append to src/db.ts (keep everything already there)**

```ts
import type Anthropic from '@anthropic-ai/sdk'
import type { Profile, PlanRow, DailyTotals, MealRow, WorkoutPlan, MealPlan } from './types.ts'

function unwrap<T>({ data, error }: { data: T; error: { message: string } | null }) {
  if (error) throw new Error(error.message)
  return data
}

export async function loadProfile() {
  return unwrap(await sb.from('profiles').select('*').single()) as Profile
}

export async function updateProfile(userId: string, patch: Partial<Profile>) {
  const { user_id, ...rest } = patch
  unwrap(await sb.from('profiles').update({ ...rest, updated_at: new Date().toISOString() }).eq('user_id', userId))
}

export async function latestWeight() {
  const rows = unwrap(
    await sb.from('daily_logs').select('date, weight_kg').not('weight_kg', 'is', null).order('date', { ascending: false }).limit(1),
  ) as { date: string; weight_kg: number }[]
  return rows[0] ?? null
}

export async function upsertDailyLog(date: string, patch: { weight_kg?: number; progress_photo_path?: string; notes?: string }) {
  unwrap(await sb.from('daily_logs').upsert({ date, ...patch }, { onConflict: 'user_id,date' }))
}

export async function latestPlan(kind: 'workout' | 'meal') {
  const rows = unwrap(
    await sb.from('plans').select('*').eq('kind', kind).order('created_at', { ascending: false }).limit(1),
  ) as PlanRow[]
  return rows[0] ?? null
}

export async function savePlan(kind: 'workout' | 'meal', title: string, content: WorkoutPlan | MealPlan) {
  unwrap(await sb.from('plans').insert({ kind, title, content }))
}

export async function dayTotals(date: string) {
  const rows = unwrap(await sb.from('daily_totals').select('*').eq('date', date)) as DailyTotals[]
  return rows[0] ?? null
}

export async function dayMeals(date: string) {
  return unwrap(await sb.from('meals').select('*').eq('date', date).order('eaten_at')) as MealRow[]
}

export type MessageRow = { id: number; role: 'user' | 'assistant'; content: Anthropic.MessageParam['content'] }

export async function loadMessages(limit = 40) {
  const rows = unwrap(
    await sb.from('messages').select('id, role, content').order('id', { ascending: false }).limit(limit),
  ) as MessageRow[]
  return rows.reverse()
}

export async function insertMessages(rows: Anthropic.MessageParam[]) {
  return unwrap(
    await sb.from('messages').insert(rows.map(r => ({ role: r.role, content: r.content }))).select('id, role, content'),
  ) as MessageRow[]
}

export async function clearChat(userId: string) {
  unwrap(await sb.from('messages').delete().eq('user_id', userId))
}
```

Put the two `import` lines at the top of the file with the existing import.

- [ ] **Step 2: Write src/tools.ts**

```ts
import type { ToolRunner } from './ai.ts'
import { searchExercises, type Search } from './catalog.ts'
import { pickProfileFields, missingFields, validateWorkoutPlan, validateMealPlan } from './logic.ts'
import { loadProfile, updateProfile, latestWeight, upsertDailyLog, savePlan } from './db.ts'
import { dayKey } from './dates.ts'
import type { Exercise, Videos, Profile, WorkoutPlan, MealPlan } from './types.ts'

export async function applyProfile(userId: string, patch: Partial<Profile>, weightKg?: number) {
  if (weightKg) await upsertDailyLog(dayKey(), { weight_kg: weightKg })
  if (Object.keys(patch).length) await updateProfile(userId, patch)
  const p = await loadProfile()
  const missing = missingFields(p, !!(await latestWeight()))
  if (!p.onboarded_at && !missing.length) await updateProfile(userId, { onboarded_at: new Date().toISOString() })
  return missing
}

export function makeToolRunner(deps: { userId: string; catalog: Exercise[]; videos: Videos; onChange: () => void }): ToolRunner {
  return async (name, raw) => {
    const input = (raw ?? {}) as Record<string, unknown>
    try {
      switch (name) {
        case 'update_profile': {
          const w = typeof input.weight_kg === 'number' ? input.weight_kg : undefined
          const missing = await applyProfile(deps.userId, pickProfileFields(input), w)
          deps.onChange()
          return { result: missing.length ? `saved; still missing: ${missing.join(', ')}` : 'saved; profile complete' }
        }
        case 'search_exercises':
          return { result: JSON.stringify(searchExercises(deps.catalog, input as Search, deps.videos)) }
        case 'save_workout_plan': {
          const plan = input as unknown as { title: string } & WorkoutPlan
          const errors = validateWorkoutPlan(plan, deps.catalog, (await loadProfile()).training_days)
          if (errors.length) return { result: errors.join('\n'), error: true }
          await savePlan('workout', plan.title, { days: plan.days })
          deps.onChange()
          return { result: 'saved' }
        }
        case 'save_meal_plan': {
          const plan = input as unknown as { title: string } & MealPlan
          const errors = validateMealPlan(plan)
          if (errors.length) return { result: errors.join('\n'), error: true }
          await savePlan('meal', plan.title, { days: plan.days })
          deps.onChange()
          return { result: 'saved' }
        }
        default:
          return { result: `unknown tool ${name}`, error: true }
      }
    } catch (e) {
      return { result: e instanceof Error ? e.message : String(e), error: true }
    }
  }
}
```

- [ ] **Step 3: Type-check, commit, push**

Run: `npm run check`
Expected: clean, 12 tests passing.

```bash
git add -A && git commit -m "Add queries and the tool runner" && git push
```

---

### Task 5: Settings view

**Files:**
- Create: `src/views/Settings.tsx`

**Interfaces:**
- Consumes: `MODELS validateKey setKey errorMessage` from `src/ai.ts`; `updateProfile signOut` from `src/db.ts`; `applyProfile` from `src/tools.ts`; `WEEKDAYS Weekday` from `src/dates.ts`.
- Produces: `Settings(p: { userId: string; profile: Profile; apiKey: string; onKey: (k: string) => void; onChange: () => void })`.

- [ ] **Step 1: Write src/views/Settings.tsx**

```tsx
import { useState, type FormEvent } from 'react'
import { MODELS, validateKey, setKey, errorMessage } from '../ai.ts'
import { updateProfile, signOut } from '../db.ts'
import { applyProfile } from '../tools.ts'
import { WEEKDAYS, type Weekday } from '../dates.ts'
import type { Profile } from '../types.ts'

const LB = 0.45359237
const IN = 2.54
const LEVELS = ['sedentary', 'light', 'moderate', 'active', 'very active']

export function Settings(p: { userId: string; profile: Profile; apiKey: string; onKey: (k: string) => void; onChange: () => void }) {
  const [key, setK] = useState(p.apiKey)
  const [keyStatus, setKeyStatus] = useState('')
  const [f, setF] = useState<Profile>(p.profile)
  const [weight, setWeight] = useState('')
  const [status, setStatus] = useState('')
  const imperial = f.units === 'imperial'
  const set = (k: keyof Profile, v: unknown) => setF({ ...f, [k]: v })

  async function saveKey() {
    setKeyStatus('Checking…')
    const k = key.trim()
    try {
      await validateKey(k)
      setKey(k)
      p.onKey(k)
      setKeyStatus('Key works.')
    } catch (e) {
      setKeyStatus(errorMessage(e))
    }
  }

  async function changeModel(model: string) {
    await updateProfile(p.userId, { model })
    set('model', model)
    p.onChange()
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    setStatus('')
    const { user_id, onboarded_at, model, updated_at, ...patch } = f
    const w = weight ? (imperial ? +weight * LB : +weight) : undefined
    try {
      await applyProfile(p.userId, patch, w)
      setWeight('')
      p.onChange()
      setStatus('Saved.')
    } catch (err) {
      setStatus(errorMessage(err))
    }
  }

  const toggleDay = (d: Weekday) =>
    set('training_days', f.training_days.includes(d) ? f.training_days.filter(x => x !== d) : [...f.training_days, d])

  return (
    <div className="stack">
      <section className="tile">
        <h2>Anthropic API key</h2>
        <p className="muted">Stays in this browser only. Use a dedicated key with a spend limit. On a new device, paste it again.</p>
        <input type="password" value={key} onChange={e => setK(e.target.value)} placeholder="sk-ant-…" autoComplete="off" />
        <div className="row">
          <button className="primary" type="button" onClick={saveKey} disabled={!key.trim()}>Save key</button>
          <small>{keyStatus}</small>
        </div>
      </section>

      <section className="tile">
        <h2>Model</h2>
        <select value={f.model} onChange={e => changeModel(e.target.value)}>
          {MODELS.map(m => <option key={m}>{m}</option>)}
        </select>
        <small>Opus is the default. Sonnet is cheaper and dodges the rate limits new keys hit.</small>
      </section>

      <form className="tile stack" onSubmit={save}>
        <h2>Profile</h2>
        <label>Name<input value={f.name ?? ''} onChange={e => set('name', e.target.value)} /></label>
        <label>Sex
          <select value={f.sex ?? ''} onChange={e => set('sex', e.target.value || null)}>
            <option value="">choose</option><option>male</option><option>female</option><option>other</option>
          </select>
        </label>
        <label>Birth date<input type="date" value={f.birth_date ?? ''} onChange={e => set('birth_date', e.target.value || null)} /></label>
        <label>Units
          <select value={f.units} onChange={e => set('units', e.target.value)}>
            <option value="metric">metric</option><option value="imperial">imperial</option>
          </select>
        </label>
        <label>Height ({imperial ? 'in' : 'cm'})
          <input type="number" step="any"
            value={f.height_cm == null ? '' : imperial ? Math.round(f.height_cm / IN) : f.height_cm}
            onChange={e => set('height_cm', e.target.value === '' ? null : imperial ? +e.target.value * IN : +e.target.value)} />
        </label>
        <label>Weigh-in today ({imperial ? 'lb' : 'kg'})
          <input type="number" step="any" value={weight} onChange={e => setWeight(e.target.value)} placeholder="blank to skip" />
        </label>
        <label>Goal<input value={f.goal ?? ''} onChange={e => set('goal', e.target.value)} placeholder="e.g. lose 5 kg by December" /></label>
        <label>Activity level
          <select value={f.activity_level ?? ''} onChange={e => set('activity_level', e.target.value || null)}>
            <option value="">choose</option>{LEVELS.map(a => <option key={a}>{a}</option>)}
          </select>
        </label>
        <fieldset>
          <legend>Training days</legend>
          <div className="row wrap">
            {WEEKDAYS.map(d => (
              <label key={d} className="check">
                <input type="checkbox" checked={f.training_days.includes(d)} onChange={() => toggleDay(d)} />{d}
              </label>
            ))}
          </div>
        </fieldset>
        <label>Equipment<input value={f.equipment ?? ''} onChange={e => set('equipment', e.target.value)} placeholder="e.g. full gym, or dumbbells and a bench" /></label>
        <label>Injuries<input value={f.injuries ?? ''} onChange={e => set('injuries', e.target.value)} /></label>
        <label>Dietary preferences<input value={f.dietary_prefs ?? ''} onChange={e => set('dietary_prefs', e.target.value)} /></label>
        <div className="row">
          <button className="primary">Save profile</button>
          <small>{status}</small>
        </div>
      </form>

      <button type="button" onClick={() => signOut()}>Sign out</button>
    </div>
  )
}
```

- [ ] **Step 2: Type-check, commit, push**

Run: `npm run check`
Expected: clean.

```bash
git add -A && git commit -m "Add Settings view" && git push
```

---

### Task 6: Plan view

**Files:**
- Create: `src/views/Plan.tsx`

**Interfaces:**
- Consumes: `latestPlan` from `src/db.ts`; `STILLS` from `src/catalog.ts`.
- Produces: `Plan(p: { catalog: Exercise[]; videos: Videos; version: number })`. Re-fetches whenever `version` changes.

- [ ] **Step 1: Write src/views/Plan.tsx**

```tsx
import { useEffect, useState } from 'react'
import { latestPlan } from '../db.ts'
import { STILLS } from '../catalog.ts'
import type { Exercise, Videos, PlanRow, WorkoutPlan, MealPlan, PlanExercise } from '../types.ts'

function ExerciseRow({ x, ex, video }: { x: PlanExercise; ex?: Exercise; video?: string }) {
  const search = `https://www.youtube.com/results?search_query=${encodeURIComponent(x.name + ' form')}`
  return (
    <details className="exercise">
      <summary>
        <span>{x.name}</span>
        <span className="muted">{x.sets} × {x.reps} · rest {x.rest_s}s</span>
      </summary>
      {x.notes && <p>{x.notes}</p>}
      {ex && ex.images.length > 0 && (
        <div className="stills">{ex.images.map(i => <img key={i} src={STILLS + i} alt="" loading="lazy" />)}</div>
      )}
      {ex && <ol>{ex.instructions.map((s, i) => <li key={i}>{s}</li>)}</ol>}
      {video && (
        <iframe loading="lazy" src={`https://www.youtube-nocookie.com/embed/${video}`} title={x.name} allowFullScreen />
      )}
      <a href={search} target="_blank" rel="noreferrer">Watch on YouTube</a>
    </details>
  )
}

export function Plan(p: { catalog: Exercise[]; videos: Videos; version: number }) {
  const [kind, setKind] = useState<'workout' | 'meal'>('workout')
  const [plans, setPlans] = useState<{ workout: PlanRow | null; meal: PlanRow | null }>()

  useEffect(() => {
    Promise.all([latestPlan('workout'), latestPlan('meal')]).then(([workout, meal]) => setPlans({ workout, meal }))
  }, [p.version])

  if (!plans) return null
  const byId = new Map(p.catalog.map(e => [e.id, e]))
  const row = plans[kind]

  return (
    <div className="stack">
      <div className="seg">
        {(['workout', 'meal'] as const).map(k => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>{k === 'workout' ? 'Workout' : 'Meals'}</button>
        ))}
      </div>
      {!row && <p className="muted">No {kind} plan yet. Ask APT for one.</p>}
      {row && <h2>{row.title}</h2>}
      {row && kind === 'workout' && (row.content as WorkoutPlan).days.map(d => (
        <section key={d.weekday} className="tile">
          <h3><span className="muted">{d.weekday}</span> {d.name}</h3>
          {d.exercises.map((x, i) => (
            <ExerciseRow key={i} x={x} ex={byId.get(x.exercise_id)} video={p.videos[x.exercise_id]} />
          ))}
        </section>
      ))}
      {row && kind === 'meal' && (row.content as MealPlan).days.map(d => (
        <section key={d.weekday} className="tile">
          <h3 className="muted">{d.weekday}</h3>
          {d.meals.map((m, i) => (
            <details key={i} className="exercise">
              <summary>
                <span>{m.name}</span>
                <span className="muted">{m.kcal} kcal · P{m.protein_g} C{m.carbs_g} F{m.fat_g}</span>
              </summary>
              <ul>{m.items.map((it, j) => <li key={j}>{it.qty} {it.food} <span className="muted">{it.kcal} kcal</span></li>)}</ul>
            </details>
          ))}
        </section>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Type-check, commit, push**

Run: `npm run check`
Expected: clean.

```bash
git add -A && git commit -m "Add Plan view" && git push
```

---

### Task 7: Chat sidebar

**Files:**
- Create: `src/Chat.tsx`

**Interfaces:**
- Consumes: `chatTurn buildSystem errorMessage getKey` from `src/ai.ts`; `trimWindow missingFields` from `src/logic.ts`; queries and `MessageRow` from `src/db.ts`; `makeToolRunner` from `src/tools.ts`.
- Produces: `Chat(p: { userId: string; catalog: Exercise[]; videos: Videos; onChange: () => void })`.

- [ ] **Step 1: Write src/Chat.tsx**

```tsx
import { useEffect, useRef, useState } from 'react'
import type Anthropic from '@anthropic-ai/sdk'
import { chatTurn, buildSystem, errorMessage, getKey } from './ai.ts'
import { trimWindow, missingFields } from './logic.ts'
import { loadMessages, insertMessages, clearChat, loadProfile, latestWeight, dayTotals, dayMeals, latestPlan, type MessageRow } from './db.ts'
import { makeToolRunner } from './tools.ts'
import { dayKey } from './dates.ts'
import type { Exercise, Videos } from './types.ts'

function chip(b: Anthropic.ToolUseBlock) {
  const i = b.input as Record<string, unknown>
  switch (b.name) {
    case 'update_profile': return `Updated profile: ${Object.keys(i).join(', ')}`
    case 'search_exercises': return `Searched exercises: ${[i.q, i.muscle, i.equipment].filter(Boolean).join(' ')}`
    case 'save_workout_plan': return `Saved workout plan: ${i.title}`
    case 'save_meal_plan': return `Saved meal plan: ${i.title}`
    default: return b.name
  }
}

function Bubble({ m }: { m: MessageRow }) {
  const blocks = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content
  return (
    <>
      {blocks.map((b, i) => {
        if (b.type === 'text' && b.text.trim()) return <div key={i} className={'bubble ' + m.role}>{b.text}</div>
        if (b.type === 'tool_use') return <div key={i} className="chip">{chip(b as Anthropic.ToolUseBlock)}</div>
        return null
      })}
    </>
  )
}

export function Chat(p: { userId: string; catalog: Exercise[]; videos: Videos; onChange: () => void }) {
  const [rows, setRows] = useState<MessageRow[]>([])
  const [draft, setDraft] = useState('')
  const [live, setLive] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const end = useRef<HTMLDivElement>(null)
  const hasKey = !!getKey()

  useEffect(() => { loadMessages().then(setRows).catch(e => setError(e.message)) }, [])
  useEffect(() => { end.current?.scrollIntoView() }, [rows, live])

  async function send() {
    const text = draft.trim()
    if (!text || busy) return
    setDraft('')
    setError('')
    setBusy(true)
    try {
      const [userRow] = await insertMessages([{ role: 'user', content: [{ type: 'text', text }] }])
      const history = trimWindow([...rows, userRow].map(r => ({ role: r.role, content: r.content })))
      setRows(r => [...r, userRow])
      const [profile, weight, totals, meals, workout, meal] = await Promise.all([
        loadProfile(), latestWeight(), dayTotals(dayKey()), dayMeals(dayKey()), latestPlan('workout'), latestPlan('meal'),
      ])
      const system = buildSystem({ profile, latestWeight: weight, totals, meals, workout, meal, missing: missingFields(profile, !!weight) })
      const runTool = makeToolRunner({ userId: p.userId, catalog: p.catalog, videos: p.videos, onChange: p.onChange })
      const stop = await chatTurn({
        model: profile.model,
        system,
        history,
        runTool,
        onText: setLive,
        onRound: async (assistant, results) => {
          const saved = await insertMessages(results ? [assistant, results] : [assistant])
          setRows(r => [...r, ...saved])
          setLive('')
        },
      })
      if (stop === 'refusal') setError('The model declined to answer that.')
      if (stop === 'max_rounds') setError('Stopped after 8 tool calls. Ask again to continue.')
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
      setLive('')
    }
  }

  async function clear() {
    if (!confirm('Delete the whole chat history?')) return
    await clearChat(p.userId)
    setRows([])
  }

  return (
    <div className="chat">
      <div className="chat-head">
        <strong>APT</strong>
        <button type="button" className="ghost" onClick={clear} disabled={!rows.length}>Clear chat</button>
      </div>
      <div className="chat-log">
        {rows.map(m => <Bubble key={m.id} m={m} />)}
        {live && <div className="bubble assistant">{live}</div>}
        {busy && !live && <div className="muted">thinking…</div>}
        {error && <div className="error">{error}</div>}
        <div ref={end} />
      </div>
      <form className="chat-input" onSubmit={e => { e.preventDefault(); send() }}>
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder={hasKey ? 'Talk to your trainer' : 'Add your API key in Settings first'}
          disabled={busy || !hasKey}
        />
        <button className="primary" disabled={busy || !draft.trim()}>Send</button>
      </form>
    </div>
  )
}
```

- [ ] **Step 2: Type-check, commit, push**

Run: `npm run check`
Expected: clean. If tsc complains that `b.text` does not exist on the union in `Bubble`, narrow with `if (b.type === 'text' && 'text' in b && b.text.trim())`.

```bash
git add -A && git commit -m "Add chat sidebar" && git push
```

---

### Task 8: Wire the app, styles, deploy

**Files:**
- Modify: `src/App.tsx`, `src/app.css`

**Interfaces:**
- Consumes: everything above.
- Produces: the running Phase 1 app. `App` owns `profile`, `catalog`, `apiKey`, `version`; `bump()` reloads the profile and bumps `version`.

- [ ] **Step 1: Replace src/App.tsx**

```tsx
import { useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { sb, signIn, ensureProfile, loadProfile } from './db.ts'
import { getKey } from './ai.ts'
import { loadCatalog } from './catalog.ts'
import { Chat } from './Chat.tsx'
import { Plan } from './views/Plan.tsx'
import { Settings } from './views/Settings.tsx'
import type { Exercise, Videos, Profile } from './types.ts'

export const TABS = ['today', 'plan', 'history', 'settings'] as const
export type Tab = (typeof TABS)[number]

export function tabFromHash(hash = location.hash): Tab {
  const h = hash.slice(1) as Tab
  return TABS.includes(h) ? h : 'today'
}

export function App() {
  const [session, setSession] = useState<Session | null>()
  const [tab, setTab] = useState<Tab>(tabFromHash)
  const [chatOpen, setChatOpen] = useState(false)
  const [profile, setProfile] = useState<Profile>()
  const [data, setData] = useState<{ catalog: Exercise[]; videos: Videos }>()
  const [apiKey, setApiKey] = useState(getKey)
  const [version, setVersion] = useState(0)
  const [error, setError] = useState('')

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: auth } = sb.auth.onAuthStateChange((_event, s) => setSession(s))
    const onHash = () => setTab(tabFromHash())
    addEventListener('hashchange', onHash)
    return () => {
      auth.subscription.unsubscribe()
      removeEventListener('hashchange', onHash)
    }
  }, [])

  useEffect(() => { loadCatalog().then(setData).catch(e => setError(e.message)) }, [])

  const userId = session?.user.id
  const reload = useCallback(() => {
    if (userId) loadProfile().then(setProfile).catch(e => setError(e.message))
  }, [userId])
  useEffect(() => {
    if (userId) ensureProfile(userId).then(reload).catch(e => setError(e.message))
  }, [userId, reload])
  const bump = useCallback(() => { setVersion(v => v + 1); reload() }, [reload])

  // first run: no key means Settings; key but not onboarded means Settings with the chat open
  const onboarded = !!profile?.onboarded_at
  useEffect(() => {
    if (!profile) return
    if (!apiKey || !onboarded) {
      location.hash = '#settings'
      setChatOpen(!!apiKey && !onboarded)
    }
  }, [profile?.user_id, apiKey])

  if (session === undefined) return null
  if (!session) {
    return (
      <main className="gate">
        <h1>APT</h1>
        <p className="muted">A personal trainer that runs on your own API key.</p>
        <button className="primary" onClick={() => signIn().then(({ error }) => error && setError(error.message))}>Sign in with Google</button>
        {error && <p className="error">{error}</p>}
      </main>
    )
  }
  if (error) return <main className="gate"><p className="error">{error}</p></main>
  if (!profile || !data) return null

  const view =
    tab === 'plan' ? <Plan catalog={data.catalog} videos={data.videos} version={version} /> :
    tab === 'settings' ? (
      <Settings key={profile.updated_at} userId={session.user.id} profile={profile} apiKey={apiKey}
        onKey={k => { setApiKey(k); bump() }} onChange={bump} />
    ) :
    <p className="muted">{tab === 'today' ? 'Today' : 'History'} lands in the next phase.</p>

  return (
    <div className="shell">
      <header>
        <nav>
          {TABS.map(t => (
            <a key={t} href={'#' + t} aria-current={t === tab ? 'page' : undefined}>{t}</a>
          ))}
        </nav>
      </header>
      <main>
        {!apiKey && tab !== 'settings' && <p className="notice">Add your Anthropic key in Settings to start.</p>}
        {view}
      </main>
      <aside className={chatOpen ? 'open' : ''}>
        <Chat userId={session.user.id} catalog={data.catalog} videos={data.videos} onChange={bump} />
      </aside>
      <button className="fab" onClick={() => setChatOpen(o => !o)} aria-label="Toggle chat">💬</button>
    </div>
  )
}
```

- [ ] **Step 2: Append to src/app.css**

```css
.stack { display: flex; flex-direction: column; gap: 16px; }
.tile { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-lg); padding: 16px; }
.row { display: flex; align-items: center; gap: 12px; }
.row.wrap { flex-wrap: wrap; }
label { display: block; font-size: 13px; color: var(--muted); }
label > input, label > select, label > textarea { margin-top: 4px; color: var(--fg); font-size: 17px; }
label.check { display: inline-flex; align-items: center; gap: 6px; color: var(--fg); font-size: 15px; }
label.check input { width: auto; }
fieldset { border: 0; padding: 0; margin: 0; }
legend { font-size: 13px; color: var(--muted); margin-bottom: 4px; }
.notice { background: var(--surface2); border-radius: var(--r); padding: 12px 16px; }
.error { color: #ff453a; font-size: 15px; }
button.ghost { background: none; border: 0; color: var(--muted); padding: 4px 8px; font-size: 13px; }

.seg { display: inline-flex; background: var(--surface2); border-radius: 999px; padding: 3px; }
.seg button { border: 0; background: none; color: var(--muted); border-radius: 999px; padding: 6px 14px; font-size: 15px; }
.seg button[aria-pressed="true"] { background: var(--fg); color: var(--bg); }

details.exercise { border-top: 1px solid var(--line); padding: 10px 0; }
details.exercise summary { display: flex; justify-content: space-between; gap: 12px; cursor: pointer; list-style: none; }
details.exercise summary::-webkit-details-marker { display: none; }
details.exercise ol, details.exercise ul { padding-left: 20px; margin: 8px 0; font-size: 15px; }
details.exercise a { display: inline-block; margin-top: 8px; font-size: 15px; }
.stills { display: flex; gap: 8px; margin: 8px 0; }
.stills img { width: 50%; max-width: 240px; border-radius: var(--r); background: var(--surface2); }
details.exercise iframe { width: 100%; aspect-ratio: 16 / 9; border: 0; border-radius: var(--r); margin-top: 8px; }

.chat { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.chat-head { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-bottom: 1px solid var(--line); }
.chat-log { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 8px; }
.bubble { max-width: 90%; padding: 10px 14px; border-radius: var(--r-lg); white-space: pre-wrap; font-size: 15px; line-height: 1.4; }
.bubble.user { align-self: flex-end; background: var(--fg); color: var(--bg); }
.bubble.assistant { align-self: flex-start; background: var(--surface2); }
.chip { align-self: flex-start; font-size: 13px; color: var(--muted); border: 1px solid var(--line); border-radius: 999px; padding: 3px 10px; }
.chat-input { display: flex; gap: 8px; padding: 12px 16px; padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px)); border-top: 1px solid var(--line); }
.chat-input input { flex: 1; }
```

- [ ] **Step 3: Check, build, push, verify the deploy**

```bash
npm run check && npm run build
git add -A && git commit -m "Wire the trainer: settings, plan view, chat" && git push
sleep 20
gh run watch --exit-status $(gh run list --workflow Deploy --limit 1 --json databaseId -q '.[0].databaseId')
curl -sI https://duckyquang.github.io/APT/exercises.json | head -1    # HTTP/2 200
curl -sI https://duckyquang.github.io/APT/videos.json | head -1       # HTTP/2 200
```

Expected: check and build clean; the Deploy run succeeds; both JSON files served. Sign-in still cannot be exercised until the founder's Supabase project exists (Phase 0 Task 6), so that is the whole verification for this task.

---

### Task 9: Curate videos.json

**Files:**
- Modify: `public/videos.json`

**Interfaces:**
- Produces: `{ "<exercise id from exercises.json>": "<11-character YouTube video id>", ... }` for at least 45 common movements. Every key must exist in `public/exercises.json`. Every video id must resolve through YouTube's oEmbed endpoint.

This task is a fan-out: split the list below among several workers, each returning `{ exercise_id, youtube_id, title }` entries, then one writer merges, verifies and commits. Workers do not touch git.

- [ ] **Step 1: Map names to catalog ids**

For each name below, find the catalog entry with `node -e` and a case-insensitive `includes` on `name`. Take the shortest matching name. Skip the name if nothing matches; do not guess.

```
Barbell Squat, Barbell Deadlift, Barbell Bench Press - Medium Grip, Bent Over Barbell Row, Pullups, Pushups,
Dumbbell Bench Press, Incline Dumbbell Press, Dumbbell Shoulder Press, Standing Military Press, Romanian Deadlift,
Dumbbell Lunges, Leg Press, Leg Extensions, Lying Leg Curls, Barbell Hip Thrust, Plank, Hanging Leg Raise, Crunches,
Russian Twist, Dips - Triceps Version, Close-Grip Barbell Bench Press, Triceps Pushdown, Lying Triceps Press,
Barbell Curl, Dumbbell Bicep Curl, Hammer Curls, Side Lateral Raise, Face Pull, Seated Cable Rows,
Wide-Grip Lat Pulldown, Chin-Up, One-Arm Dumbbell Row, Front Barbell Squat, Goblet Squat, Kettlebell Swing,
Farmer's Walk, Standing Calf Raises, Cable Crossover, Dips - Chest Version, Butterfly, Box Jump, Burpee,
Mountain Climbers, Rope Jumping, Glute Bridge, Good Morning, Sumo Deadlift, Arnold Dumbbell Press, Barbell Shrug,
Dumbbell Step Ups, Superman, Air Bike, Side Bridge, Reverse Lunge, Bulgarian Split Squat, Overhead Squat,
Clean and Press, Reverse Flyes, Cable Wood Chop, Inverted Row, Bench Dips
```

Example lookup: `node -e "const d=require('./public/exercises.json'); console.log(d.filter(e=>e.name.toLowerCase().includes('barbell squat')).map(e=>e.id+' | '+e.name).join('\n'))"`

- [ ] **Step 2: Find a real demonstration video per exercise**

Web-search `"<exercise name> proper form"` and take a YouTube result from a recognisable fitness channel (a short form-focused video, not a compilation). Extract the 11-character id from the URL. Verify it exists:

```bash
curl -s -o /dev/null -w '%{http_code}\n' "https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=<ID>&format=json"
```

Expected `200`. Anything else means the id is wrong or the video is gone; pick another. Never take an id from memory; only from a search result you actually saw, and only after the oEmbed check returns 200.

- [ ] **Step 3: Write, verify keys, commit**

Write `public/videos.json` as a sorted JSON object with two-space indentation. Then:

```bash
node -e "
const d=require('./public/exercises.json'), v=require('./public/videos.json');
const ids=new Set(d.map(e=>e.id)); const bad=Object.keys(v).filter(k=>!ids.has(k));
const badIds=Object.values(v).filter(x=>!/^[A-Za-z0-9_-]{11}$/.test(x));
console.log('entries', Object.keys(v).length, 'bad keys', bad, 'bad ids', badIds)"
```

Expected: `entries` at least 45, `bad keys []`, `bad ids []`. Then:

```bash
git add public/videos.json && git commit -m "Curate exercise demo videos" && git push
```
