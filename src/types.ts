import type { Weekday } from './dates.ts'

export type Exercise = {
  id: string
  name: string
  equipment: string | null
  primaryMuscles: string[]
  secondaryMuscles: string[]
  instructions: string[]
  category: string
  images: string[]
}

export type Videos = Record<string, string>

export type Targets = { kcal?: number; protein_g?: number; carbs_g?: number; fat_g?: number; water_ml?: number }

export type Profile = {
  user_id: string
  name: string | null
  sex: string | null
  birth_date: string | null
  height_cm: number | null
  goal: string | null
  activity_level: string | null
  training_days: Weekday[]
  equipment: string | null
  injuries: string | null
  dietary_prefs: string | null
  targets: Targets
  units: 'metric' | 'imperial'
  model: string
  onboarded_at: string | null
  updated_at: string
}

export type PlanExercise = { exercise_id: string; name: string; sets: number; reps: string; rest_s: number; notes?: string }
export type WorkoutPlan = { days: { weekday: Weekday; name: string; exercises: PlanExercise[] }[] }
export type MealItem = { food: string; qty: string; kcal: number; protein_g: number; carbs_g: number; fat_g: number }
export type PlanMeal = { name: string; items: MealItem[]; kcal: number; protein_g: number; carbs_g: number; fat_g: number }
export type MealPlan = { days: { weekday: Weekday; meals: PlanMeal[] }[] }
export type PlanRow = { id: string; kind: 'workout' | 'meal'; title: string | null; content: WorkoutPlan | MealPlan; created_at: string }

export type DailyTotals = {
  date: string
  kcal: number
  protein_g: number
  carbs_g: number
  fat_g: number
  water_ml: number
  workout_done: boolean
  weight_kg: number | null
}

export type MealRow = {
  id: string
  date: string
  eaten_at: string
  photo_path: string | null
  name: string | null
  items: unknown[]
  kcal: number
  protein_g: number
  carbs_g: number
  fat_g: number
  fiber_g: number
  confidence: string | null
  assumptions: string | null
  source: 'photo' | 'manual' | 'agent' | 'plan'
}

export type MealEstimateItem = {
  name: string
  portion_estimate: string
  grams: number
  kcal: number
  protein_g: number
  carbs_g: number
  fat_g: number
  fiber_g: number
}

export type MealEstimate = {
  items: MealEstimateItem[]
  totals: { kcal: number; protein_g: number; carbs_g: number; fat_g: number; fiber_g: number }
  confidence: 'low' | 'medium' | 'high'
  assumptions: string
}

export type WorkoutSet = { reps: number; weight_kg: number; done: boolean }
export type WorkoutExercise = { exercise_id: string | null; name: string; sets: WorkoutSet[] }
export type WorkoutRow = {
  id: string
  date: string
  plan_id: string | null
  day_name: string | null
  exercises: WorkoutExercise[]
  duration_min: number | null
  notes: string | null
  created_at: string
}
