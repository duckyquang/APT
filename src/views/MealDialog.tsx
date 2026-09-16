import { useEffect, useMemo, useRef, useState } from 'react'
import type { MealEstimate } from '../types.ts'
import { errorMessage } from '../ai.ts'

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
  const [err, setErr] = useState('')
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
    setErr('')
    try { await p.onSave(name.trim() || 'Meal', { ...est, totals: t }) } catch (e) { setErr(errorMessage(e)) } finally { setSaving(false) }
  }

  return (
    <dialog ref={ref} className="sheet" onClose={p.onClose}>
      <div className="stack">
        <div className="row"><h2>Log a meal</h2><button type="button" className="ghost" onClick={p.onClose}>Close</button></div>
        {preview && <img className="preview" src={preview} alt="" />}
        {p.analyzing && <p className="muted">Looking at the photo…</p>}
        {(p.error || err) && <p className="error">{p.error || err}</p>}
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
