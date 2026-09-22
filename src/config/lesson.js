// Every vocabulary item carries its own exact answer sentence (SPEC: "Vocabulary
// defines its own answer"). Never build one as "I like " + word: singular and
// plural cannot be inferred safely from the label.
const say = (id, answer) => Object.freeze({ id, answer });

const VOCABULARY = Object.freeze({
  food: Object.freeze([
    say('curry', 'I like curry.'),
    say('pizza', 'I like pizza.'),
    say('hamburger', 'I like hamburgers.'),
    say('ramen', 'I like ramen.'),
    say('sushi', 'I like sushi.'),
  ]),
  color: Object.freeze([
    say('red', 'I like red.'),
    say('blue', 'I like blue.'),
    say('yellow', 'I like yellow.'),
    say('green', 'I like green.'),
    say('pink', 'I like pink.'),
    say('purple', 'I like purple.'),
    say('orange', 'I like orange.'),
  ]),
  drink: Object.freeze([
    say('water', 'I like water.'),
    say('milk', 'I like milk.'),
    say('orange juice', 'I like orange juice.'),
    say('apple juice', 'I like apple juice.'),
    say('tea', 'I like tea.'),
    say('soda', 'I like soda.'),
  ]),
  sport: Object.freeze([
    say('soccer', 'I like soccer.'),
    say('basketball', 'I like basketball.'),
    say('baseball', 'I like baseball.'),
    say('volleyball', 'I like volleyball.'),
  ]),
  // The eight animals that actually roam the park. Answers are written out
  // rather than pluralised generically: "I like deer." has no -s.
  animal: Object.freeze([
    say('tiger', 'I like tigers.'),
    say('horse', 'I like horses.'),
    say('dog', 'I like dogs.'),
    say('deer', 'I like deer.'),
    say('cat', 'I like cats.'),
    say('penguin', 'I like penguins.'),
    say('chicken', 'I like chickens.'),
    say('giraffe', 'I like giraffes.'),
  ]),
});

function lesson(fields) {
  const vocabulary = VOCABULARY[fields.category];
  return {
    ...fields,
    vocabulary,
    /** Vocabulary ids in order: the values games store and compare. */
    answers: Object.freeze(vocabulary.map((item) => item.id)),
    /** The model answer the talk control shows for the turnaround. */
    answerExample: vocabulary[0].answer,
  };
}

export const LESSONS = Object.freeze([
  lesson({ id: 'restaurant', name: 'Restaurant', category: 'food', question: 'What food do you like?', available: true }),
  lesson({ id: 'coloring', name: 'Coloring', category: 'color', question: 'What color do you like?', available: true }),
  lesson({ id: 'drink-stand', name: 'Drink Stand', category: 'drink', question: 'What drink do you like?', available: true }),
  lesson({ id: 'sports', name: 'Sports', category: 'sport', question: 'What sport do you like?', available: true }),
  lesson({ id: 'zoo', name: 'Zoo', category: 'animal', question: 'What animal do you like?', available: true }),
]);

export const LESSON_BY_ID = Object.freeze(
  Object.fromEntries(LESSONS.map((lesson) => [lesson.id, lesson])),
);

