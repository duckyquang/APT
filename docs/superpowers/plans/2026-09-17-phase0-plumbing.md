# Phase 0: Plumbing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deployable dark shell on GitHub Pages with Google sign-in, hash tabs, the Supabase schema, and a green deploy workflow.

**Architecture:** Vite + React SPA at `https://duckyquang.github.io/APT/`. Supabase (Auth, Postgres with RLS, private Storage) is the only backend. No router, no state library, no CSS framework. Everything the spec calls a "decision" lives in `/Users/buno/Documents/coding/APT/PLAN.md`; this plan implements its Phase 0.

**Tech Stack:** Node 22, Vite 8.3.0, React 19.3.0, TypeScript 5.9.3, @supabase/supabase-js 2.116.0, Supabase CLI (local stack for schema verification), GitHub Actions Pages deploy.

## Global Constraints

- Repo: `/Users/buno/Documents/coding/APT`, branch `main`, remote `origin` = `https://github.com/duckyquang/APT.git`. Push directly to main after each task's commit. No PRs.
- Git identity must be `Quang Bui <157789469+duckyquang@users.noreply.github.com>` (already set globally; verify with `git config user.name`). No AI attribution anywhere in commit messages.
- Runtime dependencies are exactly: `react`, `react-dom`, `@supabase/supabase-js` (and `@anthropic-ai/sdk` from Phase 1). Nothing else. Pin exact versions (no `^`).
- No router, no state library, no Tailwind, no component library, no markdown renderer, no zod.
- Vite `base` is `'/APT/'`. Views are a `location.hash` switch: `#today` `#plan` `#history` `#settings`.
- All dates stored as the device's local `YYYY-MM-DD` via `dayKey()` from `src/dates.ts`. Never `toISOString().slice(0,10)`.
- Supabase URL and publishable key are literals at the top of `src/db.ts`. Both are public by design. Never a service-role / `sb_secret_` key anywhere.
- Every table has RLS with one `own_rows` policy. No triggers. No database functions.
- Code style: match the existing tone; no docstrings on obvious code; short natural names; no `TODO` noise. Mark deliberate shortcuts with a `// ponytail:` comment.
- `npm run check` must pass before every commit.

---

### Task 1: Scaffold and shell

**Files:**
- Create: `package.json` (via npm), `tsconfig.json`, `vite.config.ts`, `index.html`, `.gitignore`, `src/main.tsx`, `src/App.tsx`, `src/app.css`, `public/manifest.json`

**Interfaces:**
- Produces: `App` component exported from `src/App.tsx`; CSS tokens `--bg --surface --surface2 --fg --muted --line --r --r-lg --r-xl`; classes `.shell .gate .fab button.primary`; tab type `Tab = 'today'|'plan'|'history'|'settings'`.

- [ ] **Step 1: Create package.json with pinned deps**

```bash
cd /Users/buno/Documents/coding/APT
npm init -y >/dev/null
npm pkg set name=apt private=true type=module version=0.0.0
npm pkg delete main description keywords author license
npm pkg set scripts.dev=vite scripts.build="vite build" scripts.preview="vite preview" scripts.check="tsc --noEmit"
npm install --save-exact react@19.3.0 react-dom@19.3.0 @supabase/supabase-js@2.116.0
npm install --save-exact -D vite@8.3.0 @vitejs/plugin-react@6.1.1 typescript@5.9.3 @types/react@19 @types/react-dom@19
```

Expected: `package.json` lists the three runtime deps and five dev deps with exact versions; `package-lock.json` exists.

- [ ] **Step 2: Write tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "types": ["vite/client"]
  },
  "include": ["src"],
  "exclude": ["src/**/*.test.ts"]
}
```

- [ ] **Step 3: Write vite.config.ts**

The CSP meta tag is injected only on `build`, because the React plugin's dev preamble is an inline script that a strict CSP would block.

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self' https://api.anthropic.com https://*.supabase.co",
  "img-src 'self' blob: data: https://*.supabase.co https://raw.githubusercontent.com",
  "frame-src https://www.youtube-nocookie.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

export default defineConfig(({ command }) => ({
  base: '/APT/',
  plugins: [
    react(),
    {
      name: 'csp',
      transformIndexHtml: () =>
        command === 'build'
          ? [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: csp }, injectTo: 'head-prepend' as const }]
          : [],
    },
  ],
}))
```

