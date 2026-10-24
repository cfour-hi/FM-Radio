import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";

// Node 运行测试时为 Vite 使用的相对 TS 导入补扩展名。
const loader = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && context.parentURL?.includes("/src/") && !/\.[a-z]+$/i.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});
const { engine } = await import("../src/player/engine.ts");
loader.deregister();

const station = { id: "test", url: "https://example.com/radio.mp3", hls: false };

function setup(t) {
  let now = 100000;
  let serial = 0;
  const timers = new Map();
  const audios = [];
  const ticks = [];
  const statuses = [];
  const oldWindow = globalThis.window;
  const oldAudio = globalThis.Audio;
  globalThis.window = {
    setTimeout(fn, delay) { const id = ++serial; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  globalThis.Audio = class extends EventTarget {
    readyState = 0;
    error = null;
    constructor() { super(); audios.push(this); }
    play() { return Promise.resolve(); }
    pause() { this.dispatchEvent(new Event("pause")); }
    removeAttribute() {}
    load() {}
  };
  t.mock.method(Date, "now", () => now);
  engine.hooks = { onTick: (n) => ticks.push(n), onStatus: (s) => statuses.push(s) };
  t.after(() => {
    engine.stop();
    engine.hooks = null;
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
    if (oldAudio === undefined) delete globalThis.Audio; else globalThis.Audio = oldAudio;
  });
  return {
    timers, audios, ticks, statuses,
    advance(ms) {
      const target = now + ms;
      for (;;) {
        const next = [...timers].filter(([, v]) => v.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at;
        timers.delete(next[0]);
        next[1].fn();
      }
      now = target;
    },
  };
}

test("调谐只在 4 秒阈值提醒；8 秒超时清理全部计时器", (t) => {
  const env = setup(t);
  engine.load(station);
  assert.deepEqual(env.ticks, [0]);
  env.advance(3999);
  assert.deepEqual(env.ticks, [0]);
  env.advance(1);
  assert.deepEqual(env.ticks, [0, 4]);
  env.advance(4000);
  assert.equal(engine.currentStatus, "error");
  assert.equal(env.timers.size, 0);
  const count = env.ticks.length;
  env.advance(60000);
  assert.equal(env.ticks.length, count);
});

test("正常播放、缓冲期间无周期更新；暂停和停止清理计时器", (t) => {
  const env = setup(t);
  engine.load(station);
  env.advance(1000);
  env.audios[0].dispatchEvent(new Event("playing"));
  assert.equal(env.timers.size, 0);
  const count = env.ticks.length;
  env.advance(60000);
  assert.equal(env.ticks.length, count);
  env.audios[0].dispatchEvent(new Event("waiting"));
  assert.equal(engine.currentStatus, "buffering");
  assert.equal(env.timers.size, 0);
  engine.pause();
  assert.equal(engine.currentStatus, "paused");
  assert.equal(env.timers.size, 0);
  engine.stop();
  assert.equal(engine.currentStatus, "idle");
  assert.equal(env.timers.size, 0);
});

test("暂停后恢复重新安排剩余阈值；换台后重新计时且忽略旧音频事件", (t) => {
  const env = setup(t);
  engine.load(station);
  env.advance(1000);
  engine.pause();
  assert.equal(env.timers.size, 0);
  env.advance(1000);
  engine.resume();
  const count = env.ticks.length;
  env.advance(1999);
  assert.equal(env.ticks.length, count);
  env.advance(1);
  assert.equal(env.ticks.at(-1), 4);
  engine.load({ ...station, id: "second" });
  env.audios[0].dispatchEvent(new Event("playing"));
  assert.equal(engine.currentStatus, "tuning");
  assert.equal(env.ticks.at(-1), 0);
  env.advance(4000);
  assert.equal(env.ticks.at(-1), 4);
  engine.stop();
  assert.equal(env.timers.size, 0);
});

test("播放被浏览器拒绝也会清理阈值提醒和连接超时", async (t) => {
  const env = setup(t);
  globalThis.Audio.prototype.play = () => Promise.reject(new DOMException("blocked", "NotAllowedError"));
  engine.load(station);
  await Promise.resolve();
  assert.equal(engine.currentStatus, "error");
  assert.equal(env.timers.size, 0);
});
