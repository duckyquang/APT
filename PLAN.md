# APT build plan

Written 2026-09-16. This is the design I'm building against. If it isn't in here, it isn't planned.

## The idea

APT is a website that turns your own AI API key into a personal trainer. You talk to it. It writes your workout and meal plans, logs what you eat from a photo, tracks water, weight and workouts, keeps one progress photo a day, and later stitches those into a transformation video. Everything lives in your cloud account so it works from any device.

## The constraint that shapes everything

The site is static, hosted on GitHub Pages. There is no server I run. So:

- The browser calls the AI provider directly with the user's key. Verified live on 2026-09-16: Anthropic's API answers the CORS preflight with `access-control-allow-origin: *` when the request carries the `anthropic-dangerous-direct-browser-access: true` header, which the TypeScript SDK adds when you construct it with `dangerouslyAllowBrowser: true`.
- Cloud storage is a backend-as-a-service the browser talks to with a public key and row-level security. That's Supabase.
- GitHub Pages can't set response headers, so no COOP/COEP, so no SharedArrayBuffer, so no multi-threaded wasm. Video generation uses native browser APIs instead.
- Nothing secret ships in the bundle. Supabase's publishable key is designed to be public. RLS is the only wall, so every table has it.

## Decisions

Each one was checked against current docs or probed live before I wrote it down. Sources are at the bottom.

