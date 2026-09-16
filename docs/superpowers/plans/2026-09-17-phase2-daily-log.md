# Phase 2: The Daily Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Today tab works: water, weigh-in, meal photo to editable estimate to log, manual meals, "Ate this" from the meal plan, totals rings, and the daily progress photo. The trainer gets `log_meal` and `log_water`.

**Architecture:** Photos are resized on a canvas in the browser before anything else touches them. Meal analysis is one `messages.parse` call with a JSON schema, outside the chat loop. Every write carries the device's local `date`. Today re-fetches when `version` changes, and bumps it after its own writes.

**Tech Stack:** Same as Phase 1. `jsonSchemaOutputFormat` from `@anthropic-ai/sdk/helpers/json-schema`. Supabase Storage for the two private buckets.

## Global Constraints

- Everything in the Phase 1 plan's Global Constraints still applies (repo, identity, direct push to main, four runtime deps, no libraries, exact model ids, `thinking` omitted, dates via `dayKey()`, `npm run check` before every commit, `// ponytail:` markers).
- Meal photos are resized to 1280 px long edge JPEG 0.85 before upload and before analysis. Progress photos are cover-cropped to 1080x1350 JPEG 0.85. Originals are never uploaded.
- Meal photos never enter chat history. `analyzeMeal` is not a tool.
- Storage paths: `meals/<uid>/<date>-<uuid>.jpg`, `progress/<uid>/<date>.jpg`.
- Estimates are shown editable with a confidence tag and a "typically within 30%" hint. The user's edit is what gets stored.
- Phase 1 interfaces this plan consumes: `client MODELS errorMessage TOOLS` from `src/ai.ts`; `unwrap sb loadProfile latestWeight upsertDailyLog latestPlan dayTotals dayMeals` from `src/db.ts`; `makeToolRunner` from `src/tools.ts`; `Profile MealRow DailyTotals PlanRow MealPlan PlanMeal` from `src/types.ts`; `bump()` and `version` in `src/App.tsx`.

---

### Task 1: Image helpers with a runnable check

**Files:**
- Create: `src/image.ts`, `src/image.test.ts`

**Interfaces:**
- Produces: `fitSize(iw, ih, max): { w, h }`; `coverBox(iw, ih, w, h): { sx, sy, sw, sh }`; `resizeToJpeg(file: Blob, max = 1280): Promise<Blob>`; `coverCrop(file: Blob, w = 1080, h = 1350): Promise<Blob>`; `toBase64(blob: Blob): Promise<string>` (no data-URL prefix).

- [ ] **Step 1: Write the failing test src/image.test.ts**

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fitSize, coverBox } from './image.ts'

test('fitSize scales the long edge down and never up', () => {
  assert.deepEqual(fitSize(4000, 3000, 1280), { w: 1280, h: 960 })
  assert.deepEqual(fitSize(3000, 4000, 1280), { w: 960, h: 1280 })
  assert.deepEqual(fitSize(800, 600, 1280), { w: 800, h: 600 })
})

