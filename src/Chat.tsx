import { useEffect, useRef, useState } from 'react'
import { chatTurn, buildSystem, errorMessage, getKey } from './ai.ts'
import { trimWindow, missingFields } from './logic.ts'
import { loadMessages, insertMessages, clearChat, loadProfile, latestWeight, dayTotals, dayMeals, latestPlan, type MessageRow } from './db.ts'
import { makeToolRunner } from './tools.ts'
import { dayKey } from './dates.ts'
import type { Exercise, Videos, Block, Msg, ProviderId } from './types.ts'

function chip(b: Extract<Block, { type: 'tool_use' }>) {
  const i = b.input as Record<string, unknown>
  switch (b.name) {
    case 'update_profile': return `Updated profile: ${Object.keys(i).join(', ')}`
    case 'search_exercises': return `Searched exercises: ${[i.q, i.muscle, i.equipment].filter(Boolean).join(' ')}`
    case 'save_workout_plan': return `Saved workout plan: ${i.title}`
    case 'save_meal_plan': return `Saved meal plan: ${i.title}`
    case 'log_meal': return `Logged meal: ${i.name}`
    case 'log_water': return `Logged ${i.ml} ml water`
    case 'log_workout': return `Logged workout: ${i.day_name}`
    case 'get_history': return 'Checked history'
    default: return b.name
  }
}

function Bubble({ m }: { m: MessageRow }) {
  const blocks: Block[] = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content
  return (
    <>
      {blocks.map((b, i) => {
        if (b.type === 'text' && b.text.trim()) return <div key={i} className={'bubble ' + m.role}>{b.text}</div>
        if (b.type === 'tool_use') return <div key={i} className="chip">{chip(b)}</div>
        return null
      })}
    </>
  )
}

const KNOWN = new Set(['text', 'tool_use', 'tool_result'])
// stored rows may carry provider-specific blocks (Anthropic thinking); only the neutral ones go back out
const toMsg = (r: MessageRow): Msg => ({
  role: r.role,
  content: typeof r.content === 'string' ? [{ type: 'text', text: r.content }] : r.content.filter(b => KNOWN.has(b.type)),
})

export function Chat(p: { userId: string; provider: ProviderId; catalog: Exercise[]; videos: Videos; onChange: () => void }) {
  const [rows, setRows] = useState<MessageRow[]>([])
  const [draft, setDraft] = useState('')
  const [live, setLive] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const end = useRef<HTMLDivElement>(null)
  const hasKey = !!getKey(p.provider)

  useEffect(() => { loadMessages().then(setRows).catch(e => setError(e.message)) }, [])
  useEffect(() => { end.current?.scrollIntoView() }, [rows, live])

  async function send() {
    const text = draft.trim()
    if (!text || busy) return
    setDraft('')
    setError('')
    setBusy(true)
    try {
      const [userRow] = await insertMessages([{ role: 'user', content: [{ type: 'text', text }] }])
      const history = trimWindow([...rows, userRow].slice(-40).map(toMsg))
      setRows(r => [...r, userRow])
      const [profile, weight, totals, meals, workout, meal] = await Promise.all([
        loadProfile(), latestWeight(), dayTotals(dayKey()), dayMeals(dayKey()), latestPlan('workout'), latestPlan('meal'),
      ])
      const system = buildSystem({ profile, latestWeight: weight, totals, meals, workout, meal, missing: missingFields(profile, !!weight) })
      const runTool = makeToolRunner({ userId: p.userId, catalog: p.catalog, videos: p.videos, onChange: p.onChange })
      const stop = await chatTurn(profile.provider, getKey(profile.provider), {
        model: profile.model,
        system,
        history,
        runTool,
        onText: setLive,
        onRound: async (assistant, results) => {
          const saved = await insertMessages(results ? [assistant, results] : [assistant])
          setRows(r => [...r, ...saved])
          setLive('')
        },
      })
      if (stop === 'refusal') setError('The model declined to answer that.')
      if (stop === 'max_rounds') setError('Stopped after 8 tool calls. Ask again to continue.')
      if (stop === 'max_tokens') setError('That reply was cut off. Ask again to continue.')
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
      setLive('')
    }
  }

  async function clear() {
    if (!confirm('Delete the whole chat history?')) return
    try {
      await clearChat(p.userId)
      setRows([])
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <div className="chat">
      <div className="chat-head">
        <span className="label">Trainer</span>
        <button type="button" className="ghost" onClick={clear} disabled={busy || !rows.length}>Clear chat</button>
      </div>
      <div className="chat-log">
        {rows.length === 0 && !busy && <p className="muted">Say hi. APT will ask what it needs to know, then write your first week.</p>}
        {rows.map(m => <Bubble key={m.id} m={m} />)}
        {live && <div className="bubble assistant">{live}</div>}
        {busy && !live && <div className="muted">thinking…</div>}
        {error && <div className="error">{error}</div>}
        <div ref={end} />
      </div>
      <form className="chat-input" onSubmit={e => { e.preventDefault(); send() }}>
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder={hasKey ? 'Talk to your trainer' : 'Add your API key in Settings first'}
          disabled={busy || !hasKey}
        />
        <button className="primary" disabled={busy || !draft.trim()}>Send</button>
      </form>
    </div>
  )
}
