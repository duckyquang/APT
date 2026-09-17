import { errorMessage, type ToolRunner } from './ai.ts'
import { searchExercises, type Search } from './catalog.ts'
import { pickProfileFields, missingFields, validateWorkoutPlan, validateMealPlan, when } from './logic.ts'
import { loadProfile, updateProfile, latestWeight, upsertDailyLog, savePlan, insertMeal, insertWater, upsertWorkout, rangeTotals, rangeWorkouts, rangeMeals } from './db.ts'
import { dayKey } from './dates.ts'
import type { Exercise, Videos, Profile, WorkoutPlan, MealPlan } from './types.ts'

export async function applyProfile(userId: string, patch: Partial<Profile>, weightKg?: number) {
  const [p, weight] = await Promise.all([loadProfile(), latestWeight()])
  // targets is one jsonb column; a partial patch must not drop the other targets
  if (patch.targets) patch = { ...patch, targets: { ...p.targets, ...patch.targets } }
  const missing = missingFields({ ...p, ...patch }, !!(weightKg || weight))
  if (!p.onboarded_at && !missing.length) patch = { ...patch, onboarded_at: new Date().toISOString() }
  await Promise.all([
    weightKg ? upsertDailyLog(dayKey(), { weight_kg: weightKg }) : null,
    Object.keys(patch).length ? updateProfile(userId, patch) : null,
  ])
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
        case 'log_meal': {
          const m = input as { name: string; kcal: number; protein_g: number; carbs_g: number; fat_g: number; fiber_g?: number; date?: string; time?: string }
          const at = when(m.date, m.time)
          await insertMeal({
            date: dayKey(at), eaten_at: at.toISOString(), photo_path: null, name: m.name, items: [],
            kcal: Math.round(m.kcal), protein_g: m.protein_g, carbs_g: m.carbs_g, fat_g: m.fat_g, fiber_g: m.fiber_g ?? 0,
            confidence: null, assumptions: null, source: 'agent',
          })
          deps.onChange()
          return { result: 'logged' }
        }
        case 'log_water': {
          const w = input as { ml: number; date?: string; time?: string }
          await insertWater(Math.round(w.ml), when(w.date, w.time))
          deps.onChange()
          return { result: 'logged' }
        }
        case 'log_workout': {
          const w = input as { date?: string; day_name: string; duration_min?: number; notes?: string; exercises: { exercise_id?: string; name: string; sets: { reps: number; weight_kg: number }[] }[] }
          await upsertWorkout({
            id: crypto.randomUUID(), date: dayKey(when(w.date)), plan_id: null, day_name: w.day_name,
            exercises: w.exercises.map(x => ({ exercise_id: x.exercise_id ?? null, name: x.name, sets: x.sets.map(s => ({ reps: s.reps, weight_kg: s.weight_kg, done: true })) })),
            // ponytail: 0 means finished with an unknown duration; the view keys workout_done on a non-null duration
            duration_min: Math.round(w.duration_min ?? 0), notes: w.notes ?? null, created_at: new Date().toISOString(),
          })
          deps.onChange()
          return { result: 'logged' }
        }
        case 'get_history': {
          const h = input as { days?: number; include_meals?: boolean }
          const days = Math.min(90, Math.max(1, Math.round(h.days ?? 14)))
          const to = dayKey()
          const from = dayKey(new Date(Date.now() - (days - 1) * 864e5))
          const [totals, workouts, meals] = await Promise.all([rangeTotals(from, to), rangeWorkouts(from, to), h.include_meals ? rangeMeals(from, to) : []])
          return { result: JSON.stringify({
            totals,
            workouts: workouts.map(x => ({ date: x.date, day: x.day_name, min: x.duration_min, exercises: x.exercises.map(e => `${e.name}: ${e.sets.filter(s => s.done).map(s => `${s.reps}@${s.weight_kg}`).join(' ')}`) })),
            meals: meals.map(m => ({ date: m.date, name: m.name, kcal: m.kcal })),
          }) }
        }
        default:
          return { result: `unknown tool ${name}`, error: true }
      }
    } catch (e) {
      return { result: errorMessage(e), error: true }
    }
  }
}
