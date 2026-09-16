import { useState, type FormEvent } from 'react'
import { MODELS, validateKey, setKey, errorMessage } from '../ai.ts'
import { updateProfile, signOut } from '../db.ts'
import { applyProfile } from '../tools.ts'
import { WEEKDAYS, type Weekday } from '../dates.ts'
import type { Profile } from '../types.ts'

const LB = 0.45359237
const IN = 2.54
const LEVELS = ['sedentary', 'light', 'moderate', 'active', 'very active']

export function Settings(p: { userId: string; profile: Profile; apiKey: string; onKey: (k: string) => void; onChange: () => void }) {
  const [key, setK] = useState(p.apiKey)
  const [keyStatus, setKeyStatus] = useState('')
  const [f, setF] = useState<Profile>(p.profile)
  const [weight, setWeight] = useState('')
  const [status, setStatus] = useState('')
  const imperial = f.units === 'imperial'
  const set = (k: keyof Profile, v: unknown) => setF({ ...f, [k]: v })

  async function saveKey() {
    setKeyStatus('Checking…')
    const k = key.trim()
    try {
      await validateKey(k)
      setKey(k)
      p.onKey(k)
      setKeyStatus('Key works.')
    } catch (e) {
      setKeyStatus(errorMessage(e))
    }
  }

  async function changeModel(model: string) {
    await updateProfile(p.userId, { model })
    set('model', model)
    p.onChange()
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    setStatus('')
    const { user_id, onboarded_at, model, updated_at, ...patch } = f
    const w = weight ? (imperial ? +weight * LB : +weight) : undefined
    try {
      await applyProfile(p.userId, patch, w)
      setWeight('')
      p.onChange()
      setStatus('Saved.')
    } catch (err) {
      setStatus(errorMessage(err))
    }
  }

  const toggleDay = (d: Weekday) =>
    set('training_days', f.training_days.includes(d) ? f.training_days.filter(x => x !== d) : [...f.training_days, d])

  return (
    <div className="stack">
      <section className="tile">
        <h2>Anthropic API key</h2>
        <p className="muted">Stays in this browser only. Use a dedicated key with a spend limit. On a new device, paste it again.</p>
        <input type="password" value={key} onChange={e => setK(e.target.value)} placeholder="sk-ant-…" autoComplete="off" />
        <div className="row">
          <button className="primary" type="button" onClick={saveKey} disabled={!key.trim()}>Save key</button>
          <small>{keyStatus}</small>
        </div>
      </section>

      <section className="tile">
        <h2>Model</h2>
        <select value={f.model} onChange={e => changeModel(e.target.value)}>
          {MODELS.map(m => <option key={m}>{m}</option>)}
        </select>
        <small>Opus is the default. Sonnet is cheaper and dodges the rate limits new keys hit.</small>
      </section>

      <form className="tile stack" onSubmit={save}>
        <h2>Profile</h2>
        <label>Name<input value={f.name ?? ''} onChange={e => set('name', e.target.value)} /></label>
        <label>Sex
          <select value={f.sex ?? ''} onChange={e => set('sex', e.target.value || null)}>
            <option value="">choose</option><option>male</option><option>female</option><option>other</option>
          </select>
        </label>
        <label>Birth date<input type="date" value={f.birth_date ?? ''} onChange={e => set('birth_date', e.target.value || null)} /></label>
        <label>Units
          <select value={f.units} onChange={e => set('units', e.target.value)}>
            <option value="metric">metric</option><option value="imperial">imperial</option>
          </select>
        </label>
        <label>Height ({imperial ? 'in' : 'cm'})
          <input type="number" step="any"
            value={f.height_cm == null ? '' : imperial ? Math.round(f.height_cm / IN) : f.height_cm}
            onChange={e => set('height_cm', e.target.value === '' ? null : imperial ? +e.target.value * IN : +e.target.value)} />
        </label>
        <label>Weigh-in today ({imperial ? 'lb' : 'kg'})
          <input type="number" step="any" value={weight} onChange={e => setWeight(e.target.value)} placeholder="blank to skip" />
        </label>
        <label>Goal<input value={f.goal ?? ''} onChange={e => set('goal', e.target.value)} placeholder="e.g. lose 5 kg by December" /></label>
        <label>Activity level
          <select value={f.activity_level ?? ''} onChange={e => set('activity_level', e.target.value || null)}>
            <option value="">choose</option>{LEVELS.map(a => <option key={a}>{a}</option>)}
          </select>
        </label>
        <fieldset>
          <legend>Training days</legend>
          <div className="row wrap">
            {WEEKDAYS.map(d => (
              <label key={d} className="check">
                <input type="checkbox" checked={f.training_days.includes(d)} onChange={() => toggleDay(d)} />{d}
              </label>
            ))}
          </div>
        </fieldset>
        <label>Equipment<input value={f.equipment ?? ''} onChange={e => set('equipment', e.target.value)} placeholder="e.g. full gym, or dumbbells and a bench" /></label>
        <label>Injuries<input value={f.injuries ?? ''} onChange={e => set('injuries', e.target.value)} /></label>
        <label>Dietary preferences<input value={f.dietary_prefs ?? ''} onChange={e => set('dietary_prefs', e.target.value)} /></label>
        <div className="row">
          <button className="primary">Save profile</button>
          <small>{status}</small>
        </div>
      </form>

      <button type="button" onClick={() => signOut()}>Sign out</button>
    </div>
  )
}