test('coverBox picks the centred source rect that fills the target', () => {
  assert.deepEqual(coverBox(4000, 3000, 1080, 1350), { sx: 800, sy: 0, sw: 2400, sh: 3000 })
  assert.deepEqual(coverBox(1080, 1920, 1080, 1350), { sx: 0, sy: 285, sw: 1080, sh: 1350 })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test src/image.test.ts`
Expected: FAIL, cannot find module `./image.ts`.

- [ ] **Step 3: Write src/image.ts**

```ts
export function fitSize(iw: number, ih: number, max: number) {
  const s = Math.min(1, max / Math.max(iw, ih))
  return { w: Math.round(iw * s), h: Math.round(ih * s) }
}

export function coverBox(iw: number, ih: number, w: number, h: number) {
  const s = Math.max(w / iw, h / ih)
  const sw = w / s
  const sh = h / s
  return { sx: (iw - sw) / 2, sy: (ih - sh) / 2, sw, sh }
}

// drawImage on a decoded <img> applies EXIF orientation in every current browser, so the
// output is upright pixels; Claude ignores EXIF and would otherwise see phone photos sideways
async function draw(file: Blob, box: (iw: number, ih: number) => { w: number; h: number; sx: number; sy: number; sw: number; sh: number }) {
  const url = URL.createObjectURL(file)
  const img = new Image()
  img.src = url
  try {
    await img.decode()
  } catch {
    URL.revokeObjectURL(url)
    throw new Error('Could not read that image. Please pick a JPEG or PNG.')
  }
  const b = box(img.naturalWidth, img.naturalHeight)
  const c = document.createElement('canvas')
  c.width = b.w
  c.height = b.h
  c.getContext('2d')!.drawImage(img, b.sx, b.sy, b.sw, b.sh, 0, 0, b.w, b.h)
  URL.revokeObjectURL(url)
  return new Promise<Blob>((ok, no) =>
    c.toBlob(blob => (blob ? ok(blob) : no(new Error('Could not encode the image.'))), 'image/jpeg', 0.85))
}

export const resizeToJpeg = (file: Blob, max = 1280) =>
  draw(file, (iw, ih) => ({ ...fitSize(iw, ih, max), sx: 0, sy: 0, sw: iw, sh: ih }))

export const coverCrop = (file: Blob, w = 1080, h = 1350) =>
  draw(file, (iw, ih) => ({ w, h, ...coverBox(iw, ih, w, h) }))

export function toBase64(blob: Blob) {
  return new Promise<string>((ok, no) => {
    const r = new FileReader()
    r.onload = () => ok((r.result as string).split(',')[1])
    r.onerror = () => no(r.error)
    r.readAsDataURL(blob)
  })
}
```

- [ ] **Step 4: Run the check, commit, push**

Run: `npm run check`
Expected: clean; 14 tests passing.

```bash
git add -A && git commit -m "Add browser image resize and crop" && git push
```

---

### Task 2: Meal analysis call and estimate sanitiser

**Files:**
- Modify: `src/types.ts`, `src/ai.ts`, `src/logic.ts`, `src/logic.test.ts`

**Interfaces:**
- Produces: type `MealEstimate`; `analyzeMeal(jpeg: Blob, note: string, model: string): Promise<MealEstimate>` in `src/ai.ts`; `sanitizeMeal(est: MealEstimate): MealEstimate` in `src/logic.ts`.

- [ ] **Step 1: Append to src/types.ts**

```ts
export type MealEstimateItem = {
  name: string
  portion_estimate: string
  grams: number
  kcal: number
  protein_g: number
  carbs_g: number
  fat_g: number
  fiber_g: number
}

export type MealEstimate = {
  items: MealEstimateItem[]
  totals: { kcal: number; protein_g: number; carbs_g: number; fat_g: number; fiber_g: number }
  confidence: 'low' | 'medium' | 'high'
  assumptions: string
}
```

- [ ] **Step 2: Write the failing tests (append to src/logic.test.ts)**

```ts
import { sanitizeMeal } from './logic.ts'
import type { MealEstimate } from './types.ts'

const est: MealEstimate = {
  items: [
    { name: 'rice', portion_estimate: '1 cup', grams: 180, kcal: 230, protein_g: 4, carbs_g: 50, fat_g: 0.5, fiber_g: 1 },
    { name: 'chicken', portion_estimate: '150 g', grams: 150, kcal: 250, protein_g: 45, carbs_g: 0, fat_g: -3, fiber_g: 0 },
  ],
  totals: { kcal: 999, protein_g: 1, carbs_g: 1, fat_g: 1, fiber_g: 1 },
  confidence: 'medium',
  assumptions: 'grilled, no sauce',
}

test('sanitizeMeal clamps negatives and recomputes totals from items', () => {
  const s = sanitizeMeal(est)
  assert.equal(s.items[1].fat_g, 0)
  assert.equal(s.totals.kcal, 480)
  assert.equal(s.totals.protein_g, 49)
  assert.equal(s.assumptions, 'grilled, no sauce')
})

test('sanitizeMeal recomputes kcal from macros when they disagree badly', () => {
  const s = sanitizeMeal({ ...est, items: [{ ...est.items[0], kcal: 900 }] })
  assert.equal(s.totals.kcal, Math.round(4 * 4 + 4 * 50 + 9 * 0.5))
  assert.match(s.assumptions, /recomputed/)
})

test('sanitizeMeal keeps clamped totals when there are no items', () => {
  const s = sanitizeMeal({ ...est, items: [], totals: { kcal: 300, protein_g: -2, carbs_g: 30, fat_g: 20, fiber_g: 0 } })
  assert.deepEqual(s.totals, { kcal: 300, protein_g: 0, carbs_g: 30, fat_g: 20, fiber_g: 0 })
})
```

Put the two import lines with the other imports at the top of the file.

- [ ] **Step 3: Run to verify they fail**

Run: `node --test src/logic.test.ts`
Expected: FAIL, `sanitizeMeal` is not exported.

- [ ] **Step 4: Append to src/logic.ts**

```ts
import type { MealEstimate } from './types.ts'

const nz = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0)
const r1 = (n: number) => Math.round(n * 10) / 10

// structured outputs cannot express minimum, so clamp here; totals come from items when there are any
export function sanitizeMeal(est: MealEstimate): MealEstimate {
  const items = (est.items ?? []).map(i => ({
    ...i, grams: nz(i.grams), kcal: nz(i.kcal), protein_g: nz(i.protein_g), carbs_g: nz(i.carbs_g), fat_g: nz(i.fat_g), fiber_g: nz(i.fiber_g),
  }))
  const sum = (k: 'kcal' | 'protein_g' | 'carbs_g' | 'fat_g' | 'fiber_g') => items.reduce((a, i) => a + i[k], 0)
  const t = est.totals ?? { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 }
  const totals = items.length
    ? { kcal: Math.round(sum('kcal')), protein_g: r1(sum('protein_g')), carbs_g: r1(sum('carbs_g')), fat_g: r1(sum('fat_g')), fiber_g: r1(sum('fiber_g')) }
    : { kcal: Math.round(nz(t.kcal)), protein_g: r1(nz(t.protein_g)), carbs_g: r1(nz(t.carbs_g)), fat_g: r1(nz(t.fat_g)), fiber_g: r1(nz(t.fiber_g)) }
  let assumptions = (est.assumptions ?? '').trim()
  const fromMacros = 4 * totals.protein_g + 4 * totals.carbs_g + 9 * totals.fat_g
  if (totals.kcal && Math.abs(fromMacros - totals.kcal) > totals.kcal * 0.3) {
    totals.kcal = Math.round(fromMacros)
    assumptions = `${assumptions} Calories recomputed from macros.`.trim()
  }
  return { items, totals, confidence: est.confidence ?? 'low', assumptions }
}
```

Merge the `import type` with the existing types import line at the top of `src/logic.ts` (one import from `./types.ts`).

- [ ] **Step 5: Append to src/ai.ts**

```ts
import { jsonSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/json-schema'
import { toBase64 } from './image.ts'
import type { MealEstimate } from './types.ts'

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
```

Merge the `import type { MealEstimate }` into the existing `./types.ts` import in `src/ai.ts`. The `str` and `num` constants already exist above `TOOLS`; place `nutr`, `MEAL_SCHEMA` and `analyzeMeal` after `TOOLS`.

- [ ] **Step 6: Type-check, commit, push**

Run: `npm run check`
Expected: clean; 17 tests passing. If tsc says `parse` does not exist on `messages`, or cannot resolve `@anthropic-ai/sdk/helpers/json-schema`, run `grep -n "parse\|helpers" node_modules/@anthropic-ai/sdk/package.json node_modules/@anthropic-ai/sdk/resources/messages/messages.d.ts | head` and adapt the import path to what the installed package exports; report the change.

```bash
git add -A && git commit -m "Add meal photo analysis" && git push
```

---

### Task 3: Queries and tools for meals and water

**Files:**
- Modify: `src/db.ts`, `src/ai.ts` (TOOLS), `src/tools.ts`

**Interfaces:**
- Produces in `src/db.ts`: `insertMeal(row: NewMeal)`; `deleteMeal(id)`; `insertWater(ml: number, at?: Date)`; `dayLog(date): Promise<{ weight_kg: number | null; progress_photo_path: string | null } | null>`; `uploadPhoto(bucket, path, blob)`; `signedUrls(bucket, paths: string[]): Promise<Record<string, string>>`.
- Produces in `src/ai.ts`: tools `log_meal` and `log_water` appended to `TOOLS`.
- Produces in `src/tools.ts`: cases `log_meal`, `log_water`.

- [ ] **Step 1: Append to src/db.ts**

```ts
import { dayKey } from './dates.ts'

export type NewMeal = Omit<MealRow, 'id' | 'eaten_at'> & { eaten_at?: string }

export async function insertMeal(row: NewMeal) {
  unwrap(await sb.from('meals').insert(row))
}

export async function deleteMeal(id: string) {
  unwrap(await sb.from('meals').delete().eq('id', id))
}

export async function insertWater(ml: number, at = new Date()) {
  unwrap(await sb.from('water').insert({ ml, at: at.toISOString(), date: dayKey(at) }))
}

export async function dayLog(date: string) {
  const rows = unwrap(
    await sb.from('daily_logs').select('weight_kg, progress_photo_path').eq('date', date),
  ) as { weight_kg: number | null; progress_photo_path: string | null }[]
  return rows[0] ?? null
}

export async function uploadPhoto(bucket: 'meals' | 'progress', path: string, blob: Blob) {
  const { error } = await sb.storage.from(bucket).upload(path, blob, { contentType: 'image/jpeg', upsert: true })
  if (error) throw new Error(error.message)
}

export async function signedUrls(bucket: 'meals' | 'progress', paths: string[]) {
  if (!paths.length) return {}
  const { data, error } = await sb.storage.from(bucket).createSignedUrls(paths, 3600)
  if (error) throw new Error(error.message)
  return Object.fromEntries(data.filter(d => d.path && d.signedUrl).map(d => [d.path as string, d.signedUrl]))
}
```

- [ ] **Step 2: Append two tools to `TOOLS` in src/ai.ts**

```ts
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
      properties: { ml: num, time: { type: 'string', description: 'HH:MM local, default now' } },
    },
  },
