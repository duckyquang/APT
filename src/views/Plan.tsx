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
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    Promise.all([latestPlan('workout'), latestPlan('meal')])
      .then(([workout, meal]) => alive && setPlans({ workout, meal }))
      .catch(e => alive && setError(e.message))
    return () => { alive = false }
  }, [p.version])

  if (!plans) return error ? <p className="error">{error}</p> : null
  const byId = new Map(p.catalog.map(e => [e.id, e]))
  const row = plans[kind]

  return (
    <div className="stack">
      {error && <p className="error">{error}</p>}
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
