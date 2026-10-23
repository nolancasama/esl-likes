/**
 * SPEECH MATCHING
 * ---------------
 * Pure logic, no DOM and no Web Speech API. The recognition wrapper lives
 * elsewhere; this module only judges transcripts.
 *
 * The pedagogical rule, carried over from town-builder and not negotiable:
 *
 *   A child who says the sentence well enough for a teacher to understand
 *   must always be rewarded. Recognition noise is the game's problem, not
 *   the child's.
 *
 * So this matcher errs toward acceptance. A false rejection teaches a child
 * that their correct English was wrong, which is far more damaging than a
 * false acceptance letting a sloppy attempt through.
 *
 * See SPEC.md section 3.
 */

/** The five lesson categories. The noun the child must be heard to say. */
export const CATEGORY = {
  food: 'food',
  color: 'color',
  drink: 'drink',
  sport: 'sport',
  animal: 'animal',
};

/**
 * Accepted spoken variants per word, for Japanese-accented English heard
 * through a classroom Chromebook microphone. Levenshtein fuzz alone is not
 * enough: "caller" for color and "anime" for animal are too far away by edit
 * distance but are obviously the intended word in context.
 *
 * Extend these from real classroom transcripts as they are observed.
 *
 * @type {Record<string, string[]>}
 */
export const VARIANTS = {
  food:   ['food', 'foot', 'hood', 'foods', 'fud', 'whod', 'fudo', 'foodo', 'hudo', 'fooddo', 'fuudo', 'foodu', 'fuud'],
  color:  ['color', 'colour', 'caller', 'collar', 'cooler', 'kara', 'kalar', 'karaa', 'colors', 'kalaa', 'karra', 'colorr'],
  drink:  ['drink', 'dring', 'drinks', 'junk', 'trink', 'dorinku', 'drinku', 'dorink', 'dorinks', 'drinko', 'dlink', 'dorinko'],
  sport:  ['sport', 'spot', 'sports', 'spore', 'support', 'supotsu', 'supo', 'sportu', 'supootsu', 'supoto', 'spooto', 'spots'],
  animal: ['animal', 'anime', 'animals', 'aniaml', 'enemal', 'animaru', 'animol', 'anemal', 'anima', 'animo', 'aniaru', 'animarus'],
  // The park's short animal names get no fuzz slack at all (len <= 4), so their
  // plurals and usual mis-hearings have to be listed explicitly.
  dog:    ['dog', 'dogs', 'doggu', 'dogu', 'dock', 'doggy'],
  cat:    ['cat', 'cats', 'kat', 'cut', 'catto', 'kyatto'],
  pig:    ['pig', 'pigs', 'piggu', 'pigu'],
  sheep:  ['sheep'],
  wolf:   ['wolf', 'wolves'],
  horse:  ['horse', 'horses', 'house', 'hoss', 'hoosu', 'horsu'],
  // A loanword the class already says as ラーメン, so the recogniser returns the
  // long-vowel and l/r shapes far more often than the dictionary spelling.
  ramen:  ['ramen', 'raamen', 'rahmen', 'lamen', 'laamen', 'ramon', 'raman', 'ramenu', 'lamon'],
  what:   ['what', 'wat', 'hwat', 'watt', 'wot', 'but', 'watto', 'whatto', 'hut', 'whatt', 'hwatto', 'howatto', 'wha'],
  like:   ['like', 'lick', 'light', 'rike', 'raiku', 'laiku', 'riku', 'raik', 'laik', 'rikes', 'likes', 'liked'],
};

/**
 * The answer words a child may hear or say, per category.
 * @type {Record<string, string[]>}
 */
export const ANSWERS = {
  food:   ['curry', 'pizza', 'hamburger', 'ramen', 'sushi'],
  color:  ['red', 'blue', 'yellow', 'green', 'pink', 'purple', 'orange'],
  drink:  ['water', 'milk', 'orange juice', 'apple juice', 'tea', 'soda'],
  sport:  ['soccer', 'basketball', 'baseball', 'volleyball'],
  animal: ['cat', 'chicken', 'dog', 'horse', 'pig', 'raccoon', 'sheep', 'wolf'],
};

/**
 * Strip punctuation and case, collapse whitespace.
 * @param {string} text
 * @returns {string}
 */
