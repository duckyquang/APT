import { useEffect, useState, type ChangeEvent } from 'react'
import { dayTotals, dayMeals, progressPhotoPath, latestWeight, latestPlan, rangeTotals, insertMeal, deleteMeal, insertWater, upsertDailyLog, uploadPhoto, signedUrls, zeroTotals } from '../db.ts'
import { analyzeMeal, errorMessage, getKey } from '../ai.ts'
import { sanitizeMeal, toKg, fromKg, lastNDays, heatmap } from '../logic.ts'
import { resizeToJpeg, coverCrop } from '../image.ts'
import { dayKey, weekdayOf, type Weekday } from '../dates.ts'
import { MealDialog } from './MealDialog.tsx'
import { WorkoutCard } from './WorkoutCard.tsx'
import { Label, Big, Delta, Bars, Spark, Segments, Heat } from './widgets.tsx'
import type { Profile, DailyTotals, MealRow, MealPlan, WorkoutPlan, PlanMeal, MealEstimate } from '../types.ts'

const short = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short' })
const ORDER: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const NAMES = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' }

export function Today(p: { userId: string; profile: Profile; version: number; onChange: () => void }) {
  const date = dayKey()
  const imperial = p.profile.units === 'imperial'
  const unit = imperial ? 'lb' : 'kg'
  const [totals, setTotals] = useState<DailyTotals>(() => zeroTotals(date))
  const [recent, setRecent] = useState<DailyTotals[]>([])
  const [meals, setMeals] = useState<MealRow[]>([])
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [progressUrl, setProgressUrl] = useState('')
  const [weight, setWeight] = useState<{ weight_kg: number; date: string } | null>(null)
  const [weightIn, setWeightIn] = useState('')
  const [water, setWater] = useState('')
  const [planned, setPlanned] = useState<PlanMeal[]>([])
  const [workoutPlan, setWorkoutPlan] = useState<WorkoutPlan | null>(null)
  const [dialog, setDialog] = useState<{ photo: Blob | null; estimate: MealEstimate | null; analyzing: boolean; error: string } | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    const days = lastNDays(56)
    Promise.all([dayTotals(date), dayMeals(date), progressPhotoPath(date), latestWeight(), latestPlan('meal'), latestPlan('workout'), rangeTotals(days[0], date)])
      .then(async ([t, m, path, w, mp, wp, r]) => {
        const [th, pu] = await Promise.all([
          signedUrls('meals', m.map(x => x.photo_path).filter((x): x is string => !!x)),
          path ? signedUrls('progress', [path]) : ({} as Record<string, string>),
        ])
        if (!alive) return
        setTotals(t)
        setRecent(r)
        setMeals(m)
        setWeight(w)
        setPlanned(mp ? ((mp.content as MealPlan).days.find(d => d.weekday === weekdayOf())?.meals ?? []) : [])
        setWorkoutPlan(wp ? (wp.content as WorkoutPlan) : null)
        setThumbs(th)
        setProgressUrl(path ? pu[path] ?? '' : '')
      })
      .catch(e => alive && setError(e.message))
    return () => { alive = false }
  }, [p.version])

  const run = (fn: () => Promise<void>) => fn().then(p.onChange).catch(e => setError(errorMessage(e)))

  async function pickMeal(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setDialog({ photo: null, estimate: null, analyzing: true, error: '' })
    try {
      const jpeg = await resizeToJpeg(file)
      setDialog({ photo: jpeg, estimate: null, analyzing: true, error: '' })
      const est = sanitizeMeal(await analyzeMeal(p.profile.provider, getKey(p.profile.provider), p.profile.model, jpeg, ''))
      setDialog({ photo: jpeg, estimate: est, analyzing: false, error: '' })
    } catch (err) {
      setDialog(d => ({ photo: d?.photo ?? null, estimate: null, analyzing: false, error: errorMessage(err) }))
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
    const kg = toKg(+weightIn, imperial)
    if (!kg) return
    run(async () => { await upsertDailyLog(date, { weight_kg: kg }); setWeightIn('') })
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

  const target = p.profile.targets
  const byDate = new Map(recent.map(t => [t.date, t]))
  const week = lastNDays(7).map(d => ({ label: short(d), value: d === date ? totals.kcal : byDate.get(d)?.kcal ?? 0, today: d === date }))
  const weighIns = recent.filter(t => t.weight_kg != null).sort((a, b) => a.date.localeCompare(b.date))
  const weekAgo = lastNDays(8)[0]
  const prev = [...weighIns].reverse().find(t => t.date <= weekAgo)
  const macro = (cls: string, label: string, value: number, t?: number) => (
    <div className={'macro ' + cls}>
      <span>{label}</span>
      <div className="bar"><i style={{ width: `${Math.min(100, (value / Math.max(1, t ?? value)) * 100)}%` }} /></div>
      <span className="num">{Math.round(value)}{t ? ` / ${t}` : ''} g</span>
    </div>
  )

  // the next training day after today (today itself if it is not finished)
  const todayIdx = ORDER.indexOf(weekdayOf())
  const next = workoutPlan?.days
    .map(d => ({ d, away: (ORDER.indexOf(d.weekday) - todayIdx + 7) % 7 }))
    .filter(x => x.away > 0 || !totals.workout_done)
    .sort((a, b) => a.away - b.away)[0]

  return (
    <div className="today-grid">
      {error && <p className="error err">{error}</p>}

      <section className="tile cal">
        <Label meta="7d">Calories</Label>
        <Big value={totals.kcal} unit={target.kcal ? `/ ${target.kcal} kcal` : 'kcal'} />
        <Bars points={week} unit="kcal" />
      </section>

      <section className="tile mac">
        <Label meta="today">Macros</Label>
        {macro('p', 'Protein', totals.protein_g, target.protein_g)}
        {macro('c', 'Carbs', totals.carbs_g, target.carbs_g)}
        {macro('f', 'Fat', totals.fat_g, target.fat_g)}
      </section>

      <section className="tile wat">
        <Label meta={`of ${target.water_ml ?? 2500} ml`}>Water</Label>
        <Big value={totals.water_ml} unit="ml" />
        <Segments value={totals.water_ml} max={target.water_ml ?? 2500} />
        <div className="row wrap" style={{ marginTop: 10 }}>
          <button type="button" onClick={() => addWater(250)}>+250</button>
          <button type="button" onClick={() => addWater(500)}>+500</button>
          <input type="number" step="1" inputMode="numeric" value={water} onChange={e => setWater(e.target.value)} placeholder="ml" className="short" />
          <button type="button" onClick={() => { const ml = Math.round(+water); if (ml > 0) { addWater(ml); setWater('') } }}>Add</button>
        </div>
      </section>

      <section className="tile wei">
        <Label meta="30d">Weight</Label>
        <Big value={weight ? fromKg(weight.weight_kg, imperial) : '–'} unit={unit} />
        {weight && prev && prev.date !== weight.date
          ? <Delta value={Math.round((fromKg(weight.weight_kg, imperial) - fromKg(prev.weight_kg!, imperial)) * 10) / 10} unit={unit} label="vs a week ago" />
          : <div className="delta">{weight ? `last weigh-in ${weight.date}` : 'no weigh-in yet'}</div>}
        <Spark points={weighIns.filter(t => t.date >= lastNDays(30)[0]).map(t => ({ label: t.date, value: fromKg(t.weight_kg!, imperial) }))} unit={unit} />
        <div className="row" style={{ marginTop: 10 }}>
          <input type="number" step="any" value={weightIn} onChange={e => setWeightIn(e.target.value)} placeholder={unit} className="short" />
          <button type="button" onClick={saveWeight}>Weigh in</button>
        </div>
      </section>

      <WorkoutCard imperial={imperial} version={p.version} onChange={p.onChange} />

      <section className="tile heat-tile">
        <Label meta="8 weeks">Consistency</Label>
        <Heat cols={heatmap(recent.concat(totals))} />
      </section>

      <section className="tile meals">
        <Label meta={`${meals.length} logged`}>Meals</Label>
        <div className="row wrap">
          <label className="button">Log a meal<input type="file" accept="image/*" capture="environment" onChange={pickMeal} hidden /></label>
          <button type="button" onClick={() => setDialog({ photo: null, estimate: null, analyzing: false, error: '' })}>Add manually</button>
        </div>
        {meals.length === 0 && <p className="muted" style={{ marginTop: 10 }}>Nothing logged yet.</p>}
        {meals.map(m => (
          <div key={m.id} className="meal">
            {m.photo_path && thumbs[m.photo_path] && <img src={thumbs[m.photo_path]} alt="" />}
            <div><strong>{m.name}</strong><div className="muted">{m.kcal} kcal · P {m.protein_g} C {m.carbs_g} F {m.fat_g}</div></div>
            <button type="button" className="ghost" onClick={() => run(() => deleteMeal(m.id))}>Remove</button>
          </div>
        ))}
        {planned.length > 0 && (
          <>
            <div className="label" style={{ marginTop: 12 }}>Planned for today</div>
            {planned.map((m, i) => (
              <div key={i} className="meal">
                <div><strong>{m.name}</strong><div className="muted">{m.kcal} kcal</div></div>
                <button type="button" onClick={() => ateThis(m)}>Ate this</button>
              </div>
            ))}
          </>
        )}
      </section>

      <section className="tile next">
        <Label meta={next ? (next.away === 0 ? 'today' : next.away === 1 ? 'tomorrow' : NAMES[next.d.weekday]) : ''}>Up next</Label>
        {next ? (
          <>
            <Big value={next.d.name} />
            <p className="muted">{next.d.exercises.length} exercises · {next.d.exercises.reduce((a, x) => a + x.sets, 0)} sets</p>
            <p className="muted">{next.d.exercises.slice(0, 3).map(x => x.name).join(', ')}{next.d.exercises.length > 3 ? '…' : ''}</p>
          </>
        ) : (
          <p className="muted">{workoutPlan ? 'Nothing scheduled.' : 'Ask APT for a plan and it shows up here.'}</p>
        )}
      </section>

      <section className="tile photo">
        <Label meta={progressUrl ? 'done today' : 'not yet'}>Progress</Label>
        {progressUrl ? <img className="progress" src={progressUrl} alt="" /> : <p className="muted">One a day, same spot, same light. They become your transformation video.</p>}
        <label className="button">{progressUrl ? 'Retake today' : 'Take today\'s photo'}
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
