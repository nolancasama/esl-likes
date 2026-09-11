# ESL Likes — Specification

One 3D ESL game containing five independent minigames, for Japanese
elementary 3rd graders (~8–9 years old), on classroom Chromebooks.

## Target language (frozen — never changes)

    "What ___ do you like?"     — the student SAYS this
    "I like ___."               — the student HEARS this, and must act on it
                                — and SAYS it once per minigame (see Turnaround)

The grammar never gets harder. Gameplay complexity is the only difficulty axis.

### Vocabulary defines its own answer

Every vocabulary item defines its exact spoken and displayed answer sentence —
never `"I like " + label`. Singular and plural cannot be inferred safely from a
label:

    curry     -> "I like curry."        elephant -> "I like elephants."
    hamburger -> "I like hamburgers."   penguin  -> "I like penguins."

Vocabulary lives in `src/config/lesson.js`, one object per item.

## The one rule that decides every design question

> The NPC's answer must be information the player genuinely needs in order to
> succeed. If a player could win without understanding the English, the
> minigame is wrong.

Second rule, carried over from town-builder and kept verbatim:

> A child who says the sentence well enough for a teacher to understand must
> always be rewarded. Recognition noise is the game's problem, not the child's.

## The anti-shortcut rule (added 2026-09-11 — applies to every minigame)

> **A minigame must not be reliably solvable through fixed positions, sequence,
> timing, visual shortcuts, or other non-language cues instead of understanding
> the NPC's English answer.**

The Restaurant review exposed this: dishes sat on the counter in the same
left-to-right order as the tables, and bells rang in the order the orders were
taken, so "left plate, left table" and "first bell, first customer" beat
listening.

Every minigame review must explicitly ask:

> **"Can a child consistently succeed without understanding the NPC's answer?"**

If yes, change the design. Leaks to check for: a fixed item-to-place mapping;
outcomes that follow asking, arrival or readiness order; elimination (only one
option left); colour or appearance cues on the NPC or in the scene that match
the answer; a default selection that happens to be right; free trial-and-error.
A lucky one-in-three guess is fine — it is not "consistently succeed".

---

## 1. Shape of the product

A 3D world is the main presentation. 2D interfaces appear only where flat
input is genuinely better — the coloring canvas, the zoo viewfinder, the hub
stamp book, settings. There is exactly ONE rendering stack (three.js) and one
UI layer (DOM overlay). There is no 2D build and no 3D build.

    Hub (3D)  ->  minigame (3D, some with a 2D interface)  ->  stamp  ->  Hub

### Interface language

UI chrome is Japanese. English appears ONLY where it is the lesson: the target
sentence, the NPC's answer, the food/color/drink/sport/animal words, and the
minigame names. This follows esl-time and is deliberate — reading load in the
child's L2 is not the skill being taught here.

### Controls (identical in every 3D minigame)

- WASD / arrow keys to move. Nothing else is required to play.
- One interact key (Space) and one talk control (hold).
- Camera follows gently from a raised three-quarter angle. NO mandatory mouse
  look, NO manual rotation, NO precision movement, NO platforming.
- Interaction zones are large and forgiving — a generous radius, not a
  pixel-accurate trigger. A child must never fail because of aiming.
- Everything clickable is also reachable by keyboard.

---

## 2. Shared systems (built once, used by all five)

| System | Responsibility |
|---|---|
| `speech` | Hold-to-talk Web Speech plus the forgiving matcher |
| `audio` | SFX, NPC voice playback, ducking; optional and nonblocking |
| `characters` | Kenney blocky cast loader, clips, tinting |
| `cameraRig` | Follow camera with per-minigame framing presets |
| `dialogue` | NPC speech bubble, English text, replay button |
| `progression` | Stamps, stars, best results, save data |
| `hub` | Minigame selection, stamp book |
| `settings` | Volume, mic mode, difficulty, text size |
| `transitions` | Wipe in and out between hub and minigames |
| `tween` | Easing and timing (port from town-builder) |

Each minigame owns its OWN gameplay controller, state machine, scoring, camera
preset, UI panel, and completion logic. Do NOT build a universal minigame base
class. Shared code exists only where it removes real duplication.

### Assets

`public/assets/characters/` already holds Kenney Blocky Characters 2.0 (CC0,
18 models, 2.4 MB). Seven-node hierarchies animated by node transforms — no
skeleton, no skinning, no Draco decoder. Clips: `idle`, `walk`, `sprint`,
`emote-yes`. Reuse them for every NPC and for the player avatar. Environments
are built from simple procedural geometry with flat bright materials. Avoid
realism.

---

## 3. Speech system