export function normalise(text) {
  // The recogniser can hand back undefined for an empty result, and callers
  // pass transcripts straight through. Coerce rather than throw mid-round.
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Edit distance between two strings.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  // Single-row DP
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);

  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,       // deletion
        curr[j - 1] + 1,   // insertion
        prev[j - 1] + cost, // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/**
 * Maximum allowed Levenshtein distance for a word of a given length.
 *
 *   len <= 4 -> 0    len 5-6 -> 1    len 7+ -> 2
 *
 * Short words get no fuzz at all, because at that length a single edit is
 * usually a different word rather than a mis-hearing: like/bike, tea/sea and
 * red/bed are all distance 1. Legitimate short mis-hearings are handled by the
 * VARIANTS table instead, which lists them explicitly.
 *
 * Longer words get more slack, per the pedagogical rule — "hamburger" survives
 * two edits because nothing else in the lesson is close to it.
 */
function maxDistance(len) {
  if (len <= 4) return 0;
  if (len <= 6) return 1;
  return 2;
}

/** Town Builder question slack; answers and hasWord keep the stricter profile. */
function questionMaxDistance(len) {
  if (len <= 4) return 1;
  if (len <= 7) return 2;
  return 3;
}

/**
 * How closely `word` was heard among the tokens: 0 for an exact or listed-variant
 * hit, the edit distance for a fuzzy hit inside the length-scaled slack, and
 * Infinity when it was not heard at all.
 *
 * @param {string[]} tokens
 * @param {string} word
 * @param {(len: number) => number} maxDist
 * @returns {number}
 */
function wordDistance(tokens, word, maxDist = maxDistance) {
  const w = normalise(word);
  const variants = VARIANTS[w];
  let best = Infinity;
  for (const token of tokens) {
    const t = normalise(token);
    if (t === w || (variants && variants.includes(t))) return 0;
    const d = levenshtein(t, w);
    if (d <= maxDist(w.length) && d < best) best = d;
  }
  return best;
}

/**
 * Is `word` present among the spoken tokens, allowing for small mis-hearings
 * and the explicit VARIANTS table? Fuzz slack scales with word length: short
 * words get little or none, so "like" does not match "bike".
 *
 * @param {string[]} tokens
 * @param {string} word
 * @returns {boolean}
 */
export function hasWord(tokens, word) {
  return wordDistance(tokens, word) !== Infinity;
}

/**
 * Judge the child ASKING the question: "What ___ do you like?"
 *
 * Requires the category noun plus either "what" or "like", heard in a separate
 * token. A clearly heard different category blocks a merely fuzzy noun hit.
 *
 * @param {string} transcript raw text from the recogniser
 * @param {string} category one of CATEGORY
 * @returns {{ ok: boolean, what: boolean, noun: boolean, like: boolean,
 *             wrongCategory: boolean, text: string, tokens: string[] }}
 *          the per-part hits so the UI can give useful, gentle feedback
 */
export function matchQuestion(transcript, category) {
  return matchQuestionAlternatives([transcript], category);
}

// Keep distance-0 evidence separate from fuzzy hits so alternatives can pool
// support without joining transcripts or losing a clearly heard category.
function questionEvidence(transcript, category) {
  const text = normalise(transcript);
  const tokens = text ? text.split(' ') : [];
  const nounDistances = tokens.map((token) => wordDistance([token], category, questionMaxDistance));
  const nounDistance = Math.min(...nounDistances);
  const noun = nounDistance !== Infinity;
  const nounIndex = noun ? nounDistances.indexOf(nounDistance) : -1;
  const anchorTokens = tokens.filter((_, index) => index !== nounIndex);

  return {
    what: wordDistance(anchorTokens, 'what', questionMaxDistance) !== Infinity,
    noun,
    like: wordDistance(anchorTokens, 'like', questionMaxDistance) !== Infinity,
    exactNoun: nounDistance === 0,
    otherCategory: Object.values(CATEGORY).some((other) => (
      other !== category && wordDistance(tokens, other, questionMaxDistance) === 0
    )),
    text,
    tokens,
  };
}

/**
 * Pool question evidence across recogniser alternatives, without concatenating.
 * @param {string[]} alternatives
 * @param {string} category one of CATEGORY
 * @returns {{ ok: boolean, what: boolean, noun: boolean, like: boolean,
 *             wrongCategory: boolean, text: string, tokens: string[] }}
 */
export function matchQuestionAlternatives(alternatives, category) {
  const evidence = (alternatives?.length ? alternatives : [''])
    .map((text) => questionEvidence(text, category));
  const what = evidence.some((result) => result.what);
  const noun = evidence.some((result) => result.noun);
  const like = evidence.some((result) => result.like);
  const wrongCategory = evidence.some((result) => result.otherCategory)
    && !evidence.some((result) => result.exactNoun);
  const ok = noun && (what || like) && !wrongCategory;
  const { text, tokens } = evidence.find((result) => result.noun) || evidence[0];
  return { ok, what, noun, like, wrongCategory, text, tokens };
}

