import { useEffect, useState } from 'react'

export const TABS = ['today', 'plan', 'history', 'settings'] as const
export type Tab = (typeof TABS)[number]

export function tabFromHash(hash = location.hash): Tab {
  const h = hash.slice(1) as Tab
  return TABS.includes(h) ? h : 'today'
}

export function App() {
  const [tab, setTab] = useState<Tab>(tabFromHash)
  const [chatOpen, setChatOpen] = useState(false)

  useEffect(() => {
    const onHash = () => setTab(tabFromHash())
    addEventListener('hashchange', onHash)
    return () => removeEventListener('hashchange', onHash)
  }, [])

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
