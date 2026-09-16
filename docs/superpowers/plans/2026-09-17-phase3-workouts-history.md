# Phase 3: Workouts and History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Today shows the active plan's workout for the day as a live checklist with a rest timer; History shows every day by month with the progress photo strip. The trainer gets `log_workout` and `get_history`.

**Architecture:** A `workouts` row is created on the first tick and upserted on every change (client uuid), so a half-done session survives a closed tab. `duration_min` is null until Finish, which is what `daily_totals.workout_done` keys on. History is one query per table over the last 90 days, grouped in the browser.

**Tech Stack:** Same as Phases 1 and 2.

## Global Constraints

- Everything in the Phase 1 and Phase 2 plans' Global Constraints still applies.
- Workout row shape: `exercises = [{ exercise_id, name, sets: [{ reps, weight_kg, done }] }]`. `reps` and `weight_kg` are numbers.
- Interfaces consumed: `latestPlan dayTotals dayMeals dayLog signedUrls unwrap sb` from `src/db.ts`; `TOOLS str num weekday` from `src/ai.ts`; `makeToolRunner` switch in `src/tools.ts`; `chip()` in `src/Chat.tsx`; `Today` in `src/views/Today.tsx`; `WorkoutPlan PlanRow DailyTotals MealRow` from `src/types.ts`; `dayKey weekdayOf` from `src/dates.ts`.

---

### Task 1: Workout types and session logic

**Files:**
- Modify: `src/types.ts`, `src/logic.ts`, `src/logic.test.ts`

**Interfaces:**
- Produces: types `WorkoutSet WorkoutExercise WorkoutRow`; `parseReps(s: string): number`; `lastWeights(rows: WorkoutRow[]): Map<string, number>` (rows newest first); `sessionFromPlan(day: WorkoutPlan['days'][number], last: Map<string, number>): WorkoutExercise[]`.

- [ ] **Step 1: Append to src/types.ts**

```ts
export type WorkoutSet = { reps: number; weight_kg: number; done: boolean }
export type WorkoutExercise = { exercise_id: string | null; name: string; sets: WorkoutSet[] }
export type WorkoutRow = {
  id: string
  date: string
  plan_id: string | null
  day_name: string | null
  exercises: WorkoutExercise[]
  duration_min: number | null
  notes: string | null
  created_at: string
}
```

- [ ] **Step 2: Write the failing tests (append to src/logic.test.ts)**

```ts
import { parseReps, lastWeights, sessionFromPlan } from './logic.ts'
import type { WorkoutRow } from './types.ts'

test('parseReps takes the first number', () => {
  assert.equal(parseReps('8-10'), 8)
  assert.equal(parseReps('5'), 5)
  assert.equal(parseReps('AMRAP'), 0)
})

const w = (date: string, id: string, weights: number[]): WorkoutRow => ({
  id: date, date, plan_id: null, day_name: null, duration_min: 40, notes: null, created_at: date,
  exercises: [{ exercise_id: id, name: id, sets: weights.map(weight_kg => ({ reps: 5, weight_kg, done: true })) }],
})

test('lastWeights takes the newest non-zero weight per exercise', () => {
  const m = lastWeights([w('2026-09-16', 'Barbell_Squat', [100, 0]), w('2026-09-10', 'Barbell_Squat', [90]), w('2026-09-09', 'Pushups', [0])])
  assert.equal(m.get('Barbell_Squat'), 100)
  assert.equal(m.has('Pushups'), false)
})

test('sessionFromPlan builds sets with last weights prefilled', () => {
  const s = sessionFromPlan(
    { weekday: 'mon', name: 'Legs', exercises: [{ exercise_id: 'Barbell_Squat', name: 'Barbell Squat', sets: 3, reps: '6-8', rest_s: 120 }] },
    new Map([['Barbell_Squat', 100]]))
  assert.deepEqual(s, [{ exercise_id: 'Barbell_Squat', name: 'Barbell Squat', sets: [
    { reps: 6, weight_kg: 100, done: false }, { reps: 6, weight_kg: 100, done: false }, { reps: 6, weight_kg: 100, done: false } ] }])
})
```

Merge the imports into the existing import lines at the top of the file.

