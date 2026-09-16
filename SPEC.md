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
- One interact key (Space) and one talk control: the on-screen 🎤 button or
  Space, pressed once (see §3 "Press to talk", revised 2026-09-15). Walking up
  to someone never starts a conversation by itself.
- Camera follows gently from a raised three-quarter angle. NO mandatory mouse
  look, NO manual rotation, NO precision movement, NO platforming.
- Interaction zones are large and forgiving — a generous radius, not a
  pixel-accurate trigger. A child must never fail because of aiming.
- Everything clickable is also reachable by keyboard.

---

## 2. Shared systems (built once, used by all five)

| System | Responsibility |
|---|---|
| `speech` | Press-to-talk Web Speech plus the forgiving matcher |
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

### Press to talk (revised 2026-09-15 — replaces hold-to-talk and dwell-to-talk)

One interaction in every minigame:

> **press Talk once → the microphone listens → the child speaks → recognition ends by itself**

- **Who can be talked to** is still chosen by proximity (plus facing, or the
  click-to-walk target, as each minigame already does). When a valid target is
  in range the 🎤 Talk control is shown. Being near someone, standing still
  beside them, or arriving by click-to-walk **never** opens the microphone or
  the fallback.
- **Press once** (the button, a tap, or **Space**) to commit: the target is
  locked, protected speech focus begins, and one recognition session starts
  (`continuous = false`, interim results on). The press is a user gesture, so it
  is also where a first-time browser permission prompt may appear — never on
  approach.
- **Nothing is held.** Releasing the button, the key or the touch has no effect.
  The session ends when the recognizer ends naturally, on acceptance, or at an
  8-second safety cap.
- **Press again while listening to cancel.** The attempt is dropped without
  counting as a failure; focus and any Restaurant reservation are released; the
  button returns to ready; nothing restarts by itself.
- **A failed attempt** (the recognizer ended without a match) keeps the target
  locked and focus on while the child stays in range; the next press retries.
  Walking out of range ends it. Two failures open the read-along fallback.
- **Target lock.** From the press until the conversation resolves, is cancelled
  or the child leaves range, no neighbouring NPC can take the prompt.
- **Mic-free mode.** The same press opens the read-and-tap fallback for the
  locked target instead of the microphone.
- **Space shares Talk and interact.** While a Talk prompt is live, speech takes
  priority only when it handles the press. A refused Talk press remains available
  to collect / deliver / return at the Restaurant or fill at the Drink Stand.

Interim hypotheses are judged live, for SUCCESS ONLY — a correct sentence is
accepted the instant the recognizer reports it. A non-match keeps listening
until the recognizer ends.

Listening is unmistakable: the button turns red with a pulsing ring and a ● dot
and a Japanese label (● きいてるよ…), and returns to ready the moment the session
ends.

Removed: hold-to-talk and its pointer-capture mechanics, dwell-to-talk
(`talkDwell.js`, `AUTO_TALK_*`), and every automatic listen after a dwell or a
click-to-walk. The microphone opens only on a press.

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

1. Attempts 1 and 2: normal press-to-talk.
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

### Protected speech focus (ADDED 2026-09-12 — applies to every minigame)

> **While the child is speaking, the game stops pressing them.**

Speaking English must never cost a child anything in a game about speaking
English. Speech focus begins when the child presses Talk on a valid target (or
the fallback opens), never merely because the child walked into a talk radius. Whenever a required speech interaction is open — the talk prompt
showing, the button held, recognition running, a retry after a failed
recognition, or the read-and-tap fallback — every source of service pressure
pauses or nearly pauses:

- all customer patience, not only the customer being spoken to;
- preparation, cooking and pouring timers;
- customer spawning, queue promotion and rush scheduling;
- any other clock that can turn waiting into a worse outcome.

NPC animation, dialogue, recognition and HUD carry on normally. The feel is
`normal play → approach → focus → speak → hear the answer → play resumes`, not
a modal pause; there is no large PAUSED overlay.

The consequence that matters: a sentence that needed two recognition attempts
must not consume twice the service time of one that worked first try. A child
may never lose a customer, a temperature grade, patience or a combo because
classroom speech recognition misheard them.

