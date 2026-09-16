# Phase 4: Video and Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The transformation video renders in the browser and shares or downloads; the app has icons, an empty chat state, and a check that the curated video map matches the real catalog.

**Architecture:** `src/video.ts` draws each progress photo onto a 1080x1350 canvas for a fixed hold via `requestAnimationFrame`, records the canvas with MediaRecorder using the first mime type the browser supports, and returns a Blob. History owns the button, progress text, preview and share/download.

**Tech Stack:** Same as before. No new dependencies.

## Global Constraints

- Everything in the earlier plans' Global Constraints still applies.
- No ffmpeg.wasm, no mediabunny, no new npm packages. Mime type is chosen at runtime with `MediaRecorder.isTypeSupported`, never by user-agent sniffing.
- Videos are never uploaded to Supabase.
- Interfaces consumed: `History` in `src/views/History.tsx` (its `photos` state is `{ date, url }[]`); `Chat` in `src/Chat.tsx`; `public/manifest.json`; `index.html`; `src/catalog.test.ts`.

---

### Task 1: Transformation video

**Files:**
- Create: `src/video.ts`, `src/video.test.ts`
- Modify: `src/views/History.tsx`, `src/app.css`

**Interfaces:**
- Produces: `MIMES`; `pickMime(supported: (m: string) => boolean): string`; `makeVideo(frames: { url: string; label: string }[], onProgress: (done: number) => void, holdMs = 400): Promise<Blob>`.

- [ ] **Step 1: Write the failing test src/video.test.ts**

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickMime } from './video.ts'

