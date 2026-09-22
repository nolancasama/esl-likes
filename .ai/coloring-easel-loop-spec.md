# Coloring — the magical easel loop (frozen contract, 2026-09-22)

This is the contract for the third revision of Coloring. It records what the
owner's plan asked for, what was **already true** before the plan was written,
the one gap the plan does not close, and the frozen interfaces.

Read this before `index.js`.

---

## 1. Most of the plan's "keep" list is already built

The plan opens by listing systems to preserve. All of them exist and are
tested. **Do not rebuild any of them, and do not "restore" them — they are
not missing.**

| Plan section | State |
| --- | --- |
| §5 free coloring, no regions/★/labels | already true (`picture.js`, `coverage.js`) |
| §6 seven colours | already true (`palette.js`) |
| §7 brushes 18/38/70, medium default, dots not a slider | already true (`brushes.js`) |
| §8 undo + eraser | already true, plus a guarded reset |
| §9 unique-area power, no farming, no background credit, favourite bonus | already true (`coverage.js`, measured in browser) |
| §10 threshold | already tuned: `POWER_THRESHOLD = 0.68`, full power lands at ~69.5% real coverage |
| §31 close-up is 2D, puppet is 3D only after activation | already true |
| §32 simple connected silhouette, not 18 fragmented regions | **already true** — the 18-region design was deleted a pass ago; the current robot is v1's proportions with the gaps closed, 11 shapes over 5 pieces |
| §33 five-piece puppet, hop/flap/squash, seams hidden by overlap | already true (`robotPuppet.js`, `paperPuppet.js`) |
| §21 each robot owns its texture | already structurally true — `createPaperPuppet` draws each piece into its own canvas at construction. Nothing is shared and nothing is re-read per frame. |

So the real work is the **loop**: §1–4, §11–30, §34–44.

## 2. The gap the plan does not close: there is no way out

`finish()` is the **only** exit from a minigame. `src/main.js` has no back
button, no pause-and-leave, and no escape key. §27 deletes the gift and
turnaround phases — which is precisely where `finish()` was called.

Implemented literally, the plan traps the child in Coloring forever and awards
no stamp.

It also deletes a **frozen** requirement. `SPEC.md` line 10:

> `"I like ___."` — the student HEARS this, and must act on it
> — and SAYS it once per minigame (see Turnaround)

and SPEC §"Turnaround beat": *"At the end of every minigame, one NPC turns the
question around."* The saved answer feeds the hub's "You like pizza!". Asking
the question every round while never once answering it removes half the
language objective from this minigame.

### Resolution (accepted, and part of this contract)

Add a **door**, and hang the turnaround on it.

- The room gets a plain doorway on the back wall, labelled 「おわる」.
- Approaching it and pressing Space starts the turnaround.
- **The robot the child made most recently asks the question.** The camera
  moves to it, it turns to face the child, and it asks
  `What color do you like?`. The child answers. Then `finish()`.
- This is better than the old artist NPC, not a fallback: your own creation
  asking you back is the fiction the plan is building.
- There is always at least one robot when the room exists, because the first
  round starts at the canvas and the room is only ever revealed after robot 1
  lands (§29). No empty-room case to handle.

The door is deliberate and labelled, so nobody ends a session by walking past
a robot. It is the only Space action that ends anything.

### Stars

No result modal (§10), so stars come from the session, not a round:

```
stars = min(3, robotsCompleted)      // and never less than 1
```

`scoreRound()` in `coverage.js` is **deleted** along with its tests, and a
`sessionStars(robots)` replaces it. Accumulation is the reward (§20), so
accumulation is what the stamp counts. Coverage is not graded — it cannot be,
since a robot that exists has already passed the 68% threshold by definition.

---

## 3. The phase model (frozen)

```
inactive
canvas-question      ← FIRST ENTRY STARTS HERE. No room, no walking.
canvas-answer        the drawing answers "I like ___."
coloring             tools visible; paint freely
activation-page      power full: input frozen, pulse, blinks, shake, tiny hop
reveal-easel         stage 1→2: DOM screen cross-fades out over the 3D easel
robot-exit           the puppet peels off the canvas, hops, drops, lands, celebrates
room-reveal          stage 2→3: camera eases back; the canvas goes blank
room                 free play: walk; easel Space = new round; door Space = leave
to-canvas            transition into the close-up; the round resets
turnaround           the newest robot asks "What color do you like?"
finishing
```

