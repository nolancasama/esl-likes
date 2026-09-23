# Coloring — the polish pass (frozen contract, 2026-09-23)

The owner played nothing yet, but reviewed the shipped Coloring screen and the
easel reveal and produced a polish list. This pass implements it.

It is **polish, not redesign**. The loop in `.ai/coloring-easel-loop-spec.md`
and the power rule in `.ai/coloring-correction-spec.md` both stand, and every
phase name survives:

```
canvas-question → canvas-answer → coloring → activation-page
  → reveal-easel → robot-exit → room-reveal → room
```

Read both of those first, then this. Where they disagree, **this file wins**.

---

## 1. What the owner's list got right, verified in the source first

Each checked before the work started; none is a guess.

| Claim | Verified |
| --- | --- |
| there is a redundant `<h1>` above a contextual hint | yes — `index.js:919`, `STRINGS.paintTitle` |
| power is a horizontal bar at the bottom | yes — `index.js:816` sets `powerFill.style.width` |
| full power activates by itself | yes — `index.js:876`, `if (info.power >= 1 && phase === 'coloring') beginCharging()` |
| painting stops at full power | yes, as a consequence — `locked: () => phase !== 'coloring'` and `beginCharging` sets `phase = 'activation-page'` |
| Reset is a primary control | yes — third button in `.coloring-tools`, with its own confirm modal |
| Listen Again is a separate large button | yes — `createListenAgain`, `position: absolute; right: 1rem; bottom: 5.4rem` |
| `answerNotice` duplicates the answer | yes — `index.js:694-697`, a second pill showing the same sentence |
| **easel uprights cross in front of the artwork** | **yes, measured — see §6** |

## 2. The easel occlusion, measured

Not a judgement call. From `buildWorld()`:

- front legs: centre `z = 0.02`, depth `0.18` → they occupy **z ∈ [-0.07, 0.11]**
- canvasGroup: `z = 0.04`, `rotation.x = -0.08`, `PAPER_SIZE = 1.7`
- so the paper's top edge sits at `0.04 - 0.85·sin(0.08) = -0.028`
  and its bottom edge at `0.04 + 0.85·sin(0.08) = 0.108`

The paper plane spans **z ∈ [-0.028, 0.108]**, entirely inside the legs' depth
range, at `x = ±0.66` — well inside the paper's `x = ±0.85`. Both front
uprights therefore cut through the picture over its whole height. The owner's
finding is exact.

The shelf (`y = 0.86`, `0.18` tall → top at `y = 0.95`) versus the paper's
bottom edge (`y = 1.78 - 0.85·cos(0.08) = 0.933`) overlaps the picture by
`0.017` of `1.7` — **1%**. The shelf is not the problem and must not be
"fixed" into one.

## 3. The consequence the owner's list does not name — read this one twice

`CAMERA.paper` is `offset: [0, PAPER_CENTRE_Y, 2.59]` **measured from the easel
group origin, not from the sheet**. With the sheet at local `z = 0.04` the real
camera-to-paper distance is `2.55`, and the header comment explains why that
number is load-bearing: at 48° vertical FOV a 1.7-unit page fills ~78% of the
screen, which is what the DOM canvas fills, *and the cross-fade between them
only works if they match*.

**Moving the sheet forward without moving the camera forward by the same amount
breaks the cross-fade.** At `z = 0.24` the distance becomes `2.35` and the
easel sheet appears ~8% larger than the DOM canvas it is dissolving into — a
visible pop at the exact moment the illusion has to hold.

So: introduce a single source of truth and derive everything from it.

```js
/** Local z of the paper plane on the easel. Everything else follows it. */
const PAPER_PLANE_Z = 0.24;      // clears the front uprights (§2)
/** Camera-to-sheet distance. Fixed by the cross-fade, not by taste. */
const PAPER_CAMERA_GAP = 2.55;
CAMERA.paper.offset = [0, PAPER_CENTRE_Y, PAPER_PLANE_Z + PAPER_CAMERA_GAP]
```

The puppet start is the same story. `beginRobotExit` places it at
`EASEL.z + 0.2`, which today is `0.16` **in front** of the sheet. Move the
sheet to `0.24` and the newborn robot starts *behind the paper it is supposed
to be peeling off*. Derive it:

```js
const PUPPET_START_Z = PAPER_PLANE_Z + 0.16;   // used by placeAt and the arc
```

Both `placeAt` calls in `beginRobotExit` and `updateRobotExit` use it. Nothing
in this pass may leave a bare `EASEL.z + 0.2` behind.

---

## 4. The screen — what changes

### 4.1 One hint, centred, contextual

Delete the `<h1>` and `STRINGS.paintTitle` **as visible text**. The string
survives only as the canvas's accessible name (`paintingCanvas` currently uses
it for `aria-label`); rename it `canvasLabel` or keep `paintTitle` and use it
for that alone. The canvas must not lose its accessible name.

`.coloring-screen__top` holds exactly one element: the existing
`paintInstruction`, horizontally centred over the canvas, at every viewport.

