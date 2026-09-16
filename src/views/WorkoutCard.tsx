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