- [ ] **Step 3: Run to verify they fail**

Run: `node --test src/logic.test.ts`
Expected: FAIL, `parseReps` is not exported.

- [ ] **Step 4: Append to src/logic.ts**

```ts
import type { WorkoutRow, WorkoutExercise } from './types.ts'

export function parseReps(s: string) {
  const m = String(s).match(/\d+/)
  return m ? +m[0] : 0
}

export function lastWeights(rows: WorkoutRow[]) {
  const map = new Map<string, number>()
  for (const r of rows) {
    for (const x of r.exercises) {
      if (!x.exercise_id || map.has(x.exercise_id)) continue
      const w = [...x.sets].reverse().find(s => s.weight_kg > 0)?.weight_kg
      if (w) map.set(x.exercise_id, w)
    }
  }
  return map
}

export function sessionFromPlan(day: WorkoutPlan['days'][number], last: Map<string, number>): WorkoutExercise[] {
  return day.exercises.map(x => ({
    exercise_id: x.exercise_id,
    name: x.name,
    sets: Array.from({ length: x.sets }, () => ({ reps: parseReps(x.reps), weight_kg: last.get(x.exercise_id) ?? 0, done: false })),
  }))
}
```

Merge the type import into the existing `./types.ts` import in `src/logic.ts`.

- [ ] **Step 5: Run the check, commit, push**

Run: `npm run check`
Expected: clean; 20 tests passing.

```bash
git add -A && git commit -m "Add workout session logic" && git push
```

---

### Task 2: Queries, tools and chat chips

**Files:**
- Modify: `src/db.ts`, `src/ai.ts`, `src/tools.ts`, `src/Chat.tsx`

**Interfaces:**
- Produces in `src/db.ts`: `dayWorkout(date): Promise<WorkoutRow | null>`; `upsertWorkout(row: WorkoutRow)`; `recentWorkouts(limit = 10): Promise<WorkoutRow[]>` newest first; `rangeTotals(from, to): Promise<DailyTotals[]>` newest first; `rangeWorkouts(from, to): Promise<WorkoutRow[]>`; `rangeMeals(from, to): Promise<MealRow[]>`; `rangePhotos(from, to): Promise<{ date: string; progress_photo_path: string }[]>` oldest first.
- Produces in `src/ai.ts`: tools `log_workout`, `get_history`.
- Produces in `src/tools.ts`: cases `log_workout`, `get_history`.

- [ ] **Step 1: Append to src/db.ts**

```ts
import type { WorkoutRow } from './types.ts'

export async function dayWorkout(date: string) {
  const rows = unwrap(await sb.from('workouts').select('*').eq('date', date).order('created_at').limit(1)) as WorkoutRow[]
  return rows[0] ?? null
}

export async function upsertWorkout(row: WorkoutRow) {
  unwrap(await sb.from('workouts').upsert(row, { onConflict: 'id' }))
}

export async function recentWorkouts(limit = 10) {
  return unwrap(await sb.from('workouts').select('*').order('date', { ascending: false }).limit(limit)) as WorkoutRow[]
}

export async function rangeTotals(from: string, to: string) {
  return unwrap(await sb.from('daily_totals').select('*').gte('date', from).lte('date', to).order('date', { ascending: false })) as DailyTotals[]
}

export async function rangeWorkouts(from: string, to: string) {
  return unwrap(await sb.from('workouts').select('*').gte('date', from).lte('date', to).order('date', { ascending: false })) as WorkoutRow[]
}

export async function rangeMeals(from: string, to: string) {
  return unwrap(await sb.from('meals').select('*').gte('date', from).lte('date', to).order('eaten_at')) as MealRow[]
}

export async function rangePhotos(from: string, to: string) {
  return unwrap(
    await sb.from('daily_logs').select('date, progress_photo_path').gte('date', from).lte('date', to).not('progress_photo_path', 'is', null).order('date'),
  ) as { date: string; progress_photo_path: string }[]
}
```

Merge the type import into the existing `./types.ts` import.

- [ ] **Step 2: Append two tools to `TOOLS` in src/ai.ts**

```ts
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
```