Every old phase name is gone. `approach`, `gift`, `reaction` and
`transition-to-painting` do not survive under any spelling.

## 4. The three camera stages (§12, §14, §34)

`cameraRig` already damps toward whatever preset it is given, so a staged
pullback is three `setPreset` calls and no new camera code. **Do not write a
tween.** Use a low damping (~2.0–2.6) for the two cinematic stages so the move
reads as a deliberate pull-back rather than a snap.

| Stage | Target | Framing | When |
| --- | --- | --- | --- |
| 1 — paper | the easel | tight on the paper | set before the cross-fade, so the 3D easel is already framed when the DOM screen fades |
| 2 — easel | the easel | far enough to show the easel and the player in front of it | `reveal-easel` → `robot-exit` |
| 3 — room | the player | the normal `follow` preset | `room-reveal` → `room` |

### The cross-fade, and why not the wipe

`transitions.run()` is a scale-X wipe — a hard cut. §12 asks for the illusion
to survive. So stage 1→2 is a **cross-fade**: the finished page is drawn onto
the easel's canvas texture, the camera is placed at stage 1, `world.visible`
goes true, and then the DOM `.coloring-screen` fades its own opacity to 0 over
~0.5 s. The child sees the same picture they were painting, now on an easel,
with their own avatar in front of it.

The DOM canvas and the easel's paper plane must land at **roughly** the same
place and size on screen, or the fade reads as two unrelated images. Author
stage 1's framing against a real screenshot; this is judged by looking.

`transitions.run()` is still right for `to-canvas` (§19), which is a
deliberate change of view, not an illusion.

## 5. The easel canvas: blank → fading → ready (§18, §36, §37, §38)

One `CanvasTexture` on the easel's paper plane, in one of three states:

- `blank` — plain paper.
- `fading` — the line art fades in over ~1.2 s, starting 2.5–4 s after the
  previous robot lands.
- `ready` — line art at full strength.

**Space works in all three states, always** (§17). There is no lockout and no
"wait for the next picture" message anywhere. Pressing Space while `blank` or
`fading` prepares the page during the `to-canvas` transition, so the close-up
is never established on an empty canvas.

There is exactly **one** robot drawing. The plan's talk of "generate/select the
new B&W drawing" (§17, §18, §37, §38) is about the *fade state*, not about
multiple pictures — a second picture was ruled out two passes ago and is still
ruled out. Every round is the same robot, coloured differently.

## 6. The crowd: `robotCrowd.js` (new, pure)

No navmesh, no steering, no avoidance loop, and **nothing that can jitter**
(§24). Spacing is decided **once, at join**, by giving each robot its own
slightly displaced copy of the authored roam points:

```js
export const RING_RADIUS = 0.62;      // how far a member's points may shift

createCrowd({ points = ROAM_POINTS, random = Math.random })
  crowd.join()   → { id, start, idlePause, stateTime, points }
  crowd.leave(id)
  crowd.size
```

- `points` — `ROAM_POINTS`, each displaced by one offset on a ring. The ring
  angle comes from the member's index by golden angle, so consecutive robots
  never sit on top of each other. Any displaced point that leaves the safe area
  falls back to the authored point.
- `start` — a different starting index per member, so nobody sets off from the
  same corner.
- `idlePause` — 1.1–2.3 s, so nobody idles for the same beat.
- `stateTime` — a seeded phase offset, so hops do not land in unison.

Occasional overlap is fine. Five robots stacked in one spot is not — and with
displaced point sets it cannot happen.

`robotPuppet.js` needs three small openings for this, and nothing more:

- `createRoamPlan(points, start, { idlePause })` — `idlePause` replaces the
  module constant `IDLE_PAUSE` as a per-plan value (default unchanged).
- `stepRoam` reads `plan.idlePause`.
- `paperPuppet.startRoaming(points, { start, idlePause, stateTime })`.

Nothing else in either module changes.

## 7. The room (§15)

Removed: the artist NPC, the art table, the paint pots, the wall frame and its
four wood rails, and the old corner easel. Kept: floor, three walls, trim,
lighting, the player.

Added: **one easel near the centre** with the canvas on it, and a **doorway**
on the back wall. The easel dominates; nothing else is gameplay.

`OBSTACLES` and `ROAM_POINTS` in `robotPuppet.js` are re-authored for the new
room: the table and artist obstacles are gone, the easel obstacle moves to the
centre, and the point list grows (8–10 points, spread wide) because up to
twenty robots now share it.

## 8. Performance (§25, §44)

