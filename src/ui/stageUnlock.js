/** A transient shell reward; timing is independent of CSS animations. */
export function createStageUnlock({ root, lesson, strings, audio, onComplete, durationMs = 1800 }) {
  let section = null;
  let soundTimer = null;
  let completeTimer = null;

  function exit() {
    clearTimeout(soundTimer);
    clearTimeout(completeTimer);
    soundTimer = null;
    completeTimer = null;
    section?.remove();
    section = null;
  }

  return {
    enter() {
      exit();
      section = document.createElement('section');
      section.className = 'stage-unlock';
      section.setAttribute('role', 'status');
      const card = document.createElement('div');
      card.className = 'stage-unlock__card';
      const lock = document.createElement('div');
      lock.className = 'stage-unlock__lock';
      lock.setAttribute('aria-hidden', 'true');
      const shackle = document.createElement('span');
      shackle.className = 'stage-unlock__shackle';
      lock.append(shackle);
      const title = document.createElement('h1');
      title.className = 'stage-unlock__title';
      title.textContent = strings.title;
      const name = document.createElement('div');
      name.className = 'stage-unlock__name';
      name.textContent = lesson.name;
      card.append(lock, title, name);
      section.append(card);
      root.append(section);
      soundTimer = setTimeout(() => audio.playSfx('unlock'), 400);
      completeTimer = setTimeout(() => {
        completeTimer = null;
        onComplete();
      }, durationMs);
    },
    update() {},
    exit,
  };
}
