# えいごで「すき」をつたえよう — ESL Likes

A 3D English game for Japanese elementary classrooms, built around one sentence
pattern and nothing else:

    "What ___ do you like?"   — the child asks
    "I like ___."             — the child hears, acts on, and finally says

Five minigames share one three.js world, one speech system and one stamp book.
The grammar never gets harder; only the game around it does.

| Minigame | What the child does |
|---|---|
| **Restaurant** | Ask a customer, remember the order, carry the dish to the right table |
| **Coloring** | Ask an artist their favourite colour, paint the starred part of a robot |
| **Drink Stand** | Ask, pour and serve at a busy counter, ending in a RUSH |
| **Sports** | Ask friends their sport and lead them to the right zone |
| **Zoo** | Ask a visitor, find the animal, photograph it and bring the photo back |

## The rule that decides every design question

> The NPC's answer must be information the child genuinely needs. If a child can
> win without understanding the English, the minigame is wrong.

Every minigame is reviewed against it before shipping. Answers are random and
independent each round, nothing on screen points at the answer, and guessing is
possible but costly — a child who ignores the English can finish, but cannot
reliably earn three stars. The other half of the rule matters just as much:

> A child who says the sentence well enough for a teacher to understand must
> always be rewarded. Recognition noise is the game's problem, not the child's.

So the speech matcher is deliberately forgiving — phonetic variants for
Japanese-accented English, singular or plural, closest-match selection — and
after two failures the sentence appears to read aloud instead. There is a
mic-free mode for rooms where microphones do not work, and no dead ends
anywhere.

## Running it

```
npm install
npm run dev          # play at the printed localhost address
npm run dev -- --host   # also reachable from Chromebooks on the same wifi
npm test             # unit tests: vocabulary, matcher, per-game scoring
npm run build        # production build
```

Controls are WASD or arrow keys, Space to interact, hold to talk. Nothing else
is required to play.

### Scripted playthroughs

`scripts/playthrough*.mjs` drive each minigame end to end in a real browser
(Playwright, mic-free), checking both that the game can be completed and that
ignoring the English cannot reach full marks. Playwright is a local dev
dependency of this project. Build once, then run a scenario:

```
npm run build
npm run playthrough:zoo        # or :restaurant :drink-stand :coloring :sports
```

`scripts/playthrough-run.mjs` owns the whole lifecycle: it picks a free port,
starts `vite preview` from this project's own `node_modules`, waits for it,
runs the scenario, and always stops the preview. Its exit status is the
scenario's. Each run clears and writes only `.tmp/playthrough/<scenario>/`,
including a `manifest.json` that lists that run's screenshots. It never builds
for you: a missing `dist/` exits nonzero.

To check the runner itself (known-good and known-bad):
`npm run playthrough -- selftest-pass` should exit 0, and
`npm run playthrough -- selftest-fail` should exit 1.

## Documents

- `SPEC.md` — the frozen design, including the anti-shortcut rule.
- `DESIGN_DECISIONS.md` — why things are the way they are.
- `CURRENT_STATE.md` — what is true right now, and what still needs a
  classroom Chromebook to verify.

## Assets and credits

- **Characters** — Kenney *Blocky Characters* (CC0). <https://kenney.nl>
- **Zoo animals** — Quaternius *Cube World* (CC0). The project owner's download
  did not include a licence file, so confirm the source page for exact
  attribution before redistribution.

See `public/assets/animals/README.md` for per-file provenance, embedded clips,
and the model-loading quirks worth knowing.