Retaining every robot is not negotiable, so the cost per robot is what gets
optimised.

- **Share the two radial textures.** `shadowTexture()` and `glowTexture()` are
  identical for every puppet and are currently built per puppet. Hoist them to
  lazily-created module singletons. They must **never** be disposed by a
  puppet's own `dispose()` — that is exactly the "shared texture accidental
  disposal" §42 warns about. Add a test.
- **Drop `textureSize` for room puppets.** 900 is sized for a close-up that no
  longer happens; the puppet is ~1.75 world units in a room seen from 8.5 up
  and 10.5 back. Measure, then pick the smallest size that still reads — 640 is
  the expected answer. Five cropped pieces plus five silhouettes per robot at
  900 is roughly 4 MB of canvas each; twenty of those is not acceptable.
- Piece **geometry** may be shared across puppets (the quads are identical per
  piece); shared geometry likewise must not be disposed per puppet.
- No per-frame canvas redraw and no per-frame allocation for a finished robot.
  A finished robot's textures are drawn once, at construction, forever.
- No per-robot DOM listeners. There were none; keep it that way.
- **Landing sounds must be rate-limited** (§40). Twenty robots hopping is
  twenty paper-taps a second. Cap it (one tap per ~0.35 s across the whole
  crowd) or the room becomes unbearable.

Add a dev spawner so a crowd can be inspected without painting twenty robots
by hand (`src/dev/robot-preview/`, or a debug hook gated exactly as
`DEV_TOOLS_ENABLED` already gates the scene editor). It is a tool, not a
gameplay cap.

## 9. Layering, which has already bitten this screen once

`.lesson-hud` is `z-index: 20` and `.coloring-screen` is also `z-index: 20`,
appended later — so the coloring screen currently paints **over** the HUD. The
question now happens on the coloring screen, and the child needs the Talk
control, so the screen must sit **below** the HUD (`z-index: 18`). The HUD root
is `pointer-events: none`, so nothing is blocked.

`listenAgain` (z 21) lives inside the screen and so cannot escape its stacking
context; it will sit under the HUD. That is fine as long as they do not
overlap — check it at 1366×768 and at 760×420.

The HUD's Talk button is bottom-centre, exactly where the power bar goes. This
does not collide, because the tools are hidden during `canvas-question` (§4)
and the HUD is hidden once the answer is accepted. Keep that true.

## 10. The speech bubble on the page (§3)

The B&W robot answers, and the bubble belongs to the drawing. `dialogue.show`
anchors to a 3D object and the world is not visible, so this is a **DOM bubble
inside the coloring screen**, positioned over the canvas at the robot's head.

The head is at `x 0.285–0.715`, `y 0.155–0.36` of the picture
(`robotDefinition.SHAPES`), so anchor the bubble's tail at (0.5, 0.15) of the
canvas box and let it sit above that. A small wiggle and a blink on the same
beat (`surface.setBlink`) make the drawing the speaker.

`promptQuestion` needs no anchor and works unchanged.

## 11. Round reset (§30)

`to-canvas` resets: paint canvas, coverage grid, power bar, stroke/undo
history, the round's favourite colour, `selectedColor` (back to none, §6),
`erasing`, the activation state and the answer sentence. The brush size may
persist — a child who chose Large meant it.

It must **not** touch: the player, the room, the easel, the living robots or
any of their textures. Disposing the painting surface must not dispose a
puppet's textures; the puppet copied what it needed at construction.

## 12. Non-negotiables

- No regions, tap-to-fill, ★, colour labels, correctness-by-body-part, gift
  delivery, wall frame or artist NPC. Not switched off — **gone**.
- ~~The favourite colour is a **bonus**. A robot must activate for a child who
  ignores it completely.~~ **SUPERSEDED 2026-09-22 by the owner**, who reversed
  this deliberately: the favourite colour is now the **only** thing that charges
  ROBOT POWER, at a much lower threshold (~28% of the silhouette rather than
  68%). Other colours stay fully available and charge nothing. The browser check
  that proved the old rule is inverted, not deleted: ignoring the favourite
  entirely must now **fail** to activate the robot. See
  `.ai/coloring-correction-spec.md`.
- The favourite colour never appears in the debug snapshot. A playthrough hears
  it in the dialogue exactly as a child does.
- No robot cap, no eviction, no fade-out of old robots, no `localStorage`.
- Hopping is the only locomotion.
- `finish()` is called exactly once per session, from `finishing`.