Implemented once, in `src/systems/speechFocus.js`, and used by every minigame
that has service pressure. Each such minigame keeps a **service clock** that is
separate from the render clock: spawns, patience, preparation and rush all read
the service clock, which advances by `dt × focusScale` and therefore freezes
during focus by construction rather than by a guard at each timer.

---

## 4. Minigame 1 — Restaurant

Player is a waiter. Never a cook.

Foods: curry, pizza, hamburger, noodles, sushi.

### Identity (revised 2026-09-12)

Restaurant is the **working-memory** stage. The question it puts to the child is
never "what food is this?" but:

> **Curry is going past on the belt. Who said curry?**

Drink Stand asks the other question — "she said orange juice, where is that
machine?" — and the two must never collapse into one service game. Restaurant
difficulty is therefore memory load and competing demands, never faster speech.

### Environment

A compact 3D dining room: several tables, wide clear pathways, and a back wall
composed as one piece — **MATSUBARA RESTAURANT** as a mounted wall sign on top,
a moving conveyor below it, kitchen openings in the two side walls. Small enough
that crossing it is quick and readable. There is no bell and no one standing at
a pass (revised 2026-09-14).

### Loop

1. Three to five customers are visibly seated. Every unclaimed seated customer
   can be asked; there is no raised hand, question mark or other order cue.
2. Player walks over and presses Talk once: "What food do you like?"
3. NPC answers "I like curry." — spoken, plus a full speech bubble for about
   2.5 seconds. It then collapses to a persistent ownership bubble that says
   only "I like...": white means the player's customer and black means the
   rival's. No bubble means the seated customer has not yet been asked, and no
   ownership bubble is shown while a customer eats or leaves. Speech focus
   holds all service pressure while the full answer is showing.
4. The kitchen never cooks to order (revised 2026-09-15): a continuous random
   stream of every menu food rides the conveyor at all times. No sound or
   marker announces anything; the child watches for a curry.
5. Player recognises the food, grabs it from the moving belt, remembers who
   asked for it, and carries it to that customer.

### Conveyor (added 2026-09-14)

One continuous straight belt runs across the back of the room: it emerges
through an opening in the **right** side wall, travels horizontally in front of
the back wall, and disappears through an opening in the **left** side wall. It
reads as the visible middle of a larger kitchen system; it never starts or
stops inside the room, and its direction never changes.

The belt surface moves from service time whenever service is active, including
when it carries nothing. Speech focus, pause, or another global freeze stops it;
when that ends it resumes with every dish where it was.

**Supply (revised 2026-09-16).** The belt is kitchen output, not an order queue.
Food enters from a shuffled bag holding each of the five foods once; when the
bag empties it is reshuffled, and a new bag never starts with the food that
ended the last one. Dishes enter at a steady rate from the start of service —
with no orders open, with every order served, and between waves. Nothing about
orders, either waiter or a carried dish affects which food comes next, so a
pizza never appears *because* someone asked for pizza. Starting the rush changes
only the rate, never the shuffled-bag food sequence. The bag bounds any food's
absence to eight dishes; no hidden demand bias is added. A dish that reaches the
far wall is simply gone. Dishes carry no owner: a pizza is a pizza, for whoever
takes it, and any dish of a food satisfies any customer who wants that food.
Missing a dish costs time, never the order.

Every shift starts solo at these belt rates (speed in belt units per service
second / entry interval): Easy 0.9 / 4.9 s, Normal 1.0 / 4.4 s, and Challenge
1.05 / 4.2 s. Easy stays at that rate for the whole shift. Normal's rush rate is
1.08 / 2.75 s; Challenge's is 1.18 / 2.0 s. Consecutive dishes must remain at
least 1.9 belt units apart, so the effective entry interval is never less than
`1.9 / speed`, including across the instant the rush begins. Density is the
main increase in pressure; the smaller speed increase must never turn the belt
into a twitch game.

**Picking up.** Keyboard interaction, click or tap on a dish, and click-to-walk
all work, with a forgiving pickup window along the belt front; a click leads the
moving dish rather than demanding precision. A player carries one dish at a
time. A wrongly picked dish goes into the **dish return** beside the entry end:
it is removed and nothing else changes; the stream is unaffected. Wrong pickup
and wrong delivery are separate mistakes. When the player is standing at the
belt front without a dish, a pickable dish takes priority over a nearby
customer's Talk prompt unless a question is already locked or that customer was
explicitly clicked.

