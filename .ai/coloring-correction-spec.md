# Coloring — the correction pass (frozen contract, 2026-09-22)

The magical-easel loop shipped and the owner played it. This is the fix list.
It is a **targeted correction**, not a third redesign: the loop in
`.ai/coloring-easel-loop-spec.md` stands, and every phase name survives.

Read that spec first, then this. Where they disagree, **this file wins**.

---

## 1. What the owner's plan got right, verified in the source

Each of these was checked before the work started; none is a guess.

| Claim | Verified |
| --- | --- |
| `livingRobots.length = 0` in `enter()` | yes, `index.js:1320`, and `exit()` disposes + clears at 1420 |
| the canvas shifts when tools appear | yes — `grid-template-columns: auto minmax(0, 1fr)` with `.coloring-side { display: none }` while asking |
| room geometry is inconsistent | yes, and worse than stated — see §4 |
| player is placed at `EASEL.z + 2.15` | yes, `index.js:1035`, and the puppet lands at `EASEL.z + 0.2` |
| `startRoaming` teleports the robot | yes — `createRoamPlan` seeds `position` from `points[start]`, then `startRoaming` calls `placeAt` with it |
| every colour charges the bar | yes — `creditOf(CELL_PLAIN) = 1`, `creditOf(CELL_FAVOURITE) = 1.5` |

## 2. The one thing the plan reverses, and what it costs