### Interaction

Press-and-HOLD to talk. Never a continuously open microphone. Pointer capture,
keyboard parity (hold Space), a five-second cap, and the mic closed at every
seam. Port the hold mechanics from `esl-time/src/speech.js` and the matcher
approach from `town-builder/src/systems/speech.js`.

Interim hypotheses are judged live, for SUCCESS ONLY — a correct sentence is
accepted the instant the recognizer reports it, without waiting for release. A
non-match during the hold keeps listening.

### Visible states (all five must be unmistakable)

    mic ready -> listening -> speech detected -> accepted / try again

### The matcher

Normalize, tokenize, Levenshtein-fuzz each token (slack scaled to word length).
Accept when:

- a question word is present — `what` or a near miss, AND
- the CATEGORY NOUN is present — `food` / `color` / `drink` / `sport` /
  `animal`, AND
- `like` is present.

`do` and `you` are NOT required — they are the first words a classroom mic
drops. Three content hits is enough.

### Phonetic tolerance table — REQUIRED, not optional

Levenshtein distance alone will reject correct Japanese-accented English heard
through a cheap microphone. Every category noun needs an explicit
accepted-variant list, for example:

    food   -> food, foot, hood, foods, fud, whod
    color  -> color, colour, caller, collar, cooler, kara
    drink  -> drink, dring, drinks, junk, trink
    sport  -> sport, spot, sports, spore, support
    animal -> animal, anime, animals, aniaml, enemal
    what   -> what, wat, hwat, watt, wot, but

Extend this table from real classroom transcripts as they appear. THIS IS THE
HIGHEST-RISK PART OF THE GAME. A false rejection teaches a child that their
correct English was wrong, which is far more damaging than a false acceptance.

### Fallback ladder (the game never gets stuck)

1. Attempts 1 and 2: normal hold-to-talk.
2. After two consecutive failures: the target sentence appears, word by word,
   large. The child may TAP it to continue. Tapping plays the sentence audio
   and highlights each word as it is spoken.
3. Settings offers a mic-free mode in which step 2 is the only route, for rooms
   where microphones simply do not work.

The fallback never removes the English. It changes speaking to reading along.

### Listening again is support, not failure (revised 2026-09-11)

Every minigame lets the child hear the NPC's answer again (🔊 もういちど きく).

- Asking again never deducts score. Acting correctly after only the first
  hearing earns a memory bonus; asking again gives up only that bonus, and the
  task still earns full normal credit.
- The control is secondary: clearly visible and reachable by keyboard (Tab),
  but never bound to the main interact key and never the big primary button,
  so it cannot be pressed by habit.
- Deliberately minimal until classroom behaviour has been observed.

### Turnaround beat (ADDED to the original plan)

At the end of every minigame, one NPC turns the question around:

    NPC:     "What food do you like?"
    Student: "I like pizza."

The student must PRODUCE "I like ___", not only comprehend it. Any valid
category word is correct — this is expression, not a quiz. The answer is saved
and referenced later in the hub ("You like pizza!"), which makes it feel heard.
The matcher for this direction requires `like` plus any one category word.

---

## 4. Minigame 1 — Restaurant

Player is a waiter. Never a cook.

Foods: curry, pizza, hamburger, noodles, sushi.

### Environment

A compact 3D dining room: several tables, a kitchen pickup counter with a bell,
wide clear pathways. Small enough that crossing it is quick and readable.

### Loop

1. A customer sits at a table.
2. Player walks over and holds to talk: "What food do you like?"
3. NPC answers "I like curry." — spoken, plus a speech bubble.
4. The kitchen prepares it automatically. Bell and visual cue when ready.
5. Player collects the dish from the counter.
6. Player delivers it to the customer who ordered it, from memory.

The order is NOT displayed on a ticket, a HUD, or above the table. Memory is
the mechanic. A secondary 🔊 もういちど きく control re-asks the customer, so a
child who is stuck always has a way forward; it forfeits that customer's memory
bonus and never deducts score (see "Listening again").

### Scoring

- Correct delivery — the primary term.
- Food temperature: the dish cools after leaving the counter.
  Hot 3 stars / Warm 2 / Cold 1.
- Customer patience: a visible, generous meter.

Cold food never fails. On a wrong delivery the customer politely refuses, the
dish stays in hand, and the player walks it to the right table. No penalty.

### Difficulty

L1 one customer, one order. L2 two tables overlapping. L3 several tables,
staggered readiness, longer memory gaps.

---

## 5. Minigame 2 — Coloring

Calm and creative. No timer. Coloring validates the collection's second
architecture: 3D NPC interaction -> speech -> 2D activity -> scoring -> back to
3D -> NPC reaction.