**Never added:** a food icon over a customer, a line or glow linking dish and
table, a ticket, a label of the requested food, or automatic delivery. The
conveyor changes how food is acquired, never what must be remembered.

Several demands overlap by design: unasked seated customers, unresolved orders,
dishes moving past on the belt, food cooling in the player's hands, and internal
customer patience. The player chooses what to do next. There is no global
countdown — the interesting decision is "deliver this hot curry now, or ask
another customer first?"

The order is NOT displayed on a ticket, a HUD, or above the table. Memory is
the mechanic. A secondary 🔊 もういちど きく control re-asks the customer, so a
child who is stuck always has a way forward; it forfeits that customer's memory
bonus and never deducts score (see "Listening again").

### Each customer's food is independent, and repeats are allowed

Foods were dealt from a shuffled five-item menu without repetition, so at five
customers every food appeared exactly once and the last order could be deduced
by elimination — the leak the anti-shortcut rule names explicitly, and the
opposite of the Drink Stand's rule that nothing is removed from the choice.

Each customer's food is now chosen independently and uniformly; two customers
may want the same dish. A ready dish is therefore identified by **what it is**,
not by which customer it was cooked for: if two people asked for curry and two
curries are on the counter, either curry satisfies either of them. That keeps
duplicates fair — a child must never be refused for carrying a visually
identical dish to the wrong one of two curry customers — and it is simpler than
binding each plate to one person.

### Scoring

- Correct delivery — the primary term.
- First-try delivery drives a visible combo: 2 COMBO!, 3 COMBO!, … A wrong
  customer resets it. The combo counts physical deliveries only; it is never
  tied to how fast or how fluently the child spoke, and replaying an answer
  forfeits that customer's memory bonus without breaking the combo.
- Food temperature: the dish cools after it is picked up from the belt.
  Hot 3 stars / Warm 2 / Cold 1.
- Customer patience stays internal and forgiving. Unclaimed seated customers
  effectively never leave; once claimed, patience drains at one point per
  service second from a starting 150 / 140 / 130 on Easy / Normal / Challenge.
  Below 30%, a seated customer looks around gently as the only late warning —
  no meter, bar, ring, countdown or icon is shown.

Cold food never fails, and no order is ever permanently lost.

### Wrong delivery (revised 2026-09-12)

Free trial and error was too effective: with three customers, walking the dish
from table to table beat listening. Guessing must stay possible and stay
recoverable, but must be *slower* than understanding the answer.

On a wrong delivery the customer politely refuses in Japanese, the English
answer is not repeated, no hint about the food appears, the dish stays in the
player's hands, and that order's first-try credit and combo are lost. That
customer then will not reconsider the same dish for a few seconds, and the
player must step out of their radius before offering it to anyone else.

Rejected: making the player carry a refused dish back to the pickup counter.
That converts a listening mistake into a temperature penalty plus a long walk,
which punishes the unsure child hardest — the opposite of what the friction is
for. The friction exists to make listening the fast route, not to punish.

### Difficulty

Never one customer. With a single recipient the only ready dish obviously
belongs to them, and the English answer becomes unnecessary — the anti-shortcut
rule fails at the easiest level, where it matters most.

- **L1** — warm-up shift: 3 tables, 5 customers in total, very generous
  patience. Every unclaimed seated customer may be asked, so the answer must
  still be remembered among several possible recipients.
- **L2** — rush: 4 tables, 9 customers in total, several unresolved orders at
  once, matching dishes arriving in no set order, and a rival who arrives after
  the player's third correct delivery.
- **L3** — rush hour: 5 tables, 13 customers in total; the player may ask any
  unclaimed seated customer while carrying food, a rival waiter shares the
  belt after the player's third correct delivery, and patience is moderate but
  still forgiving.

### Rush and rival waiter (added 2026-09-13, revised 2026-09-16)

Every shift starts with the player as the only waiter. Easy has no rival and no
rate change. On Normal and Challenge, the player's third **correct delivery**
triggers the rush exactly once. Wrong deliveries, customers leaving, Listen
Again, taking orders and rival service do not count. The completed delivery's
normal feedback plays first, followed by a 0.9-second service-time beat. Then
the belt switches to its rush rate, the director enters rush, and a brief
`ランチラッシュ！ ウェイターが きたよ！` phase cue and score pill appear.

