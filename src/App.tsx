import { useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { sb, signIn, ensureProfile, loadProfile } from './db.ts'
import { getKey } from './ai.ts'
import { loadCatalog } from './catalog.ts'
import { Chat } from './Chat.tsx'
import { Today } from './views/Today.tsx'
import { Plan } from './views/Plan.tsx'
import { Settings } from './views/Settings.tsx'
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
  const [profile, setProfile] = useState<Profile>()
  const [data, setData] = useState<{ catalog: Exercise[]; videos: Videos }>()
  const [apiKey, setApiKey] = useState(getKey)
  const [version, setVersion] = useState(0)
  const [error, setError] = useState('')

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: auth } = sb.auth.onAuthStateChange((_event, s) => setSession(s))
    const onHash = () => setTab(tabFromHash())
    addEventListener('hashchange', onHash)
    const onVisible = () => { if (document.visibilityState === 'visible') setVersion(v => v + 1) }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      auth.subscription.unsubscribe()
      removeEventListener('hashchange', onHash)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  useEffect(() => { loadCatalog().then(setData).catch(e => setError(e.message)) }, [])

  const userId = session?.user.id
  const reload = useCallback(() => {
    if (userId) loadProfile().then(setProfile).catch(e => setError(e.message))
  }, [userId])
  useEffect(() => {
    if (userId) ensureProfile(userId).then(reload).catch(e => setError(e.message))
  }, [userId, reload])
  const bump = useCallback(() => { setVersion(v => v + 1); reload() }, [reload])

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
        <button className="primary" onClick={() => signIn().then(({ error }) => error && setError(error.message))}>Sign in with Google</button>
        {error && <p className="error">{error}</p>}
      </main>
    )
  }
  if (error) return <main className="gate"><p className="error">{error}</p></main>
  if (!profile || !data) return null

  const view =
    tab === 'today' ? <Today userId={session.user.id} profile={profile} version={version} onChange={bump} /> :
    tab === 'plan' ? <Plan catalog={data.catalog} videos={data.videos} version={version} /> :
    tab === 'settings' ? (
      <Settings key={profile.updated_at} userId={session.user.id} profile={profile} apiKey={apiKey}
        onKey={k => { setApiKey(k); bump() }} onChange={bump} />
    ) :
    <p className="muted">History lands in the next phase.</p>

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
        {!apiKey && tab !== 'settings' && <p className="notice">Add your Anthropic key in Settings to start.</p>}
        {view}
      </main>
      <aside className={chatOpen ? 'open' : ''}>
        <Chat userId={session.user.id} catalog={data.catalog} videos={data.videos} onChange={bump} />
      </aside>
      <button className="fab" onClick={() => setChatOpen(o => !o)} aria-label="Toggle chat">💬</button>
    </div>
  )
}