```

- [ ] **Step 3: Add the two cases to the switch in src/tools.ts, before `default`**

```ts
        case 'log_meal': {
          const m = input as { name: string; kcal: number; protein_g: number; carbs_g: number; fat_g: number; fiber_g?: number; time?: string }
          const at = atTime(m.time)
          await insertMeal({
            date: dayKey(at), eaten_at: at.toISOString(), photo_path: null, name: m.name, items: [],
            kcal: Math.round(m.kcal), protein_g: m.protein_g, carbs_g: m.carbs_g, fat_g: m.fat_g, fiber_g: m.fiber_g ?? 0,
            confidence: null, assumptions: null, source: 'agent',
          })
          deps.onChange()
          return { result: 'logged' }
        }
        case 'log_water': {
          const w = input as { ml: number; time?: string }
          await insertWater(Math.round(w.ml), atTime(w.time))
          deps.onChange()
          return { result: 'logged' }
        }
```

And add this helper above `makeToolRunner`, plus `insertMeal, insertWater` to the `./db.ts` import:

```ts
function atTime(hhmm?: string) {
  const d = new Date()
  const m = hhmm?.match(/^(\d{1,2}):(\d{2})$/)
  if (m) d.setHours(+m[1], +m[2], 0, 0)
  return d
}
```

- [ ] **Step 4: Type-check, commit, push**

Run: `npm run check`
Expected: clean.

```bash
git add -A && git commit -m "Add meal and water logging tools" && git push
```

---

### Task 4: Meal dialog

**Files:**
- Create: `src/views/MealDialog.tsx`

**Interfaces:**
- Consumes: `MealEstimate` from `src/types.ts`.
- Produces: `MealDialog(p: { estimate: MealEstimate | null; photo: Blob | null; analyzing: boolean; error: string; onSave: (name: string, est: MealEstimate) => Promise<void>; onClose: () => void })`. Renders a native `<dialog>` that is open while mounted.

- [ ] **Step 1: Write src/views/MealDialog.tsx**

```tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import type { MealEstimate } from '../types.ts'