The rival physically enters at `(-2.1, 6.6)`, walks down the clear aisle to
`(-2.1, 2.4)` at about 4 units per service second, then plays `emote-yes` for
0.6 seconds. Only after that entrance does its existing state machine begin;
it never teleports into a claim or starts with a customer. The beat, walk and
emote all freeze under speech focus like every other source of service
pressure, and the entrance can never run twice.

Normal's rival has speed 3.6, waits until a customer has been seated for 7
seconds, may claim 0.35 of the shift total, hesitates 0.8–1.5 seconds, and
notices a dish after 1.0 second. Challenge's rival has speed 4.4, waits 3.5
seconds, may claim 0.5 of the shift total, hesitates 0.3–0.8 seconds, and
notices a dish after 0.6 seconds. The longer 9- and 13-customer shifts leave
customers to compete for after the tutorial-like first three deliveries.

Every seated customer has an owner: `null` (unclaimed), `player`, or `rival`.
A newly seated customer is unclaimed and immediately talkable. Pressing Talk on
an unclaimed seated customer reserves that customer at once; the rival can
never claim a player-reserved customer, so recognition time can never cost the
child an order. A refused reservation opens no microphone. A cancel press, or
leaving the talk radius before the question is accepted, releases the
reservation and leaves the customer unclaimed; a failed attempt keeps it while
the child stays in range. An accepted question (spoken or read-along) converts
it to player ownership. Click-to-walk alone never reserves or starts speech.

The customer lifecycle is `walkingIn → seated → awaiting → eating → leaving →
delivered/left`. Only seated, unclaimed customers are talkable. Only
player-owned awaiting customers accept the player's delivery; rival-owned,
unclaimed, eating and leaving customers are never delivery targets. The full
answer bubble is visible for about 2.5 seconds after a successful question or
Listen Again, hiding the ownership bubble during that time. It then returns as
a white player or black rival "I like..." bubble. It never contains the food.
There is no separate owner badge. Listen Again remains available only for
player-owned awaiting customers and forfeits only that customer's memory bonus.

The rival announces a target before walking and claims only when it physically
arrives, if the customer is still unclaimed and unreserved. If the player has
reserved or claimed that customer on the way, the rival abandons the target and
waits a random 0.6–1.2 seconds before choosing again. Ownership never
transfers. Served and departed customers are removed from the registry.

The rival is a pure, one-customer-at-a-time state machine (revised 2026-09-15):

    idle → choosing → walkingToCustomer → takingOrder → watchingBelt
         → walkingToDish → carrying → delivering → idle

It chooses the longest-seated unclaimed, unreserved customer, subject to the
level's minimum seated age. Taking an order lasts about 1.2 seconds. It then
watches the same belt as the player for its customer's food. A dish becomes an
option only after the level's dish-notice delay (no instant knowledge) and only
if the rival can reach the belt front before it leaves. The rival walks to where
that dish will be, facing its path, and takes it only if the dish is still on
the belt within the pickup window when it arrives; otherwise it drops that
target and looks again. Walking time is distance divided by the level's rival
speed, with the level's random hesitation, so an attentive child can usually
beat it to a dish and sometimes will not. Walk targets are exposed as positions
so the controller can animate them; its path and facing are how a child reads
"the waiter is going for that pizza". No floating marker is added.

**Dishes are shared; customers are not (revised 2026-09-15).** Both waiters take
food from the one belt, and either may take the dish the other wanted. The first
pickup wins: the dish leaves the belt in that same update and the other waiter
re-evaluates. Within one controller update the player's pickup is resolved
before the rival's. A dish in anyone's hands can never be taken by the other
waiter. The rival never delivers to, completes or claims a player-owned or
player-reserved customer, and the player can never deliver to a rival-owned
one. There is no rival hatch and no rival cooking. Foods remain independent
across both waiters and repeats are allowed. Customer patience still applies
after a rival claim; if that customer leaves, the rival discards any dish it
carries and abandons the task.

The rival's claim limit follows the level's share of the customers remaining
when the rival becomes active. After reaching that limit it only finishes its
current task. The shift ends when all customers have been served by either
waiter or have left. Progress counts all resolved customers. Pure comparison
data separately tracks `playerServed` and `rivalServed`; the player's stars and
scoring never depend on `rivalServed`.