- [ ] **Step 4: Write index.html**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#000000" />
    <meta name="color-scheme" content="dark" />
    <link rel="manifest" href="manifest.json" />
    <title>APT</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Write public/manifest.json**

`display` is `browser` on purpose: a standalone iOS web app plus a Google OAuth redirect is a known way to lose the session on the way back.

```json
{
  "name": "APT",
  "short_name": "APT",
  "display": "browser",
  "start_url": "/APT/#today",
  "background_color": "#000000",
  "theme_color": "#000000",
  "icons": []
}
```

- [ ] **Step 6: Write .gitignore**

```
node_modules
dist
.DS_Store
```

- [ ] **Step 7: Write src/main.tsx**

```tsx
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import './app.css'

createRoot(document.getElementById('root')!).render(<App />)
```

- [ ] **Step 8: Write src/App.tsx (shell only, auth comes in Task 4)**

```tsx
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
```

- [ ] **Step 9: Write src/app.css**

```css
:root {
  --bg: #000;
  --surface: #111;
  --surface2: #1c1c1e;
  --fg: #fff;
  --muted: #8e8e93;
  --line: rgba(255, 255, 255, 0.12);
  --r: 12px;
  --r-lg: 16px;
  --r-xl: 20px;
  color-scheme: dark;
  font-family: -apple-system, "SF Pro Text", Inter, system-ui, sans-serif;
  font-size: 17px;
  line-height: 1.4;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); -webkit-font-smoothing: antialiased; }
h1 { font-size: 34px; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 8px; }
h2 { font-size: 22px; font-weight: 600; margin: 0 0 8px; }
h3 { font-size: 17px; font-weight: 600; margin: 0 0 4px; }
p { margin: 0 0 8px; }
small, .muted { color: var(--muted); font-size: 13px; }
a { color: inherit; }
button {
  font: inherit; color: var(--fg); background: var(--surface2);
  border: 1px solid var(--line); border-radius: var(--r); padding: 10px 16px; cursor: pointer;
}
button.primary { background: var(--fg); color: var(--bg); border-color: var(--fg); }
button:disabled { opacity: 0.5; cursor: default; }
input, textarea, select {
  font: inherit; color: var(--fg); background: var(--surface);
  border: 1px solid var(--line); border-radius: var(--r); padding: 10px 12px; width: 100%;
}

.gate { min-height: 100dvh; display: grid; place-content: center; text-align: center; gap: 16px; padding: 24px; }

.shell { display: grid; grid-template-columns: 1fr 380px; grid-template-rows: auto 1fr; min-height: 100dvh; }
.shell header {
  grid-column: 1 / -1; position: sticky; top: 0; z-index: 2;
  padding: 12px 20px; padding-top: calc(12px + env(safe-area-inset-top, 0px));
  border-bottom: 1px solid var(--line); background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
}
.shell nav { display: flex; gap: 4px; }
.shell nav a { text-decoration: none; text-transform: capitalize; color: var(--muted); padding: 6px 12px; border-radius: 999px; font-size: 15px; }
.shell nav a[aria-current] { color: var(--fg); background: var(--surface2); }
.shell main { padding: 20px; padding-bottom: calc(20px + env(safe-area-inset-bottom, 0px)); max-width: 760px; width: 100%; justify-self: center; }
.shell aside { border-left: 1px solid var(--line); background: var(--surface); display: flex; flex-direction: column; min-height: 0; }
.fab { display: none; }

@media (max-width: 900px) {
  .shell { grid-template-columns: 1fr; }
  .shell aside {
    position: fixed; inset: auto 0 0 0; height: 80dvh; z-index: 3;
    border-left: 0; border-top: 1px solid var(--line); border-radius: var(--r-xl) var(--r-xl) 0 0;
    transform: translateY(100%); transition: transform 0.2s ease-out;
  }
  .shell aside.open { transform: none; }
  .fab {
    display: block; position: fixed; right: 16px; bottom: calc(16px + env(safe-area-inset-bottom, 0px)); z-index: 4;
    width: 56px; height: 56px; border-radius: 50%; padding: 0; font-size: 24px;
  }
}
@media (prefers-reduced-motion: reduce) { .shell aside { transition: none; } }
```