const EMPTY: MealEstimate = { items: [], totals: { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 }, confidence: 'low', assumptions: '' }

export function MealDialog(p: {
  estimate: MealEstimate | null
  photo: Blob | null
  analyzing: boolean
  error: string
  onSave: (name: string, est: MealEstimate) => Promise<void>
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const est = p.estimate ?? EMPTY
  const [name, setName] = useState('')
  const [t, setT] = useState(est.totals)
  const [saving, setSaving] = useState(false)
  const preview = useMemo(() => (p.photo ? URL.createObjectURL(p.photo) : ''), [p.photo])

  useEffect(() => { ref.current?.showModal(); return () => ref.current?.close() }, [])
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])
  useEffect(() => {
    if (!p.estimate) return
    setT(p.estimate.totals)
    setName(p.estimate.items.map(i => i.name).join(', ').slice(0, 80))
  }, [p.estimate])

  const num = (k: keyof typeof t) => (
    <label>{k === 'kcal' ? 'kcal' : k.replace('_g', ' g')}
      <input type="number" step="any" value={t[k]} onChange={e => setT({ ...t, [k]: +e.target.value })} />
    </label>
  )

  async function save() {
    setSaving(true)
    try { await p.onSave(name.trim() || 'Meal', { ...est, totals: t }) } finally { setSaving(false) }
  }

  return (
    <dialog ref={ref} className="sheet" onClose={p.onClose}>
      <div className="stack">
        <div className="row"><h2>Log a meal</h2><button type="button" className="ghost" onClick={p.onClose}>Close</button></div>
        {preview && <img className="preview" src={preview} alt="" />}
        {p.analyzing && <p className="muted">Looking at the photo…</p>}
        {p.error && <p className="error">{p.error}</p>}
        {!p.analyzing && (
          <>
            {p.estimate && (
              <p className="muted">
                Confidence {p.estimate.confidence}. Photo estimates are typically within 30%; edit anything that looks off.
                {p.estimate.assumptions && ` ${p.estimate.assumptions}`}
              </p>
            )}
            {est.items.length > 0 && (
              <ul className="items">
                {est.items.map((i, k) => <li key={k}>{i.name} <span className="muted">{i.portion_estimate}, {i.kcal} kcal</span></li>)}
              </ul>
            )}
            <label>Name<input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. chicken and rice" /></label>
            <div className="grid5">{num('kcal')}{num('protein_g')}{num('carbs_g')}{num('fat_g')}{num('fiber_g')}</div>
            <button className="primary" type="button" onClick={save} disabled={saving || !t.kcal}>Save to today</button>
          </>
        )}
      </div>
    </dialog>
  )
}
```

- [ ] **Step 2: Type-check, commit, push**

Run: `npm run check`
Expected: clean.

```bash
git add -A && git commit -m "Add meal dialog" && git push
```

---

### Task 5: Today view

**Files:**
- Create: `src/views/Today.tsx`

**Interfaces:**
- Consumes: everything above; `resizeToJpeg coverCrop` from `src/image.ts`; `analyzeMeal` from `src/ai.ts`; `sanitizeMeal` from `src/logic.ts`; `weekdayOf dayKey` from `src/dates.ts`.
- Produces: `Today(p: { userId: string; profile: Profile; version: number; onChange: () => void })`.

- [ ] **Step 1: Write src/views/Today.tsx**

```tsx
import { useEffect, useState, type ChangeEvent } from 'react'
import { dayTotals, dayMeals, dayLog, latestWeight, latestPlan, insertMeal, deleteMeal, insertWater, upsertDailyLog, uploadPhoto, signedUrls } from '../db.ts'
import { analyzeMeal } from '../ai.ts'
import { sanitizeMeal } from '../logic.ts'
import { resizeToJpeg, coverCrop } from '../image.ts'
import { dayKey, weekdayOf } from '../dates.ts'
import { MealDialog } from './MealDialog.tsx'
import type { Profile, DailyTotals, MealRow, MealPlan, PlanMeal, MealEstimate } from '../types.ts'