The registry and rival read only service delta. Zero service delta freezes
seated age, walking, claiming, hesitation, order-taking, dish targeting,
pickup, delivery and every other rival timer, including through recognition
retries. New rival claims also honour the existing 0.8-second post-focus hold.
Events and ownership are plain data; the Restaurant controller continues to
own every scene object.

### Service shift (revised 2026-09-13)

A session is a short service shift, not a fixed list that empties the room.
When a customer is served or gives up, their table frees and, after a short
randomised delay, a new customer walks in and sits with a new, independently
random food; a table never predicts a food. The shift ends when its customer
total has been resolved (served or left), so the room stays busy until the
last few customers.

A small service director, driven only by the service clock, shapes the shift.
On Normal and Challenge its warm-up is manual: it cannot advance to rush by
elapsed time and changes phase only when the third correct player delivery
starts the one-shot rush. Easy has no gameplay rush and its conveyor remains at
the solo rate.

- **Warm-up** — the solo opening, with staggered arrivals and gentler delays.
- **Rush** — arrivals, open seating, claimed customers and moving dishes
  overlap; idle stretches are cut short.
- **Final push** — once the last customers are seated: shorter replacement
  delays and a small ラストスパート！ cue. No sudden spike.

The director schedules arrivals and replacements, briefly holds new events
after speech focus ends so the child is not ambushed the instant they finish
speaking, and keeps enough randomness that shifts do not feel scripted. Because
it reads only the service clock, speech focus freezes it entirely. A small
progress counter is allowed; a large countdown is not. Nothing is ever a game
over: a shift always ends, because patience eventually resolves every claimed
customer while unclaimed seated customers remain available to ask.

Rejected for now: continuous ambience (in a classroom it bleeds into the
microphone during recognition) and footstep sounds (noise for no information).

Carrying two dishes at once is deliberately NOT in this revision: it adds a
carry-slot state machine and delivery ambiguity for little pedagogical gain.
Revisit only after classroom observation.

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
- **Hold to fill (revised 2026-09-12).** Holding Space at a station runs that
  dispenser and the liquid visibly rises in the cup; releasing stops it. One
  identical control at all six stations — six stations, not six minigames.
  Starting a different drink empties the old cup first.
- Filling is forgiving, and pouring is never a skill that competes with
  listening. A cup past roughly a third full is already a valid drink; an
  underfilled cup can be topped up at the same station; holding past full plays
  a comic overflow and the drink stays valid. Fill level never enters the
  score — it is feedback and feel only. The child must never lose a correct
  drink for holding a button slightly too long.
- A trackpad child must not be worse off: a short tap of the on-screen action
  latches the dispenser and fills to full on its own, while a real hold behaves
  as a hold. Every route ends in a valid cup.
- Space at an asked customer while holding a cup serves it.
- At an unasked customer, the 🎤 Talk control appears; press it (or Space) once
  to ask.
- Click / tap a station or a customer: the avatar walks there by itself and
  does the same action on arrival, so a trackpad alone is enough.

Each station has its own look and sound — the pale blue stream of water, milk's
thick white pour, bright orange, pale gold, amber tea with a wisp of steam,
green soda with fizz — but never its own controls, and the English word stays
plainly readable at 1366x768.

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

A session is a short, intense service rush (revised 2026-09-13). Customers per
session: L1 5, L2 6, L3 7. Every customer is a real asking — there are no
filler customers — so repetition stays bounded. At most 1, 2 or 3 windows are
in use at once; anyone beyond that waits in a visible line, not yet asked,
with their patience paused.

A small director, driven only by the service clock, keeps the stand busy after
a short warm-up: a freed window is refilled from the line at once, and the line
is topped up so that during the rush someone is usually waiting behind the
windows. The final ラッシュ！ is a real phase, not only a banner: the remaining
customers arrive in quick succession, the line visibly grows and the cue sounds
quicken. It is a finale, never a fail state. Speech focus freezes the director
with everything else; when the answer ends, the rush resumes.

Drink Stand stays immediate: no kitchen delays, no tray, no temperature and no
person-order memory beyond the customers currently at the windows.

Patience is a visible, generous meter above each customer at a window. A
customer whose patience runs out waves and leaves. Play continues, and there is
no failure state.

Speech focus (section 3) pauses **every** window's patience, the queue, the
arrival schedule and the rush — not only the customer being spoken to, which
was the earlier behaviour and quietly punished the child for speaking whenever
two or three windows were busy. ラッシュ！ must never make a child hurry their
English.

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

