function freezeUnit(unit) {
  return Object.freeze(unit);
}

/**
 * Parses the lesson's {base|reading} notation into indivisible display units.
 * Plain Unicode code points cost one, line breaks cost zero, and a ruby unit
 * costs the number of code points in its base text.
 */
export function parseFurigana(source) {
  const text = String(source ?? '');
  const units = [];
  let offset = 0;

  while (offset < text.length) {
    if (text[offset] === '{') {
      const end = text.indexOf('}', offset + 1);
      if (end >= 0) {
        const body = text.slice(offset + 1, end);
        const divider = body.indexOf('|');
        if (divider > 0 && divider < body.length - 1) {
          const base = body.slice(0, divider);
          const reading = body.slice(divider + 1);
          units.push(freezeUnit({ kind: 'ruby', base, reading, cost: [...base].length }));
          offset = end + 1;
          continue;
        }
      }
    }

    const character = String.fromCodePoint(text.codePointAt(offset));
    if (character === '\n') {
      units.push(freezeUnit({ kind: 'line-break', text: character, cost: 0 }));
    } else {
      units.push(freezeUnit({ kind: 'text', text: character, cost: 1 }));
    }
    offset += character.length;
  }

  return Object.freeze(units);
}

export function createTypewriter({ units, charsPerSecond = 30 } = {}) {
  const displayUnits = Object.freeze([...(units ?? [])]);
  const rateValue = Number(charsPerSecond);
  const rate = Number.isFinite(rateValue) ? Math.max(0, rateValue) : 30;
  const totalCost = displayUnits.reduce((sum, unit) => sum + Math.max(0, Number(unit?.cost) || 0), 0);
  let earnedCost = 0;
  let revealedCost = 0;
  let visibleUnitCount = 0;

  function revealAffordableUnits() {
    while (visibleUnitCount < displayUnits.length) {
      const cost = Math.max(0, Number(displayUnits[visibleUnitCount]?.cost) || 0);
      if (revealedCost + cost > earnedCost + 1e-10) break;
      visibleUnitCount += 1;
      revealedCost += cost;
    }
  }

  revealAffordableUnits();

  function advance(dt) {
    const step = Math.max(0, Number(dt) || 0);
    earnedCost = Math.min(totalCost, earnedCost + step * rate);
    revealAffordableUnits();
    return visibleUnitCount;
  }

  function revealAll() {
    earnedCost = totalCost;
    visibleUnitCount = displayUnits.length;
    revealedCost = totalCost;
    return visibleUnitCount;
  }

  return {
    advance,
    revealAll,
    get units() { return displayUnits; },
    get charsPerSecond() { return rate; },
    get revealedCost() { return revealedCost; },
    get totalCost() { return totalCost; },
    get visibleUnitCount() { return visibleUnitCount; },
    get complete() { return visibleUnitCount === displayUnits.length; },
  };
}
