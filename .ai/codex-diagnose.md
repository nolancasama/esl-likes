# Diagnose: flaky Zoo playthrough

**READ-ONLY DIAGNOSIS.** Do not edit application source, implement fixes,
refactor, change dependencies, commit, push, or merge. You may read files,
search code, inspect git history and diffs, read logs, screenshots, and test
output, run non-destructive diagnostic commands, and run unit tests when that
helps isolate the problem. Investigate independently.

Note: your sandbox cannot start the preview server, so do not try to run
`npm run playthrough:zoo`. Claude will run any runtime check you ask for;
say exactly what to run or log.

## Observed symptom

`npm run build` then `npm run playthrough:zoo` (runner `scripts/playthrough-run.mjs`,
headless Chromium with SwiftShader, 1366x768) gives different results on
repeated runs with no Zoo source change:

- 2026-09-13 at commit `27cc580`: 109/109.
- 2026-09-14 working tree (only Restaurant files + two added UI strings in
  `src/config/lesson.js` changed): 88/96.
- 2026-09-14 clean checkout of `d311b9c` (Zoo code identical to `27cc580`): 106/108.

The total check count itself varies (96 / 108 / 109).

Log lines seen in the failing runs:

- `(route gave up short of -19.0,-10.0 at -27.1,3.8)`
- `(route gave up short of 0.0,29.2 at -26.9,1.5)`
- `(route gave up short of 29.0,-14.0 at 0.1,30.1)`
- `(route gave up short of 0.0,24.3 at -27.1,1.4)`
- `B retry 0 for deer: ... "reached":true ... "wallSeconds":44.41`
- `(timed out waiting for waiting visitor)`, `(timed out waiting for turnaround)`,
  `(timed out waiting for hub)`
- FAILs in both failing runs: `showing wrong photos still finishes and earns the
  stamp (no dead end)` and `anti-shortcut: showing a wrong animal first cannot
  reach 3 stars`; the 88/96 run also failed `penguin/alpaca/horse/fox viewpoint
  is reached from the plaza`, `all thirteen habitats are photographed in one
  session`, and the region-screenshot check (penguinCove missing).
- No console, page or network errors in any run.

Full logs: `.tmp/zoo-flake/zoo-working-tree-88of96.log`,
`.tmp/zoo-flake/zoo-clean-d311b9c-106of108.log`.

## Desired behaviour

The Zoo playthrough is a trustworthy regression check: the same code gives the
same verdict every run, and a FAIL means the game is wrong. Checks do not
silently disappear from the count.

## Frequency / when it started

2 of the last 2 runs failed (plus 1 earlier full pass). Failures appeared on
2026-09-14; no Zoo source or Zoo harness change since `27cc580`.

## Constraints

- Must not change Zoo gameplay, layout, or visuals to make the harness pass
  unless the diagnosis shows a genuine game defect (e.g. a real player can get
  stuck at the same spot) — say so explicitly if that is the case.
- Harness protocol: `~/.claude/workers/harness/PROTOCOL.md` (wait for state not
  time, preconditions classified as HARNESS_PRECONDITION_FAILED, seeded or
  invariant-based randomness).
- Rationale for Zoo design: `DESIGN_DECISIONS.md`.

## Systems that may be involved (no cause selected)

The Zoo playthrough script and its route-walking helper; the Zoo campus layout /
collision (`src/minigames/zoo/layout.js`, `world.js`); movement and frame-time
clamping under software GL; randomness in visitor/animal order; check
bookkeeping that makes the total vary.

Unverified hypothesis worth testing, not direction: wall-clock timeouts under
slow SwiftShader frames. Alternative worth ruling out: the route helper follows
a path through a collider or a region that depends on a random/dressing
placement, so some seeds leave the walker stuck regardless of speed.

## Already tried

Nothing on Zoo. A clean-checkout comparison established it is not caused by the
current Restaurant work.

## Report shape (keep it short, no raw log dumps)

1. Observed evidence.
2. 2–4 ranked probable causes: confidence, file/line evidence for and against,
   what would confirm or disprove each (name the exact runtime check/log).
3. Possible solutions per leading cause: change, files, blast radius, risks,
   root cause vs symptom.
4. Recommended solution.
5. Relevant files/systems.
6. Remaining uncertainties.

If you cannot converge, say what evidence would settle it.