function Ring({ value, max, label, unit }: { value: number; max?: number; label: string; unit: string }) {
  const r = 26
  const c = 2 * Math.PI * r
  const frac = max ? Math.min(1, value / max) : 0
  return (
    <div className="ring">
      <svg viewBox="0 0 64 64" width="64" height="64">
        <circle cx="32" cy="32" r={r} stroke="var(--line)" strokeWidth="6" fill="none" />
        <circle cx="32" cy="32" r={r} stroke="var(--fg)" strokeWidth="6" fill="none" strokeLinecap="round"
          strokeDasharray={`${c * frac} ${c}`} transform="rotate(-90 32 32)" />
      </svg>
      <div><strong>{Math.round(value)}</strong><small> {max ? `/ ${max} ` : ''}{unit}</small><div className="muted">{label}</div></div>
    </div>
  )
}

const LB = 0.45359237

export function Today(p: { userId: string; profile: Profile; version: number; onChange: () => void }) {
  const date = dayKey()
  const imperial = p.profile.units === 'imperial'
  const [totals, setTotals] = useState<DailyTotals | null>(null)
  const [meals, setMeals] = useState<MealRow[]>([])
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [log, setLog] = useState<{ weight_kg: number | null; progress_photo_path: string | null } | null>(null)
  const [progressUrl, setProgressUrl] = useState('')
  const [weight, setWeight] = useState<{ weight_kg: number; date: string } | null>(null)
  const [weightIn, setWeightIn] = useState('')
  const [water, setWater] = useState('')
  const [planned, setPlanned] = useState<PlanMeal[]>([])
  const [dialog, setDialog] = useState<{ photo: Blob | null; estimate: MealEstimate | null; analyzing: boolean; error: string } | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([dayTotals(date), dayMeals(date), dayLog(date), latestWeight(), latestPlan('meal')])
      .then(async ([t, m, l, w, mp]) => {
        setTotals(t); setMeals(m); setLog(l); setWeight(w)
        setPlanned(mp ? ((mp.content as MealPlan).days.find(d => d.weekday === weekdayOf())?.meals ?? []) : [])
        setThumbs(await signedUrls('meals', m.map(x => x.photo_path).filter((x): x is string => !!x)))
        setProgressUrl(l?.progress_photo_path ? (await signedUrls('progress', [l.progress_photo_path]))[l.progress_photo_path] ?? '' : '')
      })
      .catch(e => setError(e.message))
  }, [p.version])

  const run = (fn: () => Promise<void>) => fn().then(p.onChange).catch(e => setError(e.message))

  async function pickMeal(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setDialog({ photo: null, estimate: null, analyzing: true, error: '' })
    try {
      const jpeg = await resizeToJpeg(file)
      setDialog({ photo: jpeg, estimate: null, analyzing: true, error: '' })
      const est = sanitizeMeal(await analyzeMeal(jpeg, '', p.profile.model))
      setDialog({ photo: jpeg, estimate: est, analyzing: false, error: '' })
    } catch (err) {
      setDialog(d => ({ photo: d?.photo ?? null, estimate: null, analyzing: false, error: err instanceof Error ? err.message : String(err) }))
    }
  }

  async function saveMeal(name: string, est: MealEstimate) {
    let photo_path: string | null = null
    if (dialog?.photo) {
      photo_path = `${p.userId}/${date}-${crypto.randomUUID()}.jpg`
      await uploadPhoto('meals', photo_path, dialog.photo)
    }
    await insertMeal({
      date, photo_path, name, items: est.items, ...est.totals, kcal: Math.round(est.totals.kcal),
      confidence: est.confidence, assumptions: est.assumptions || null, source: photo_path ? 'photo' : 'manual',
    })
    setDialog(null)
    p.onChange()
  }

  const ateThis = (m: PlanMeal) => run(() => insertMeal({
    date, photo_path: null, name: m.name, items: m.items, kcal: Math.round(m.kcal), protein_g: m.protein_g, carbs_g: m.carbs_g, fat_g: m.fat_g, fiber_g: 0,
    confidence: null, assumptions: null, source: 'plan',
  }))

  const addWater = (ml: number) => run(() => insertWater(ml))

  const saveWeight = () => {
    const kg = imperial ? +weightIn * LB : +weightIn
    if (!kg) return
    run(async () => { await upsertDailyLog(date, { weight_kg: Math.round(kg * 10) / 10 }); setWeightIn('') })
  }

  async function pickProgress(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    run(async () => {
      const jpeg = await coverCrop(file)
      const path = `${p.userId}/${date}.jpg`
      await uploadPhoto('progress', path, jpeg)
      await upsertDailyLog(date, { progress_photo_path: path })
    })
  }

  const t = totals ?? { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, water_ml: 0, workout_done: false, weight_kg: null }
  const target = p.profile.targets
  const showW = (kg: number) => imperial ? `${Math.round(kg / LB * 10) / 10} lb` : `${kg} kg`

  return (
    <div className="stack">
      {error && <p className="error">{error}</p>}
      <section className="tile rings">
        <Ring value={t.kcal} max={target.kcal} label="calories" unit="kcal" />
        <Ring value={t.water_ml} max={target.water_ml ?? 2500} label="water" unit="ml" />
        <div className="macros muted">P {Math.round(t.protein_g)} g · C {Math.round(t.carbs_g)} g · F {Math.round(t.fat_g)} g</div>
      </section>

      <section className="tile">
        <div className="row"><h2>Meals</h2>
          <label className="button">Log a meal<input type="file" accept="image/*" capture="environment" onChange={pickMeal} hidden /></label>
          <button type="button" onClick={() => setDialog({ photo: null, estimate: null, analyzing: false, error: '' })}>Add manually</button>
        </div>
        {meals.length === 0 && <p className="muted">Nothing logged yet.</p>}
        {meals.map(m => (
          <div key={m.id} className="meal">
            {m.photo_path && thumbs[m.photo_path] && <img src={thumbs[m.photo_path]} alt="" />}
            <div><strong>{m.name}</strong><div className="muted">{m.kcal} kcal · P {m.protein_g} C {m.carbs_g} F {m.fat_g}</div></div>
            <button type="button" className="ghost" onClick={() => run(() => deleteMeal(m.id))}>Remove</button>
          </div>
        ))}
        {planned.length > 0 && (
          <>
            <h3 className="muted">Planned for today</h3>
            {planned.map((m, i) => (
              <div key={i} className="meal">
                <div><strong>{m.name}</strong><div className="muted">{m.kcal} kcal</div></div>
                <button type="button" onClick={() => ateThis(m)}>Ate this</button>
              </div>
            ))}
          </>
        )}
      </section>

      <section className="tile">
        <h2>Water</h2>
        <div className="row wrap">
          <button type="button" onClick={() => addWater(250)}>+250 ml</button>
          <button type="button" onClick={() => addWater(500)}>+500 ml</button>
          <input type="number" value={water} onChange={e => setWater(e.target.value)} placeholder="ml" className="short" />
          <button type="button" onClick={() => { if (+water > 0) { addWater(+water); setWater('') } }}>Add</button>
        </div>
      </section>

      <section className="tile">
        <h2>Weight</h2>
        <p className="muted">{weight ? `Last weigh-in ${showW(weight.weight_kg)} on ${weight.date}` : 'No weigh-in yet.'}</p>
        <div className="row">
          <input type="number" step="any" value={weightIn} onChange={e => setWeightIn(e.target.value)} placeholder={imperial ? 'lb' : 'kg'} className="short" />
          <button type="button" onClick={saveWeight}>Save</button>
        </div>
      </section>

      <section className="tile">
        <h2>Progress photo</h2>
        <p className="muted">One a day, same spot, same light. They become your transformation video.</p>
        {progressUrl && <img className="progress" src={progressUrl} alt="" />}
        <label className="button">{log?.progress_photo_path ? 'Retake today' : 'Take today\'s photo'}
          <input type="file" accept="image/*" capture="user" onChange={pickProgress} hidden />
        </label>
      </section>

      {dialog && (
        <MealDialog estimate={dialog.estimate} photo={dialog.photo} analyzing={dialog.analyzing} error={dialog.error}
          onSave={saveMeal} onClose={() => setDialog(null)} />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Type-check, commit, push**

Run: `npm run check`
Expected: clean. If tsc rejects `hidden` on the input, use `style={{ display: 'none' }}` instead. If it rejects `capture="user"`, use `capture` without a value.

```bash
git add -A && git commit -m "Add Today view" && git push
```

---

### Task 6: Wire Today into the app, styles, deploy

**Files:**
- Modify: `src/App.tsx`, `src/app.css`

- [ ] **Step 1: Wire the view in src/App.tsx**

Add the import:

```tsx
import { Today } from './views/Today.tsx'
```

Replace the `view` expression's fallback branch so it reads:

```tsx
  const view =
    tab === 'today' ? <Today userId={session.user.id} profile={profile} version={version} onChange={bump} /> :
    tab === 'plan' ? <Plan catalog={data.catalog} videos={data.videos} version={version} /> :
    tab === 'settings' ? (
      <Settings key={profile.updated_at} userId={session.user.id} profile={profile} apiKey={apiKey}
        onKey={k => { setApiKey(k); bump() }} onChange={bump} />
    ) :
    <p className="muted">History lands in the next phase.</p>
```

Also refresh when the tab comes back to the foreground (cross-device freshness), inside the first `useEffect` next to the hash listener:

```tsx
    const onVisible = () => { if (document.visibilityState === 'visible') setVersion(v => v + 1) }
    document.addEventListener('visibilitychange', onVisible)
```

and in the cleanup:

```tsx
      document.removeEventListener('visibilitychange', onVisible)
```

- [ ] **Step 2: Append to src/app.css**

```css
.rings { display: flex; gap: 24px; align-items: center; flex-wrap: wrap; }
.ring { display: flex; align-items: center; gap: 10px; }
.ring strong { font-size: 22px; }
.macros { flex-basis: 100%; }
.meal { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-top: 1px solid var(--line); }
.meal img { width: 56px; height: 56px; object-fit: cover; border-radius: var(--r); }
.meal > div { flex: 1; }
input.short { width: 110px; }
label.button { display: inline-block; font: inherit; font-size: 17px; color: var(--fg); background: var(--surface2); border: 1px solid var(--line); border-radius: var(--r); padding: 10px 16px; cursor: pointer; }
img.progress { width: 100%; max-width: 320px; aspect-ratio: 4 / 5; object-fit: cover; border-radius: var(--r-lg); display: block; margin-bottom: 12px; }

dialog.sheet { background: var(--surface); color: var(--fg); border: 1px solid var(--line); border-radius: var(--r-xl); padding: 20px; width: min(520px, calc(100vw - 32px)); max-height: 90dvh; overflow-y: auto; }
dialog.sheet::backdrop { background: rgba(0, 0, 0, 0.6); }
dialog.sheet .row { justify-content: space-between; }
img.preview { width: 100%; max-height: 240px; object-fit: cover; border-radius: var(--r); }
.items { margin: 0; padding-left: 20px; font-size: 15px; }
.grid5 { display: grid; grid-template-columns: repeat(auto-fit, minmax(90px, 1fr)); gap: 8px; }
```

- [ ] **Step 3: Check, build, push, verify the deploy**

```bash
npm run check && npm run build
git add -A && git commit -m "Add the daily log to Today" && git push
sleep 20
gh run watch --exit-status $(gh run list --workflow Deploy --limit 1 --json databaseId -q '.[0].databaseId')
curl -sI https://duckyquang.github.io/APT/ | head -1
```

Expected: check and build clean; Deploy run succeeds; `HTTP/2 200`. On an iPhone, once the Supabase project exists: take a portrait meal photo and confirm the thumbnail is upright. That is the EXIF check from PLAN.md Phase 2.