1. **Sign in with Google only.** Not magic link. Supabase Free's built-in mailer sends 2 emails an hour and refuses addresses outside the project team, so magic link is dead on arrival without custom SMTP. Google OAuth needs no email. Magic link can come back if I wire up Resend or Brevo later.
2. **Three providers behind one interface** (changed 2026-09-17 at the founder's request; the original launch decision was Anthropic only). Anthropic, OpenAI (Responses API) and Gemini (`@google/genai`) each have an adapter in `src/providers/`; the profile stores `provider` and `model`, keys live in localStorage per provider, and the model field is free text because names move. Never Gemini's OpenAI-compat endpoint, its preflight returns 403. Design: `docs/superpowers/specs/2026-09-17-providers-and-dashboard-design.md`.
3. **The API key lives in localStorage, per device.** Paste it once on each device. It is never sent to Supabase or anywhere except api.anthropic.com. On save, one `claude-haiku-4-5` call with `max_tokens: 1` validates it, so a typo fails at entry and not mid-chat. Settings tells the user to make a dedicated key with a spend limit.
   `// ponytail: an encrypted vault synced through the profile row (PBKDF2 + AES-GCM with crypto.subtle, ~60 lines) is the upgrade if pasting per device annoys anyone. After unlock the plaintext sits in localStorage anyway, so the threat model is the same.`
4. **No YouTube API, no YouTube key.** The exercise catalog is free-exercise-db (Unlicense, 876 exercises with step instructions; 873 have two stills). `exercises.json` is bundled; the stills are hotlinked from the project's raw GitHub URLs. A hand-curated `videos.json` maps exercise id to YouTube video id for the common movements; those get an embed. Every exercise gets a "Watch on YouTube" search link. The model never emits a video id. It picks exercise ids from the catalog and the client rejects any it doesn't know. YouTube's `listType=search` embed died in November 2020, and Data API search is 100 calls a day per project shared across every visitor.
5. **Meal photos are one vision call, no nutrition database.** Peer-reviewed numbers put photo-only energy error at roughly 30 to 36 percent with a bias toward underestimating large portions, and most of that error is portion size rather than per-100 g values, so a database wouldn't fix it. What measurably helps: telling the model to estimate the visible portion instead of snapping to standard serving sizes, and letting the user add a one-line note. Chain-of-thought and second-pass verification prompts were measured as no gain or worse. The estimate is shown as editable with a confidence tag. The user's edit is what gets stored.
6. **Transformation video is canvas plus MediaRecorder.** No ffmpeg.wasm (32 MB, slow, needs COOP/COEP for the threaded build). Mime type is picked at runtime with `isTypeSupported`: mp4 on Safari, iOS and Chrome 126+, webm on Firefox. Shared via `navigator.share` with a File on iPhone, download link elsewhere.
   `// ponytail: MediaRecorder records in real time, so 90 photos at 0.3 s is 27 s in the foreground. Switch to mediabunny (WebCodecs, ~17 kB gzip, faster than real time, mp4 wherever the browser can encode H.264: Chrome 94+, Firefox 130+, Safari 16.4+, check with canEncode()) if that annoys anyone.`
7. **Supabase Free.** 500 MB database, 1 GB storage, 5 GB egress a month. A Free project pauses after 7 days without database activity; restoring it is one click in the dashboard. Overage on Free is not a bill: after a grace period Supabase pauses the project, makes the database read-only, or returns 402 on every request. Upgrade to Pro at $25/month when storage passes about 700 MB or a second real user shows up.
8. **Four runtime dependencies:** react, react-dom, @supabase/supabase-js, @anthropic-ai/sdk. No router (hash tabs), no state library, no Tailwind, no component library, no markdown renderer, no zod (the SDK's `jsonSchemaOutputFormat` helper is zod-free).
9. **Photos are resized in the browser before anything touches them.** Meal photos to 1280 px long edge; progress photos cover-cropped to a fixed 1080x1350. Both JPEG at 0.85. That bakes in EXIF orientation (Claude ignores EXIF and would see a sideways photo), converts HEIC where the browser can decode it (Safari and iOS, which is the only place HEIC shows up), lands at roughly 200 to 400 KB, costs roughly 1,300 to 2,100 visual tokens depending on aspect ratio (a 4:3 photo is about 1,600) and close to the same across model tiers, and keeps Supabase's 1 GB of storage useful for years.
10. **Meal photos never enter the chat history.** Analysis is a single `messages.parse` call from the Today view, outside the chat loop. Chat rows store the assistant's content array verbatim, thinking blocks included, because the API needs them replayed inside a tool loop. Only image blocks are excluded, and they never enter chat in the first place.
11. **Demo mode runs the whole app with no account.** A "Try the demo" button on the sign-in screen keeps every table as a JSON array in localStorage and photos in the browser's Cache API, behind the same function names the Supabase layer exports (`src/local.ts` next to `src/supabase.ts`, switched in `src/db.ts`). Anyone can use the live URL with just an API key; the Supabase setup adds Google sign-in and syncing across devices, nothing else.
12. **Every dated row carries a local date the client wrote.** `meals`, `water`, `workouts` and `daily_logs` all have a `date` column holding the device's local `YYYY-MM-DD`. Totals group on that column, never on a timestamp cast to a date, which would be UTC and put dinner at 8 pm on tomorrow for anyone west of Greenwich.

## Architecture

```
Browser (React SPA on GitHub Pages, https://duckyquang.github.io/APT/)
  ├─ @supabase/supabase-js ──► Auth (Google) · Postgres (RLS) · Storage (private buckets)
  ├─ @anthropic-ai/sdk ──────► api.anthropic.com, with the user's key, browser only
  └─ native: <input capture>, canvas, MediaRecorder, navigator.share, <dialog>, localStorage
```

Files:

| Path | Job |
|---|---|
| `src/App.tsx` | Hash switch (`#today` `#plan` `#history` `#settings`), grid shell, auth gate, key gate |
| `src/Chat.tsx` | Sidebar chat, streaming, tool chips |
| `src/views/Today.tsx` `Plan.tsx` `History.tsx` `Settings.tsx` | The four tabs |
| `src/ai.ts` | `chatTurn()`, `analyzeMeal()`, tool definitions, system prompt builder. Only file that imports the SDK |
| `src/db.ts` | Picks `src/supabase.ts` or `src/local.ts` (demo mode) and re-exports the same query functions |
| `src/supabase.ts` | Supabase client (URL and publishable key as literals at the top; both are public by design) and typed queries |
| `src/local.ts` | The same functions over localStorage and the Cache API, for demo mode |
| `src/image.ts` | Resize, cover-crop, base64 |
| `src/video.ts` | Stitch photos into a video |
| `src/app.css` | Tokens and components |
| `public/exercises.json` | Bundled catalog from free-exercise-db |
| `public/videos.json` | `{ exerciseId: youtubeVideoId }`, hand-curated |
| `public/manifest.json` | Home-screen icon. `display: "browser"`, because a standalone iOS web app plus a Google OAuth redirect is a known way to lose the session on the way back |
| `supabase/schema.sql` | Tables, view, RLS, buckets |
| `.github/workflows/deploy.yml` | Vite build to Pages on push to main |
| `index.html` | Includes a `<meta http-equiv="Content-Security-Policy">` |

The meta CSP: `default-src 'self'`; `connect-src` api.anthropic.com and the Supabase project host; `frame-src` youtube-nocookie.com; `img-src` self, blob:, data:, the Supabase host and raw.githubusercontent.com; `object-src 'none'`; `base-uri 'self'`; `form-action 'self'`. GitHub Pages can't send a real CSP header, but a meta CSP still blocks injected inline scripts and limits where fetches can go, which raises the bar for getting the key out of the browser. It is not a complete defence against a compromised dependency, which is why there are four of them and they're pinned.

## Data model

All tables: `enable row level security`, one policy `for all to authenticated using ((select auth.uid()) = user_id) with check (same)`, `user_id default auth.uid()`. No service-role key anywhere in the app. No triggers: the client upserts the profile row itself after the first session lands.

| Table | Columns | Notes |
|---|---|---|
| `profiles` | `user_id pk → auth.users`, `name`, `sex`, `birth_date`, `height_cm`, `goal`, `activity_level`, `training_days text[]` (`mon`..`sun`), `equipment`, `injuries`, `dietary_prefs`, `targets jsonb` (kcal, protein_g, carbs_g, fat_g, water_ml; default water 2500), `units` (default metric), `model` (default `claude-opus-5`), `onboarded_at`, `updated_at` | One row per user, upserted with `ignoreDuplicates` on first sign-in. No weight here: current weight is the latest `daily_logs.weight_kg`, one source of truth. Free-form text fields mean onboarding never needs a migration |
| `plans` | `id`, `user_id`, `kind` (workout / meal), `title`, `content jsonb`, `created_at` | Whole plan is one blob written verbatim from the tool input. The active plan of a kind is the newest row: `order('created_at', desc).limit(1)`. Saving a plan is one insert. Old plans are kept |
| `workouts` | `id` (client-generated uuid), `user_id`, `date`, `plan_id`, `day_name`, `exercises jsonb`, `duration_min`, `notes`, `created_at` | `exercises = [{exercise_id, name, sets:[{reps, weight_kg, done}]}]`. Upserted live from the Today checklist so a half-done session survives a closed tab. `duration_min` is null until Finish |
| `meals` | `id`, `user_id`, `date`, `eaten_at`, `photo_path`, `name`, `items jsonb`, `kcal`, `protein_g`, `carbs_g`, `fat_g`, `fiber_g`, `confidence`, `assumptions`, `source` (photo / manual / agent / plan), `created_at` | Macros are real columns so the daily view is a one-line sum. `items` holds the per-item breakdown |
| `water` | `id`, `user_id`, `date`, `at`, `ml` | Append-only. Day total is `sum(ml)`. Two devices logging at once never clobber each other and there's no RPC |
| `daily_logs` | `(user_id, date) pk`, `weight_kg`, `progress_photo_path`, `notes` | One row per day, upserted. One progress photo per day by construction. Every weigh-in path writes here and only here |
| `messages` | `id identity`, `user_id`, `role` (user / assistant), `content jsonb`, `created_at` | Anthropic content blocks stored verbatim (thinking, text, tool_use, tool_result) so the chat replays identically on any device. Never image blocks |
| `daily_totals` (view) | `user_id`, `date`, `kcal`, `protein_g`, `carbs_g`, `fat_g`, `water_ml`, `workout_done`, `weight_kg` | Groups meals, water, workouts and daily_logs on their `date` column. `workout_done` = a workouts row exists for the day with `duration_min` not null. Feeds the dashboard header, the system prompt and `get_history`. `security_invoker` so it inherits RLS |

Storage: two private buckets. `meals` at `<uid>/<date>-<uuid>.jpg`, `progress` at `<uid>/<date>.jpg`. Policy on `storage.objects`: `(storage.foldername(name))[1] = auth.uid()::text`. Read through `createSignedUrl` with a one-hour expiry. Videos are never stored (50 MB per-file cap on Free, and they're generated on the device anyway).

Plan blob shapes. `weekday` is `mon`..`sun`; Today renders `days.find(d => d.weekday === todayWeekday)`.

```
workout: { days: [{ weekday, name, exercises: [{ exercise_id, name, sets, reps, rest_s, notes }] }] }
meal:    { days: [{ weekday, meals: [{ name, items: [{ food, qty, kcal, protein_g, carbs_g, fat_g }], kcal, protein_g, carbs_g, fat_g }] }] }
```

## The trainer

One agent loop in `src/ai.ts`.

**First run order:** auth gate (no session, show Sign in with Google), then key gate (no key in localStorage, route to Settings key entry), then onboarding (`onboarded_at` null, open the chat with the missing-fields block).

**System prompt**, in this order so the stable part caches: trainer persona (static, with `cache_control`; the tool definitions come before it in the cache prefix, so together they clear the roughly 1024-token minimum a breakpoint needs), compact profile JSON including the latest weight and its date, today's `daily_totals` row, today's meals as `[{name, kcal, source}]`, the active workout and meal plan blobs (a few KB each), and a list of profile fields still missing. The 876-exercise catalog is not in the prompt; the model searches it with a tool.

**Messages**: the last 40 rows from `messages`, oldest first, then trimmed forward to the first `user` row that has no `tool_result` block, and with a trailing assistant `tool_use` row that has no result dropped. The API rejects a `tool_result` whose `tool_use` isn't in the immediately preceding assistant message, so the window must never split a pair.

**Call**: `client.messages.stream()` with the eight tools below and the model from `profiles.model`. `thinking` is omitted: Opus 5 and Sonnet 5 run adaptive thinking by default, Haiku 4.5 doesn't take that parameter shape, and omitting it gives one call shape for all three. On `stop_reason: 'tool_use'` the browser runs the tool (a Supabase write or a JSON search), sends the SDK's returned content array back unchanged plus the `tool_result`, and loops until `end_turn`. Hard cap of 8 rounds. The send box is disabled while a turn is in flight.

**Persistence**: a user text message is inserted when sent. The assistant `tool_use` message and the user `tool_result` message are inserted together, in one call, after the tool has run. Never the `tool_use` alone, so a closed tab or a 429 mid-round can't leave a dangling call that 400s every later request. The final assistant text is inserted at `end_turn`. "Clear chat" deletes the user's rows and ships in Phase 1 as the escape hatch.

**Tools** (plain JSON Schema, `additionalProperties: false`):

| Tool | What it does |
|---|---|
| `update_profile` | Merge a subset of an explicit whitelist: name, sex, birth_date, height_cm, weight_kg, goal, activity_level, training_days, equipment, injuries, dietary_prefs, targets, units. The handler copies known keys off the input; it never spreads the input into the update. `weight_kg` is not a profile column: it upserts today's `daily_logs.weight_kg` |
| `search_exercises` | Runs in the browser over `exercises.json`. Filter by name, muscle, equipment. Returns up to 20 `{id, name, equipment, primaryMuscles, has_video}`. The model is told to prefer `has_video` |
| `save_workout_plan` | Inserts a `plans` row. Client checks every `exercise_id` exists (returns a tool error naming bad ids with near matches) and every `weekday` is in `profiles.training_days` (returns an error telling the model to call `update_profile` first if the user agreed to new days) |
| `save_meal_plan` | Inserts a `plans` row with `kind='meal'`. Client checks numbers are non-negative and totals roughly match items |
| `log_workout` | Insert a `workouts` row from a typed description ("did 5x5 squats at 100 kg, skipped dips") |
| `log_meal` | Insert a `meals` row with `source='agent'` when the user describes food in text. Photo analysis is not a tool |
| `log_water` | Insert a `water` row for now or a given time |
| `get_history` | Read-only. `daily_totals` plus workouts (optionally meals) for a range, default 14 days, max 90, as compact JSON |

**Errors** are mapped to typed messages before display: 401 bad key, 429 rate limit on the user's tier (new keys start on Tier 1 and Opus with a few tool rounds can hit it, so `claude-sonnet-5` is one click away), 529 overloaded, `stop_reason: 'refusal'`, and a CORS failure hint for zero-data-retention orgs. The key never appears in URLs, logs or toasts.

**Meal analysis** is separate: `client.messages.parse()` with `output_config.format = jsonSchemaOutputFormat(schema)`. Image block first, then text with the optional user note. System text says to estimate the actual visible portion in grams per item, not standard serving sizes. Schema:

```
{ items: [{ name, portion_estimate, grams, kcal, protein_g, carbs_g, fat_g, fiber_g }],
  totals: { kcal, protein_g, carbs_g, fat_g, fiber_g },
  confidence: 'low' | 'medium' | 'high',
  assumptions: string }
```

Structured outputs can't express `minimum`, so after parsing the client recomputes totals from items, sanity-checks 4/4/9 kcal against macros, and clamps negatives.

## Features, one by one

1. **Tailored workout plans from conversation.** The sidebar chat is the loop above. To build a plan the model calls `search_exercises` to find real ids, then `save_workout_plan`. The Plan view re-queries the newest plan of each kind and renders it. The model is told to explain the plan in prose after saving. To revise ("shorter Tuesdays") it edits the active plan blob it already has in the system prompt and saves a new row.
2. **Clear instructions plus a YouTube video.** Plan view expands each exercise on tap into sets x reps, rest, the trainer's notes, the catalog's step-by-step instructions and its two stills from `raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/<id>/0.jpg` (tolerating the three exercises with none). If `videos.json` has an id, the expanded row renders `<iframe loading="lazy" src="https://www.youtube-nocookie.com/embed/<id>">`. A "Watch on YouTube" link to `youtube.com/results?search_query=<name>+form` is always shown beneath, so a removed video just shows YouTube's own unavailable card with the search link under it.
3. **Workout history.** Today shows the active plan's day for today's weekday as a checklist of sets, reps and weight pre-filled from the plan and the last logged weight for that exercise (Today loads the last 10 `workouts` rows and takes the most recent set weight per `exercise_id` client-side). Each tick upserts the `workouts` row. "Finish" stamps `duration_min` from a `performance.now()` timer; a `setInterval` rest timer runs between sets. History is `workouts` by date, grouped by month, tap to expand. `log_workout` and `get_history` cover the chat side.
4. **Meal plans.** `save_meal_plan` writes the same `plans` table with `kind='meal'`. A Meals tab on Plan renders days, meals, items with macros against `profiles.targets`. Today lists today's planned meals with an "Ate this" button that copies the planned meal into `meals` with `source='plan'`, so planned food needs no photo. Dietary prefs and today's meals are in the system prompt, so "plan dinner around what I ate" needs no extra plumbing.
5. **Meal photo to macros.** "Log a meal" on Today opens `<input type="file" accept="image/*" capture="environment">`. One decode path: `new Image()` from an object URL, `await img.decode()`, `drawImage` onto a canvas sized to 1280 px long edge, `toBlob('image/jpeg', 0.85)`. Browsers apply EXIF orientation when drawing an image element; a decode failure (HEIC on desktop Chrome, say) shows "please pick a JPEG or PNG". The same blob is uploaded to the `meals` bucket and base64-encoded into the `messages.parse` call. Result shows in an editable `<dialog>` card with the confidence tag and a "typically within 30%" hint. Save inserts the `meals` row with `source='photo'` and today's local date. Manual entry is the same card without a photo. Daily totals come from the view.
6. **Water.** A tile on Today with +250, +500 and custom buttons inserting `water` rows. An inline SVG ring fills toward `profiles.targets.water_ml`. `log_water` covers "drank a litre after training".
7. **Daily progress photo and transformation video.** Progress tile on Today: same file input and decode path, cover-fit crop to 1080x1350 on a canvas, upload to `progress/<uid>/<date>.jpg`, upsert `daily_logs.progress_photo_path`. "Make video" in History: fetch signed URLs in date order, draw each onto a 1080x1350 canvas for its hold time via `requestAnimationFrame` with the date stamped in a corner, `canvas.captureStream(30)` into a MediaRecorder at about 5 Mbps, collect the blob on stop, then a second tap calls `navigator.share({ files })` when `canShare` says yes, else an `<a download>`. The fixed crop keeps frames aligned without a live camera preview. Photos are never sent to any model.
8. **Onboarding and ongoing info.** Required fields: height_cm, birth_date, sex, goal, training_days, and a first weight. Optional, defaulting to none or moderate: equipment, injuries, dietary_prefs, activity_level. `onboarded_at` null opens the chat with the missing-fields block, and the main column shows `#settings` so on a phone the profile form sits under the chat sheet and updates as fields land. The trainer asks two or three at a time, calls `update_profile` as it learns them, and proposes a plan once the required fields are set. The client stamps `onboarded_at` when every required field is non-null after an `update_profile` call. Ongoing: weight quick-entry on Today upserts `daily_logs.weight_kg`, the same write `update_profile` does, so there is one weight path. The trainer sees the latest weight and its date in the profile JSON and asks for a weigh-in when it's older than 7 days. Any "I hurt my shoulder" triggers `update_profile`. Settings shows the same fields as a plain form for people who'd rather type. Stored metric; a units toggle converts weight and height at the input only.
9. **Dashboard with chat sidebar.** One page. CSS grid: main column with the four hash tabs, plus a 380 px right `<aside>` for chat that collapses to a bottom sheet with a floating button under 900 px. Every tool call shows as a small chip in the chat ("Logged lunch, 640 kcal") and re-renders the affected tile, so the sidebar and the dashboard visibly agree. Assistant text renders as plain text with `white-space: pre-wrap`. No markdown library, no `dangerouslySetInnerHTML`.
10. **Cloud, any device.** All rows in Postgres behind RLS, photos in private Storage, chat in `messages`. Sign in with Google anywhere and everything is there; the API key is the one thing you paste again on a new device. The browser holds the Supabase session, the key and the last tab. Today's data is refetched on `visibilitychange` and after every tool call. No Realtime.

## UI

Black ground, white text, hairline borders, monospace uppercase labels on every widget, one blue for data marks, green and red only for labeled deltas, gradient-tinted cards on the Plan tab. Redesigned 2026-09-17 from three reference screenshots; the widget list is in `docs/superpowers/specs/2026-09-17-providers-and-dashboard-design.md`.

Tokens in `app.css`: `--bg #000`, `--surface #111`, `--surface2 #1c1c1e`, `--fg #fff`, `--muted #8e8e93`, `--line rgba(255,255,255,.12)`. Radii 12, 16, 20. Font stack `-apple-system, "SF Pro Text", Inter, system-ui`. `color-scheme: dark`. Type scale from the Apple HIG: 34 / 28 / 22 / 17 / 15 / 13 / 11. 4 pt spacing grid. `backdrop-filter` on the sticky header. 200 ms ease-out on sheets and rings only. `prefers-reduced-motion` respected.

Components, all hand-written: tile, ring (inline SVG `stroke-dasharray`), checklist row, chat bubble, tool chip, sheet (`<dialog>`), segmented tabs, form row. That's the whole kit.

## Phases

**Phase 0, plumbing.** Supabase project. `schema.sql` with the seven tables, the view, RLS, two private buckets. Google OAuth wired: a Google Cloud web client with authorized JavaScript origin `https://duckyquang.github.io` and authorized redirect URI `https://<project-ref>.supabase.co/auth/v1/callback`, client ID and secret pasted into Supabase, Supabase Site URL and Redirect URL set to `https://duckyquang.github.io/APT/`. Vite React TS scaffold with `base: '/APT/'`, hash tabs, dark shell, tokens, meta CSP, manifest, the profile upsert on first session. Deploy workflow (checkout v7, setup-node v7, configure-pages v6, upload-pages-artifact v5, deploy-pages v5, Pages source set to GitHub Actions, Enforce HTTPS on).
Exit test: sign in on a phone and a laptop from the live URL, and once more from the home-screen icon on the phone.

Console steps for Phase 0 (one time, by hand):

1. supabase.com, New project, name `apt`, region nearest you, note the database password somewhere safe (never needed by the app).
2. Project Settings, API: copy the Project URL and the `sb_publishable_` key into the two constants at the top of `src/db.ts`.
3. SQL Editor, paste `supabase/schema.sql`, Run.
4. console.cloud.google.com, APIs & Services, Credentials, Create credentials, OAuth client ID, type Web application. Authorized JavaScript origins: `https://duckyquang.github.io` and `http://localhost:5173`. Authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`. Copy the client ID and secret.
5. Supabase, Authentication, Providers, Google: enable, paste client ID and secret.
6. Supabase, Authentication, URL Configuration: Site URL `https://duckyquang.github.io/APT/`; Redirect URLs add `https://duckyquang.github.io/APT/` and `http://localhost:5173/APT/`.
7. Push `src/db.ts`; wait for the deploy; open the live URL and sign in on a phone and a laptop.

**Phase 1, the trainer.** Settings: key entry with the validation ping, model dropdown, profile form. `ai.ts` with streaming, the tool loop, message persistence with the pairing and trimming rules, the system prompt builder, "Clear chat". Tools `update_profile`, `search_exercises`, `save_workout_plan`, `save_meal_plan`. Catalog bundled, `videos.json` seeded with about 50 common movements. Onboarding via the missing-fields block. Plan view with instructions, stills, embed or search link, Meals tab.
Covers features 1, 2, 9, 10 and the chat side of 4 and 8. "Ate this" and weight quick-entry land in Phase 2.

**Phase 2, the daily log.** Today view: water tile, weight quick-entry, meal photo to editable card to `meals` row, manual meal entry, "Ate this", totals header with rings, progress photo capture with the fixed crop. Tools `log_meal`, `log_water`. Check EXIF orientation on an iPhone portrait photo.
Covers features 5, 6, the Today halves of 4 and 8, and the capture half of 7.

**Phase 3, workouts and history.** Today workout checklist with live upsert, rest and session timers. History view by month with meals, water, weight per day and the progress photo strip. Tools `log_workout`, `get_history`.
Covers feature 3 and lets the trainer adjust plans from real data.

**Phase 4, video and polish.** Transformation video with runtime mime selection and share or download. Error toasts for 401 / 429 / 529 / refusal / CORS. Empty states, loading state for photo analysis, and one `npm run check` (tsc plus a smoke test that validates a sample plan against the catalog and runs the message-window trimming over a history with a tool call at the cut). Verify on Pages from phone and laptop. Tick the README roadmap.
Covers the video half of 7.

## Defaults I'm taking unless you say otherwise

| Decision | Default |
|---|---|
| Sign-in | Google only. Magic link only after custom SMTP exists |
| Key across devices | Paste it once per device, held in localStorage. An encrypted vault synced through Supabase is the upgrade if that annoys you |
| YouTube curation at launch | About 50 common movements in `videos.json`, search link on everything, trainer prefers exercises with a video |
| Meal photos after analysis | Kept, as the 1280 px JPEG, so the log has a thumbnail |
| Model selection | One dropdown for everything, `claude-opus-5` default, cost note pointing at `claude-sonnet-5` |
| Supabase tier | Free. Pauses after 7 idle days, restore is a click. Pro when storage passes ~700 MB or a second real user appears |
| Second provider | None until asked. Then Gemini |
| Chat memory | Last 40 messages plus profile, today's log and the active plans. A summary tool if the trainer visibly forgets things |
| Units | Metric stored, imperial toggle on weight and height inputs |
| Progress photo frame | 4:5 portrait, 1080x1350 |
| License | MIT |

## Risks

- **Direct browser access to Anthropic works but has no doc-backed stability promise.** The old CORS docs page 404s; the header is documented only in the SDK. If it's withdrawn, the fallback is a ~30-line Cloudflare Worker forwarding the user's key, which is a server.
- **The key lives in the browser.** Any XSS or compromised dependency can read it. Mitigation: meta CSP, four pinned dependencies, no third-party scripts, plain-text rendering of model output, and telling users to use a spend-capped key.
- **Supabase Free limits.** 500 MB database, 1 GB storage, 5 GB egress a month shared across everything, a 7-day idle pause that takes a dashboard click to undo, and overage is an outage. Photo resizing keeps one user in range for a long time. Pro is $25/month.
- **Meal-photo accuracy is roughly plus or minus 30 to 36 percent on energy** and 50 to 60 percent on individual macros. The UI presents estimates as editable with a confidence tag. Any "90% accurate" copy would be unsupported.
- **Rate limits are the user's.** New keys sit on Tier 1. Surface 429 clearly, keep Sonnet one click away.
- **Stills are hotlinked from raw.githubusercontent.com**, which GitHub doesn't promise as a CDN. If it ever breaks, copy the stills for the curated movements into `public/`.
- **MediaRecorder is real-time and foreground-only.** Safari has had duration and blank-canvas bugs (fixed, but test the file in Chrome or VLC). Firefox can only emit webm. Upgrade path is mediabunny.
- **Supabase auth on a Pages subpath is fiddly.** Site URL, Redirect URL, the Google authorized origin and the Google redirect URI (the supabase.co callback) must all match exactly. Budgeted in Phase 0.
- **GitHub Pages terms forbid hosting a commercial SaaS.** A free BYOK tool is fine. If APT ever charges money it moves to Cloudflare Pages or Netlify, which also give real headers.
- **Chat memory is 40 messages.** Anything not in the profile, today's log or a plan is forgotten after a while.

## Not building

Router, state library, Tailwind, component library, markdown rendering, zod, encrypted key vault, offline outbox, service worker, chat threads, cost meter, data export, account deletion, live camera preview, ghost overlay for progress photos, Supabase Realtime, database triggers, keep-alive cron, push notifications, wearables, social features, a normalized exercise table, a measurements table, YouTube Data API, click-to-load video facades, ffmpeg.wasm, nutrition database lookups. Each comes back only when a real user needs it.

## Sources checked

- Anthropic SDK source and README (`dangerouslyAllowBrowser`, `jsonSchemaOutputFormat`), plus a live OPTIONS and POST probe of `api.anthropic.com/v1/messages` on 2026-09-16
- platform.claude.com docs: vision limits, structured outputs
- OpenAI and Google Gemini SDK READMEs and docs, plus live CORS probes of both endpoints
- supabase.com/pricing and docs: api-keys, file-limits, free-project-pausing, auth-smtp, rate-limits, auth-google, redirect-urls, row-level-security
- vite.dev static-deploy and base path docs; docs.github.com Pages limits, HTTPS, custom workflows; GitHub community thread on custom headers
- MDN browser-compat-data, caniuse (mediarecorder, webcodecs, web-share), WebKit blog posts on MediaRecorder formats, ffmpeg.wasm docs, mediabunny.dev
- developers.google.com YouTube player_parameters, Data API quota and compliance-audit pages; yuhonas/free-exercise-db; wger API; ExerciseDB
- Fridolfsson et al. 2025, Nutrition5k evaluations (PMC13401436, PMC13483877), Claude-only nutrition study (PMC13306177), GPT-5 text-context study (PMC12655113); USDA FoodData Central and Open Food Facts API docs