### v1 scope (deliberately small)

One NPC in a 3D Art Room, one picture (a robot), three large enclosed regions
(body, arms, eyes), three palette colours (red, blue, yellow). No picture
library and no difficulty levels yet.

### Loop

1. Enter the Art Room and walk to the NPC, who holds up a black-and-white
   picture.
2. Ask "What color do you like?"; the NPC answers with one of the three
   colours, e.g. "I like blue."
3. Transition to a full-screen 2D colouring screen.
4. Paint with a brush (pointer drag), choosing from a three-swatch palette.
5. Press できた and see a simple result.
6. Back in the Art Room, give the picture to the NPC, who reacts happily. The
   picture hangs on the wall.
7. Turnaround: the NPC asks the child "What color do you like?" and the child
   answers "I like ___." with any colour.

### The favourite colour must matter (anti-shortcut)

- Each round one region is STARRED. It must be painted in the NPC's favourite
  colour and carries most of the score.
- The other two regions are FREE — any colour, scored only for coverage and
  neatness. Giving them prescribed colours would let a child find the starred
  colour by elimination (the one colour not used elsewhere), so they
  deliberately have none.
- Which region is starred and which colour the NPC likes are chosen
  independently at random each round, so neither a place nor a colour can be
  learned by replaying.
- Nothing may hint at the answer: the star marker uses no palette colour, the
  NPC and the room carry no matching colour cue, and no swatch is selected by
  default.
- 🔊 もういちど きく replays the answer on the colouring screen; it forfeits only
  the memory bonus.

### Painting and scoring

- A large, forgiving brush; strokes are interpolated so fast trackpad movement
  leaves no gaps. Mouse, touch and Chromebook trackpad (click-drag). No
  fill-only tool, no pixel accuracy.
- Scored on a coarse grid, not pixels:
  - starred region: share of its area in the favourite colour (dominant term);
  - free regions: coverage in any colour;
  - neatness: paint well outside every region, ignoring a forgiving margin
    just beyond the lines;
  - memory bonus when the answer was never replayed.
- Painting the starred region in a wrong colour can never reach three stars.

---

## 6. Minigame 3 — Drink Stand

The fastest, most arcade-like stage.

Drinks: water, milk, orange juice, apple juice, tea, soda.

### Stand and camera (v1, decided 2026-09-11)

A fixed 3D camera, high and behind the player, looking over the stand. Top of
the screen: three serving windows where customers stand facing the camera.
Middle: the player's avatar in a small work area behind the counter. Bottom,
nearest the camera: six large drink stations in a row, each a clearly shaped
object plus a sign with a drink picture and its English word. The whole stand
fits on a 1366x768 Chromebook screen; there is no exploration.

Each drink looks different at a glance: water (clear, pale blue), milk
(white), orange juice (orange), apple juice (pale gold, apple mark), tea
(amber, teacup), soda (bright green and fizzy, like melon soda).

### Controls

- WASD / arrows walk inside the small work area, as in the Restaurant.
  Interaction is by generous proximity: near a station, near a window.
- Space at a station pours that drink into a cup in the avatar's hands. Pour
  time is the same for every drink. Pouring while already holding a cup
  empties the old one first.
- Space at an asked customer while holding a cup serves it.
- At an unasked customer, the talk prompt appears (hold to ask).
- Click / tap a station or a customer: the avatar walks there by itself and
  does the same action on arrival, so a trackpad alone is enough.

### Loop

1. A customer walks up to a free serving window. The window is chosen at
   random.
2. The player walks to them and asks "What drink do you like?"
3. The customer answers with that drink's sentence ("I like orange juice."),
   spoken plus a bubble. The bubble then disappears. There is no ticket and no
   icon, so remembering is part of the job.
4. The player pours the drink and serves it. A right drink gets a happy
   reaction and the customer leaves; the next one arrives.
5. With a wrong drink, the customer politely declines in Japanese without
   repeating the English, and the cup is emptied. Their patience keeps
   running. 🔊 もういちど きく (shown when at an asked customer) replays their
   answer and forfeits only that customer's memory bonus.
6. After the last customer comes the turnaround: "What drink do you like?" /
   "I like ___." with any of the six drinks.

### Difficulty

Customers per session: L1 6, L2 7, L3 8. At most 1, 2 or 3 customers stand at
windows at once; anyone beyond that waits in a visible line, not yet asked,
with their patience paused. Every session ends with a RUSH: the last three
customers arrive in quick succession, announced by a large ラッシュ！ banner. It
is a finale, never a fail state.