- [ ] **Step 3: Add the two cases to the switch in src/tools.ts, before `default`**

```ts
        case 'log_workout': {
          const w = input as { date?: string; day_name: string; duration_min?: number; notes?: string; exercises: { exercise_id?: string; name: string; sets: { reps: number; weight_kg: number }[] }[] }
          const date = /^\d{4}-\d{2}-\d{2}$/.test(w.date ?? '') ? w.date! : dayKey()
          await upsertWorkout({
            id: crypto.randomUUID(), date, plan_id: null, day_name: w.day_name,
            exercises: w.exercises.map(x => ({ exercise_id: x.exercise_id ?? null, name: x.name, sets: x.sets.map(s => ({ reps: s.reps, weight_kg: s.weight_kg, done: true })) })),
            duration_min: w.duration_min ?? null, notes: w.notes ?? null, created_at: new Date().toISOString(),
          })
          deps.onChange()
          return { result: 'logged' }
        }
        case 'get_history': {
          const h = input as { days?: number; include_meals?: boolean }
          const days = Math.min(90, Math.max(1, Math.round(h.days ?? 14)))
          const to = dayKey()
          const from = dayKey(new Date(Date.now() - days * 864e5))
          const [totals, workouts, meals] = await Promise.all([rangeTotals(from, to), rangeWorkouts(from, to), h.include_meals ? rangeMeals(from, to) : []])
          return { result: JSON.stringify({
            totals,
            workouts: workouts.map(x => ({ date: x.date, day: x.day_name, min: x.duration_min, exercises: x.exercises.map(e => `${e.name}: ${e.sets.filter(s => s.done).map(s => `${s.reps}@${s.weight_kg}`).join(' ')}`) })),
            meals: meals.map(m => ({ date: m.date, name: m.name, kcal: m.kcal })),
          }) }
        }
```

Add `upsertWorkout, rangeTotals, rangeWorkouts, rangeMeals` to the `./db.ts` import.

- [ ] **Step 4: Label the new tools in src/Chat.tsx**

Add these cases to `chip()` before `default`:

```ts
    case 'log_meal': return `Logged meal: ${i.name}`
    case 'log_water': return `Logged ${i.ml} ml water`
    case 'log_workout': return `Logged workout: ${i.day_name}`
    case 'get_history': return 'Checked history'
```

- [ ] **Step 5: Type-check, commit, push**

Run: `npm run check`
Expected: clean.

```bash
git add -A && git commit -m "Add workout logging and history tools" && git push
```

---

### Task 3: Workout checklist on Today

**Files:**
- Create: `src/views/WorkoutCard.tsx`
- Modify: `src/views/Today.tsx`

**Interfaces:**
- Produces: `WorkoutCard(p: { version: number; onChange: () => void })`, rendered by `Today` above the Meals tile.

- [ ] **Step 1: Write src/views/WorkoutCard.tsx**

