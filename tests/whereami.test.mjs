import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
const loader = registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('.') && context.parentURL?.includes('/src/') && !/\.[a-z]+$/i.test(specifier)) return next(`${specifier}.ts`, context);
  return next(specifier, context);
}});
const { locateViaBrowser, readManualLocation, saveManualLocation } = await import('../src/lib/whereami.ts');
const { buildLocalGroups, nearbyQueue } = await import('../src/lib/localFromData.ts');
loader.deregister();

function setup(t) {
  const previous = ['window', 'sessionStorage', 'navigator'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  const cache = new Map();
  Object.defineProperty(globalThis, 'window', { value: { isSecureContext: true }, configurable: true });
  Object.defineProperty(globalThis, 'sessionStorage', { value: {
    getItem: k => cache.get(k) ?? null, setItem: (k, v) => cache.set(k, v),
  }, configurable: true });
  Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true });
  t.mock.method(globalThis, 'fetch', () => { assert.fail('定位不应请求第三方接口'); });
  t.after(() => {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  });
  return cache;
}
const position = (latitude = 37, longitude = -122, accuracy = 25) => ({ coords: { latitude, longitude, accuracy }, timestamp: 12345 });

test('浏览器返回原始全球坐标与精度，不推算省份、不写入存储', async t => {
  const cache = setup(t);
  for (const [lat, lon] of [[37, -122], [0, 0], [-90, 180]]) {
    navigator.geolocation = { getCurrentPosition: (ok, _fail, options) => {
      assert.deepEqual(options, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
      ok(position(lat, lon));
    }};
    assert.deepEqual(await locateViaBrowser(), { ok: true, where: {
      source: 'browser', geo: { lat, lon }, accuracy: 25, timestamp: 12345,
    }});
  }
  assert.equal(cache.size, 0);
});

test('无效坐标和精度不进入附近计算', async t => {
  setup(t);
  for (const args of [[91, 0, 1], [0, 181, 1], [NaN, 0, 1], [0, 0, -1], [0, 0, Infinity]]) {
    navigator.geolocation = { getCurrentPosition: ok => ok(position(...args)) };
    const result = await locateViaBrowser();
    assert.equal(result.ok, false);
    assert.match(result.error, /有效位置/);
  }
});

test('权限拒绝、不可用、超时和同步异常提供可恢复的提示', async t => {
  setup(t);
  for (const [code, message] of [[1, /权限/], [2, /无法获取/], [3, /超时/]]) {
    navigator.geolocation = { getCurrentPosition: (_ok, fail) => fail({ code }) };
    const result = await locateViaBrowser();
    assert.equal(result.ok, false);
    assert.match(result.error, message);
  }
  navigator.geolocation.getCurrentPosition = () => { throw new Error('denied'); };
  assert.match((await locateViaBrowser()).error, /不可用/);
});

test('不安全上下文和不支持定位时不尝试请求', async t => {
  setup(t);
  assert.match((await locateViaBrowser()).error, /不支持/);
  navigator.geolocation = { getCurrentPosition: () => assert.fail('不应调用') };
  window.isSecureContext = false;
  assert.match((await locateViaBrowser()).error, /HTTPS/);
});

test('浏览器不回调时总期限兜底；迟到回调无效，之后仍可重试', async t => {
  setup(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let late;
  navigator.geolocation = { getCurrentPosition: ok => { late = ok; } };
  const pending = locateViaBrowser();
  t.mock.timers.tick(10500);
  const result = await pending;
  assert.match(result.error, /超时/);
  late(position());
  assert.deepEqual(await pending, result);
  navigator.geolocation.getCurrentPosition = ok => ok(position());
  assert.equal((await locateViaBrowser()).ok, true);
});

test('只缓存手选地区，忽略旧 IP 缓存及过期或无效缓存', t => {
  const cache = setup(t);
  cache.set('fm:where:v1', JSON.stringify({ at: Date.now(), where: { province: '广东', source: 'ip' } }));
  assert.equal(readManualLocation(), null);
  assert.deepEqual(saveManualLocation('湖南'), { source: 'manual', province: '湖南' });
  assert.deepEqual(readManualLocation(), { source: 'manual', province: '湖南' });
  const saved = JSON.parse(cache.get('fm:manual-region:v2'));
  assert.deepEqual(Object.keys(saved).sort(), ['at', 'province']);
  assert.equal(saveManualLocation('无效'), null);
  for (const entry of [
    { at: Date.now() - 1800001, province: '湖南' },
    { at: Date.now() + 10000, province: '湖南' },
    { at: 'invalid', province: '湖南' },
    { at: Date.now(), province: 'invalid' },
  ]) {
    cache.set('fm:manual-region:v2', JSON.stringify(entry));
    assert.equal(readManualLocation(), null);
  }
  cache.set('fm:manual-region:v2', '{');
  assert.equal(readManualLocation(), null);
});

test('存储被禁用时仍可手动选择地区', t => {
  setup(t);
  sessionStorage.getItem = sessionStorage.setItem = () => { throw new Error('blocked'); };
  assert.equal(readManualLocation(), null);
  assert.deepEqual(saveManualLocation('湖南'), { source: 'manual', province: '湖南' });
});

test('手选地区按省会、其他城市构建本地播放队列', () => {
  const stations = [
    { id: 'other', province: '湖南', city: '岳阳', clicks: 100 },
    { id: 'capital', province: '湖南', city: '长沙', clicks: 20 },
    { id: 'city', province: '湖南', city: '株洲', clicks: 1 },
    { id: 'outside', province: '广东', city: '广州', clicks: 1000 },
  ];
  assert.deepEqual(nearbyQueue(buildLocalGroups(stations, '湖南', null, '长沙')).map(s => s.id), ['capital', 'other', 'city']);
});
