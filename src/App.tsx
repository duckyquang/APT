import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { sb, signIn, ensureProfile } from './db.ts'

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

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: auth } = sb.auth.onAuthStateChange((_event, s) => setSession(s))
    const onHash = () => setTab(tabFromHash())
    addEventListener('hashchange', onHash)
    return () => {
      auth.subscription.unsubscribe()
      removeEventListener('hashchange', onHash)
    }
  }, [])

  const userId = session?.user.id
  useEffect(() => {
    if (userId) ensureProfile(userId).catch(console.error)
  }, [userId])

  if (session === undefined) return null
  if (!session) {
    return (
      <main className="gate">
        <h1>APT</h1>
        <p className="muted">A personal trainer that runs on your own API key.</p>
        <button className="primary" onClick={() => signIn()}>Sign in with Google</button>
      </main>
    )
  }

  return (
    <div className="shell">
      <header>
        <nav>
          {TABS.map(t => (
            <a key={t} href={'#' + t} aria-current={t === tab ? 'page' : undefined}>{t}</a>
          ))}
        </nav>
      </header>
      <main>{tab}</main>
      <aside className={chatOpen ? 'open' : ''}>chat</aside>
      <button className="fab" onClick={() => setChatOpen(o => !o)} aria-label="Toggle chat">💬</button>
    </div>
  )
}