- [ ] **Step 10: Type-check and build**

Run: `npm run check && npm run build`
Expected: tsc exits 0; `dist/index.html` exists and contains `Content-Security-Policy`, `/APT/assets/`, and `manifest.json`. Confirm with:

```bash
grep -c 'Content-Security-Policy' dist/index.html   # 1
grep -o '/APT/assets/[^"]*' dist/index.html | head -2
grep -o 'manifest.json' dist/index.html             # manifest.json
```

If `npm run build` fails on the `injectTo: 'head-prepend' as const` line, replace the plugin's return with `[{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: csp }, injectTo: 'head-prepend' }]` and add `// @ts-expect-error` above it only if tsc complains.

- [ ] **Step 11: Commit and push**

```bash
git add -A && git commit -m "Scaffold Vite app with dark shell and hash tabs" && git push
```

---

### Task 2: Date helpers with a runnable check

**Files:**
- Create: `src/dates.ts`, `src/dates.test.ts`
- Modify: `package.json` (check script)

**Interfaces:**
- Produces: `dayKey(d?: Date): string` (local `YYYY-MM-DD`), `weekdayOf(d?: Date): Weekday`, `WEEKDAYS` tuple `['sun','mon','tue','wed','thu','fri','sat']`, type `Weekday`.

- [ ] **Step 1: Write the failing test**

`src/dates.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dayKey, weekdayOf } from './dates.ts'

test('dayKey is the local calendar date, not UTC', () => {
  assert.equal(dayKey(new Date(2026, 0, 31, 23, 30)), '2026-01-31')
  assert.equal(dayKey(new Date(2026, 8, 5, 0, 5)), '2026-09-05')
})

test('weekdayOf', () => {
  assert.equal(weekdayOf(new Date(2026, 8, 17)), 'thu')
  assert.equal(weekdayOf(new Date(2026, 8, 20)), 'sun')
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test src/dates.test.ts`
Expected: FAIL, cannot find module `./dates.ts`.

- [ ] **Step 3: Write src/dates.ts**

```ts
export const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const
export type Weekday = (typeof WEEKDAYS)[number]

// local calendar date; toISOString would be UTC and put a late dinner on tomorrow
export function dayKey(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function weekdayOf(d = new Date()): Weekday {
  return WEEKDAYS[d.getDay()]
}
```

- [ ] **Step 4: Run the test and add it to `check`**

Run: `node --test src/dates.test.ts`
Expected: 2 passing.

Then: `npm pkg set scripts.check="tsc --noEmit && node --test src/*.test.ts"` and run `npm run check`. Expected: tsc clean, 2 passing.

- [ ] **Step 5: Commit and push**

```bash
git add -A && git commit -m "Add local date helpers" && git push
```

---

### Task 3: Supabase schema, verified on a local stack

**Files:**
- Create: `supabase/schema.sql`

**Interfaces:**
- Produces: tables `profiles plans workouts meals water daily_logs messages`, view `daily_totals`, buckets `meals` and `progress`, exactly as in PLAN.md's data model.

- [ ] **Step 1: Write supabase/schema.sql**

