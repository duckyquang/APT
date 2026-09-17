import { useEffect, useState, type CSSProperties } from 'react'
import { signIn, ensureProfile, loadProfile, getSession, onAuthChange, startDemo, DEMO, SUPABASE_URL } from './db.ts'
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

const CHAT = 'apt.chat'
const desktop = () => matchMedia('(min-width: 901px)').matches

export function App() {
  const [session, setSession] = useState<{ user: { id: string } } | null>()
  const [tab, setTab] = useState<Tab>(tabFromHash)
  const [chatOpen, setChatOpen] = useState(() => { try { return desktop() && localStorage.getItem(CHAT) !== '0' } catch { return false } })
  const [ready, setReady] = useState(false)
  const [profile, setProfile] = useState<Profile>()
  const [data, setData] = useState<{ catalog: Exercise[]; videos: Videos }>()
  const [version, setVersion] = useState(0)
  const [error, setError] = useState('')
  const bump = () => setVersion(v => v + 1)
  const toggleChat = () => setChatOpen(o => { try { localStorage.setItem(CHAT, o ? '0' : '1') } catch {} return !o })

  useEffect(() => {
    getSession().then(setSession)
    const offAuth = onAuthChange(setSession)
    const onHash = () => setTab(tabFromHash())
    addEventListener('hashchange', onHash)
    const onVisible = () => { if (document.visibilityState === 'visible') bump() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      offAuth()
      removeEventListener('hashchange', onHash)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  useEffect(() => { loadCatalog().then(setData).catch(e => setError(e.message)) }, [])

  const userId = session?.user.id
  useEffect(() => {
    setReady(false)
    setProfile(undefined)
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
  const keyOk = !!profile && !!getKey(profile.provider)
  useEffect(() => {
    if (!profile) return
    if (!keyOk || !onboarded) {
      location.hash = '#settings'
      setChatOpen(keyOk && !onboarded)
    }
  }, [profile?.user_id, keyOk])

  if (session === undefined) return null
  if (!session) {
    const configured = !SUPABASE_URL.includes('YOUR-PROJECT')
    return (
      <main className="gate">
        <h1 className="wordmark">APT</h1>
        <p className="muted">A personal trainer that runs on your own API key.</p>
        <div className="features">
          <div className="tile" style={{ '--accent': 'var(--orange)' } as CSSProperties}><b>PLANS</b>written from a real conversation</div>
          <div className="tile" style={{ '--accent': 'var(--teal)' } as CSSProperties}><b>MEALS</b>calories and macros from a photo</div>
          <div className="tile" style={{ '--accent': 'var(--purple)' } as CSSProperties}><b>PROGRESS</b>a daily photo, then a video</div>
        </div>
        <div className="cta">
          {configured && <button className="primary" onClick={() => signIn().then(({ error }) => error && setError(error))}>Sign in with Google</button>}
          <button className={configured ? '' : 'primary'} type="button" onClick={startDemo}>Try the demo</button>
        </div>
        <p className="muted">The demo keeps everything in this browser. You still bring your own API key.</p>
        {error && <p className="error">{error}</p>}
      </main>
    )
  }
  if (!profile) {
    return error ? (
      <main className="gate">
        <p className="error">{error}</p>
        <button type="button" onClick={() => location.reload()}>Try again</button>
      </main>
    ) : null
  }

  const view =
    tab === 'today' ? <Today userId={session.user.id} profile={profile} version={version} onChange={bump} /> :
    tab === 'plan' ? (data ? <Plan catalog={data.catalog} videos={data.videos} version={version} /> : <p className="muted">Loading exercises…</p>) :
    tab === 'settings' ? <Settings userId={session.user.id} profile={profile} onChange={bump} /> :
    <History imperial={profile.units === 'imperial'} version={version} />

  return (
    <div className={'shell ' + (chatOpen ? 'chat-open' : 'chat-closed')}>
      <header>
        <nav>
          <a className="wordmark" href="#today">APT</a>
          {TABS.map(t => (
            <a key={t} href={'#' + t} aria-current={t === tab ? 'page' : undefined}>{t}</a>
          ))}
          <span className="end">
            {DEMO && <span className="pill">demo</span>}
            <button type="button" className="chat-toggle" aria-pressed={chatOpen} onClick={toggleChat}>Chat</button>
          </span>
        </nav>
      </header>
      <main className={tab}>
        {error && <p className="notice error" onClick={() => setError('')}>{error}</p>}
        {!keyOk && tab !== 'settings' && <p className="notice">Add your API key in Settings to start.</p>}
        {view}
      </main>
      <aside inert={!chatOpen}>
        <div className="aside-in">
          {data ? <Chat userId={session.user.id} provider={profile.provider} catalog={data.catalog} videos={data.videos} onChange={bump} /> : <p className="muted" style={{ padding: 16 }}>Loading exercises…</p>}
        </div>
      </aside>
    </div>
  )
}
