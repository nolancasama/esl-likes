import test from 'node:test';
import assert from 'node:assert/strict';

import { canOpenZooCamera } from './cameraGate.js';

test('camera access requires an active playing Zoo with an open request', () => {
  assert.equal(canOpenZooCamera({ active: false, phase: 'playing', openRequestCount: 1 }), false);
  assert.equal(canOpenZooCamera({ active: true, phase: 'answering', openRequestCount: 1 }), false);
  assert.equal(canOpenZooCamera({ active: true, phase: 'playing', openRequestCount: 0 }), false);
  assert.equal(canOpenZooCamera({ active: true, phase: 'playing', openRequestCount: 1 }), true);
});
