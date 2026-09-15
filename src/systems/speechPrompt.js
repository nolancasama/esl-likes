import { answerChoices } from '../config/lesson.js';

/**
 * SPEECH PROMPTS
 * --------------
 * One place that wires a speech prompt: the HUD talk control, its fallback
 * ladder, and the speech target. Every minigame used to carry its own copy of
 * this block; they now call promptQuestion / promptAnswer instead.
 *
 * Game policy stays with the caller: `onAccepted` receives the recognised
 * vocabulary id (answers) or null (questions), whichever route the child used.
 */
export function promptSpeech(ctx, {
  mode,
  category,
  sentence,
  choices = null,
  fallbackAnswer = null,
  isActive = () => true,
  onCommit,
  onCancel,
  onAccepted,
}) {
  const { hud, speech, settings } = ctx;
  const micFree = Boolean(settings.get('micFree'));
  hud.configureTalk({
    targetSentence: sentence,
    micFree,
    choices,
    onFallbackContinue: (value) => {
      if (isActive()) onAccepted(value || fallbackAnswer);
    },
  });
  hud.show();
  speech.setEnabled(true);
  speech.setTarget({
    mode,
    category,
    micFree: () => Boolean(settings.get('micFree')),
    onCommit: () => {
      if (!isActive()) return false;
      return onCommit?.();
    },
    onCancel: () => {
      if (isActive()) onCancel?.();
    },
    onFallback: () => {
      if (isActive()) hud.showFallback();
    },
    onState: (state) => hud.setTalkState(state),
    onAccepted: (result) => {
      if (isActive()) onAccepted(result.answer || fallbackAnswer);
    },
    onFailure: () => hud.recordFailure(),
    onUnavailable: () => {
      hud.showFallback();
    },
  });
}

/** The child asks the NPC: "What ___ do you like?" */
export function promptQuestion(ctx, lesson, options) {
  promptSpeech(ctx, {
    mode: 'question',
    category: lesson.category,
    sentence: lesson.question,
    ...options,
  });
}

/**
 * The turnaround: the child answers "I like ___." for themselves. The fallback
 * offers every vocabulary sentence so a mic-free child still chooses their own
 * answer instead of being handed the first one on the list.
 */
export function promptAnswer(ctx, lesson, options) {
  promptSpeech(ctx, {
    mode: 'answer',
    category: lesson.category,
    sentence: lesson.answerExample,
    choices: answerChoices(lesson),
    fallbackAnswer: lesson.vocabulary[0].id,
    ...options,
  });
}