test('pickMime prefers mp4, then vp9, then vp8, and gives up cleanly', () => {
  assert.equal(pickMime(() => true), 'video/mp4;codecs=avc1')
  assert.equal(pickMime(m => m.startsWith('video/webm')), 'video/webm;codecs=vp9')
  assert.equal(pickMime(m => m === 'video/webm'), 'video/webm')
  assert.equal(pickMime(() => false), '')
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test src/video.test.ts`
Expected: FAIL, cannot find module `./video.ts`.

- [ ] **Step 3: Write src/video.ts**

```ts
export const MIMES = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']

export function pickMime(supported: (m: string) => boolean) {
  return MIMES.find(supported) ?? ''
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((ok, no) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => ok(img)
    img.onerror = () => no(new Error('Could not load one of the photos.'))
    img.src = url
  })
}

// ponytail: MediaRecorder records in real time, so N photos take N * holdMs in the foreground.
// Switch to mediabunny (WebCodecs) if anyone complains about the wait or Firefox needs mp4.
export async function makeVideo(frames: { url: string; label: string }[], onProgress: (done: number) => void, holdMs = 400) {
  const mime = pickMime(m => MediaRecorder.isTypeSupported(m))
  if (!mime) throw new Error('This browser cannot record video.')
  const W = 1080
  const H = 1350
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')!
  const imgs = await Promise.all(frames.map(f => loadImage(f.url)))
  const rec = new MediaRecorder(c.captureStream(30), { mimeType: mime, videoBitsPerSecond: 5e6 })
  const chunks: Blob[] = []
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
  const stopped = new Promise<void>(r => { rec.onstop = () => r() })
  rec.start()
  for (let i = 0; i < imgs.length; i++) {
    onProgress(i + 1)
    const t0 = performance.now()
    while (performance.now() - t0 < holdMs) {
      ctx.drawImage(imgs[i], 0, 0, W, H)
      ctx.fillStyle = 'rgba(0,0,0,0.5)'
      ctx.fillRect(0, H - 90, W, 90)
      ctx.fillStyle = '#fff'
      ctx.font = '600 44px -apple-system, system-ui, sans-serif'
      ctx.fillText(frames[i].label, 40, H - 32)
      await new Promise(requestAnimationFrame)
    }
  }
  rec.stop()
  await stopped
  return new Blob(chunks, { type: mime.split(';')[0] })
}
```

- [ ] **Step 4: Add the button, progress, preview and share to src/views/History.tsx**

Add the import:

```tsx
import { makeVideo } from '../video.ts'
```

Add state next to the existing state:

```tsx
  const [video, setVideo] = useState<{ blob: Blob; url: string } | null>(null)
  const [rendering, setRendering] = useState(0)
```

Add these functions inside the component, after the `useEffect`:

```tsx
  async function render() {
    setError('')
    setRendering(1)
    try {
      const blob = await makeVideo(photos.map(x => ({ url: x.url, label: x.date })), setRendering)
      setVideo(v => { if (v) URL.revokeObjectURL(v.url); return { blob, url: URL.createObjectURL(blob) } })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRendering(0)
    }
  }

  function share() {
    if (!video) return
    const ext = video.blob.type.includes('mp4') ? 'mp4' : 'webm'
    const file = new File([video.blob], `transformation.${ext}`, { type: video.blob.type })
    if (navigator.canShare?.({ files: [file] })) {
      navigator.share({ files: [file] }).catch(() => {})
    } else {
      const a = document.createElement('a')
      a.href = video.url
      a.download = file.name
      a.click()
    }
  }
```

Replace the Progress section's JSX with:

```tsx
        <section className="tile">
          <h2>Progress</h2>
          <div className="strip">{photos.map(x => <figure key={x.date}><img src={x.url} alt="" loading="lazy" /><figcaption className="muted">{x.date.slice(5)}</figcaption></figure>)}</div>
          <div className="row wrap">
            <button type="button" onClick={render} disabled={photos.length < 2 || rendering > 0}>
              {rendering > 0 ? `Rendering ${rendering}/${photos.length}, keep this tab open` : 'Make video'}
            </button>
            {video && <button type="button" className="primary" onClick={share}>Share or save</button>}
          </div>
          {photos.length < 2 && <p className="muted">Two or more days of photos make a video.</p>}
          {video && <video className="preview" src={video.url} controls playsInline />}
        </section>
```

- [ ] **Step 5: Append to src/app.css**

```css
video.preview { width: 100%; max-width: 320px; aspect-ratio: 4 / 5; border-radius: var(--r-lg); background: var(--surface2); display: block; margin-top: 12px; }
```

- [ ] **Step 6: Check, commit, push**

Run: `npm run check`
Expected: clean; 21 tests passing.

```bash
git add -A && git commit -m "Render the transformation video in the browser" && git push
```

---

### Task 2: Icons

**Files:**
- Create: `public/icon.svg`, `public/icon-192.png`, `public/icon-512.png`, `public/apple-touch-icon.png`
- Modify: `public/manifest.json`, `index.html`

- [ ] **Step 1: Write public/icon.svg**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#000"/><text x="256" y="322" font-family="-apple-system, Helvetica, Arial, sans-serif" font-size="190" font-weight="700" fill="#fff" text-anchor="middle" letter-spacing="-6">APT</text></svg>
```

- [ ] **Step 2: Rasterise with the tools already on this Mac**

```bash
cd /Users/buno/Documents/coding/APT
qlmanage -t -s 512 -o public public/icon.svg >/dev/null 2>&1
mv public/icon.svg.png public/icon-512.png
sips -z 192 192 public/icon-512.png --out public/icon-192.png >/dev/null
sips -z 180 180 public/icon-512.png --out public/apple-touch-icon.png >/dev/null
sips -g pixelWidth -g pixelHeight public/icon-192.png public/icon-512.png public/apple-touch-icon.png
```

Expected: three PNGs at 192, 512 and 180 px. If `qlmanage` produces no file, fall back to `python3 -c "from PIL import Image, ImageDraw; im=Image.new('RGBA',(512,512),(0,0,0,255)); ImageDraw.Draw(im).rounded_rectangle([0,0,511,511],112,fill=(0,0,0,255)); im.save('public/icon-512.png')"` and continue with the two `sips` lines; report which path ran.

- [ ] **Step 3: Reference them**

`public/manifest.json`, replace `"icons": []` with:

```json
  "icons": [
    { "src": "/APT/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/APT/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
```

`index.html`, after the manifest link:

```html
    <link rel="icon" href="icon.svg" type="image/svg+xml" />
    <link rel="apple-touch-icon" href="apple-touch-icon.png" />
```

- [ ] **Step 4: Build, commit, push**

Run: `npm run build && grep -o 'apple-touch-icon[^"]*' dist/index.html`
Expected: build clean; the grep prints `apple-touch-icon.png` (Vite keeps public references as written, resolved under `/APT/`).

```bash
git add -A && git commit -m "Add app icons" && git push
```

---

### Task 3: Empty chat state, catalog guard, final deploy

**Files:**
- Modify: `src/Chat.tsx`, `src/catalog.test.ts`

- [ ] **Step 1: Empty chat state in src/Chat.tsx**

Inside `.chat-log`, before `{rows.map(...)}`:

```tsx
        {rows.length === 0 && !busy && <p className="muted">Say hi. APT will ask what it needs to know, then write your first week.</p>}
```

- [ ] **Step 2: Guard the curated video map against the real catalog (append to src/catalog.test.ts)**

```ts
import { readFileSync } from 'node:fs'

const real: Exercise[] = JSON.parse(readFileSync(new URL('../public/exercises.json', import.meta.url), 'utf8'))
const videos: Record<string, string> = JSON.parse(readFileSync(new URL('../public/videos.json', import.meta.url), 'utf8'))

test('every curated video key is a real exercise id', () => {
  const ids = new Set(real.map(e => e.id))
  assert.deepEqual(Object.keys(videos).filter(k => !ids.has(k)), [])
})

test('search over the real catalog finds the barbell squat first', () => {
  assert.equal(searchExercises(real, { q: 'barbell squat' }, videos)[0].id, 'Barbell_Squat')
})
```

Before relying on `'Barbell_Squat'`, confirm the id: `node -e "console.log(require('./public/exercises.json').find(e=>e.name==='Barbell Squat').id)"`. If it prints something else, use that value.

- [ ] **Step 3: Check, build, push, verify the deploy**

```bash
npm run check && npm run build
git add -A && git commit -m "Empty chat state and catalog guard" && git push
sleep 20
gh run watch --exit-status $(gh run list --workflow Deploy --limit 1 --json databaseId -q '.[0].databaseId')
curl -sI https://duckyquang.github.io/APT/ | head -1
curl -sI https://duckyquang.github.io/APT/icon-192.png | head -1
```

Expected: check clean with 23 tests; Deploy run succeeds; both curls `HTTP/2 200`.

- [ ] **Step 4: Do not tick the README roadmap yet**

The roadmap boxes get ticked only after a live sign-in on the Pages URL has been verified, which needs the founder's Supabase project and Google client (Phase 0 Task 6). Leave README.md unchanged in this task and say so in your report.
