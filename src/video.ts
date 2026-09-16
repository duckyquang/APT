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