```tsx
import { useEffect, useRef, useState } from 'react'
import { latestPlan, dayWorkout, upsertWorkout, recentWorkouts } from '../db.ts'
import { lastWeights, sessionFromPlan } from '../logic.ts'
import { dayKey, weekdayOf } from '../dates.ts'
import type { WorkoutPlan, WorkoutRow, PlanRow } from '../types.ts'

export function WorkoutCard(p: { version: number; onChange: () => void }) {
  const date = dayKey()
  const [plan, setPlan] = useState<PlanRow | null>(null)
  const [row, setRow] = useState<WorkoutRow | null>(null)
  const [last, setLast] = useState(new Map<string, number>())
  const [rest, setRest] = useState(0)
  const [error, setError] = useState('')
  const timer = useRef<number>(0)

  useEffect(() => {
    Promise.all([latestPlan('workout'), dayWorkout(date), recentWorkouts(10)])
      .then(([pl, r, recent]) => { setPlan(pl); setRow(r); setLast(lastWeights(recent)) })
      .catch(e => setError(e.message))
  }, [p.version])

  useEffect(() => {
    if (rest <= 0) return
    timer.current = window.setTimeout(() => setRest(r => r - 1), 1000)
    return () => clearTimeout(timer.current)
  }, [rest])

  const day = plan ? (plan.content as WorkoutPlan).days.find(d => d.weekday === weekdayOf()) : undefined
  if (!plan) return <section className="tile"><h2>Workout</h2><p className="muted">No plan yet. Ask APT for one.</p></section>
  if (!day && !row) return <section className="tile"><h2>Workout</h2><p className="muted">Rest day.</p></section>

  const current: WorkoutRow = row ?? {
    id: crypto.randomUUID(), date, plan_id: plan.id, day_name: day!.name,
    exercises: sessionFromPlan(day!, last), duration_min: null, notes: null, created_at: new Date().toISOString(),
  }
  const done = current.duration_min != null

  function save(next: WorkoutRow) {
    setRow(next)
    upsertWorkout(next).catch(e => setError(e.message))
  }

  function setField(ei: number, si: number, patch: Partial<WorkoutRow['exercises'][number]['sets'][number]>) {
    const exercises = current.exercises.map((x, i) => i !== ei ? x : { ...x, sets: x.sets.map((s, j) => j !== si ? s : { ...s, ...patch }) })
    save({ ...current, exercises })
    if (patch.done) setRest(day?.exercises[ei]?.rest_s ?? 90)
  }

  function finish() {
    const minutes = Math.max(1, Math.round((Date.now() - new Date(current.created_at).getTime()) / 60000))
    save({ ...current, duration_min: minutes })
    setRest(0)
    p.onChange()
  }

  const ticked = current.exercises.reduce((a, x) => a + x.sets.filter(s => s.done).length, 0)
  const total = current.exercises.reduce((a, x) => a + x.sets.length, 0)

  return (
    <section className="tile">
      <div className="row">
        <h2>{current.day_name}</h2>
        {done ? <span className="muted">Done, {current.duration_min} min</span> : rest > 0 ? <span className="rest">rest {rest}s</span> : <span className="muted">{ticked}/{total} sets</span>}
      </div>
      {error && <p className="error">{error}</p>}
      {current.exercises.map((x, ei) => (
        <div key={ei} className="ex">
          <h3>{x.name}</h3>
          {x.sets.map((s, si) => (
            <div key={si} className="set">
              <span className="muted">{si + 1}</span>
              <input type="number" value={s.reps} onChange={e => setField(ei, si, { reps: +e.target.value })} disabled={done} aria-label="reps" />
              <span className="muted">×</span>
              <input type="number" step="any" value={s.weight_kg} onChange={e => setField(ei, si, { weight_kg: +e.target.value })} disabled={done} aria-label="kg" />
              <span className="muted">kg</span>
              <input type="checkbox" checked={s.done} onChange={e => setField(ei, si, { done: e.target.checked })} disabled={done} aria-label="done" />
            </div>
          ))}
        </div>
      ))}
      {!done && <button type="button" className="primary" onClick={finish} disabled={!ticked}>Finish workout</button>}
    </section>
  )
}
```

- [ ] **Step 2: Render it in src/views/Today.tsx**

Add the import:

```tsx
import { WorkoutCard } from './WorkoutCard.tsx'
```

Insert `<WorkoutCard version={p.version} onChange={p.onChange} />` directly after the `rings` section (before the Meals section).

- [ ] **Step 3: Type-check, commit, push**

Run: `npm run check`
Expected: clean.

```bash
git add -A && git commit -m "Add workout checklist to Today" && git push
```

---

### Task 4: History view, wiring, styles, deploy

**Files:**
- Create: `src/views/History.tsx`
- Modify: `src/App.tsx`, `src/app.css`

**Interfaces:**
- Produces: `History(p: { version: number })`.

- [ ] **Step 1: Write src/views/History.tsx**

