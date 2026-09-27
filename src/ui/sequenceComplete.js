function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

/**
 * The end of the three-stage run. A controller like any minigame, so the shell
 * routes to it through the same transition and the Zoo is properly exited
 * behind it — but it is only a DOM card, not another room.
 */
export function createSequenceComplete({ root, progression, lessons, strings, onReplay }) {
  let section = null;

  function exit() {
    section?.remove();
    section = null;
  }

  return {
    enter() {
      exit();
      section = makeElement('section', 'sequence-complete');
      section.setAttribute('role', 'dialog');
      section.setAttribute('aria-labelledby', 'sequence-complete-title');
      const card = makeElement('div', 'sequence-complete__card');
      const title = makeElement('h1', '', strings.title);
      title.id = 'sequence-complete-title';
      const list = makeElement('ul', 'sequence-complete__stages');
      for (const lesson of lessons) {
        const stars = Math.max(0, Math.min(3, progression.getBestStars(lesson.id)));
        const item = makeElement('li');
        item.append(
          makeElement('span', 'sequence-complete__stars', '★'.repeat(stars) + '☆'.repeat(3 - stars)),
          makeElement('span', 'sequence-complete__name', lesson.name),
        );
        list.append(item);
      }
      const replay = makeElement('button', 'sequence-complete__replay', strings.replay);
      replay.type = 'button';
      replay.addEventListener('click', () => onReplay());
      card.append(title, list, replay);
      section.append(card);
      root.append(section);
      replay.focus?.();
    },
    update() {},
    exit,
  };
}
