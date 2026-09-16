export function fitSize(iw: number, ih: number, max: number) {
  const s = Math.min(1, max / Math.max(iw, ih))
  return { w: Math.round(iw * s), h: Math.round(ih * s) }
}

export function coverBox(iw: number, ih: number, w: number, h: number) {
  const s = Math.max(w / iw, h / ih)
  const sw = w / s
  const sh = h / s
  return { sx: (iw - sw) / 2, sy: (ih - sh) / 2, sw, sh }
}

// drawImage on a decoded <img> applies EXIF orientation in every current browser, so the
// output is upright pixels; Claude ignores EXIF and would otherwise see phone photos sideways
async function draw(file: Blob, box: (iw: number, ih: number) => { w: number; h: number; sx: number; sy: number; sw: number; sh: number }) {
  const url = URL.createObjectURL(file)
  const img = new Image()
  img.src = url
  try {
    await img.decode()
  } catch {
    URL.revokeObjectURL(url)
    throw new Error('Could not read that image. Please pick a JPEG or PNG.')
  }
  const b = box(img.naturalWidth, img.naturalHeight)
  const c = document.createElement('canvas')
  c.width = b.w
  c.height = b.h
  c.getContext('2d')!.drawImage(img, b.sx, b.sy, b.sw, b.sh, 0, 0, b.w, b.h)
  URL.revokeObjectURL(url)
  return new Promise<Blob>((ok, no) =>
    c.toBlob(blob => (blob ? ok(blob) : no(new Error('Could not encode the image.'))), 'image/jpeg', 0.85))
}

export const resizeToJpeg = (file: Blob, max = 1280) =>
  draw(file, (iw, ih) => ({ ...fitSize(iw, ih, max), sx: 0, sy: 0, sw: iw, sh: ih }))

export const coverCrop = (file: Blob, w = 1080, h = 1350) =>
  draw(file, (iw, ih) => ({ w, h, ...coverBox(iw, ih, w, h) }))

export function toBase64(blob: Blob) {
  return new Promise<string>((ok, no) => {
    const r = new FileReader()
    r.onload = () => ok((r.result as string).split(',')[1])
    r.onerror = () => no(r.error)
    r.readAsDataURL(blob)
  })
}