```tsx
import { useEffect, useState } from 'react'
import { rangeTotals, rangeWorkouts, rangeMeals, rangePhotos, signedUrls } from '../db.ts'
import { dayKey } from '../dates.ts'
import type { DailyTotals, WorkoutRow, MealRow } from '../types.ts'

const month = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
const dayLabel = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })

export function History(p: { version: number }) {
  const [totals, setTotals] = useState<DailyTotals[]>([])
  const [workouts, setWorkouts] = useState<WorkoutRow[]>([])
  const [meals, setMeals] = useState<MealRow[]>([])
  const [photos, setPhotos] = useState<{ date: string; url: string }[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    const to = dayKey()
    const from = dayKey(new Date(Date.now() - 90 * 864e5))
    Promise.all([rangeTotals(from, to), rangeWorkouts(from, to), rangeMeals(from, to), rangePhotos(from, to)])
      .then(async ([t, w, m, ph]) => {
        setTotals(t); setWorkouts(w); setMeals(m)
        const urls = await signedUrls('progress', ph.map(x => x.progress_photo_path))
        setPhotos(ph.map(x => ({ date: x.date, url: urls[x.progress_photo_path] })).filter(x => x.url))
      })
      .catch(e => setError(e.message))
  }, [p.version])

  const months = [...new Set(totals.map(t => t.date.slice(0, 7)))]

  return (
    <div className="stack">
      {error && <p className="error">{error}</p>}
      {photos.length > 0 && (
        <section className="tile">
          <h2>Progress</h2>
          <div className="strip">{photos.map(x => <figure key={x.date}><img src={x.url} alt="" loading="lazy" /><figcaption className="muted">{x.date.slice(5)}</figcaption></figure>)}</div>
        </section>
      )}
      {totals.length === 0 && <p className="muted">Nothing logged in the last 90 days.</p>}
      {months.map(mo => (
        <section key={mo} className="tile">
          <h2>{month(mo + '-01')}</h2>
          {totals.filter(t => t.date.startsWith(mo)).map(t => {
            const w = workouts.filter(x => x.date === t.date)
            const m = meals.filter(x => x.date === t.date)
            return (
              <details key={t.date} className="exercise">
                <summary>
                  <span>{dayLabel(t.date)}</span>
                  <span className="muted">{t.kcal} kcal · {(t.water_ml / 1000).toFixed(1)} L{t.workout_done ? ' · workout' : ''}{t.weight_kg != null ? ` · ${t.weight_kg} kg` : ''}</span>
                </summary>
                <p className="muted">P {Math.round(t.protein_g)} · C {Math.round(t.carbs_g)} · F {Math.round(t.fat_g)}</p>
                {w.map(x => (
                  <div key={x.id}>
                    <h3>{x.day_name}{x.duration_min != null && <span className="muted"> · {x.duration_min} min</span>}</h3>
                    <ul>{x.exercises.map((e, i) => <li key={i}>{e.name} <span className="muted">{e.sets.filter(s => s.done).map(s => `${s.reps}×${s.weight_kg}`).join(', ')}</span></li>)}</ul>
                  </div>
                ))}
                {m.length > 0 && <ul>{m.map(x => <li key={x.id}>{x.name} <span className="muted">{x.kcal} kcal</span></li>)}</ul>}
              </details>
            )
          })}
        </section>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Wire it in src/App.tsx**

Add the import:

```tsx
import { History } from './views/History.tsx'
```

Replace the final fallback of the `view` expression (`<p className="muted">History lands in the next phase.</p>`) with:

```tsx
    <History version={version} />
```

- [ ] **Step 3: Append to src/app.css**

```css
.ex { border-top: 1px solid var(--line); padding: 8px 0; }
.set { display: flex; align-items: center; gap: 8px; margin: 4px 0; }
.set input[type="number"] { width: 72px; padding: 6px 8px; }
.set input[type="checkbox"] { width: 22px; height: 22px; margin-left: auto; }
.rest { font-variant-numeric: tabular-nums; }
.strip { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px; }
.strip figure { margin: 0; flex: 0 0 auto; text-align: center; }
.strip img { width: 96px; aspect-ratio: 4 / 5; object-fit: cover; border-radius: var(--r); display: block; }
```

- [ ] **Step 4: Check, build, push, verify the deploy**

```bash
npm run check && npm run build
git add -A && git commit -m "Add History view" && git push
sleep 20
gh run watch --exit-status $(gh run list --workflow Deploy --limit 1 --json databaseId -q '.[0].databaseId')
curl -sI https://duckyquang.github.io/APT/ | head -1
```

Expected: check and build clean; Deploy run succeeds; `HTTP/2 200`.