```sql
-- APT schema. Run once in the Supabase SQL editor of a fresh project.

create table public.profiles (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  name text,
  sex text,
  birth_date date,
  height_cm numeric,
  goal text,
  activity_level text,
  training_days text[] not null default '{}',
  equipment text,
  injuries text,
  dietary_prefs text,
  targets jsonb not null default '{"water_ml": 2500}',
  units text not null default 'metric',
  model text not null default 'claude-opus-5',
  onboarded_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('workout', 'meal')),
  title text,
  content jsonb not null,
  created_at timestamptz not null default now()
);
create index plans_latest on public.plans (user_id, kind, created_at desc);

create table public.workouts (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  plan_id uuid references public.plans(id) on delete set null,
  day_name text,
  exercises jsonb not null default '[]',
  duration_min int,
  notes text,
  created_at timestamptz not null default now()
);
create index workouts_by_day on public.workouts (user_id, date desc);

create table public.meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  eaten_at timestamptz not null default now(),
  photo_path text,
  name text,
  items jsonb not null default '[]',
  kcal int not null default 0,
  protein_g numeric not null default 0,
  carbs_g numeric not null default 0,
  fat_g numeric not null default 0,
  fiber_g numeric not null default 0,
  confidence text,
  assumptions text,
  source text not null check (source in ('photo', 'manual', 'agent', 'plan')),
  created_at timestamptz not null default now()
);
create index meals_by_day on public.meals (user_id, date desc);

create table public.water (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  at timestamptz not null default now(),
  ml int not null
);
create index water_by_day on public.water (user_id, date desc);

create table public.daily_logs (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  weight_kg numeric,
  progress_photo_path text,
  notes text,
  primary key (user_id, date)
);

create table public.messages (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content jsonb not null,
  created_at timestamptz not null default now()
);
create index messages_latest on public.messages (user_id, id desc);

-- RLS: every table, one policy, own rows only. The publishable key is public; this is the wall.
do $$
declare t text;
begin
  foreach t in array array['profiles', 'plans', 'workouts', 'meals', 'water', 'daily_logs', 'messages'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy own_rows on public.%I for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t);
  end loop;
end $$;

create view public.daily_totals with (security_invoker = true) as
select
  user_id,
  date,
  coalesce(sum(kcal), 0)::int as kcal,
  coalesce(sum(protein_g), 0) as protein_g,
  coalesce(sum(carbs_g), 0) as carbs_g,
  coalesce(sum(fat_g), 0) as fat_g,
  coalesce(sum(water_ml), 0)::int as water_ml,
  bool_or(workout_done) as workout_done,
  max(weight_kg) as weight_kg
from (
  select user_id, date, kcal, protein_g, carbs_g, fat_g, 0 as water_ml, false as workout_done, null::numeric as weight_kg from public.meals
  union all select user_id, date, 0, 0, 0, 0, ml, false, null from public.water
  union all select user_id, date, 0, 0, 0, 0, 0, duration_min is not null, null from public.workouts
  union all select user_id, date, 0, 0, 0, 0, 0, false, weight_kg from public.daily_logs
) t
group by user_id, date;

-- Storage: two private buckets, objects live under <uid>/...
insert into storage.buckets (id, name, public) values ('meals', 'meals', false), ('progress', 'progress', false);

create policy own_objects on storage.objects for all to authenticated
  using (bucket_id in ('meals', 'progress') and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id in ('meals', 'progress') and (storage.foldername(name))[1] = auth.uid()::text);
```

- [ ] **Step 2: Start a local Supabase stack in the scratchpad**

The Supabase CLI is installed via Homebrew (`supabase --version` prints a version). Docker Desktop must be running (`docker info` succeeds). Work outside the repo so no local config lands in git:

```bash
mkdir -p /private/tmp/claude-504/-Users-buno-Documents-coding-APT/cfa3fc32-8c82-4b57-a651-61514f9ac113/scratchpad/apt-local
cd /private/tmp/claude-504/-Users-buno-Documents-coding-APT/cfa3fc32-8c82-4b57-a651-61514f9ac113/scratchpad/apt-local
printf 'n\nn\n' | supabase init
supabase start -x studio,edge-runtime,logflare,vector,imgproxy,pgadmin-schema-diff,migra,supavisor
```

