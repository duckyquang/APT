# Design critique: APT as of commit 8669710

Read off the source (no browser in this session), so this is about structure, states and flow rather than pixel rendering.

## Overall impression

The bones are right: dark ground, monospace labels, big numbers, one blue for data. What makes it feel sketchy is uniformity and inertness. Every card is the same flat gray with the same weight, the sign-in screen is three lines and two plain buttons, Settings is a stack of native browser controls, nothing responds to hover or press, and the chat column is a fixed 380 px slab you cannot close.

## Usability

| Finding | Severity | Recommendation |
|---|---|---|
| The chat sidebar has no close control on desktop, and on mobile the only control is an emoji floating button | Critical | A labelled toggle in the header on every size; on desktop animate the column to zero width so the grid reflows |
| Sign-in screen is bare: an h1, a sentence, two buttons of which the demo one looks secondary even when it is the only working path | Critical | Make the working path the primary button, add a three-point feature strip, give the wordmark some presence |
| Today scrolls as a long single column of equal tiles; the workout, the thing you came for, sits below the heatmap | Moderate | A fixed-height grid on desktop: stat strip on top, workout and consistency in the middle, meals and photo below, each scrolling inside its tile |
| Settings mixes two save models: provider and model save instantly, the profile needs a button | Moderate | One model: everything edits in place, a sticky "Save changes" bar appears only when something is dirty; the key has its own explicit Save because it is validated |
| Settings uses native selects, checkboxes and number inputs, which look different on every platform | Moderate | Segmented controls, steppers, day chips and a model picker, all styled the same |
| Buttons have no hover, press or focus treatment | Moderate | Metal gradient surfaces, a press transform, a visible focus ring |
| Meal actions, weigh-in and water inputs are inline unstyled rows | Minor | Group actions at the tile head, use the stepper for numbers |
| Stat-row icons are emoji, so they render differently per OS | Minor | Keep glyphs simple (✓ ⏱ ≡) and let the colored chip carry the meaning |

## Visual hierarchy

- **First look**: the four big numbers, which is right, but all four weigh the same and nothing anchors the page.
- **Reading flow**: left to right across equal tiles; there is no primary object.
- **Emphasis**: give each tile its own accent hue so the eye can tell calories from water at a glance, and let the workout tile be the widest thing on screen.

## Consistency

| Element | Issue | Recommendation |
|---|---|---|
| `.pill` | Used for the demo badge, plan status, and plan title | Keep pills for status, use the meta style for titles |
| Buttons | Three visual sizes across tiles | One size, two variants (metal, primary) |
| Labels | `h2` in some tiles, `.label` in others | `.label` everywhere on tiles |

## Accessibility

- Muted text at #8e8e93 on #141414 is about 4.3:1, under AA for small text; lift it to #9a9aa3.
- Buttons are about 36 px tall; go to 40 px minimum and 44 px for the primary.
- No custom focus-visible ring; add one.

## What works

- The monospace label plus big number pattern, straight from the reference.
- The consistency heatmap and the tinted plan cards read well and match the references.
- One data hue with labeled deltas keeps the charts honest.

## Priority recommendations

1. Structure and motion: 100vh dashboard grid on desktop, collapsible animated sidebar, tiles that reflow.
2. Surfaces: liquid-metal cards and buttons with real states, per-tile accent colors.
3. Settings as a settings screen: grouped rows, segmented controls, steppers, model picker, key row with masked value and status.
