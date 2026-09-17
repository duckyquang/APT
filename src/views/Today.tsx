import { useEffect, useState, type ChangeEvent } from 'react'
import { dayTotals, dayMeals, progressPhotoPath, latestWeight, latestPlan, insertMeal, deleteMeal, insertWater, upsertDailyLog, uploadPhoto, signedUrls, zeroTotals } from '../db.ts'
import { analyzeMeal, errorMessage, getKey } from '../ai.ts'
import { sanitizeMeal, toKg, fromKg } from '../logic.ts'
import { resizeToJpeg, coverCrop } from '../image.ts'
import { dayKey, weekdayOf } from '../dates.ts'
import { MealDialog } from './MealDialog.tsx'
import { WorkoutCard } from './WorkoutCard.tsx'
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

export function Today(p: { userId: string; profile: Profile; version: number; onChange: () => void }) {
  const date = dayKey()
  const imperial = p.profile.units === 'imperial'
  const unit = imperial ? 'lb' : 'kg'
  const [totals, setTotals] = useState<DailyTotals>(() => zeroTotals(date))
  const [meals, setMeals] = useState<MealRow[]>([])
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [progressUrl, setProgressUrl] = useState('')
  const [weight, setWeight] = useState<{ weight_kg: number; date: string } | null>(null)
  const [weightIn, setWeightIn] = useState('')
  const [water, setWater] = useState('')
  const [planned, setPlanned] = useState<PlanMeal[]>([])
  const [dialog, setDialog] = useState<{ photo: Blob | null; estimate: MealEstimate | null; analyzing: boolean; error: string } | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    Promise.all([dayTotals(date), dayMeals(date), progressPhotoPath(date), latestWeight(), latestPlan('meal')])
      .then(async ([t, m, path, w, mp]) => {
        const [th, pu] = await Promise.all([
          signedUrls('meals', m.map(x => x.photo_path).filter((x): x is string => !!x)),
          path ? signedUrls('progress', [path]) : ({} as Record<string, string>),
        ])
        if (!alive) return
        setTotals(t)
        setMeals(m)
        setWeight(w)
        setPlanned(mp ? ((mp.content as MealPlan).days.find(d => d.weekday === weekdayOf())?.meals ?? []) : [])
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

  return (
    <div className="stack">
      {error && <p className="error">{error}</p>}
      <section className="tile rings">
        <Ring value={totals.kcal} max={target.kcal} label="calories" unit="kcal" />
        <Ring value={totals.water_ml} max={target.water_ml ?? 2500} label="water" unit="ml" />
        <div className="macros muted">P {Math.round(totals.protein_g)} g · C {Math.round(totals.carbs_g)} g · F {Math.round(totals.fat_g)} g</div>
      </section>

      <WorkoutCard imperial={imperial} version={p.version} onChange={p.onChange} />

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
          <input type="number" step="1" inputMode="numeric" value={water} onChange={e => setWater(e.target.value)} placeholder="ml" className="short" />
          <button type="button" onClick={() => { const ml = Math.round(+water); if (ml > 0) { addWater(ml); setWater('') } }}>Add</button>
        </div>
      </section>

      <section className="tile">
        <h2>Weight</h2>
        <p className="muted">{weight ? `Last weigh-in ${fromKg(weight.weight_kg, imperial)} ${unit} on ${weight.date}` : 'No weigh-in yet.'}</p>
        <div className="row">
          <input type="number" step="any" value={weightIn} onChange={e => setWeightIn(e.target.value)} placeholder={unit} className="short" />
          <button type="button" onClick={saveWeight}>Save</button>
        </div>
      </section>

      <section className="tile">
        <h2>Progress photo</h2>
        <p className="muted">One a day, same spot, same light. They become your transformation video.</p>
        {progressUrl && <img className="progress" src={progressUrl} alt="" />}
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
