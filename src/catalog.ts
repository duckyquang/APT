import type { Exercise, Videos } from './types.ts'

export const STILLS = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/'

export async function loadCatalog(): Promise<{ catalog: Exercise[]; videos: Videos }> {
  const base = import.meta.env.BASE_URL
  const [catalog, videos] = await Promise.all([
    fetch(base + 'exercises.json').then(r => r.json()),
    fetch(base + 'videos.json').then(r => r.json()),
  ])
  return { catalog, videos }
}

export type Search = { q?: string; muscle?: string; equipment?: string }

export function searchExercises(catalog: Exercise[], s: Search, videos: Videos, limit = 20) {
  const q = s.q?.toLowerCase().trim()
  const muscle = s.muscle?.toLowerCase().trim()
  const equipment = s.equipment?.toLowerCase().trim()
  const hits = catalog.filter(e =>
    (!q || e.name.toLowerCase().includes(q)) &&
    (!muscle || e.primaryMuscles.some(m => m.includes(muscle))) &&
    (!equipment || (e.equipment ?? '').includes(equipment)))
  // videos first, then shorter names so "Barbell Squat" beats "Barbell Squat To A Bench"
  hits.sort((a, b) => Number(b.id in videos) - Number(a.id in videos) || a.name.length - b.name.length)
  return hits.slice(0, limit).map(e => ({
    id: e.id,
    name: e.name,
    equipment: e.equipment,
    primaryMuscles: e.primaryMuscles,
    has_video: e.id in videos,
  }))
}
