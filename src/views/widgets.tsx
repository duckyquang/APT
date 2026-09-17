import type { CSSProperties, ReactNode } from 'react'
import type { HeatCell } from '../logic.ts'

// every tile sets --accent; labels, bars and chips pick it up from CSS
export const Label = ({ children, meta }: { children: ReactNode; meta?: ReactNode }) => (
  <div className="tile-head">
    <span className="label">{children}</span>
    {meta != null && <span className="meta">{meta}</span>}
  </div>
)

export const Big = ({ value, unit }: { value: ReactNode; unit?: string }) => (
  <div className="big">{value}{unit && <small>{unit}</small>}</div>
)

export function Delta({ value, unit, label }: { value: number; unit: string; label: string }) {
  const dir = value > 0 ? 'up' : value < 0 ? 'down' : ''
  return <div className={'delta ' + dir}>{value > 0 ? '↑' : value < 0 ? '↓' : '→'} {Math.abs(value)} {unit} {label}</div>
}

type Point = { label: string; value: number; today?: boolean }

export function Bars({ points, unit }: { points: Point[]; unit: string }) {
  const max = Math.max(1, ...points.map(p => p.value))
  return (
    <div className="bars">
      {points.map(p => (
        <i key={p.label} className={(p.value ? '' : 'dim ') + (p.today ? 'today' : '')}
          style={{ height: `${Math.max(6, (p.value / max) * 100)}%` }} title={`${p.label}: ${Math.round(p.value)} ${unit}`} />
      ))}
    </div>
  )
}

export function Spark({ points, unit }: { points: Point[]; unit: string }) {
  if (!points.length) return <div className="spark empty" />
  const vals = points.map(p => p.value)
  const lo = Math.min(...vals)
  const hi = Math.max(...vals)
  return (
    <div className="spark">
      {points.map((p, i) => (
        <i key={p.label} className={i === points.length - 1 ? 'last' : ''}
          style={{ height: `${hi === lo ? 60 : 20 + ((p.value - lo) / (hi - lo)) * 80}%` }} title={`${p.label}: ${p.value} ${unit}`} />
      ))}
    </div>
  )
}

export function Segments({ value, max, n = 12 }: { value: number; max: number; n?: number }) {
  const on = Math.round(Math.min(1, value / Math.max(1, max)) * n)
  return <div className="segs">{Array.from({ length: n }, (_, i) => <i key={i} className={i < on ? 'on' : ''} />)}</div>
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function Heat({ cols }: { cols: HeatCell[][] }) {
  return (
    <>
      <div className="heat">
        {DAYS.map((d, r) => [
          <span key={d} className="day">{d}</span>,
          ...cols.map((c, w) => <i key={`${w}-${r}`} className={`l${c[r].level}`} title={`${c[r].date}: ${['nothing', 'logged', 'workout'][c[r].level]}`} />),
        ])}
      </div>
      <div className="legend"><span><i />nothing</span><span><i className="l1" />logged</span><span><i className="l2" />workout</span></div>
    </>
  )
}

export function Stat({ icon, color, label, value, unit }: { icon: string; color: string; label: string; value: ReactNode; unit?: string }) {
  return (
    <div className="stat" style={{ '--c': color } as CSSProperties}>
      <span className="icon" aria-hidden="true">{icon}</span>
      <span>{label}</span>
      <span className="value">{value}{unit && <small>{unit}</small>}</span>
    </div>
  )
}
