import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

function reader(player) {
  const source = readFileSync(new URL('../src/utils/audioDuration.ts', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', outputText)(
    () => ({ createAudioPlayer: () => player }), module, module.exports);
  return module.exports.getAudioDuration;
}

test('duration reader accepts the maximum and cleans up without starting playback', async () => {
  let removed = 0;
  const getDuration = reader({ isLoaded: true, duration: 86400, remove() { removed++; } });
  assert.equal(await getDuration('file:///clip.m4a'), 86400);
  assert.equal(removed, 1);
});

test('duration reader rejects missing, invalid, and nonpositive metadata and releases the player', async () => {
  for (const duration of [undefined, NaN, Infinity, -Infinity, 0, -1]) {
    let removed = 0;
    const getDuration = reader({ isLoaded: true, duration, remove() { removed++; } });
    await assert.rejects(getDuration('file:///invalid'), /Could not read the audio duration/);
    assert.equal(removed, 1);
  }
});

test('duration reader waits for metadata and handles the listener-registration race', async () => {
  for (const race of [false, true]) {
    let removed = 0;
    let unsubscribed = 0;
    const player = {
      isLoaded: false, duration: 86400,
      addListener(event, listener) {
        assert.equal(event, 'playbackStatusUpdate');
        if (race) this.isLoaded = true;
        else setImmediate(() => listener({ isLoaded: true }));
        return { remove() { unsubscribed++; } };
      },
      remove() { removed++; },
    };
    assert.equal(await reader(player)('file:///clip.m4a'), 86400);
    assert.equal(removed, 1);
    assert.equal(unsubscribed, 1);
  }
});

test('duration timeout releases listener and player', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let removed = 0;
  let unsubscribed = 0;
  const pending = reader({
    isLoaded: false,
    addListener() { return { remove() { unsubscribed++; } }; },
    remove() { removed++; },
  })('file:///unreadable');
  const rejected = assert.rejects(pending, /Could not read the audio file/);
  t.mock.timers.tick(10_000);
  await rejected;
  assert.equal(removed, 1);
  assert.equal(unsubscribed, 1);
});
