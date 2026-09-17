-- APT schema. Run once in the Supabase SQL editor of a fresh project.

create table public.profiles (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  name text,
  sex text,
  birth_date date,
  height_cm numeric check (height_cm > 0),
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
  duration_min int check (duration_min >= 0),
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
  check (kcal >= 0 and protein_g >= 0 and carbs_g >= 0 and fat_g >= 0 and fiber_g >= 0),
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
  ml int not null check (ml > 0)
);
create index water_by_day on public.water (user_id, date desc);

create table public.daily_logs (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  weight_kg numeric check (weight_kg > 0),
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
