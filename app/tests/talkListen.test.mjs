import assert from 'node:assert/strict';
import { test } from 'node:test';
import { talkListenPercent } from '../src/utils/talkListen.ts';

for (const [ratio, percent] of [[0, 0], [0.5, 33], [1, 50], [2, 67], [99, 99]]) {
  test(`talk/listen ratio ${ratio} represents ${percent}% talking`, () => {
    assert.equal(talkListenPercent(ratio), percent);
  });
}

test('invalid ratios do not produce invalid chart values', () => {
  for (const ratio of [-1, NaN, Infinity]) {
    assert.equal(talkListenPercent(ratio), 0);
  }
});