The active stage: walking a crowd of new friends across a playground.

Sports: soccer, basketball, baseball, volleyball.

### Environment (v1, decided 2026-09-12)

A playground with a central plaza, where NPCs wait, and four zones in the four
corners around it. Each zone is identifiable from across the field by
silhouette and colour: a goal and a green pitch, a hoop and an orange court, a
backstop and a brown diamond, a net and sand. Each zone also has a large sign
with a picture and its English word, as at the Drink Stand. A straight path
leads from the plaza to each zone without crossing any other zone. The whole
field is small enough to cross in a few seconds. The follow camera and WASD
controls are the same as in the Restaurant.

### Loop

1. NPCs wait at random spots on the plaza. Walk up to one and ask "What sport
   do you like?"
2. The NPC answers ("I like basketball."), spoken plus a bubble. The bubble
   disappears afterwards, and nothing on screen records the answer. The NPC
   then follows the player.
3. Several NPCs can follow at once, trailing in a line.
4. Entering a zone: every follower whose sport it is joins in and plays there
   for the rest of the session. The sport is the reward animation, not a
   minigame: soccer kicks at the goal, basketball shoots, baseball bats,
   volleyball passes over the net. A ball moves procedurally.
5. Entering a zone where NO follower's sport matches: the followers shake their
   heads, say ここじゃないよ in Japanese without repeating the English, and keep
   following.
6. 🔊 もういちど きく (shown while anyone is following) replays each current
   follower's answer in turn. It forfeits only their memory bonus.
7. When everyone has joined, next comes the turnaround: "What sport do you
   like?" / "I like ___." with any of the four sports.

### Difficulty

Each level sets how many answers the child holds and routes at once. L1 has 3
NPCs, one at a time: the next appears after a delivery. L2 has 4 NPCs in two
waves of two. L3 has 6 NPCs in two waves of three. With two or three
followers, the child plans an order of zones. There is no timer and no
patience meter.

### Anti-shortcut review (applied before building)

- The original "wrong zone, no penalty" rule let a child tour all four zones
  until every NPC joined, winning without listening. Wrong zones therefore
  cost the dominant first-try credit (below). The game still never gets stuck.
- Each NPC's sport is chosen uniformly at random, independent of their model,
  waiting spot, asking order and every other NPC. Repeats are allowed: forcing
  different sports would let the last follower's sport be found by
  elimination.
- Zone positions are shuffled once per session. NPCs carry no ball or kit,
  and nothing on an NPC or in the scene points to their zone.
- Paths never cross another zone, so passing through never counts as a visit
  or gives feedback.

### Scoring

Computed in a pure module from per-NPC records. Joining in the first zone
visited while that NPC was following counts as first try, the dominant term.
Joining after one or more wrong-zone visits while following earns part credit.
A memory bonus goes to followers never replayed. Route efficiency is expressed
through the same term: a wrong-zone visit costs every current follower their
first-try credit, so a good route and a correct memory are the same thing.
First-try share under one half caps the result at two stars.

---

## 8. Minigame 5 — Zoo

The exploratory finale, and the largest space — but navigable, not sprawling.

Animals (thirteen): elephant, giraffe, penguin, tiger, deer, alpaca, horse,
fox, wolf, stag, bull, cow, donkey.

### Campus (revised 2026-09-13 — replaces the single ring of habitats)

A compact, walkable zoo campus rather than pens around a circle. With every
animal hidden it must still read as a zoo: an entrance, paths, exhibits,
landscaping, signage and themed areas. The child should rarely be truly lost.

- **Entrance plaza (home base)** at the south: striped gate, benches, planters,
  lamps, a ticket booth or kiosk, and a large YOU ARE HERE board. Visitors wait
  here, and it stays recognisable from nearby paths.
- **Central fountain** where the main paths meet: the landmark a child learns to
  return to.
- **Four themed regions**, visibly different, dressed from reusable kits:
  - *Savanna* — elephant, giraffe, tiger (as the transition toward the forest):
    warm dry ground, broad sparse trees, rocks, a tall giraffe feeder, a mud pool.
  - *Forest trail* — deer, fox, wolf, stag: dense pines, bushes, logs, darker fencing.
  - *Farm* — horse, alpaca, cow, bull, donkey: wooden paddocks, a red barn, hay, troughs.
  - *Penguin Cove* — penguin: a pool, pale rocks, a rail or small bridge; well away
    from the giraffe.
