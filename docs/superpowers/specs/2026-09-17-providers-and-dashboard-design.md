# Providers and dashboard redesign

Written 2026-09-17, on top of PLAN.md. Two changes the founder asked for after trying the plan: APT should work with OpenAI and Gemini keys as well as Anthropic, and the UI should take its look and its widgets from three reference screenshots (an ops dashboard grid, gradient project cards, and a workout summary with icon stat rows).

## Providers

One interface, three adapters, one dropdown.

- `src/providers/types.ts`: `Provider = { validateKey(key, model), chatTurn(key, opts), analyzeMeal(key, model, jpegBase64, text, schema) }`. Chat history is provider-neutral: `Msg = { role, content: Block[] }` with `Block` being `text`, `tool_use { id, name, input }` or `tool_result { tool_use_id, content, is_error }`. This is the Anthropic shape minus thinking, so the stored rows don't change; unknown block types are dropped when history is rebuilt.
- `src/providers/defs.ts`: the tool definitions as plain JSON Schema, the trainer persona, the meal-analysis instruction and the meal JSON schema. Shared by all three adapters.
- `src/providers/anthropic.ts`: what `ai.ts` did before, moved. Streaming with tools, `messages.parse` for meals, thinking omitted.
- `src/providers/openai.ts`: Responses API with `stream: true`, function tools, `function_call_output` items, `input_image` data URL for meals, `text.format` json_schema strict.
- `src/providers/gemini.ts`: `generateContentStream` with `functionDeclarations` carrying `parametersJsonSchema`, `functionResponse` parts, `inlineData` for meals, `responseJsonSchema` for the JSON.
- `src/ai.ts` becomes the facade: `PROVIDERS` (label and known model ids), `getKey(provider)` and `setKey(provider, key)` in localStorage per provider (the old single key migrates to Anthropic), `validateKey`, `chatTurn`, `analyzeMeal`, `errorMessage` keyed on the error's `status` so all three SDKs map to the same four messages.
- Profile gains `provider` (`anthropic` default). Settings gets a provider dropdown, a model field that is free text with the known ids as suggestions (I cannot verify current OpenAI or Gemini model names without a key), and one key input per provider. Switching provider resets the model to that provider's first suggestion.
- Gemini rejects `additionalProperties` inside `responseSchema`, which is why the adapter uses `responseJsonSchema` and `parametersJsonSchema`, both of which take standard JSON Schema. Gemini also wants strict user/model alternation, so consecutive same-role messages are merged when converting.
- Not verified live: I have no OpenAI or Gemini key here. Both adapters are type-checked against the installed SDKs and their converters have node tests; the first real call is the founder's.

## Dashboard

Design language from the references: near-black ground, cards with hairline borders and 16 px radius, small monospace uppercase labels with a right-aligned range, big numbers with the unit in muted text, a single blue for data marks, green and red only for labeled deltas, per-card gradient tints on plan cards, colored icon chips on stat rows.

Today widgets, in order:

1. Calories: number vs target, 7-day bars.
2. Macros: protein, carbs and fat as bars against targets, labeled directly.
3. Water: number, a segmented strip toward the target, quick-add buttons.
4. Weight: number, delta versus seven days ago with an arrow, a 30-day sparkline.
5. Consistency: an 8-week heatmap, one cell per day, three steps of one hue: nothing, something logged, workout done. Legend under it.
6. Workout: the checklist restyled with a progress bar; once finished it shows stat rows (duration, sets, volume, exercises) with icon chips.
7. Meals and the progress photo, restyled to match.

All of it is fed by one extra query per load, `rangeTotals` over the last 56 days, which serves the bars, the sparkline and the heatmap.

Plan tab: one gradient card per training day (title, exercise count, this week's completion bar, a pill saying Today, Tomorrow or the weekday), expanding to the existing exercise rows. History and Chat keep their structure and take the new tokens.

Charts are inline SVG with a native `<title>` tooltip per mark, no library.

## Out of scope

Drag-to-rearrange widgets, cost tracking, avatars, and anything that needs data the app doesn't log.
