<div align="center">

# 🏋️ APT

**A personal trainer that runs on your own API key.**

Paste in an Anthropic key and you get a trainer that builds your plan from a real conversation, reads your meals off a photo, and turns your daily progress pics into a transformation video.

[Live app](https://duckyquang.github.io/APT) · [How it works](#how-it-works) · [Bring your own key](#bring-your-own-key) · [Roadmap](#roadmap)

![status](https://img.shields.io/badge/status-early%20build-white?style=flat&labelColor=000)
![hosting](https://img.shields.io/badge/hosted%20on-GitHub%20Pages-white?style=flat&labelColor=000)
![license](https://img.shields.io/badge/license-MIT-white?style=flat&labelColor=000)

</div>

---

## Why

Every fitness app wants a subscription and then hands you the same template as everyone else. I wanted one that runs on my own API key and actually listens. So I'm building it.

Your key goes browser to Anthropic, nothing in between. The only things I run are a static page on GitHub Pages and a Supabase project that holds your logs and photos. Your key never touches it.

I'm building this for me first. If it's useful to you too, great.

## What it does

- **Talks first, plans second.** Onboarding is a chat, not a form. Height, weight, age, goals, injuries, schedule, what gear you have. Then it writes a plan around you.
- **Workouts you can actually follow.** Sets, reps, rest, form cues, step-by-step instructions and stills for every exercise. The common lifts get a YouTube demo embedded, the rest get a one-tap YouTube search.
- **Meal plans too.** Same trainer, same context. It knows what you lifted this morning when it plans dinner.
- **Snap your meals.** Photo in, calories and macros out, logged to today. Estimates are editable, because a photo is a photo. Think Cal AI, except the model is yours.
- **Water, workouts, all of it logged.** Full history. Ask the trainer how last month went and it can actually answer.
- **Daily progress photo.** One shot a day. When you've got enough, APT stitches them into a transformation video, on your device.
- **Dashboard plus chat.** Your day in the middle, the trainer in a sidebar (a bottom sheet on your phone). Black background, white text, no clutter.
- **Same on every device.** Sign in with Google and your plan, logs and chat are all there. Paste your key on the new device and you're in.

## How it works

1. Open the app and sign in with Google, or tap Try the demo to keep everything in your browser. No password to remember either way.
2. Paste your API key. It stays in your browser and is never uploaded anywhere. New device, paste it again. That's the whole security model, and it's on purpose.
3. Talk to APT. It asks what it needs, then writes your first week.
4. Live your day. Log meals by photo, tap for water, check off sets. Snap a progress pic.
5. Come back tomorrow. It already knows what you ate, drank and lifted, so "make Tuesday shorter" or "I'm still sore" is a one-liner, not a re-onboarding.

## Bring your own key

Anthropic only for now. `claude-opus-5` is the default, `claude-sonnet-5` and `claude-haiku-4-5` are in a dropdown, meal photos work on all three. On a fresh key you'll hit Opus rate limits pretty fast; switch to Sonnet in Settings and it goes away.

You pay Anthropic directly and can watch usage in their console. Use a dedicated key with a spend limit.

Want a different provider? Open an issue. Gemini is next in line, it's about 40 lines.

## What leaves your browser

- Meal photos go to Anthropic with your key, resized to 1280 px first. That's the only thing a model ever sees.
- Progress photos go to your private Supabase storage and nowhere else. The transformation video is rendered on your device and never uploaded.
- Chat history is stored so it's the same on every device. Images are never in it.
- Your API key is never stored anywhere but your own browser.
- In the demo, nothing is uploaded at all. Logs and photos live in that browser until you erase them.

Cost: whatever Anthropic bills you. I haven't measured a typical day yet. When I have real numbers they'll go here.

## Stack

Static React app on GitHub Pages. Supabase for sign-in, database and photo storage. AI calls go browser to Anthropic with your key. Four runtime dependencies. No server. The full design is in [PLAN.md](PLAN.md).

## Run it locally

```bash
git clone https://github.com/duckyquang/APT
cd APT
npm install
npm run dev
```

You need your own Supabase project: run `supabase/schema.sql`, turn on Google sign-in, add `http://localhost:5173` to the Google client's authorized origins, and put your project URL and `sb_publishable_` key at the top of `src/db.ts`. The whole setup is in PLAN.md under Phase 0.

## Roadmap

Everything below is built and runs in the live demo. Google sign-in and syncing across devices still need the one-time Supabase setup in PLAN.md, so the boxes stay unticked until that's verified.

- [ ] Sign in, same data on every device
- [ ] Onboarding conversation and profile
- [ ] Workout plans with instructions and YouTube demos
- [ ] Meal plans
- [ ] Meal photo to macros
- [ ] Water tracking
- [ ] Daily progress photo
- [ ] Workout logging and history
- [ ] Transformation video
- [ ] Add to home screen on iPhone and Android

## Contributing

Issues and PRs welcome. If you're adding a provider, keep it browser-only. No proxies.

## License

MIT
