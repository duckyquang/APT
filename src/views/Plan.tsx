import { useEffect, useState } from 'react'
import { latestPlan, rangeWorkouts } from '../db.ts'
import { STILLS } from '../catalog.ts'
import { weekStart } from '../logic.ts'
import { dayKey, weekdayOf, type Weekday } from '../dates.ts'
import { Label } from './widgets.tsx'
import type { Exercise, Videos, PlanRow, WorkoutPlan, MealPlan, PlanExercise, WorkoutRow } from '../types.ts'

const ORDER: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const NAMES = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' }
const TINTS = ['#2dd4bf', '#f59e0b', '#ef4444', '#3b82f6', '#a855f7', '#22c55e', '#eab308']

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
  const [week, setWeek] = useState<WorkoutRow[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    Promise.all([latestPlan('workout'), latestPlan('meal'), rangeWorkouts(weekStart(), dayKey())])
      .then(([workout, meal, w]) => { if (alive) { setPlans({ workout, meal }); setWeek(w) } })
      .catch(e => alive && setError(e.message))
    return () => { alive = false }
  }, [p.version])

  if (!plans) return error ? <p className="error">{error}</p> : null
  const byId = new Map(p.catalog.map(e => [e.id, e]))
  const row = plans[kind]
  const today = ORDER.indexOf(weekdayOf())

  return (
    <div className="stack">
      {error && <p className="error">{error}</p>}
      <div className="row">
        <div className="seg">
          {(['workout', 'meal'] as const).map(k => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>{k === 'workout' ? 'Workout' : 'Meals'}</button>
          ))}
        </div>
        {row && <span className="pill">{row.title}</span>}
      </div>
      {!row && <p className="muted">No {kind} plan yet. Ask APT for one.</p>}

      {row && kind === 'workout' && (
        <div className="cards">
          {[...(row.content as WorkoutPlan).days].sort((a, b) => ORDER.indexOf(a.weekday) - ORDER.indexOf(b.weekday)).map(d => {
            const idx = ORDER.indexOf(d.weekday)
            const session = week.find(w => w.day_name === d.name)
            const sets = session?.exercises.flatMap(x => x.sets) ?? []
            const planned = d.exercises.reduce((a, x) => a + x.sets, 0)
            const pct = session?.duration_min != null ? 100 : sets.length ? Math.round((sets.filter(s => s.done).length / sets.length) * 100) : 0
            const away = (idx - today + 7) % 7
            const pill = session?.duration_min != null ? 'Done' : away === 0 ? 'Today' : away === 1 ? 'Tomorrow' : `in ${away} days`
            const mins = Math.round(d.exercises.reduce((a, x) => a + x.sets * (x.rest_s + 45), 0) / 60)
            return (
              <div key={d.weekday} className="plan-card" style={{ '--tint': TINTS[idx] } as React.CSSProperties}>
                <span className="meta">{NAMES[d.weekday]}</span>
                <h3>{d.name}</h3>
                <div className="sub">{d.exercises.length} exercises · {planned} sets · ~{mins} min</div>
                <div className="label">Progress</div>
                <div className="bar"><i style={{ width: `${pct}%`, background: TINTS[idx] }} /></div>
                <div className="foot"><span className="meta">{pct}%</span><span className={'pill' + (away === 0 ? ' on' : '')}>{pill}</span></div>
                <details>
                  <summary>Exercises</summary>
                  {d.exercises.map((x, i) => (
                    <ExerciseRow key={i} x={x} ex={byId.get(x.exercise_id)} video={p.videos[x.exercise_id]} />
                  ))}
                </details>
              </div>
            )
          })}
        </div>
      )}

      {row && kind === 'meal' && (row.content as MealPlan).days.map(d => (
        <section key={d.weekday} className="tile">
          <Label meta={`${d.meals.reduce((a, m) => a + m.kcal, 0)} kcal`}>{NAMES[d.weekday]}</Label>
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
