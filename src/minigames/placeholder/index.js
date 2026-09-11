import * as THREE from 'three';
import { LESSON_BY_ID, UI, likeSentence } from '../../config/lesson.js';

const LESSON = LESSON_BY_ID.restaurant;
const answerChoices = () => LESSON.answers.map((answer) => ({ sentence: likeSentence(answer), value: answer }));

/**
 * Interface proof only. This deliberately contains no Restaurant gameplay.
 * Every real minigame replaces this factory without changing the shell.
 */
export function createPlaceholder(ctx) {
  const {
    scene,
    cameraRig,
    speech,
    audio,
    dialogue,
    characters,
    hud,
    settings,
    finish,
  } = ctx;

  let world = null;
  let npc = null;
  let overlay = null;
  let instruction = null;
  let active = false;
  let completed = false;
  let timer = null;
  let unsubscribeSettings = null;
  const owned = [];

  function addMesh(geometry, material, position) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(position);
    world.add(mesh);
    owned.push({ geometry, material });
    return mesh;
  }

  function configureSpeech({ mode, sentence, onAccepted, fallbackAnswer }) {
    const micFree = Boolean(settings.get('micFree'));
    hud.configureTalk({
      targetSentence: sentence,
      micFree,
      // In the turnaround the child answers for themselves, so the fallback
      // offers every "I like ___." instead of reading out one fixed answer.
      choices: mode === 'answer' ? answerChoices() : null,
      onFallbackContinue: (value) => {
        if (active) onAccepted(value || fallbackAnswer);
      },
    });
    hud.show();
    speech.setEnabled(!micFree);
    speech.setTarget({
      mode,
      category: LESSON.category,
      onState: (state) => hud.setTalkState(state),
      onAccepted: (result) => onAccepted(result.answer || fallbackAnswer),
      onFailure: () => hud.recordFailure(),
      onUnavailable: () => {
        speech.setEnabled(false);
        hud.setMicFree(true);
      },
    });
  }

  function complete(answer) {
    if (!active || completed) return;
    completed = true;
    speech.clearTarget();
    hud.setTalkState('accepted');
    instruction.textContent = UI.placeholder.complete;
    npc?.playAnimation?.('emote-yes');
    audio.playSfx('stamp');
    timer = setTimeout(() => {
      if (active) {
        hud.hide();
        finish({ stars: 3, detail: { category: LESSON.category, answer } });
      }
    }, 650);
  }

  function beginTurnaround() {
    if (!active || completed) return;
    instruction.textContent = UI.placeholder.turnaround;
    dialogue.show({ text: LESSON.question, anchor: npc });
    configureSpeech({
      mode: 'answer',
      sentence: LESSON.answerExample,
      fallbackAnswer: LESSON.answers[0],
      onAccepted: complete,
    });
  }

  function questionAccepted() {
    if (!active || completed) return;
    speech.clearTarget();
    hud.setTalkState('accepted');
    audio.playSfx('accept');
    npc?.playAnimation?.('emote-yes');
    timer = setTimeout(() => {
      if (!active) return;
      hud.hide();
      dialogue.show({ text: LESSON.answerExample, anchor: npc });
      timer = setTimeout(beginTurnaround, 1500);
    }, 550);
  }

  function createOverlay() {
    overlay = document.createElement('div');
    overlay.innerHTML = `
      <div class="top-bar">
        <section class="scene-card">
          <h1></h1>
          <p></p>
        </section>
      </div>
    `;
    overlay.querySelector('h1').textContent = UI.placeholder.roomName;
    instruction = overlay.querySelector('p');
    instruction.textContent = UI.placeholder.instruction;
    document.querySelector('#ui-layer').append(overlay);
  }

  function enter() {
    active = true;
    completed = false;
    world = new THREE.Group();
    world.name = 'placeholder-minigame';
    scene.background = new THREE.Color(0xffd6a3);
    scene.fog = null;
    world.add(new THREE.HemisphereLight(0xffffff, 0xa8664d, 2.3));
    const light = new THREE.DirectionalLight(0xffffff, 2.2);
    light.position.set(5, 9, 7);
    world.add(light);

    addMesh(
      new THREE.BoxGeometry(13, 0.5, 10),
      new THREE.MeshStandardMaterial({ color: 0xffe6b9, flatShading: true }),
      new THREE.Vector3(0, -0.28, 0),
    );
    addMesh(
      new THREE.BoxGeometry(13, 5, 0.4),
      new THREE.MeshStandardMaterial({ color: 0xf28e72, flatShading: true }),
      new THREE.Vector3(0, 2.25, -5),
    );
    addMesh(
      new THREE.BoxGeometry(4.8, 1.1, 1),
      new THREE.MeshStandardMaterial({ color: 0x75b7c9, flatShading: true }),
      new THREE.Vector3(0, 0.55, -2.1),
    );

    npc = characters.create({ model: 'character-j', tint: 0xffb36b });
    npc.position.set(0, 0, -1.2);
    npc.rotation.y = Math.PI;
    world.add(npc);
    scene.add(world);

    cameraRig.setTarget(null).setPreset('fixed', {
      position: [5.5, 4.8, 7.2],
      lookAt: [0, 1.2, -1.2],
      damping: 4.5,
    });
    createOverlay();
    configureSpeech({
      mode: 'question',
      sentence: LESSON.question,
      fallbackAnswer: null,
      onAccepted: questionAccepted,
    });

    unsubscribeSettings = settings.subscribe((next) => {
      if (!active) return;
      speech.setEnabled(!next.micFree);
      hud.setMicFree(next.micFree);
      hud.setTextSize(next.textSize);
    });
  }

  function update(dt) {
    npc?.updateAnimation?.(dt);
  }

  function exit() {
    active = false;
    clearTimeout(timer);
    timer = null;
    unsubscribeSettings?.();
    unsubscribeSettings = null;
    speech.clearTarget();
    speech.cancel();
    audio.stop();
    hud.hide();
    dialogue.hide();
    overlay?.remove();
    overlay = null;
    instruction = null;
    npc?.disposeCharacter?.();
    npc = null;
    if (world) scene.remove(world);
    world = null;
    for (const item of owned) {
      item.geometry.dispose();
      item.material.dispose();
    }
    owned.length = 0;
  }

  return { id: 'restaurant', enter, update, exit };
}
