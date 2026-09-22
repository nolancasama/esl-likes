# Coloring: one detailed robot that comes alive — frozen interface

Authored by Claude (product/design lead) from the owner's 40-section plan.
**This file is the contract.** Where it differs from the plan, the difference is
deliberate and the reason is given. Implementers do not renegotiate it; if
something here is impossible, stop and say so rather than inventing a
different shape.

The pass proves one loop: **listen → remember a favourite colour → colour the
required parts → freely decorate → Done → the child's exact robot hops into the
3D atelier as a paper puppet.** One robot. No second picture.

## The decision that shapes everything: pure region fill

Coloring becomes **tap-to-fill only**. Freehand painting is removed, not kept
alongside.

The current minigame is a pixel system: `buildRegionMap` rasterises shapes into
a 72×72 `Uint8Array`, and `scoring.js` grades coverage with a two-cell
`NEATNESS_MARGIN`. That machinery exists to forgive a child who cannot paint
inside a line on a Chromebook touchpad. With twelve-plus small accent regions it
would stop being forgiving and start being impossible.

So the grid goes. Correctness becomes a map lookup — `colors[regionId] ===
required` — which is exact, instant, and trivially testable. **Delete**
`buildRegionMap`, `buildForgivingArea`, `NEATNESS_MARGIN` and the grid-coverage
scoring rather than layering on top of them.

**This resolves the plan's §6/§13 tension.** §13 says to crop the finished
canvas into puppet textures so small decorations survive. That worry only exists
while freehand painting can put pixels anywhere. With pure region fill the
region colours *are* the artwork, losslessly. The puppet therefore renders each
piece **from the same shape definitions and the same draw code**, not from
cropped canvas pixels. Same pixels on screen, no crop-bounds arithmetic, no
texture atlas, and the §38 "crop bounds are correct" tests become the far
stronger "a rendered piece contains exactly its own regions, in the child's
colours". Rebuilding from palette values is not the hazard §13 feared — it is
the same renderer, run twice.

## Files

```text
src/minigames/coloring/
  robotDefinition.js   # pure: regions, shapes, piece mapping. No DOM, no three.
  picture.js           # canvas rendering of the robot from a colour map
  colorState.js        # pure: region colours, undo, completion accounting
  scoring.js           # pure: round selection, correctness, stars
  robotPuppet.js       # three.js: builds and animates the paper puppet
  index.js             # the minigame: flow, UI, cinematic, atelier
```

`robotDefinition.js` is shared by the colouring page and the puppet. There is
one robot, defined once.

## Regions

18 regions. 3 required, 15 free.

```js
{ id: 'chestPanel', piece: 'torso', type: 'required-favorite', shapes: [...] }
{ id: 'eyes',       piece: 'head',  type: 'required-label', label: 'YELLOW', shapes: [...] }
{ id: 'leftKnee',   piece: 'leftLeg', type: 'free', shapes: [...] }
```

- `type` is `required-favorite` (exactly one), `required-label` (exactly two),
  or `free`.
- Every region names a `piece`. Every piece must own at least one region, and
  every region's piece must exist — a test asserts both directions.
- No region may be smaller than **44 × 44 CSS pixels** at the rendered size.
  That is the touch-target floor; a decorative stripe thinner than that gets a
  hit area padded out to it, while still *drawing* thin.
- `eyes` and pupils draw **above** fill, and the black line art always redraws
  over every region colour. That principle is already right in `picture.js`;
  keep it.

Suggested regions, grouped by puppet piece:

- **head** — face, leftEar, rightEar, eyes *(required-label)*, cheekPanels,
  antenna, antennaLight *(required-label)*
- **torso** — body, chestPanel *(required-favorite)*, buttons, sidePanels,
  shoulders
- **leftArm / rightArm** — upperArm, forearm, hand (×2 = 6 regions)
- **leftLeg / rightLeg** — upperLeg, kneePanel, foot (×2 = 6 regions)

Adjust the exact split while implementing, but keep 3 required and 12–15 free,
and keep the piece mapping total.

## Labels

Only the three required regions are marked. Free regions carry nothing.

- The favourite region shows **★ only**. It must never render the colour name —
  that is the listening task. The existing
  `★の ところは おともだちの すきないろで ぬろう` line stays.
- The two labelled regions show a small English colour word: `RED`, `YELLOW`,
  `GREEN`, … Readable, not louder than the artwork.
- A required region's label fades out once it is filled with the right colour.
- **Placement is authored, not automatic.** A word goes inside its region by
  default, but a region may carry a `labelBox` when its own shape cannot hold
  `ORANGE` legibly — the 55px antenna light, or the eye band already occupied by
  the pupils. A box outside the region draws a thin leader from the region's
  *edge* to the word, so the instruction is never mistaken for one about the
  shape it happens to sit on. `labelPlacement()` in `robotDefinition.js` owns
  this, and `fitLabelFont()` measures the word and shrinks it to the box width —
  sizing from height alone let `RED` spill outside the light.

## Round selection

```js
pickRound(rng) -> { favourite, starredRegion, labelled: [{ regionId, color }, ×2] }
```

- `favourite` is any of the seven.
- `starredRegion` is any region of type `required-favorite` (currently one, so
  this is fixed until more are added — keep the shape anyway).
- The two labelled colours are drawn from the seven and **must differ from each
  other**. They *may* equal the favourite; that is not a contradiction, and
  forbidding it would leak information about the favourite.