Patience is a visible, generous meter above each customer at a window. It
pauses while that customer's talk prompt is open, because slow speech is never
punished. A customer whose patience runs out waves and leaves. Play continues,
and there is no failure state.

### Anti-shortcut review (applied before building)

- Each customer's drink is chosen uniformly at random, independent of their
  model, window, arrival order and every other customer. Repeats are allowed,
  and nothing is removed from the choice, so elimination is impossible.
- Station order is shuffled once per session. Nothing highlights a station;
  no drink is preselected; the avatar starts holding nothing.
- Customers carry and show nothing drink-related. The answer bubble does not
  persist.
- Trial and error is possible (the game never gets stuck) but costly. A wrong
  serve loses the first-try credit that dominates the score, plus time and
  patience. Fewer than half the customers served correctly first time can
  never reach three stars.
- Guessing wins one time in six per customer. That is luck, not consistent
  success.

### Scoring

Computed in a pure module from per-customer records. Served correctly first
try is the dominant term; served correctly after a wrong try earns part
credit; leaving earns nothing. Remaining patience at serving (speed) adds a
little. A memory bonus comes from never replaying that customer. A small
streak bonus rewards consecutive first-try serves, and the current streak is
shown as a combo. Asking again never costs normal credit. First-try share
under one half caps the result at two stars.

---

## 7. Minigame 4 — Sports

Sports: soccer, basketball, baseball, volleyball.

### Environment

A playground with four clearly distinct zones, each identifiable from across
the field by silhouette and color — goal and green pitch, hoop and orange
court, backstop and diamond, net and sand.

### Loop

Meet an NPC, ask "What sport do you like?", hear "I like basketball.", the NPC
begins following, the player leads them across the field, and on arriving at
the right zone the NPC automatically joins in and plays.

The sport itself is NOT a minigame. It is the reward animation: soccer kicks,
basketball shoots, baseball bats, volleyball passes.

Wrong zone: the NPC shakes its head, keeps following, no penalty.

### Difficulty

L1 escort one NPC. L2 two NPCs at once with different sports. L3 three, which
means holding three answers and planning a route.

### Scoring

Correct deliveries, with route efficiency as a light bonus only.

---

## 8. Minigame 5 — Zoo

The exploratory finale, and the largest space — but navigable, not sprawling.

Animals: elephant, lion, panda, monkey, giraffe, penguin.

### Environment

Clear looping paths, readable signage, six recognizable habitats, and landmarks
for orientation. A child must never feel lost. Paths loop, so wandering always
returns somewhere useful.

### Loop

An NPC asks for help, the player asks "What animal do you like?", hears "I like
elephants.", explores, finds the habitat, **takes a photo**, returns, shows the
NPC, and gets a reaction.

### Photo mechanic (ADDED — the original had no real action)

Pressing the camera opens a 2D viewfinder overlay. The animal must be framed
inside it — reasonably centered and large enough — before the shutter works.
This makes the photo an action rather than walking onto a trigger tile. The
snapshot is kept and shown in the stamp book.

Forgetting is fine: walk back and ask the NPC again, at no cost. Wrong animal:
the NPC says it is not their favorite, and the player tries again with no
penalty.

Time is never the challenge here.

### Scoring

Correct animal, photo quality (framing), and requests completed.

---

## 9. Progression

The order, and its deliberate emotional rhythm:

    1 Restaurant   active
    2 Coloring     calm
    3 Drink Stand  fast
    4 Sports       active
    5 Zoo          exploratory

Intensity rises and falls on purpose. It does not climb monotonically.

Each minigame converts its own scoring into a shared result — one, two, or
three stars — and a stamp in the stamp book. Every minigame calculates stars
its own way. Do NOT unify the scoring math.

Completion matters more than perfection. Any star count earns the stamp and
unlocks onward. Replay is always available. Higher scores are an invitation,
never a gate.

The hub is a small 3D space with five doors or signs. Stamps appear in a book
the child can open.

## 10. Save data

One guarded localStorage key holding stamps, best stars per minigame, settings,
the child's own "I like ___" answers, and zoo photos. A corrupt or missing save
must start a clean game, never crash.

## 11. Non-negotiables

- Runs on a classroom Chromebook at a steady frame rate.
- No hard failure states anywhere in the game.
- No dead ends: every screen has a way forward even with a broken microphone.
- Large text, large targets, minimal reading, no long tutorial text.
- Teach mechanics visually. Demonstrate, do not explain.
- Audio is optional and nonblocking; the game is fully playable muted.
- The game is fun first and an ESL exercise second.
- Every minigame passes the anti-shortcut review before it ships.