Expected: after image pulls, `supabase start` prints `API URL`, `DB URL: postgresql://postgres:postgres@127.0.0.1:54322/postgres`. This can take several minutes the first time. If `-x` rejects a name, drop that name and retry.

- [ ] **Step 3: Apply the schema and assert it**

```bash
cd /Users/buno/Documents/coding/APT
DB=$(docker ps --format '{{.Names}}' | grep '^supabase_db_')
docker exec -i "$DB" psql -U postgres -v ON_ERROR_STOP=1 -q < supabase/schema.sql
docker exec -i "$DB" psql -U postgres -v ON_ERROR_STOP=1 -At <<'SQL'
select 'rls_tables', count(*) from pg_tables where schemaname = 'public' and rowsecurity;
select 'policies', count(*) from pg_policies where schemaname = 'public';
select 'buckets', count(*) from storage.buckets where id in ('meals', 'progress');
select 'view_rows', count(*) from public.daily_totals;
SQL
```

Expected output, exactly:

```
rls_tables|7
policies|7
buckets|2
view_rows|0
```

- [ ] **Step 4: Prove RLS isolates users through the view**

```bash
docker exec -i "$DB" psql -U postgres -v ON_ERROR_STOP=1 -At <<'SQL'
insert into auth.users (id, instance_id, aud, role, email) values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@test'),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@test');
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false);
insert into public.water (date, ml) values ('2026-09-17', 500), ('2026-09-17', 250);
insert into public.daily_logs (date, weight_kg) values ('2026-09-17', 80.5);
select 'a_sees', water_ml, weight_kg, workout_done from public.daily_totals;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false);
select 'b_sees', count(*) from public.daily_totals;
select 'b_water', count(*) from public.water;
reset role;
SQL
```

Expected output, exactly:

```
INSERT 0 2
SET
{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}
INSERT 0 2
INSERT 0 1
a_sees|750|80.5|f
{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}
b_sees|0
b_water|0
RESET
```

(`set_config` echoes the value it set. The third argument must be `false`: psql autocommits each statement, so a transaction-local setting would be gone before the insert and RLS would reject it.)

- [ ] **Step 5: Stop the local stack and commit**

```bash
cd /private/tmp/claude-504/-Users-buno-Documents-coding-APT/cfa3fc32-8c82-4b57-a651-61514f9ac113/scratchpad/apt-local && supabase stop
cd /Users/buno/Documents/coding/APT && git add supabase/schema.sql && git commit -m "Add Supabase schema" && git push
```

---

### Task 4: Supabase client, Google sign-in gate, profile upsert

**Files:**
- Create: `src/db.ts`
- Modify: `src/App.tsx`

**Interfaces:**
- Produces: `sb` (SupabaseClient), `SUPABASE_URL`, `signIn()`, `signOut()`, `ensureProfile(userId: string): Promise<void>`; `App` renders `.gate` when signed out and `.shell` when signed in.

- [ ] **Step 1: Write src/db.ts**

The two constants are placeholders until the Supabase project exists (Task 6). That is the one place a placeholder is allowed in this plan.

```ts
import { createClient } from '@supabase/supabase-js'

// both public by design; RLS is the wall
export const SUPABASE_URL = 'https://YOUR-PROJECT-REF.supabase.co'
export const SUPABASE_KEY = 'sb_publishable_YOUR_KEY'

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { flowType: 'pkce' } })

export function signIn() {
  return sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: location.origin + location.pathname },
  })
}

export function signOut() {
  return sb.auth.signOut()
}

export async function ensureProfile(userId: string) {
  const { error } = await sb
    .from('profiles')
    .upsert({ user_id: userId }, { onConflict: 'user_id', ignoreDuplicates: true })
  if (error) throw error
}
```

- [ ] **Step 2: Add the auth gate to src/App.tsx**

Replace the whole file:

```tsx
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
```

- [ ] **Step 3: Check and build**