The sequence, one line at a time, never two at once:

| when | text |
| --- | --- |
| before the question | `ボタンを おして、「What color do you like?」と きこう` |
| robot answered, no colour chosen | `いろを えらぼう` |
| a colour is chosen | `すきなように ぬろう！` |
| power reaches full | `できたら「できた！」を おそう` |
| Finished pressed | existing `STRINGS.powerFull`, then `STRINGS.alive` |

`What color do you like?` is **exactly** that, in English, inside the Japanese
line. Do not translate it, do not change its capitalisation or punctuation.

The existing `needsColor` branch of `onPaintChanged` keeps its own behaviour
(it reverts the line to `いろを えらぼう` and flashes the palette).

**This hint never mentions the favourite colour.** `.ai/coloring-correction-spec.md`
froze that: a child who did not hear the colour gets no on-screen rescue, by the
owner's explicit instruction, deferred to classroom testing. `すきなように
ぬろう！` is safe precisely because it reveals nothing. Do not "improve" it.

### 4.2 ROBOT POWER becomes a vertical meter on the right

Remove the horizontal bar from `.coloring-screen__bottom`. The meter is a
vertical battery beside the **right edge of the picture**, label under it,
⚡ over it, and it **fills bottom → top**.

`setPower()` changes `height`, not `width`. Anchor the fill to the bottom of
the track (`position: absolute; left: 0; right: 0; bottom: 0`). Keep every
existing behaviour: the `role="progressbar"` with `aria-valuenow`, the
`coloring-power--full` class, the milestone pulses fired by `fireMilestone`,
and the `transition` (now on `height`).

**Centring is the constraint, not the layout.** `.coloring-screen__work` is
already `minmax(0,1fr) auto minmax(0,1fr)`; the meter replaces
`.coloring-side-spacer` in the right column, and because both flanks are equal
`1fr` the picture stays screen-centred whatever the columns contain. Keep
`visibility: hidden` (never `display: none`) for the hidden stage, so the space
stays reserved and the canvas does not move when the tools arrive.

**The collapsed layout needs an explicit answer.** At `max-height: 34rem` the
work grid already drops to **one column** and hides the spacer — and `760×420`
is inside that query, so this is not an edge case, it is one of the three
required viewports. Decide where the vertical meter lives there and say so in
the report. It must still read as a vertical meter beside the picture, and the
picture's horizontal centre must still not move when the tools appear.

Evidence required: the picture's measured horizontal centre, before and after
the tools appear, **at each of 760×420, 1024×600, 1366×768**. The previous pass
reported `683.00 → 683.00, delta 0.00`. Anything above `0.5px` is a regression.

### 4.3 The bottom row is three buttons

Exactly, centred, in this order:

```
↶ もどす     けしゴム     できた！
```

`できた！` is the primary action and must not look like a third grey tool —
give it its own colour and weight, the way `.coloring-room-ui__action` is
distinct from `.coloring-tool`.

**Reset leaves normal gameplay.** Remove the button, its `--reset` styling in
the toolbar, `askReset`/`closeReset`, and the whole `.coloring-reset-confirm`
modal and its four strings from the visible UI.

**But do not delete `confirmReset`'s logic.** The playthrough harness uses the
Reset button at `scripts/playthrough-coloring.mjs:334` to return the canvas to a
clean slate between power measurements. Expose it as a dev/harness-only hook on
the existing debug object, beside `coloringSpawn`:

```js
if (devTools) window.__eslDebug.coloringReset = resetArtwork;
```

Same guard, same teardown in `disposeDebug`. That is the "secondary/debug-like"
placement the owner's list allows, and it keeps the harness's clean-slate step
honest instead of making it undo fifty strokes.

### 4.4 Full power no longer activates anything

Delete `if (info.power >= 1 && phase === 'coloring') beginCharging()`.

At full power: the meter pulses once, the robot blinks once, `できた！` becomes
enabled, and **painting stays fully enabled** — `phase` stays `'coloring'`, so
`locked: () => phase !== 'coloring'` needs no change. The child may keep
choosing colours, decorating, erasing and undoing for as long as they like.

`できた！` is `disabled` below full power and enabled at full power, re-checked
on **every** `onPaintChanged` — so overpainting or erasing liked-colour area
back below the threshold disables it again, and restoring it re-enables it. The
button must never claim a readiness the artwork does not have.

**The celebration fires once per round, on the first enable only.** Repeated
pulses as a child paints across the threshold is the "continuously flashing"
the list forbids. One glow/bounce, a flag, done.

Pressing `できた！` at full power calls `beginCharging()` — unchanged from
there, and with **no confirmation dialog**. Below full power it is disabled and
does nothing.

### 4.5 The speaker moves into the bubble

Stop calling `createListenAgain` in Coloring. **Leave `src/ui/listenAgain.js`
alone** — Restaurant, Drink Stand, Sports and Zoo all still use it, and this
pass touches none of them.

The bubble gains a small speaker control: `I like blue.` and a `🔊` button
inside or immediately beside it. No `もういちど きく` text anywhere on screen.

- `aria-label` and `title` are both `UI.listenAgain`'s text (`もういちど きく`)
- keyboard focusable, activated by Enter and Space
- it calls the existing `replayAnswer`, which **must keep setting `replayed`** —
  that flag is the memory bonus in scoring and is easy to drop by accident
- on a mouse/touch press it must **blur itself** (`event.detail > 0`), exactly
  as `createListenAgain` does. Space is the interact key; a button left focused
  eats the child's next Space press. This is a real bug, not a nicety.
- never bound to the global interact key

**The bubble stays visible for the whole of `coloring`.** It is the persistent
answer display and a light memory aid, which is appropriate now that only the
spoken colour charges the meter. It hides when the round ends.

Delete `answerNotice`, `answerNoticeRemaining`, its markup, its CSS and its tick
branch. A replay instead pulses the existing bubble (a short wiggle, reusing the
`coloring-speak` idiom) and speaks. The bubble already carries
`role="status" aria-live="polite"`, so the announcement is not lost.

---

## 5. The easel

Apply §3. Then:

- the paper plane and its art overlay stay in the one `canvasGroup`, unchanged —
  they may never be able to desynchronise
- nothing structural may sit in front of the sheet: not the front uprights, not
  the rear leg, not the centre support
- the shelf may sit in front of / under the **bottom edge only**, ≤ 4% of the
  paper's height, reading as *the paper rests on this*. It is at 1% today; keep
  it small. Move it forward with the sheet so it still supports it.
- solve it with **positions**, not with `renderOrder` or `depthTest: false`
- `PAPER_CENTRE_Y`, `PAPER_SIZE`, the paper's aspect ratio and the art overlay's
  alignment with it are all unchanged

Then re-derive the emergence: the puppet starts **in front of** the paper plane,
its arc to `ROBOT_LANDING_Z` starts from there, and the first pose must coincide
with the printed robot. No clipping through legs or shelf.

`PLAYER_RETREAT_X = -1.85` and the partial turn stay exactly as they are. The
handoff records why: world-space distance is not screen-space clearance, and a
purely backward retreat moves the player *towards the camera*. Do not simplify
this back.

---

## 6. Tests

Unit tests for everything above that is not a rendering judgement:

- the visible title is gone; the canvas still has an accessible name
- exactly one hint element, and it carries the exact English question
- the hint text at each of the four stages
- vertical meter: `setPower` writes `height`, the fill is bottom-anchored, and
  `aria-valuenow` still tracks
- a non-liked colour moves power not at all; the liked colour moves it
- full power does **not** change `phase`
- `できた！`: disabled below full, enabled at full, disabled again when power
  drops, enabled again when it is restored, celebration fires once only
- pressing it at full power starts activation; pressing it below full does not
- the canvas is still paintable, and undo and eraser still work, at full power
- the bubble: appears after an accepted question, contains the exact
  `I like <colour>.`, holds a focusable speaker, survives into `coloring`,
  replays, sets `replayed`, and creates no second notice
- no `.listen-again` element exists in the Coloring screen
- geometry, from the built world: the sheet's world z is in front of every
  easel upright's front face; no upright's bounding box crosses the sheet's
  plane; the shelf intersects only the bottom band; the puppet's start z is in
  front of the sheet; `CAMERA.paper` still sits `PAPER_CAMERA_GAP` from it

`npm test` must stay green in full — 600 tests pass today.

---

## 7. Acceptance — who does what

**The controller runs the browser, not the worker.** Codex's sandbox cannot
start this preview; a previous pass shipped a render-loop `ReferenceError` past
a fully green test suite for exactly that reason. Do not claim a visual result
you did not render.

The harness (`scripts/playthrough-coloring.mjs`) must be updated in step: the
Reset click becomes the debug hook, the full-power step becomes a `できた！`
click, and the new assertions above go in. It is a **trusted** harness today —
a known-bad copy went red on exactly the eight artwork-persistence checks — and
it stays trusted only if a known-bad run is re-demonstrated after the change.

Browser pass, at `760×420`, `1024×600`, `1366×768`, **one run each**, with
screenshots: opening with no title and one centred hint; the answer bubble and
its speaker; tools appearing with no canvas shift; a non-liked colour moving
nothing; the liked colour filling the meter upward; full power **not**
activating; `できた！` enabling, disabling as liked paint is erased, re-enabling;
activation on press; and the easel reveal with the sheet clearly in front of the
wood and the robot emerging from its front surface.

No looping full-playthrough re-runs and no unrequested regression sweeps: one
run, one targeted section re-run if something fails, then report.

---

## 8. Recording the decisions

Append to `DESIGN_DECISIONS.md` in the same task — date, what, why, rejected
alternative — at minimum:

- the child decides when the robot is finished, and full power is permission
  rather than a trigger
- the sheet moves forward of the easel frame, and the camera moves with it
  because the cross-fade is calibrated to the sheet, not to the easel origin
- the answer bubble persists through coloring and absorbs the replay control

Update `CURRENT_STATE.md`. **Do not commit and do not push.**
