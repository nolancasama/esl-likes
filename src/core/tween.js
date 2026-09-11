/**
 * Minimal tween / timeline utility, ported from town-builder.
 */

export const Ease = {
  linear: (t) => t,
  quadIn: (t) => t * t,
  quadOut: (t) => t * (2 - t),
  quadInOut: (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  cubicOut: (t) => 1 - Math.pow(1 - t, 3),
  cubicInOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  sineInOut: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  backOut: (t) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  elasticOut: (t) => {
    if (t === 0 || t === 1) return t;
    const c4 = (2 * Math.PI) / 3;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },
  bounceOut: (t) => {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
};

class Tween {
  constructor(duration, onUpdate, { ease = Ease.quadInOut, delay = 0, onComplete } = {}) {
    this.duration = Math.max(0.0001, duration);
    this.onUpdate = onUpdate;
    this.ease = ease;
    this.delay = delay;
    this.onComplete = onComplete;
    this.elapsed = 0;
    this.done = false;
    this.killed = false;
    this.promise = new Promise((resolve) => (this._resolve = resolve));
  }

  step(dt) {
    if (this.done) return true;
    if (this.delay > 0) {
      this.delay -= dt;
      if (this.delay > 0) return false;
      dt = -this.delay;
      this.delay = 0;
    }
    this.elapsed += dt;
    const raw = Math.min(1, this.elapsed / this.duration);
    if (this.onUpdate) this.onUpdate(this.ease(raw), raw);
    if (raw >= 1) this.finish();
    return this.done;
  }

  finish() {
    if (this.done) return;
    this.done = true;
    if (this.onComplete) this.onComplete();
    this._resolve();
  }

  kill() {
    this.killed = true;
    this.done = true;
    this._resolve();
  }
}

const active = [];

export function tween(duration, onUpdate, opts) {
  const t = new Tween(duration, onUpdate, opts);
  active.push(t);
  return t;
}

export function wait(seconds) {
  return tween(seconds, null).promise;
}

export async function sequence(steps) {
  for (const step of steps) {
    if (typeof step === 'function') {
      await step();
    } else {
      const [duration, onUpdate, opts] = step;
      await tween(duration, onUpdate, opts).promise;
    }
  }
}

export function updateTweens(dt) {
  for (let i = active.length - 1; i >= 0; i--) {
    if (active[i].step(dt)) active.splice(i, 1);
  }
}

export function killAllTweens() {
  for (const t of active) t.kill();
  active.length = 0;
}

export function damp(current, target, lambda, dt) {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

export function dampVector(current, target, lambda, dt) {
  current.x = damp(current.x, target.x, lambda, dt);
  current.y = damp(current.y, target.y, lambda, dt);
  current.z = damp(current.z, target.z, lambda, dt);
  return current;
}

export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
export const lerp = (a, b, t) => a + (b - a) * t;