- **Paths** form an irregular figure-eight through the fountain with one or two
  cross-paths. Broad, curving, forgiving; no long dead ends (a habitat's viewing
  spot may be a short spur).
- **Signposts** at junctions name each region in Japanese and list all of its
  animals in English, equally. The YOU ARE HERE board shows every region and
  animal equally and never marks the current request.
- **Camera**: a closer follow camera, so the campus spans roughly four to six
  screens and turning a bend reveals a new area. No transitions between areas.
- **Travel stays short**: entrance to any habitat within about ten seconds at
  walking speed, measured in playtest. Difficulty never comes from walking.
- **Every habitat has an obvious photo viewpoint** on the path with a clear
  sightline. Dressing never blocks the animal and scenery is never a photo subject.
- **Collision is simple**: buildings, habitat fences and the map edge are solid;
  grass, flowers and small bushes are not, so the avatar never snags.
- **Chromebook budget**: low-poly CC0 assets only (provenance in
  `public/assets/zoo/environment/README.md`), shared or instanced vegetation,
  textures at most 512 px, no new dependencies.

### Loop

1. A visitor at the plaza asks for help. The child asks "What animal do you
   like?" and hears "I like elephants." The bubble then disappears, and nothing
   records the answer.
2. The child explores, finds that habitat, and takes a photo.
3. Back at the plaza, the child shows the photo to the visitor. The right
   animal earns a delighted reaction and the visitor leaves happy.
4. The wrong animal: the visitor says in Japanese that it is not their
   favourite, without repeating the English, and waits for another try. **The
   photo is used up either way** (revised 2026-09-13): one photograph is one
   delivery attempt, so one photo can never be tested against every waiting
   visitor; another attempt needs another photograph.
5. 🔊 もういちど きく, used beside a particular visitor, replays only that
   visitor's answer and forfeits only their memory bonus.
6. After the last visitor comes the turnaround: "What animal do you like?" /
   "I like ___." with any of the thirteen animals.

### Photo mechanic (ADDED — the original had no real action)

Pressing the camera opens a 2D viewfinder overlay over the 3D view. The animal
must be framed inside it — reasonably centred and large enough — before the
shutter works. Aiming is forgiving and coarse: turn and step closer, never
pixel-accurate. The snapshot is kept and shown in the stamp book.

**The camera holds one photo at a time.** A new shot replaces the old one.
This is what stops "photograph all six, then show them in turn" from replacing
listening, and it is also why the photo is worth taking carefully.

### Difficulty

L1 3 requests, one visitor at a time. L2 4 requests with two visitors waiting.
L3 5 requests with three (revised 2026-09-13 from 6: the campus adds walking,
and six askings is repetition), so several animals are held in memory at once.
Time is never the challenge here, and there is no failure state.

### Anti-shortcut review (applied before building)

- Free trial and error is the real risk. Carrying only one photo makes a tour
  cost a full walk back to the habitat for every attempt, and showing the wrong
  animal loses the dominant first-try credit. Nothing is removed from the
  choice, so elimination never narrows it.
- Each visitor's animal is uniformly random and independent of their model,
  waiting spot, asking order and the other visitors; repeats are allowed.
- Visitors carry nothing animal-related, and no habitat is highlighted. Habitat
  positions stay fixed, as a real zoo's would: knowing where the pandas live is
  not a shortcut, because which animal is wanted is what the English carries.
- Nothing points the way. There is no marker, arrow or minimap pointing at the
  wanted habitat, because that would replace the sentence entirely.
- A shown photo is consumed whether right or wrong, so carrying one photo from
  visitor to visitor cannot identify who wanted it.
- Region signposts and the YOU ARE HERE board list every animal equally. They
  help a child who understood "wolves" find the forest; they never say which
  word was spoken.

### Scoring

Computed in a pure module from per-request records. Showing the correct animal
first is the dominant term; showing it after a wrong attempt earns part credit.
Photo framing (reasonably centred, large enough) adds a little, so a careless
shot is worth less than a good one. A memory bonus goes to visitors never
replayed. First-try share under one half caps the result at two stars.

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
