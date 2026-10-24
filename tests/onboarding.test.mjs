import assert from 'node:assert/strict';
import test from 'node:test';
import { hasSeenGuide, isGuideForced, markGuideSeen, shouldShowGuide } from '../src/lib/onboarding.ts';

const KEY = 'fm-radio.onboarding.v1';

function setup(t) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const cache = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: k => cache.get(k) ?? null,
      setItem: (k, v) => cache.set(k, String(v)),
    },
    configurable: true,
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  });
  return cache;
}

test('无标记：首次进入显示引导', t => {
  setup(t);
  assert.equal(hasSeenGuide(), false);
  assert.equal(shouldShowGuide(''), true);
});

test('写入标记：键名/值正确，之后不再显示', t => {
  const cache = setup(t);
  markGuideSeen();
  assert.equal(cache.get(KEY), '1');
  assert.equal(hasSeenGuide(), true);
  assert.equal(shouldShowGuide(''), false);
});

test('?guide=1 强制重看；?guide=0 / 裸 ?guide / 其它参数不强制', t => {
  setup(t);
  markGuideSeen();
  assert.equal(shouldShowGuide('?guide=1'), true);
  assert.equal(shouldShowGuide('?guide=1&from=share'), true);
  assert.equal(shouldShowGuide('?guide=0'), false);
  assert.equal(shouldShowGuide('?guide'), false);
  assert.equal(shouldShowGuide('?from=share'), false);
});

test('?guide=1 被识别为强制（与标记无关）', t => {
  setup(t);
  assert.equal(isGuideForced('?guide=1'), true);
  assert.equal(isGuideForced('?guide=1&from=share'), true);
  assert.equal(isGuideForced('?guide=0'), false);
  assert.equal(isGuideForced(''), false);
  assert.equal(isGuideForced('?from=share'), false);
});

test('损坏值视为未看过', t => {
  const cache = setup(t);
  for (const value of ['0', 'true', '', 'yes']) {
    cache.set(KEY, value);
    assert.equal(hasSeenGuide(), false);
    assert.equal(shouldShowGuide(''), true);
  }
});

test('存储被禁用：读为未看过、写不抛、引导仍显示', t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
    },
    configurable: true,
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  });
  assert.equal(hasSeenGuide(), false);
  assert.doesNotThrow(() => markGuideSeen());
  assert.equal(shouldShowGuide(''), true);
});