/**
 * Judge the child ANSWERING the turnaround beat: "I like ___."
 *
 * Any valid answer word for the category is correct — this is expression,
 * not a quiz. Requires "like" plus one recognised answer word, or a personal
 * phrase when openAnswer is enabled. Returns which answer was heard so the
 * game can save and later reference it; known words keep their canonical id.
 *
 * @param {string} transcript
 * @param {string} category one of CATEGORY
 * @param {{ openAnswer?: boolean }} options allow a personal phrase after "like"
 * @returns {{ ok: boolean, like: boolean, answer: string|null,
 *             freeForm: boolean, text: string, tokens: string[] }}
 */
export function matchAnswer(transcript, category, { openAnswer = false } = {}) {
  const text = normalise(transcript);
  const tokens = text ? text.split(' ') : [];

  // A child may answer in the singular or the plural ("I like lion" / "I like
  // lions") and both are right. Words of four letters or fewer get no fuzz, so
  // plural endings are stripped explicitly rather than left to edit distance.
  const answerTokens = tokens.flatMap((token) => {
    if (token.length > 3 && token.endsWith('es')) return [token, token.slice(0, -1), token.slice(0, -2)];
    if (token.length > 2 && token.endsWith('s')) return [token, token.slice(0, -1)];
    return [token];
  });

  const like = hasWord(answerTokens, 'like');

  // Choose the CLOSEST answer, not the first one inside the fuzz range:
  // "baseball" is two edits from "basketball", so first-match recorded the
  // wrong sport. Multi-word answers ("orange juice") need every part heard.
  const answers = ANSWERS[category] || [];
  let answer = null;
  let bestDistance = Infinity;
  for (const ans of answers) {
    const ansNorm = normalise(ans);
    const parts = ansNorm.split(' ');
    const distance = parts.length > 1 && text.includes(ansNorm)
      ? 0
      : parts.reduce((sum, part) => sum + wordDistance(answerTokens, part), 0);
    if (distance < bestDistance) {
      bestDistance = distance;
      answer = ans;
    }
  }

  if (openAnswer && answer === null && like) {
    const likeIndex = tokens.findIndex((token) => hasWord([token], 'like'));
    const phraseTokens = likeIndex < 0 ? [] : tokens.slice(likeIndex + 1);
    const leading = new Set(['a', 'an', 'the', 'some', 'to', 'eat']);
    while (leading.has(phraseTokens[0])) phraseTokens.shift();
    const phrase = phraseTokens.join(' ').replace(/(?:^| )(very much|so much|a lot|too)$/, '');
    const remaining = phrase ? phrase.split(' ') : [];
    const filler = new Set(['it', 'that', 'this', 'you', 'them', 'me', 'uh', 'um', 'ah', 'eh', 'so', 'very', 'much', 'lot', 'and', 'i']);
    if (remaining.length && !remaining.every((token) => filler.has(token))) {
      const words = remaining.slice(0, 4);
      while (words.join(' ').length > 32) words.pop();
      if (words.length) {
        return { ok: true, like: true, answer: words.join(' '), freeForm: true, text, tokens };
      }
    }
  }

  const ok = like && answer !== null;
  return { ok, like, answer, freeForm: false, text, tokens };
}

/**
 * Prefer a known answer from any alternative, then the first free-form answer.
 * @param {string[]} alternatives
 * @param {string} category one of CATEGORY
 * @param {{ openAnswer?: boolean }} options
 * @returns {ReturnType<typeof matchAnswer>}
 */
export function matchAnswerAlternatives(alternatives, category, options) {
  if (!options?.openAnswer) {
    return matchBest(alternatives, (text) => matchAnswer(text, category));
  }
  const results = (alternatives?.length ? alternatives : [''])
    .map((text) => matchAnswer(text, category, options));
  return results.find((result) => result.ok && !result.freeForm)
    || results.find((result) => result.ok)
    || results[0];
}

/**
 * Judge a list of recogniser alternatives, returning the best result. The Web
 * Speech API returns up to five hypotheses and the correct one is often not
 * first, so every alternative gets a chance.
 *
 * @param {string[]} alternatives
 * @param {(transcript: string) => { ok: boolean }} judge
 * @returns {{ ok: boolean }} the first passing result, else the first result
 */
export function matchBest(alternatives, judge) {
  if (!alternatives || alternatives.length === 0) {
    return judge('');
  }

  let first = null;
  for (const alt of alternatives) {
    const result = judge(alt);
    if (first === null) first = result;
    if (result.ok) return result;
  }
  return first;
}
