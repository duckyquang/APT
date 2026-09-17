import { useEffect, useRef, useState } from 'react'
import { latestPlan, dayWorkout, upsertWorkout, recentWorkouts } from '../db.ts'
import { lastWeights, sessionFromPlan, toKg, fromKg } from '../logic.ts'
import { dayKey, weekdayOf } from '../dates.ts'
import { Label, Stat } from './widgets.tsx'
import type { WorkoutPlan, WorkoutRow, WorkoutSet } from '../types.ts'

type State = { row: WorkoutRow; rests: number[] } | { note: string }

export function WorkoutCard(p: { imperial: boolean; version: number; onChange: () => void }) {
  const date = dayKey()
  const [s, setS] = useState<State>()
  const [rest, setRest] = useState(0)
  const [error, setError] = useState('')
  const latest = useRef<WorkoutRow | null>(null)
  const dirty = useRef(false)
  const queue = useRef(Promise.resolve())

  // writes go out one at a time, so a slow early upsert can never land on top of a later one
  function persist(next: WorkoutRow) {
    dirty.current = false
    queue.current = queue.current.then(() => upsertWorkout(next)).catch(e => setError(e.message))
    return queue.current
  }

  useEffect(() => {
    let alive = true
    // flush anything typed but not yet saved, and let queued writes land before reading the row back
    const flushed = dirty.current && latest.current ? persist(latest.current) : queue.current
    flushed.then(() => Promise.all([latestPlan('workout'), dayWorkout(date), recentWorkouts(10)]))
      .then(([plan, saved, recent]) => {
        if (!alive) return
        const day = plan ? (plan.content as WorkoutPlan).days.find(d => d.weekday === weekdayOf()) : undefined
        const rests = day?.exercises.map(x => x.rest_s) ?? []
        const row = saved ?? (plan && day ? {
          id: crypto.randomUUID(), date, plan_id: plan.id, day_name: day.name,
          exercises: sessionFromPlan(day, lastWeights(recent)), duration_min: null, notes: null, created_at: new Date().toISOString(),
        } : null)
        latest.current = row
        setS(row ? { row, rests } : { note: plan ? 'Rest day.' : 'No plan yet. Ask APT for one.' })
      })
      .catch(e => alive && setError(e.message))
    return () => { alive = false }
  }, [p.version])

  useEffect(() => {
    if (rest <= 0) return
    const t = window.setTimeout(() => setRest(r => r - 1), 1000)
    return () => clearTimeout(t)
  }, [rest])

  if (!s) return null
  if ('note' in s) return <section className="tile work"><Label>Workout</Label><p className="muted">{s.note}</p></section>
  const { row, rests } = s
  const done = row.duration_min != null
  const unit = p.imperial ? 'lb' : 'kg'

  function update(next: WorkoutRow, save: boolean) {
    latest.current = next
    setS({ row: next, rests })
    if (save) persist(next)
    else dirty.current = true
  }
  function setField(ei: number, si: number, patch: Partial<WorkoutSet>, save: boolean) {
    const cur = latest.current!
    const exercises = cur.exercises.map((x, i) => i !== ei ? x : { ...x, sets: x.sets.map((set, j) => j !== si ? set : { ...set, ...patch }) })
    update({ ...cur, exercises }, save)
    if (patch.done) setRest(rests[ei] ?? 90)
  }
  function finish() {
    const cur = latest.current!
    const minutes = Math.max(1, Math.round((Date.now() - new Date(cur.created_at).getTime()) / 60000))
    update({ ...cur, duration_min: minutes }, true)
    setRest(0)
    queue.current.then(p.onChange)
  }

  const doneSets = row.exercises.flatMap(x => x.sets.filter(set => set.done))
  const total = row.exercises.reduce((a, x) => a + x.sets.length, 0)
  const volume = doneSets.reduce((a, set) => a + set.reps * set.weight_kg, 0)
  const pct = total ? Math.round((doneSets.length / total) * 100) : 0

  return (
    <section className="tile work">
      <Label meta={done ? 'done' : rest > 0 ? <span className="rest">rest {rest}s</span> : `${doneSets.length}/${total} sets`}>Workout · {row.day_name}</Label>
      <div className="bar"><i style={{ width: `${pct}%` }} /></div>
      {error && <p className="error">{error}</p>}
      {done ? (
        <>
          <Stat icon="⏱" color="var(--purple)" label="Duration" value={row.duration_min || '–'} unit="min" />
          <Stat icon="✓" color="var(--green)" label="Sets" value={doneSets.length} unit={`of ${total}`} />
          <Stat icon="⚖" color="var(--blue)" label="Volume" value={Math.round(fromKg(volume, p.imperial))} unit={unit} />
          <Stat icon="≡" color="var(--yellow)" label="Exercises" value={row.exercises.length} />
        </>
      ) : (
        <>
          {row.exercises.map((x, ei) => (
            <div key={ei} className="ex">
              <h3>{x.name}</h3>
              {x.sets.map((set, si) => (
                <div key={si} className="set">
                  <span className="muted">{si + 1}</span>
                  <input type="number" value={set.reps} aria-label="reps"
                    onChange={e => setField(ei, si, { reps: +e.target.value }, false)} onBlur={() => persist(latest.current!)} />
                  <span className="muted">×</span>
                  <input type="number" step="any" value={fromKg(set.weight_kg, p.imperial)} aria-label={unit}
                    onChange={e => setField(ei, si, { weight_kg: toKg(+e.target.value, p.imperial) }, false)} onBlur={() => persist(latest.current!)} />
                  <span className="muted">{unit}</span>
                  <input type="checkbox" checked={set.done} aria-label="done" onChange={e => setField(ei, si, { done: e.target.checked }, true)} />
                </div>
              ))}
            </div>
          ))}
          <button type="button" className="primary" onClick={finish} disabled={!doneSets.length} style={{ marginTop: 12 }}>Finish workout</button>
        </>
      )}
    </section>
  )
}
