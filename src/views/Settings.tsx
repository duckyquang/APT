import { useEffect, useState, type FormEvent } from 'react'
import { MODELS, validateKey, setKey, errorMessage } from '../ai.ts'
import { updateProfile, signOut, resetDemo, DEMO } from '../db.ts'
import { applyProfile } from '../tools.ts'
import { WEEKDAYS, type Weekday } from '../dates.ts'
import { LEVELS, IN, toKg } from '../logic.ts'
import type { Profile } from '../types.ts'

export function Settings(p: { userId: string; profile: Profile; apiKey: string; onKey: (k: string) => void; onChange: () => void }) {
  const [key, setK] = useState(p.apiKey)
  const [keyStatus, setKeyStatus] = useState('')
  const [f, setF] = useState<Profile>(p.profile)
  const [dirty, setDirty] = useState<Set<keyof Profile>>(new Set())
  const [weight, setWeight] = useState('')
  const [status, setStatus] = useState('')
  const imperial = f.units === 'imperial'

  // the trainer can write the profile while this form is open; take its values for anything not being edited here
  useEffect(() => {
    setF(cur => ({ ...p.profile, ...Object.fromEntries([...dirty].map(k => [k, cur[k]])) }))
  }, [p.profile])

  const set = (k: keyof Profile, v: unknown) => {
    setF(cur => ({ ...cur, [k]: v }))
    setDirty(d => new Set(d).add(k))
  }
  const text = (k: keyof Profile) => (e: { target: { value: string } }) => set(k, e.target.value || null)

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
    try {
      await updateProfile(p.userId, { model })
      setF(cur => ({ ...cur, model }))
      p.onChange()
    } catch (e) {
      setStatus(errorMessage(e))
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    setStatus('')
    const patch = Object.fromEntries([...dirty].filter(k => k !== 'model').map(k => [k, f[k]])) as Partial<Profile>
    const w = weight ? toKg(+weight, imperial) : undefined
    try {
      await applyProfile(p.userId, patch, w)
      setDirty(new Set())
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
        <label>Name<input value={f.name ?? ''} onChange={text('name')} /></label>
        <label>Sex
          <select value={f.sex ?? ''} onChange={text('sex')}>
            <option value="">choose</option><option>male</option><option>female</option><option>other</option>
          </select>
        </label>
        <label>Birth date<input type="date" value={f.birth_date ?? ''} onChange={text('birth_date')} /></label>
        <label>Units
          <select value={f.units} onChange={e => set('units', e.target.value)}>
            <option value="metric">metric</option><option value="imperial">imperial</option>
          </select>
        </label>
        <label>Height ({imperial ? 'in' : 'cm'})
          <input type="number" step="any"
            value={f.height_cm == null ? '' : imperial ? Math.round(f.height_cm / IN) : f.height_cm}
            onChange={e => set('height_cm', e.target.value === '' ? null : imperial ? Math.round(+e.target.value * IN) : +e.target.value)} />
        </label>
        <label>Weigh-in today ({imperial ? 'lb' : 'kg'})
          <input type="number" step="any" value={weight} onChange={e => setWeight(e.target.value)} placeholder="blank to skip" />
        </label>
        <label>Goal<input value={f.goal ?? ''} onChange={text('goal')} placeholder="e.g. lose 5 kg by December" /></label>
        <label>Activity level
          <select value={f.activity_level ?? ''} onChange={text('activity_level')}>
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
        <label>Equipment<input value={f.equipment ?? ''} onChange={text('equipment')} placeholder="e.g. full gym, or dumbbells and a bench" /></label>
        <label>Injuries<input value={f.injuries ?? ''} onChange={text('injuries')} /></label>
        <label>Dietary preferences<input value={f.dietary_prefs ?? ''} onChange={text('dietary_prefs')} /></label>
        <div className="row">
          <button className="primary">Save profile</button>
          <small>{status}</small>
        </div>
      </form>

      {DEMO ? (
        <div className="row">
          <button type="button" onClick={() => signOut()}>Leave demo</button>
          <button type="button" className="ghost" onClick={() => { if (confirm('Erase all demo data in this browser?')) resetDemo() }}>Erase demo data</button>
        </div>
      ) : (
        <button type="button" onClick={() => signOut().catch(e => setStatus(errorMessage(e)))}>Sign out</button>
      )}
    </div>
  )
}
