import assert from 'node:assert/strict';
import test from 'node:test';

import { MIC_WARMUP, resetMicWarmupForTests, warmUpMicrophone } from './micWarmup.js';

function fakeDevices(outcome = 'grant') {
  const calls = [];
  const tracks = [{ stopped: false, stop() { this.stopped = true; } }];
  return {
    calls,
    tracks,
    getUserMedia(constraints) {
      calls.push(constraints);
      if (outcome === 'throw') throw new Error('policy');
      if (outcome === 'deny') return Promise.reject(new Error('NotAllowedError'));
      return Promise.resolve({ getTracks: () => tracks });
    },
  };
}

test('asks for audio once and stops every track immediately', async () => {
  resetMicWarmupForTests();
  const devices = fakeDevices();
  assert.equal(await warmUpMicrophone({ mediaDevices: devices }), MIC_WARMUP.GRANTED);
  assert.deepEqual(devices.calls, [{ audio: true }]);
  assert.ok(devices.tracks.every((track) => track.stopped));
  assert.equal(await warmUpMicrophone({ mediaDevices: devices }), MIC_WARMUP.SKIPPED_REPEAT);
  assert.equal(devices.calls.length, 1, 'never a second prompt in one session');
});

test('mic-free mode never requests the microphone', async () => {
  resetMicWarmupForTests();
  const devices = fakeDevices();
  assert.equal(await warmUpMicrophone({ mediaDevices: devices, isMicFree: () => true }), MIC_WARMUP.SKIPPED_MIC_FREE);
  assert.equal(devices.calls.length, 0);
});

test('denial, a thrown policy error and a missing API all resolve quietly', async () => {
  resetMicWarmupForTests();
  assert.equal(await warmUpMicrophone({ mediaDevices: fakeDevices('deny') }), MIC_WARMUP.FAILED);
  resetMicWarmupForTests();
  assert.equal(await warmUpMicrophone({ mediaDevices: fakeDevices('throw') }), MIC_WARMUP.FAILED);
  resetMicWarmupForTests();
  assert.equal(await warmUpMicrophone({ mediaDevices: undefined }), MIC_WARMUP.UNAVAILABLE);
});
