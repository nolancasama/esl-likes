const delay = (page, ms) => page.waitForTimeout(ms);

const cloneDebug = (value) => (value == null
  ? null
  : JSON.parse(JSON.stringify(typeof value === 'function' ? value() : value)));

export async function waitForDebug(page, key, predicate, {
  timeoutMs = 5000,
  label = key,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = await page.evaluate((debugKey) => {
      const raw = window.__eslDebug?.[debugKey];
      return raw == null ? null : JSON.parse(JSON.stringify(typeof raw === 'function' ? raw() : raw));
    }, key);
    if (await predicate(snapshot)) return snapshot;
    await delay(page, 20);
  }
  return null;
}

export async function clickUntil(page, getPoint, predicate, {
  attempts = 3,
  timeoutMs = 1500,
} = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const point = await getPoint();
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      await delay(page, 100);
      continue;
    }
    await page.mouse.click(point.x, point.y);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const matched = await predicate();
      if (matched) return matched === true ? { point, attempt } : matched;
      await delay(page, 100);
    }
  }
  return null;
}

export async function clickIfPresent(page, selector, { timeoutMs = 1500 } = {}) {
  try {
    const locator = page.locator(selector).first();
    await locator.waitFor({ state: 'visible', timeout: timeoutMs });
    await locator.click({ timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

export async function holdUntil(page, keyOrPointer, predicate, { maxMs = 5000 } = {}) {
  const pointer = typeof keyOrPointer === 'object' && keyOrPointer !== null;
  const point = pointer
    ? (typeof keyOrPointer.getPoint === 'function' ? await keyOrPointer.getPoint() : keyOrPointer)
    : null;
  if (pointer && (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y))) return null;

  if (pointer) {
    await page.mouse.move(point.x, point.y);
    await page.mouse.down({ button: keyOrPointer.button ?? 'left' });
  } else {
    await page.keyboard.down(keyOrPointer);
  }

  const deadline = Date.now() + maxMs;
  let matched = null;
  try {
    while (Date.now() < deadline) {
      const value = await predicate();
      if (value) {
        matched = value === true ? { reached: true } : value;
        break;
      }
      await delay(page, 50);
    }
  } finally {
    if (pointer) await page.mouse.up({ button: keyOrPointer.button ?? 'left' });
    else await page.keyboard.up(keyOrPointer);
  }
  await delay(page, 60);
  return matched;
}

const compact = (value) => {
  if (value == null || value === '') return '';
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  return serialized.length > 900 ? `${serialized.slice(0, 897)}...` : serialized;
};

export function createCheck(results, { getTrace } = {}) {
  return function check(name, condition, {
    detail = '',
    precondition = true,
    trace,
  } = {}) {
    const ready = typeof precondition === 'function' ? precondition() : precondition;
    const passed = Boolean(ready) && Boolean(typeof condition === 'function' ? condition() : condition);
    let diagnostic = detail;
    if (!passed) {
      const snapshot = trace ?? (getTrace ? getTrace() : null);
      diagnostic = compact({
        ...(ready ? {} : { precondition: false }),
        ...(detail ? { detail } : {}),
        ...(snapshot == null ? {} : { trace: cloneDebug(snapshot) }),
      });
    }
    results.push({ name, ok: passed });
    console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${diagnostic ? `  - ${diagnostic}` : ''}`);
    return passed;
  };
}
