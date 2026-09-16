import { useEffect, useState } from 'react'
import { rangeTotals, rangeWorkouts, rangeMeals, rangePhotos, signedUrls } from '../db.ts'
import { dayKey } from '../dates.ts'
import type { DailyTotals, WorkoutRow, MealRow } from '../types.ts'
import { makeVideo } from '../video.ts'

const month = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
const dayLabel = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })

export function History(p: { version: number }) {
  const [totals, setTotals] = useState<DailyTotals[]>([])
  const [workouts, setWorkouts] = useState<WorkoutRow[]>([])
  const [meals, setMeals] = useState<MealRow[]>([])
  const [photos, setPhotos] = useState<{ date: string; url: string }[]>([])
  const [error, setError] = useState('')
  const [video, setVideo] = useState<{ blob: Blob; url: string } | null>(null)
  const [rendering, setRendering] = useState(0)

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

  async function render() {
    setError('')
    setRendering(1)
    try {
      const blob = await makeVideo(photos.map(x => ({ url: x.url, label: x.date })), setRendering)
      setVideo(v => { if (v) URL.revokeObjectURL(v.url); return { blob, url: URL.createObjectURL(blob) } })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRendering(0)
    }
  }

  function share() {
    if (!video) return
    const ext = video.blob.type.includes('mp4') ? 'mp4' : 'webm'
    const file = new File([video.blob], `transformation.${ext}`, { type: video.blob.type })
    if (navigator.canShare?.({ files: [file] })) {
      navigator.share({ files: [file] }).catch(() => {})
    } else {
      const a = document.createElement('a')
      a.href = video.url
      a.download = file.name
      a.click()
    }
  }

  const months = [...new Set(totals.map(t => t.date.slice(0, 7)))]

  return (
    <div className="stack">
      {error && <p className="error">{error}</p>}
      {photos.length > 0 && (
        <section className="tile">
          <h2>Progress</h2>
          <div className="strip">{photos.map(x => <figure key={x.date}><img src={x.url} alt="" loading="lazy" /><figcaption className="muted">{x.date.slice(5)}</figcaption></figure>)}</div>
          <div className="row wrap">
            <button type="button" onClick={render} disabled={photos.length < 2 || rendering > 0}>
              {rendering > 0 ? `Rendering ${rendering}/${photos.length}, keep this tab open` : 'Make video'}
            </button>
            {video && <button type="button" className="primary" onClick={share}>Share or save</button>}
          </div>
          {photos.length < 2 && <p className="muted">Two or more days of photos make a video.</p>}
          {video && <video className="preview" src={video.url} controls playsInline />}
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
