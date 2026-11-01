import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_FX, FX_LIST, readFxId, writeFxId } from '../src/fx/registry.ts';

const KEY = 'fm-radio.fx.v1';

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

test('注册表：地球是默认特效，菜单第一项', t => {
  assert.equal(DEFAULT_FX, 'globe');
  assert.equal(FX_LIST[0].id, 'globe');
  // id 全部唯一，菜单不会出现两个同名项
  assert.equal(new Set(FX_LIST.map(fx => fx.id)).size, FX_LIST.length);
});

test('无记录：读回默认特效', t => {
  setup(t);
  assert.equal(readFxId(), 'globe');
});

test('写入后读回：往返一致', t => {
  const cache = setup(t);
  for (const fx of FX_LIST) {
    writeFxId(fx.id);
    assert.equal(cache.get(KEY), fx.id);
    assert.equal(readFxId(), fx.id);
  }
});

test('损坏值 / 未知 id：回落默认', t => {
  const cache = setup(t);
  for (const value of ['starfield', '""', 'GALAXY', '', 'null', '2']) {
    cache.set(KEY, value);
    assert.equal(readFxId(), 'globe', `value=${value}`);
  }
});

test('存储被禁用：读为默认、写不抛', t => {
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
  assert.equal(readFxId(), 'globe');
  assert.doesNotThrow(() => writeFxId('galaxy'));
  assert.equal(readFxId(), 'globe');
});