Run: `npm run check && npm run build`
Expected: clean. Then `npm run dev` in the background, `curl -s http://localhost:5173/APT/ | grep -c '<div id="root">'` prints `1`, stop the dev server. (Sign-in cannot be exercised until Task 6's values are in place; the gate renders because there is no session.)

- [ ] **Step 4: Commit and push**

```bash
git add -A && git commit -m "Add Supabase client and Google sign-in gate" && git push
```

---

### Task 5: GitHub Pages deploy workflow

**Files:**
- Create: `.github/workflows/deploy.yml`

**Interfaces:**
- Produces: every push to `main` builds and deploys `dist/` to `https://duckyquang.github.io/APT/`. Pages is already configured with `build_type: workflow` and HTTPS enforced (done via the API on 2026-09-17).

- [ ] **Step 1: Write .github/workflows/deploy.yml**

```yaml
name: Deploy

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run check
      - run: npm run build
      - uses: actions/configure-pages@v6
      - uses: actions/upload-pages-artifact@v5
        with:
          path: ./dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v5
```

- [ ] **Step 2: Commit, push, watch the run**

```bash
git add .github/workflows/deploy.yml && git commit -m "Deploy to GitHub Pages on push" && git push
sleep 20
gh run list --workflow Deploy --limit 1
gh run watch --exit-status $(gh run list --workflow Deploy --limit 1 --json databaseId -q '.[0].databaseId')
```

Expected: the run completes with `✓`. If a `uses:` version does not exist (the log says "Unable to resolve action"), drop the major version by one for that action and push again.

- [ ] **Step 3: Verify the live site**

```bash
curl -sI https://duckyquang.github.io/APT/ | head -1                       # HTTP/2 200
curl -s https://duckyquang.github.io/APT/ | grep -o 'Content-Security-Policy' # once
curl -s https://duckyquang.github.io/APT/ | grep -o '/APT/assets/[^"]*' | head -1
curl -sI https://duckyquang.github.io/APT/manifest.json | head -1           # 200
```

Pages can take a minute after the run finishes to serve the new build; retry once if the first curl is a 404.

---

### Task 6: Console setup steps and the two constants

**Files:**
- Modify: `PLAN.md` (Phase 0 paragraph), `src/db.ts` (only once the founder supplies values)

**Interfaces:**
- Produces: the exact click path a human follows to create the Supabase project and the Google OAuth client, appended to PLAN.md so the README's pointer ("The whole setup is in PLAN.md under Phase 0") is true.

- [ ] **Step 1: Append the setup steps to PLAN.md, directly after the Phase 0 paragraph's exit test line**

```markdown
Console steps for Phase 0 (one time, by hand):

1. supabase.com, New project, name `apt`, region nearest you, note the database password somewhere safe (never needed by the app).
2. Project Settings, API: copy the Project URL and the `sb_publishable_` key into the two constants at the top of `src/db.ts`.
3. SQL Editor, paste `supabase/schema.sql`, Run.
4. console.cloud.google.com, APIs & Services, Credentials, Create credentials, OAuth client ID, type Web application. Authorized JavaScript origins: `https://duckyquang.github.io` and `http://localhost:5173`. Authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`. Copy the client ID and secret.
5. Supabase, Authentication, Providers, Google: enable, paste client ID and secret.
6. Supabase, Authentication, URL Configuration: Site URL `https://duckyquang.github.io/APT/`; Redirect URLs add `https://duckyquang.github.io/APT/` and `http://localhost:5173/APT/`.
7. Push `src/db.ts`; wait for the deploy; open the live URL and sign in on a phone and a laptop.
```

- [ ] **Step 2: Commit and push**

```bash
git add PLAN.md && git commit -m "Document Phase 0 console setup" && git push
```

- [ ] **Step 3: When the founder supplies the URL and key**

Replace the two constants in `src/db.ts`, run `npm run check`, commit `Point at the Supabase project`, push, then run the Task 5 Step 3 curls again and sign in from the live URL.