export const UI = Object.freeze({
  appTitle: 'えいごで「すき」をつたえよう',
  loading: 'よみこみ中…',
  hub: {
    title: 'すきなゲームをえらぼう',
    moveHint: 'WASD / やじるしキーで あるく　スペースで はいる',
    interact: 'スペースで はいる',
    comingSoon: 'もうすぐ あそべるよ',
    practice: 'おためし版',
    greeting: 'きみは {answer} がすき！',
    stampBook: 'スタンプブック',
    settings: 'せってい',
  },
  speech: {
    micReady: 'おして はなそう',
    listening: '● きいてるよ…',
    detected: 'こえが きこえたよ',
    accepted: 'できた！',
    tryAgain: 'もういちど やってみよう',
    fallbackIntro: 'ことばを よんで、タップしよう',
    fallbackChoose: 'すきなものを えらんで、よもう',
    fallbackContinue: 'よんで つぎへ',
    unavailable: 'マイクを つかわず よもう',
  },
  dialogue: {
    replay: 'もういちど きく',
  },
  listenAgain: '🔊 もういちど きく',
  stampBook: {
    title: 'スタンプブック',
    earned: 'ゲット！',
    notEarned: 'まだだよ',
    stars: 'ほし {count}こ',
    close: 'とじる',
    photo: 'どうぶつの しゃしん',
  },
  settings: {
    title: 'せってい',
    open: 'せってい',
    close: 'とじる',
    volume: 'おとの おおきさ',
    micFree: 'マイクを つかわない',
    micFreeHint: 'ことばを よんで タップします',
    difficulty: 'むずかしさ',
    difficultyLevels: ['やさしい', 'ふつう', 'チャレンジ'],
    textSize: 'もじの おおきさ',
    textSizes: ['ちいさめ', 'ふつう', 'おおきめ'],
  },
  placeholder: {
    roomName: 'Restaurant',
    instruction: 'ボタンを おして、しつもんしよう',
    turnaround: 'こんどは きみの ばん！',
    complete: 'スタンプを ゲット！',
  },
  coloring: {
    roomName: 'アトリエ',
    walkToArtist: 'おともだちの ところへ いこう',
    askArtist: 'ボタンを おして、しつもんしよう',
    paintTitle: 'ロボットに いろを ぬろう',
    chooseColor: 'まず いろを えらぼう',
    paintHint: 'いろを えらんで、ロボットを ぬろう！',
    paletteLabel: 'いろを えらぶ',
    colors: {
      red: 'あか',
      blue: 'あお',
      yellow: 'きいろ',
      green: 'みどり',
      pink: 'ピンク',
      purple: 'むらさき',
      orange: 'オレンジ',
    },
    brushLabel: 'ふでの おおきさ',
    brushes: {
      small: 'ちいさい',
      medium: 'ふつう',
      large: 'おおきい',
    },
    tools: {
      eraser: 'けしゴム',
      eraserLabel: 'けしゴム（ぬった ところを けす）',
      undo: 'もどす',
      reset: 'やりなおす',
      resetConfirm: 'ぜんぶ けして いい？',
      resetYes: 'けす',
      resetNo: 'やめる',
    },
    power: 'ロボットパワー',
    powerFull: 'パワー まんタン！',
    alive: 'うごいた！',
    walkToGive: 'おともだちに えを とどけよう',
    givePicture: 'スペースで えを わたす',
    thankYou: 'ありがとう！',
    given: 'かべに かざったよ！',
    turnaround: 'こんどは きみの ばん！',
    complete: 'スタンプを ゲット！',
  },
  drinkStand: {
    roomName: 'ドリンクスタンド',
    walkToCustomer: 'おきゃくさんの ところへ いこう',
    askCustomer: 'ボタンを おして、しつもんしよう',
    walkToStation: 'ドリンクを いれに いこう',
    walkToServe: 'おきゃくさんに とどけよう',
    // Hold to fill: the hint names the hold, because releasing is how you stop.
    pourHint: 'スペースを おしているあいだ ドリンクが でるよ',
    pourDrink: 'おして ドリンクを いれる',
    pouring: 'ドリンクを いれているよ…',
    poured: 'カップに はいったよ！',
    topUp: 'もう すこし いれられるよ',
    fullCup: 'なみなみ！',
    overflow: 'あふれちゃった！ でも だいじょうぶ',
    serveHint: 'スペースで おきゃくさんに わたす',
    serveDrink: 'おきゃくさんに わたす',
    thankYou: 'ありがとう！',
    wrongDrink: 'ちがうみたい…もういちど おねがい',
    emptyCup: 'カップを からにしたよ',
    patientLeave: 'また こんどね！',
    rush: 'ラッシュ！',
    combo: '{count} コンボ！',
    // Small shift progress counter; never a countdown.
    progress: 'おきゃくさん {done}/{total}',
    roundEnd: 'みんなに とどけたよ！',
    turnaround: 'こんどは きみの ばん！',
    yourDrink: 'きみの ドリンクも できたよ！',
    complete: 'スタンプを ゲット！',
  },
  sports: {
    roomName: 'スポーツひろば',
    walkToFriend: 'ひろばの おともだちに ちかづこう',
    newFriends: 'あたらしい おともだちが きたよ！',
    askFriend: 'ボタンを おして、しつもんしよう',
    listenAndLead: 'こたえを きいて、いっしょに いこう',
    leadToZone: 'すきな スポーツの ばしょへ つれていこう',
    joined: 'ここが すき！ いっしょに あそぼう！',
    goodRoute: 'みつけた！',
    wrongZone: 'ここじゃないよ',
    tryAnotherZone: 'べつの ばしょへ いってみよう',
    everyonePlaying: 'みんな あそびはじめたよ！',
    turnaround: 'こんどは きみの ばん！',
    yourTurn: 'きみの すきな スポーツへ いこう！',
    letsPlay: 'いっしょに あそぼう！',
    complete: 'スタンプを ゲット！',
  },
  zoo: {
    roomName: 'どうぶつパーク',
    walkToVisitor: 'いりぐちの おきゃくさんに ちかづこう',
    askVisitor: 'ボタンを おして、しつもんしよう',
    explore: 'こたえを おぼえて、どうぶつを さがそう',
    searchHint: 'どうぶつは あるいて いるよ',
    cameraOpen: 'カメラを ひらく',
    cameraButton: 'カメラを ひらく　(C)',
    cameraKeyHint: 'Cキーでも カメラを ひらけるよ',
    cameraClose: 'カメラを とじる',
    shutter: 'しゃしんを とる',
    frameAnimal: 'どうぶつを わくの なかに いれよう',
    readyToShoot: 'いい しゃしんが とれそう！',
    photoTaken: 'しゃしんを とったよ！',
    carriedPhoto: 'もっている しゃしん',
    noPhoto: 'まだ しゃしんは ないよ',
    returnToVisitor: 'いりぐちの おきゃくさんに みせよう',
    showPhoto: 'スペースで しゃしんを みせる',
    thankYou: 'これが だいすき！ ありがとう！',
    wrongPhoto: 'これは いちばん すきな どうぶつじゃないよ',
    nextVisitors: 'つぎの おきゃくさんが まっているよ！',
    everyoneHappy: 'みんなに しゃしんを とどけたよ！',
    turnaround: 'こんどは きみの ばん！',
    yourFavourite: 'きみの すきな どうぶつも おしえてね！',
    complete: 'スタンプを ゲット！',
    animalNames: {
      tiger: 'トラ',
      horse: 'うま',
      dog: 'いぬ',
      deer: 'しか',
      cat: 'ねこ',
      penguin: 'ペンギン',
      chicken: 'にわとり',
      giraffe: 'キリン',
    },
  },
  restaurant: {
    roomName: 'レストラン',
    instruction: 'ボタンを おして、しつもんしよう',
    walkToCustomer: 'おきゃくさんに ちかづこう',
    walkToConveyor: 'コンベアに ちかづこう',
    watchConveyor: 'コンベアを よくみよう',
    walkToDeliver: 'おきゃくさんに とどけよう',
    delivered: 'ありがとう！',
    wrongDish: 'ちがうみたい…',
    // After a refusal that customer will not reconsider for a few seconds, which
    // is what makes listening faster than trying everybody in turn.
    thinkAgain: 'もういちど かんがえてみよう',
    wantsToOrder: 'てを あげている おきゃくさんが いるよ',
    orderTaken: 'ちゅうもんを きいたよ！',
    combo: '{count} コンボ！',
    // Shift phases and progress: small cues, never a countdown.
    rush: 'ラッシュ！',
    lunchRush: 'ランチラッシュ！',
    rivalTitle: 'ライバル ウェイター！',
    // The rival's challenge on arrival. {kanji|reading} renders as furigana;
    // \n is the line break in the dialogue box. Every reply has the same outcome.
    rivalChallenge: '{勝負|しょうぶ}しよう！\nどっちがたくさん{料理|りょうり}を{運|はこ}べるかな？',
    rivalChallengeReplies: Object.freeze(['いいよ！{勝負|しょうぶ}だ！', '{負|ま}けないよ！', 'がんばるぞ！']),
    // After losing or drawing Round 1: try the same waiter again, or finish.
    rivalRematchAsk: 'もう{一回|いっかい} やる？',
    rematchChoices: Object.freeze(['もう{一回|いっかい}！', 'おわりにする']),
    // Plain kana: the phase pill is plain text, not furigana.
    rematchCue: 'もう いっかい しょうぶ！',
    // After winning Round 1: a second, stronger waiter. Replies are flavour only.
    rival2Title: 'もっと つよい ウェイター！',
    rival2Challenge: 'ぼくとも {勝負|しょうぶ}しよう！\nもっと むずかしいよ！',
    rival2ChallengeReplies: Object.freeze(['いいよ！{勝負|しょうぶ}だ！', '{負|ま}けないよ！', 'やってみよう！']),
    round2Cue: 'ラウンド 2！',
    // After winning Round 2: a third waiter, with the same full entrance.
    rival3Title: 'さいきょうの ウェイター！',
    rival3Challenge: 'さいごの {勝負|しょうぶ}だ！\nついてこられるかな？',
    rival3ChallengeReplies: Object.freeze(['のぞむところ！', 'まけないぞ！', 'いくぞ！']),
    round3Cue: 'ラウンド 3！',
    // Shown once as Round 3 starts. The belt racing is the real cue.
    round3Hint: 'ベルトが はやくなるよ！',
    // End-of-shift head-to-head result; friendly wording whoever wins.
    resultPlayer: 'きみの かち！',
    resultRival: 'ウェイターの かち！',
    resultDraw: 'ひきわけ！',
    rivalLabel: 'ウェイター',
    finalPush: 'ラストスパート！',
    progress: 'おきゃくさん {done}/{total}',
    rivalScore: 'きみ {player} ・ ウェイター {rival}',
    turnaround: 'こんどは きみの ばん！',
    complete: 'スタンプを ゲット！',
    tempHot: 'あつあつ！',
    tempWarm: 'ちょうどいい',
    tempCold: 'さめてる…',
    patientLeave: 'またね…',
    roundEnd: 'おつかれさま！',
    collectDish: 'スペースで りょうりを もつ',
    exchangeDish: 'スペースで りょうりを とりかえる',
    deliverDish: 'スペースで とどける',
    returnDish: 'スペースで おさらを もどす',
    returnSign: 'もどす',
  },
  transition: {
    label: 'ばめんを きりかえています',
  },
  errors: {
    webgl: 'このブラウザでは 3Dを ひょうじできません。',
  },
});

export function formatUi(template, values = {}) {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
    template,
  );
}

/** The exact answer sentence for one vocabulary item, e.g. "I like hamburgers." */
export function answerFor(lesson, id) {
  const item = lesson.vocabulary.find((entry) => entry.id === id);
  if (!item) throw new Error(`No vocabulary item "${id}" in lesson "${lesson.id}"`);
  return item.answer;
}

/** Read-along choices for the turnaround: one exact sentence per vocabulary item. */
export function answerChoices(lesson, ids = null) {
  const items = ids ? lesson.vocabulary.filter((item) => ids.includes(item.id)) : lesson.vocabulary;
  return items.map((item) => ({ sentence: item.answer, value: item.id }));
}
