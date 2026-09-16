import type { ToolRunner } from './ai.ts'
import { searchExercises, type Search } from './catalog.ts'
import { pickProfileFields, missingFields, validateWorkoutPlan, validateMealPlan } from './logic.ts'
import { loadProfile, updateProfile, latestWeight, upsertDailyLog, savePlan } from './db.ts'
import { dayKey } from './dates.ts'
import type { Exercise, Videos, Profile, WorkoutPlan, MealPlan } from './types.ts'

export async function applyProfile(userId: string, patch: Partial<Profile>, weightKg?: number) {
  if (weightKg) await upsertDailyLog(dayKey(), { weight_kg: weightKg })
  if (Object.keys(patch).length) await updateProfile(userId, patch)
  const p = await loadProfile()
  const missing = missingFields(p, !!(await latestWeight()))
  if (!p.onboarded_at && !missing.length) await updateProfile(userId, { onboarded_at: new Date().toISOString() })
  return missing
}

export function makeToolRunner(deps: { userId: string; catalog: Exercise[]; videos: Videos; onChange: () => void }): ToolRunner {
  return async (name, raw) => {
    const input = (raw ?? {}) as Record<string, unknown>
    try {
      switch (name) {
        case 'update_profile': {
          const w = typeof input.weight_kg === 'number' ? input.weight_kg : undefined
          const missing = await applyProfile(deps.userId, pickProfileFields(input), w)
          deps.onChange()
          return { result: missing.length ? `saved; still missing: ${missing.join(', ')}` : 'saved; profile complete' }
        }
        case 'search_exercises':
          return { result: JSON.stringify(searchExercises(deps.catalog, input as Search, deps.videos)) }
        case 'save_workout_plan': {
          const plan = input as unknown as { title: string } & WorkoutPlan
          const errors = validateWorkoutPlan(plan, deps.catalog, (await loadProfile()).training_days)
          if (errors.length) return { result: errors.join('\n'), error: true }
          await savePlan('workout', plan.title, { days: plan.days })
          deps.onChange()
          return { result: 'saved' }
        }
        case 'save_meal_plan': {
          const plan = input as unknown as { title: string } & MealPlan
          const errors = validateMealPlan(plan)
          if (errors.length) return { result: errors.join('\n'), error: true }
          await savePlan('meal', plan.title, { days: plan.days })
          deps.onChange()
          return { result: 'saved' }
        }
        default:
          return { result: `unknown tool ${name}`, error: true }
      }
    } catch (e) {
      return { result: e instanceof Error ? e.message : String(e), error: true }
    }
  }
}
