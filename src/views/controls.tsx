import { useState, type ReactNode } from 'react'
import type { ModelOption } from '../types.ts'

export function Segmented<T extends string>(p: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="radiogroup">
      {p.options.map(o => (
        <button key={o.value} type="button" role="radio" aria-checked={p.value === o.value} className={p.value === o.value ? 'on' : ''} onClick={() => p.onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  )
}

export function Stepper(p: { value: number | ''; onChange: (v: number | '') => void; step?: number; min?: number; unit: string; placeholder?: string }) {
  const step = p.step ?? 1
  const num = typeof p.value === 'number' ? p.value : 0
  const round = (n: number) => Math.round(n / step) * step
  const bump = (d: number) => p.onChange(Math.max(p.min ?? 0, +round(num + d * step).toFixed(2)))
  return (
    <div className="stepper">
      <button type="button" aria-label="decrease" onClick={() => bump(-1)}>−</button>
      <input type="number" step={step} inputMode="decimal" value={p.value} placeholder={p.placeholder}
        onChange={e => p.onChange(e.target.value === '' ? '' : +e.target.value)} />
      <button type="button" aria-label="increase" onClick={() => bump(1)}>+</button>
      <span className="unit">{p.unit}</span>
    </div>
  )
}

export function Row(p: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="srow">
      <div><div className="rlabel">{p.label}</div>{p.hint && <div className="rhint">{p.hint}</div>}</div>
      <div className="rctl">{p.children}</div>
    </div>
  )
}

export function Chips<T extends string>(p: { value: T[]; options: { value: T; label: string }[]; onToggle: (v: T) => void }) {
  return (
    <div className="chips">
      {p.options.map(o => (
        <button key={o.value} type="button" aria-pressed={p.value.includes(o.value)} className={p.value.includes(o.value) ? 'on' : ''} onClick={() => p.onToggle(o.value)}>{o.label}</button>
      ))}
    </div>
  )
}

export function ModelPicker(p: { models: ModelOption[]; value: string; onChange: (id: string) => void }) {
  const known = p.models.some(m => m.id === p.value)
  const [custom, setCustom] = useState(known ? '' : p.value)
  const [editing, setEditing] = useState(!known)
  return (
    <div className="models">
      {p.models.map(m => (
        <button key={m.id} type="button" className={'model' + (p.value === m.id ? ' on' : '')} onClick={() => { setEditing(false); p.onChange(m.id) }}>
          <b>{m.name}</b>
          <span>{m.blurb}</span>
          <em className={'tier ' + m.tier}>{m.tier}</em>
        </button>
      ))}
      <div className={'model custom' + (!known ? ' on' : '')}>
        {editing ? (
          <>
            <b>Custom id</b>
            <input value={custom} onChange={e => setCustom(e.target.value)} placeholder="model id" autoComplete="off" spellCheck={false}
              onBlur={() => custom.trim() && p.onChange(custom.trim())} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); custom.trim() && p.onChange(custom.trim()) } }} />
          </>
        ) : (
          <button type="button" className="ghost" onClick={() => setEditing(true)}>{known ? 'Use a different model id…' : `Custom: ${p.value}`}</button>
        )}
      </div>
    </div>
  )
}