- Seeded RNG, as now, so tests and the harness stay deterministic.

## Correctness and the three outcomes

Only required regions decide activation. **A free region can never be wrong.**

| Outcome | Condition | Result |
|---|---|---|
| FULL | all 3 required correct **and** creative completion met | cinematic, robot comes alive |
| ALMOST | ★ correct, ≥1 labelled wrong | partial startup, `もうすこし！`, back to colouring |
| NOT READY | ★ wrong | failed startup, back to colouring |

Creative completion: **≥ 40% of free regions coloured**. If everything required
is right but completion is short, that is its own friendly message
(`もうすこし かざってみよう`) and a return to colouring — it is *not* an ALMOST,
and it must say plainly that the robot wants more decoration, never implying a
colour is wrong.

Failure never erases work. Every region colour survives every failed attempt.
A wrong **labelled** region may be visually indicated. A wrong **★** region must
not be — the child remembers or presses Listen Again.

## Scoring

Stars come from: required correctness **70%**, meaningful completion **20%**,
no Listen Again **10%**. Neatness is gone — there is nothing left to be neat
about. Free colour choices never affect the score.

## Puppet

Nine pieces: `head`, `torso`, `leftUpperArm`, `leftForearm`, `rightUpperArm`,
`rightForearm`, `leftLeg`, `rightLeg`, `antenna`.

Each piece is a thin flat quad textured by rendering its own regions with the
shared draw code onto a transparent canvas, cropped to that piece's bounds.
Deliberately papery: thin geometry, a slight edge, a small drop shadow, a
visible flat side at an angle. Not a glossy 3D robot.

Animation is rigid pieces around authored pivots plus **light squash and
stretch** — no skeleton and no vertex deformation, but a piece group may be
scaled non-uniformly. A paper toy flexes a little as it hops; it is not rubber.
Cap it: no axis outside 0.82–1.18, and the two axes compensate so a piece never
changes apparent area by more than a fifth.

**Locomotion is hopping, not walking.** A conventional articulated walk cycle is
the wrong read for a flat cut-out — it invites comparison with a real biped and
loses every time. A hop is stylised on purpose, so it reads as a hand-puppeted
paper toy rather than a bad walk.

- **Idle** — small up/down bob, subtle sway, occasional blink, antenna wiggle,
  slight side-to-side drift.
- **Startup** — an excited anticipatory shake, a quick bounce, eyes light up,
  arms twitch outward.
- **Hop** — crouch (compress) → pop up and forward (stretch) → airborne, tilted
  → land (squash) → small recovery bounce → repeat. It must read as
  *boing → land → boing → land*.
- **Celebrate** — two or three quick hops, a happy arm flap, an excited antenna
  wiggle.

During a hop the limbs are deliberately loose: arms flap outward, legs stretch
a little in the air, hands and feet lag behind the piece they hang from, and the
antenna trails the head. Charming beats correct. Four states, no state-machine
framework.

In the atelier it roams a small authored loop (hop → idle → turn → hop) on a
handful of points, clear of the walls, easel, table and the artist NPC. It stays
visible for the rest of the minigame; the wall frame shows the finished static
artwork at the same time (the plan's option **A**).

## Cinematic

3–6 seconds, then control returns: glow → blink → antenna lights → arms twitch →
a hop in place → peels off the paper → cut → drops onto the atelier floor →
starts hopping.

The old `すてきな えが できたよ！` star panel is **removed** from this path. A
generic results modal between correct colouring and the robot waking up is
exactly what the plan is trying to buy back.

## UI

- Seven large swatches, wrapped or horizontal, strong selected state, Japanese
  labels (`あか あお きいろ みどり ピンク むらさき オレンジ`). Add the four
  missing entries to `UI.coloring.colors` in `src/config/lesson.js`.
- Hover/focus highlights the whole logical region; clicking fills it instantly.
- **Undo** — at minimum the last region change; a small stack is better.
- **Eraser / clear region**, and a guarded `やりなおす` reset that cannot be hit
  by accident.
- Listen Again stays, still costs the memory bonus, and never blocks activation.
- Sound where the existing audio system already allows: fill pop, failed
  sputter, partial buzz, successful startup, footsteps.

## Tests

Pure modules only, `node --test`, `*.test.mjs` beside their source.

Definition: every region has a stable unique id; every region names a real
piece; every piece owns ≥1 region; the required counts are 1 favourite + 2
labelled; no region's hit area is below the touch floor.

Colour/correctness: seven colours available; favourite can be any of the seven;
the two labelled colours differ; a correct ★ validates; a wrong ★ blocks full
activation; a corrected ★ then allows it; a wrong labelled region yields ALMOST,
not NOT READY; free regions never count wrong in any combination; the 40%
completion threshold gates FULL and produces its own message; Listen Again
changes the score but not the outcome.

State: undo restores the previous colour; reset clears to blank; a colour map
survives a snapshot/restore round trip unchanged.

Puppet: the piece list is complete; the region→piece mapping is total and
onto; a rendered piece contains exactly its own regions in the child's chosen
colours; a piece's texture bounds match `pieceBounds`; idle/startup/hop/celebrate
transitions; a hop cycles through crouch → air → land → recover and returns to
where it started vertically; the squash/stretch helper never leaves the 0.82–1.18
band on either axis; roam points stay inside the safe area.

## Out of scope

A second picture. Rebuilding the atelier. Redesigning speech, mic or mic-free
behaviour. A rigged 3D robot. Anything the plan lists under its own non-goals.
