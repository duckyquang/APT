<div align="center">

# 🏋️ APT

**Your AI personal trainer. Your API key. Your data, on every device.**

Paste in an AI API key and you get a trainer that builds your plan from a real conversation, reads your meals off a photo, and turns your daily progress pics into a transformation video.

[Live app](https://duckyquang.github.io/APT) · [How it works](#how-it-works) · [Bring your own key](#bring-your-own-key) · [Roadmap](#roadmap)

![status](https://img.shields.io/badge/status-early%20build-white?style=flat&labelColor=000)
![hosting](https://img.shields.io/badge/hosted%20on-GitHub%20Pages-white?style=flat&labelColor=000)
![license](https://img.shields.io/badge/license-MIT-white?style=flat&labelColor=000)

</div>

---

## Why

Every fitness app wants a subscription, a login, and then hands you a template. APT flips it. You bring the model. The plan comes out of an actual conversation about you. Everything you log lives in your own account, so what you started on the laptop is there on your phone at the gym.

No middleman on inference. Your key talks straight to the provider from your browser. There is no APT server in between, because there isn't an APT server.

## What it does

- **Talks first, plans second.** Onboarding is a chat, not a form. Height, weight, age, goals, injuries, schedule, what gear you have. Then it writes a plan around you.
- **Workouts you can actually follow.** Every exercise gets sets, reps, rest, form cues, and a YouTube demo so you're never guessing.
- **Meal plans too.** Same trainer, same context. It knows what you lifted this morning when it plans dinner.
- **Snap your meals.** Photo in, calories and macros out, logged to today. Think Cal AI, except the model is yours.
- **Water, workouts, all of it logged.** Full history. Ask the trainer how last month went and it can actually answer.
- **Daily progress photo.** One shot a day. When you've got enough, APT stitches them into a transformation video.
- **Dashboard plus chat.** Your day in the middle, the trainer in the sidebar. Black, white, dark. Apple-clean.
- **Cloud synced.** Sign in anywhere, it's all there.

## How it works

1. Open the app and sign in. Magic link, no password to remember.
2. Paste your API key. It's saved to your account and used only from your browser.
3. Talk to APT. It asks what it needs, then writes your first week.
4. Live your day. Log meals by photo, tap for water, check off sets. Snap a progress pic.
5. Come back tomorrow. It adjusts.

## Bring your own key

| Provider | Model | Meal photos |
|---|---|---|
| Anthropic | `claude-opus-5` | yes |

You pay the provider directly at their rates and can watch usage in their console. APT never sees your key on a server.

## Stack

Static React app on GitHub Pages. Supabase for sign-in, database, and photo storage. AI calls go browser to provider with your key. That's the whole thing.

## Run it locally

```bash
git clone https://github.com/duckyquang/APT
cd APT
npm install
cp .env.example .env    # Supabase URL + anon key
npm run dev
```

## Roadmap

- [ ] Onboarding conversation and profile
- [ ] Workout plans with YouTube demos
- [ ] Workout logging and history
- [ ] Meal plans
- [ ] Meal photo to macros
- [ ] Water tracking
- [ ] Daily progress photo
- [ ] Transformation video
- [ ] Cloud sync across devices
- [ ] Mobile app

## Contributing

Issues and PRs welcome. If you're adding a provider, keep it browser-only. No proxies.

## License

MIT
