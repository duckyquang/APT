import { useEffect, useState, type CSSProperties, type FormEvent } from 'react'
import { PROVIDERS, validateKey, getKey, setKey, errorMessage } from '../ai.ts'
import { updateProfile, signOut, resetDemo, DEMO } from '../db.ts'
import { applyProfile } from '../tools.ts'
import { LEVELS, IN, toKg } from '../logic.ts'
import { Label } from './widgets.tsx'
import { Segmented, Stepper, Row, Chips, ModelPicker } from './controls.tsx'
import type { Profile, ProviderId } from '../types.ts'
import type { Weekday } from '../dates.ts'

const IDS = (Object.keys(PROVIDERS) as ProviderId[]).map(id => ({ value: id, label: PROVIDERS[id].label }))
const DAYS: { value: Weekday; label: string }[] = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun']]
  .map(([value, label]) => ({ value: value as Weekday, label }))
const mask = (k: string) => `${k.slice(0, 7)}…${k.slice(-4)}`
const accent = (c: string) => ({ '--accent': c } as CSSProperties)

export function Settings(p: { userId: string; profile: Profile; onChange: () => void }) {
  const [f, setF] = useState<Profile>(p.profile)
  const [dirty, setDirty] = useState<Set<keyof Profile>>(new Set())
  const [weight, setWeight] = useState<number | ''>('')
  const [status, setStatus] = useState('')
  const [keyDraft, setKeyDraft] = useState('')
  const [editingKey, setEditingKey] = useState(false)
  const [keyState, setKeyState] = useState<{ kind: '' | 'ok' | 'bad' | 'checking'; msg: string }>({ kind: '', msg: '' })
  const imperial = f.units === 'imperial'
  const savedKey = getKey(f.provider)
  const pending = dirty.size + (weight !== '' ? 1 : 0)

  // the trainer can write the profile while this form is open; take its values for anything not being edited here
  useEffect(() => {
    setF(cur => ({ ...p.profile, ...Object.fromEntries([...dirty].map(k => [k, cur[k]])) }))
  }, [p.profile])

  const set = (k: keyof Profile, v: unknown) => {
    setF(cur => ({ ...cur, [k]: v }))
    setDirty(d => new Set(d).add(k))
  }
  const text = (k: keyof Profile) => (e: { target: { value: string } }) => set(k, e.target.value || null)
  const toggleDay = (d: Weekday) =>
    set('training_days', f.training_days.includes(d) ? f.training_days.filter(x => x !== d) : [...f.training_days, d])

  async function saveKey() {
    const k = keyDraft.trim()
    setKeyState({ kind: 'checking', msg: '' })
    try {
      await validateKey(f.provider, k, f.model)
      setKey(f.provider, k)
      setKeyDraft('')
      setEditingKey(false)
      setKeyState({ kind: 'ok', msg: 'Key works.' })
      p.onChange()
    } catch (e) {
      setKeyState({ kind: 'bad', msg: errorMessage(e) })
    }
  }

  async function changeProvider(provider: ProviderId) {
    const model = PROVIDERS[provider].def
    try {
      await updateProfile(p.userId, { provider, model })
      setF(cur => ({ ...cur, provider, model }))
      setKeyDraft('')
      setEditingKey(!getKey(provider))
      setKeyState({ kind: '', msg: '' })
      p.onChange()
    } catch (e) {
      setStatus(errorMessage(e))
    }
  }

  async function changeModel(model: string) {
    if (model === f.model) return
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
    const patch = Object.fromEntries([...dirty].filter(k => k !== 'model' && k !== 'provider').map(k => [k, f[k]])) as Partial<Profile>
    const w = weight !== '' ? toKg(weight, imperial) : undefined
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

  function discard() {
    setF(p.profile)
    setDirty(new Set())
    setWeight('')
    setStatus('')
  }

  const keyPill = keyState.kind === 'ok' ? 'ok' : keyState.kind === 'bad' ? 'bad' : 'on'
  const keyText = keyState.kind === 'ok' ? 'works' : keyState.kind === 'bad' ? 'rejected' : 'saved'

  return (
    <form className="settings" onSubmit={save}>
      <section className="tile" style={accent('var(--purple)')}>
        <Label meta={f.model}>AI provider</Label>
        <Segmented value={f.provider} options={IDS} onChange={changeProvider} />
        <ModelPicker key={f.provider} models={PROVIDERS[f.provider].models} value={f.model} onChange={changeModel} />
        <Row label="API key" hint="Stays in this browser. Use a dedicated key with a spend limit.">
          {editingKey || !savedKey ? (
            <>
              <input type="password" value={keyDraft} onChange={e => setKeyDraft(e.target.value)} placeholder={`paste your ${PROVIDERS[f.provider].label} key`} autoComplete="off"
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (keyDraft.trim()) saveKey() } }} />
              <button type="button" className="primary" onClick={saveKey} disabled={!keyDraft.trim() || keyState.kind === 'checking'}>
                {keyState.kind === 'checking' ? 'Checking…' : 'Save key'}
              </button>
              {savedKey && <button type="button" className="ghost" onClick={() => { setEditingKey(false); setKeyState({ kind: '', msg: '' }) }}>Cancel</button>}
            </>
          ) : (
            <>
              <span className="mask">{mask(savedKey)}</span>
              <span className={'pill ' + keyPill}>{keyText}</span>
              <button type="button" className="ghost" onClick={() => { setKeyDraft(''); setEditingKey(true) }}>Change</button>
            </>
          )}
        </Row>
        {keyState.msg && <p className={keyState.kind === 'bad' ? 'error' : 'muted'}>{keyState.msg}</p>}
      </section>

      <section className="tile" style={accent('var(--blue)')}>
        <Label meta={f.onboarded_at ? 'complete' : 'in progress'}>About you</Label>
        <Row label="Name"><input value={f.name ?? ''} onChange={text('name')} placeholder="what APT should call you" /></Row>
        <Row label="Sex">
          <Segmented value={f.sex ?? ''} options={[{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }, { value: 'other', label: 'Other' }]} onChange={v => set('sex', v)} />
        </Row>
        <Row label="Birth date"><input type="date" value={f.birth_date ?? ''} onChange={text('birth_date')} style={{ maxWidth: 200 }} /></Row>
        <Row label="Units">
          <Segmented value={f.units} options={[{ value: 'metric', label: 'Metric' }, { value: 'imperial', label: 'Imperial' }]} onChange={v => set('units', v)} />
        </Row>
        <Row label="Height">
          <Stepper value={f.height_cm == null ? '' : imperial ? Math.round(f.height_cm / IN) : f.height_cm} unit={imperial ? 'in' : 'cm'} step={1}
            onChange={v => set('height_cm', v === '' ? null : imperial ? Math.round(v * IN) : v)} />
        </Row>
        <Row label="Weigh-in today" hint="leave blank to skip">
          <Stepper value={weight} unit={imperial ? 'lb' : 'kg'} step={0.5} onChange={setWeight} placeholder="–" />
        </Row>
        <Row label="Goal"><input value={f.goal ?? ''} onChange={text('goal')} placeholder="e.g. lose 5 kg by December" /></Row>
        <Row label="Activity">
          <Segmented value={f.activity_level ?? ''} options={LEVELS.map(l => ({ value: l as string, label: l }))} onChange={v => set('activity_level', v)} />
        </Row>
        <Row label="Training days"><Chips value={f.training_days} options={DAYS} onToggle={toggleDay} /></Row>
        <Row label="Equipment"><input value={f.equipment ?? ''} onChange={text('equipment')} placeholder="e.g. full gym, or dumbbells and a bench" /></Row>
        <Row label="Injuries"><input value={f.injuries ?? ''} onChange={text('injuries')} placeholder="anything the plan should work around" /></Row>
        <Row label="Diet"><input value={f.dietary_prefs ?? ''} onChange={text('dietary_prefs')} placeholder="e.g. vegetarian, no dairy" /></Row>
      </section>

      <section className="tile" style={accent('var(--muted)')}>
        <Label>Account</Label>
        <div className="row wrap">
          {DEMO ? (
            <>
              <button type="button" onClick={() => signOut()}>Leave demo</button>
              <button type="button" className="ghost" onClick={() => { if (confirm('Erase all demo data in this browser?')) resetDemo() }}>Erase demo data</button>
            </>
          ) : (
            <button type="button" onClick={() => signOut().catch(e => setStatus(errorMessage(e)))}>Sign out</button>
          )}
        </div>
      </section>

      {pending > 0 && (
        <div className="savebar">
          <span className="meta">{pending} unsaved {pending === 1 ? 'change' : 'changes'}</span>
          <div className="row">
            <button type="button" className="ghost" onClick={discard}>Discard</button>
            <button className="primary">Save changes</button>
          </div>
        </div>
      )}
      {status && <p className="muted" style={{ textAlign: 'center', marginTop: 10 }}>{status}</p>}
    </form>
  )
}