The favourite colour becoming the **only** thing that charges the bar reverses a
recorded decision and a frozen non-negotiable ("a robot must activate for a
child who ignores it completely... nothing here can fail"). The owner reversed
it deliberately and the reversal is accepted.

**The cost, recorded so nobody rediscovers it as a bug:** a child who does not
hear or does not remember the spoken colour now has no way forward and, by the
plan's §12, no hint telling them. The listening task has teeth again — that is
the point — but a stuck child is now possible where before it was not. The
owner has explicitly deferred any on-screen hint to classroom testing. Do not
add one.

The browser check that proved the old rule is **inverted, not deleted**:
painting only non-favourite colours must now fail to activate the robot.

## 3. Power: favourite-only (plan §8–§13)

This is a **smaller change than the plan implies**, and the simplicity is the
point — do not build what the plan's wording suggests.

`coverage.js` already journals every stroke as `{ index, previous }` per changed
cell, and `undoStroke` already restores cells from that journal. That machinery
gives correct repaint and erase semantics for free. The only thing standing in
the way is one guard in `dab()`:

```js
// Rule 1 and rule 3: a painted cell is finished with.
else if (painted[index] === CELL_EMPTY) setCell(index, value);
```

**Delete the guard** so a dab always overwrites. Then:

- red → blue on the same cell: journalled, favourite count rises. Power rises.
- blue → red: journalled, favourite count falls. Power falls.
- blue → blue: `setCell` returns early (`previous === next`), nothing journalled,
  nothing changes. Farming is still impossible, for free.
- erase: already `CELL_EMPTY`, already journalled. Power falls.
- undo of any of the above: the journal restores the previous cell values
  exactly. Power returns to what it was.

**Forbidden:** a second history, a coverage snapshot per stroke, or a replay of
all strokes on undo. The plan's §11 warns about paint history and coverage
history drifting apart — the answer is that there is exactly one history and it
already exists. Do not add another.

API changes:

```js
export const FAVOURITE_POWER_THRESHOLD = 0.28;   // replaces POWER_THRESHOLD = 0.68
// FAVOURITE_BONUS is DELETED, not re-tuned.
power() = min(1, favouriteCells / (robotCells * FAVOURITE_POWER_THRESHOLD))
```

`credit` and `creditOf` disappear with the bonus. Keep tracking **both** totals
(plan §10): `coverage()` stays as total unique painted area for the debug
snapshot and the harness, and `favouriteShare()` keeps working.

`MILESTONES` is already `[0.25, 0.5, 0.78]` and needs **no change** — it reads
`power()`, which is now favourite-only, so plan §12 is satisfied by doing
nothing. Do not touch it.

Background paint still charges nothing: the silhouette mask already gates
`dab()`, above the guard being removed.

## 4. The room (plan §3)

The real defect, measured:

- floor `12.5 × 11.5` centred at origin → x −6.25..6.25, z −5.75..5.75
- back wall: height 5.2 at y 2.35 → **top at y = 4.95**
- side walls: height 3.6 at y 1.55 → **top at y = 3.35**

The side walls are **1.6 units shorter than the back wall**, and the back wall
sits at z −5.55 while the side walls run to z −5.75. That is the gap the owner
sees, and it is why the pulled-back camera frames a flat void past the right
wall. Do not patch the numbers — rebuild from constants:

```js
ROOM_WIDTH, ROOM_DEPTH, WALL_HEIGHT, WALL_THICKNESS, DOOR_WIDTH, DOOR_HEIGHT
```

Every wall, trim, floor and doorway piece is **derived** from those. One wall
top height for all three walls. Corners overlap by `WALL_THICKNESS` so no seam
can open. The doorway's three pieces (two jambs and a lintel) come from
`DOOR_WIDTH`/`DOOR_HEIGHT` and the back wall's own coordinates, never from hand
tuning. No magic numbers left in the wall construction.

There is no front wall — the camera looks in from there, as it always has.
Keep it that way; the fix is the three walls agreeing, not a fourth one.

`EASEL`, `DOOR` and their radii keep their current values unless the rebuild
genuinely moves the door, in which case `DOOR` moves with it and the two radii
must stay non-overlapping (the comment at `index.js:20` explains why).

## 5. The easel (plan §4)

A recognisable A-frame: two splayed front legs, one raked rear leg, a shelf the
front legs visibly carry, canvas resting on the shelf and leaning back slightly.
Same low-poly procedural style as the rest of the suite — boxes are fine.

**The one hard constraint:** the paint plane and the line-art plane must stay
exactly co-planar with the visible canvas and with each other. They are two
planes at `z = 0.02` and `z = 0.035` today. If the canvas leans, they lean with
it — put all three in one group and rotate the group, never rotate them
separately. A lean that desynchronises the line art from the paper is worse than
no lean at all; if that cannot be made clean, keep the canvas upright and say so.

## 6. Emergence staging (plan §5, §6, §7)

Three separate faults, fixed together because they share the cinematic.

**Player retreat.** The player stands at `EASEL.z + 2.15` and the puppet lands at
`EASEL.z + 0.2`, so the player is between the camera and the robot. When the
peel starts, interpolate the player backward over **0.55 s** to roughly
`EASEL.z + 3.4`, easing out. Interpolate — do not set the position in one frame.
No pathfinding, no collision query; the retreat path is authored and known clear.

**Landing must stick.** `startRoaming` currently calls `placeAt` with
`points[start]`, which is the teleport. Extend the roam API:

```js
createRoamPlan(points, start, { idlePause, stateTime, from })   // from: {x, z}
paperPuppet.startRoaming(points, { start, idlePause, stateTime, from })
```

When `from` is given, the plan's `position` and `origin` start there and
`startRoaming` does **not** call `placeAt`. The first leg targets
`points[start]` from wherever the robot actually is. When `from` is absent the
behaviour is exactly as today — the dev spawner and every existing test depend
on that, so the default path must not change.

**The viewing beat.** After the landing, hold the easel camera for **1.2 s**
before the second pullback. Roaming does not start until the beat ends. The
robot may celebrate during it. This is the beat where the child understands what
just happened, so it is not optional and not shortened to make a test faster.

## 7. Persistence across visits (plan §1)

Robots survive leaving and re-entering Coloring **within one running app
session**. Not across a browser reload — no `localStorage`, which the easel-loop
spec forbids and the owner's plan explicitly does not ask for.

A module-level store in its own file, outside the controller, holding plain data
and **no three.js objects**:

```js
// coloringSession.js
{ artwork: HTMLCanvasElement, crowd: { start, idlePause, stateTime } }
```

- `artwork` is a **detached copy** of the paint canvas taken at completion —
  never the live surface canvas, which `to-canvas` resets. Copy it once, when the
  robot is created, and never draw to it again.
- On `enter()`, after `buildWorld()`, rebuild one puppet per saved record from
  its stored artwork, enroll it in the crowd with its saved variation so it does
  not re-randomise into a different personality, and place it on a roam point.
- `enter()` must **not** clear the store. `exit()` disposes the three.js puppets
  and clears `livingRobots`, but must **not** clear the store and must **not**
  dispose the stored canvases.
- The store is cleared only when the whole game session ends.

Memory: one 720×720 canvas per robot is ~2 MB. Twenty robots is ~40 MB of
retained canvas, which is acceptable for a session but is the reason the stored
copy must not be larger than the source.

## 8. Canvas centring (plan §2)

The canvas's horizontal centre must not move between `canvas-question` and
`coloring`. Three columns:

```css
grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
```

tools left, canvas centre, a balancing spacer right. While the tools are hidden
the left column keeps its width — use `visibility: hidden`, not `display: none`.
The narrow-screen layout may move the controls above or below the canvas, but
the canvas stays centred there too.

Verify at 760×420, 1024×600 and 1366×768: the canvas bounding box's centre x
before the answer and after the tools appear must agree within **2 px**.

## 9. What must not regress

- Every finished robot keeps its own exact artwork, including white gaps,
  scribbles and overpaint mixing — restored robots included. The harness
  fingerprints this; it is the check that matters most.
- No robot cap, no eviction, no shared-texture disposal.
- The favourite colour still never appears in the debug snapshot.
- Hopping is the only locomotion.
- `finish()` is still called exactly once, from `finishing`.
- The three camera stages still run in order.

## 10. Obsolete tests are updated, not preserved

Tests asserting that ordinary colours charge the bar, that the 68% threshold
holds, that the collection clears on exit, or that `startRoaming` snaps to its
first point are **wrong now**. Update them. Do not keep both behaviours alive
behind a flag.
