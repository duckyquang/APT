import * as remote from './supabase.ts'
import * as local from './local.ts'

export { SUPABASE_URL } from './supabase.ts'
export type { MessageRow, NewMeal } from './supabase.ts'
export { zeroTotals } from './logic.ts'
export { startDemo, resetDemo } from './local.ts'

// demo mode: same app, same calls, data stays in this browser
export const DEMO = local.isDemo()

type Api = Omit<typeof remote, 'sb' | 'SUPABASE_URL' | 'SUPABASE_KEY'>
const impl: Api = DEMO ? local : remote

export const {
  signIn, signOut, getSession, onAuthChange, ensureProfile, loadProfile, updateProfile, latestWeight, upsertDailyLog,
  latestPlan, savePlan, dayTotals, dayMeals, loadMessages, insertMessages, clearChat, insertMeal, deleteMeal, insertWater,
  progressPhotoPath, uploadPhoto, signedUrls, dayWorkout, upsertWorkout, recentWorkouts, rangeTotals, rangeWorkouts, rangeMeals, rangePhotos,
} = impl
