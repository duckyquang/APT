import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { sb, signIn, ensureProfile, loadProfile, SUPABASE_URL } from './db.ts'
import { getKey } from './ai.ts'
import { loadCatalog } from './catalog.ts'
import { Chat } from './Chat.tsx'
import { Today } from './views/Today.tsx'
import { Plan } from './views/Plan.tsx'
import { Settings } from './views/Settings.tsx'
import { History } from './views/History.tsx'
import type { Exercise, Videos, Profile } from './types.ts'

export const TABS = ['today', 'plan', 'history', 'settings'] as const
export type Tab = (typeof TABS)[number]

export function tabFromHash(hash = location.hash): Tab {
  const h = hash.slice(1) as Tab
  return TABS.includes(h) ? h : 'today'
}

export function App() {
  const [session, setSession] = useState<Session | null>()
  const [tab, setTab] = useState<Tab>(tabFromHash)
  const [chatOpen, setChatOpen] = useState(false)
  const [ready, setReady] = useState(false)
  const [profile, setProfile] = useState<Profile>()
  const [data, setData] = useState<{ catalog: Exercise[]; videos: Videos }>()
  const [apiKey, setApiKey] = useState(getKey)
  const [version, setVersion] = useState(0)
  const [error, setError] = useState('')
  const bump = () => setVersion(v => v + 1)

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: auth } = sb.auth.onAuthStateChange((_event, s) => setSession(s))
    const onHash = () => setTab(tabFromHash())
    addEventListener('hashchange', onHash)
    const onVisible = () => { if (document.visibilityState === 'visible') bump() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      auth.subscription.unsubscribe()
      removeEventListener('hashchange', onHash)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  useEffect(() => { loadCatalog().then(setData).catch(e => setError(e.message)) }, [])

  const userId = session?.user.id
  useEffect(() => {
    setReady(false)
    if (userId) ensureProfile(userId).then(() => setReady(true)).catch(e => setError(e.message))
  }, [userId])

  useEffect(() => {
    if (!ready) return
    let alive = true
    loadProfile().then(p => alive && setProfile(p)).catch(e => alive && setError(e.message))
    return () => { alive = false }
  }, [ready, version])

  // first run: no key means Settings; key but not onboarded means Settings with the chat open
  const onboarded = !!profile?.onboarded_at
  useEffect(() => {
    if (!profile) return
    if (!apiKey || !onboarded) {
      location.hash = '#settings'
      setChatOpen(!!apiKey && !onboarded)
    }
  }, [profile?.user_id, apiKey])

  if (session === undefined) return null
  if (!session) {
    return (
      <main className="gate">
        <h1>APT</h1>
        <p className="muted">A personal trainer that runs on your own API key.</p>
        {SUPABASE_URL.includes('YOUR-PROJECT') ? (
          <p className="muted">No Supabase project wired up yet. See PLAN.md, Phase 0.</p>
        ) : (
          <button className="primary" onClick={() => signIn().then(({ error }) => error && setError(error.message))}>Sign in with Google</button>
        )}
        {error && <p className="error">{error}</p>}
      </main>
    )
  }
  if (!profile) {
    return error ? (
      <main className="gate">
        <p className="error">{error}</p>
        <button type="button" onClick={() => { setError(''); bump() }}>Try again</button>
      </main>
    ) : null
  }

  const view =
    tab === 'today' ? <Today userId={session.user.id} profile={profile} version={version} onChange={bump} /> :
    tab === 'plan' ? (data ? <Plan catalog={data.catalog} videos={data.videos} version={version} /> : <p className="muted">Loading exercises…</p>) :
    tab === 'settings' ? (
      <Settings userId={session.user.id} profile={profile} apiKey={apiKey} onKey={k => { setApiKey(k); bump() }} onChange={bump} />
    ) :
    <History imperial={profile.units === 'imperial'} version={version} />

  return (
    <div className="shell">
      <header>
        <nav>
          {TABS.map(t => (
            <a key={t} href={'#' + t} aria-current={t === tab ? 'page' : undefined}>{t}</a>
          ))}
        </nav>
      </header>
      <main>
        {error && <p className="notice error" onClick={() => setError('')}>{error}</p>}
        {!apiKey && tab !== 'settings' && <p className="notice">Add your Anthropic key in Settings to start.</p>}
        {view}
      </main>
      <aside className={chatOpen ? 'open' : ''}>
        {data ? <Chat userId={session.user.id} catalog={data.catalog} videos={data.videos} onChange={bump} /> : <p className="muted">Loading exercises…</p>}
      </aside>
      <button className="fab" onClick={() => setChatOpen(o => !o)} aria-label="Toggle chat">💬</button>
    </div>
  )
}
