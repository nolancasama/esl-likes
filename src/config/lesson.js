// Every vocabulary item carries its own exact answer sentence (SPEC: "Vocabulary
// defines its own answer"). Never build one as "I like " + word: singular and
// plural cannot be inferred safely from the label.
const say = (id, answer) => Object.freeze({ id, answer });

const VOCABULARY = Object.freeze({
  food: Object.freeze([
    say('curry', 'I like curry.'),
    say('pizza', 'I like pizza.'),
    say('hamburger', 'I like hamburgers.'),
    say('noodles', 'I like noodles.'),
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
  animal: Object.freeze([
    say('elephant', 'I like elephants.'),
    say('giraffe', 'I like giraffes.'),
    say('penguin', 'I like penguins.'),
    say('tiger', 'I like tigers.'),
    say('dog', 'I like dogs.'),
    say('cat', 'I like cats.'),
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
    micReady: 'おしているあいだ はなす',
    listening: 'きいているよ…',
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
    instruction: 'ボタンを おしているあいだ、しつもんしよう',
    turnaround: 'こんどは きみの ばん！',
    complete: 'スタンプを ゲット！',
  },
  coloring: {
    roomName: 'アトリエ',
    walkToArtist: 'おともだちの ところへ いこう',
    askArtist: 'ボタンを おしているあいだ、しつもんしよう',
    paintTitle: 'ロボットに いろを ぬろう',
    chooseColor: 'まず いろを えらぼう',
    paintHint: '★の ところは おともだちの すきないろで ぬろう',
    ready: 'すてき！ まだ ぬっても いいよ',
    paletteLabel: 'いろを えらぶ',
    colors: {
      red: 'あか',
      blue: 'あお',
      yellow: 'きいろ',
    },
    done: 'できた',
    resultTitle: 'すてきな えが できたよ！',
    takePicture: 'えを もっていく',
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
    askCustomer: 'ボタンを おしているあいだ、しつもんしよう',
    walkToStation: 'ドリンクを いれに いこう',
    walkToServe: 'おきゃくさんに とどけよう',
    pourHint: 'スペースで ドリンクを いれる',
    pourDrink: 'ドリンクを いれる',
    pouring: 'ドリンクを いれているよ…',
    poured: 'カップに はいったよ！',
    serveHint: 'スペースで おきゃくさんに わたす',
    serveDrink: 'おきゃくさんに わたす',
    thankYou: 'ありがとう！',
    wrongDrink: 'ちがうみたい…もういちど おねがい',
    emptyCup: 'カップを からにしたよ',
    patientLeave: 'また こんどね！',
    rush: 'ラッシュ！',
    combo: '{count} コンボ！',
    roundEnd: 'みんなに とどけたよ！',
    turnaround: 'こんどは きみの ばん！',
    yourDrink: 'きみの ドリンクも できたよ！',
    complete: 'スタンプを ゲット！',
  },
  sports: {
    roomName: 'スポーツひろば',
    walkToFriend: 'ひろばの おともだちに ちかづこう',
    newFriends: 'あたらしい おともだちが きたよ！',
    askFriend: 'ボタンを おしているあいだ、しつもんしよう',
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
    roomName: 'どうぶつえん',
    walkToVisitor: 'いりぐちの おきゃくさんに ちかづこう',
    askVisitor: 'ボタンを おしているあいだ、しつもんしよう',
    explore: 'こたえを おぼえて、どうぶつを さがそう',
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
      elephant: 'ぞう',
      giraffe: 'キリン',
      penguin: 'ペンギン',
      tiger: 'トラ',
      dog: 'いぬ',
      cat: 'ねこ',
    },
  },
  restaurant: {
    roomName: 'レストラン',
    instruction: 'ボタンを おしているあいだ、しつもんしよう',
    walkToCustomer: 'おきゃくさんに ちかづこう',
    walkToCounter: 'カウンターに とりに いこう',
    walkToDeliver: 'おきゃくさんに とどけよう',
    bellReady: 'りょうりが できたよ！',
    bellReadyAria: '料理ができました',
    delivered: 'ありがとう！',
    wrongDish: 'ちがうみたい…もう一度どうぞ',
    turnaround: 'こんどは きみの ばん！',
    complete: 'スタンプを ゲット！',
    tempHot: 'あつあつ！',
    tempWarm: 'ちょうどいい',
    tempCold: 'さめてる…',
    patientLeave: 'またね…',
    roundEnd: 'おつかれさま！',
    waitForBell: 'ベルが なるまで まとう',
    collectDish: 'スペースで りょうりを もつ',
    deliverDish: 'スペースで とどける',
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
