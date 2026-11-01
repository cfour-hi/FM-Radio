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
  const events = [];
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
  engine.hooks = {
    onTick: (n) => ticks.push(n),
    onStatus: (s, error, kind) => {
      statuses.push(s);
      events.push({ status: s, error, kind });
    },
  };
  t.after(() => {
    engine.stop();
    engine.hooks = null;
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
    if (oldAudio === undefined) delete globalThis.Audio; else globalThis.Audio = oldAudio;
  });
  return {
    timers, audios, ticks, statuses, events,
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

test("正常播放期间无周期更新；暂停和停止清理全部计时器", (t) => {
  const env = setup(t);
  engine.load(station);
  env.advance(1000);
  env.audios[0].dispatchEvent(new Event("playing"));
  assert.equal(env.timers.size, 0, "出声之后连接超时和弱信号提示都该撤掉");
  const count = env.ticks.length;
  env.advance(60000);
  assert.equal(env.ticks.length, count, "直播没有进度可播报，不该周期性喊");
  engine.pause();
  assert.equal(engine.currentStatus, "paused");
  assert.equal(env.timers.size, 0);
  engine.stop();
  assert.equal(engine.currentStatus, "idle");
  assert.equal(env.timers.size, 0);
});

test("缓冲期间排两个里程碑：8 秒提示可以换台，15 秒判失败", (t) => {
  const env = setup(t);
  engine.load(station);
  env.advance(1000);
  env.audios[0].dispatchEvent(new Event("playing"));

  env.audios[0].dispatchEvent(new Event("waiting"));
  assert.equal(engine.currentStatus, "buffering");
  assert.equal(env.timers.size, 2, "一个 8 秒的提示 tick、一个 15 秒的兜底超时");

  const count = env.ticks.length;
  env.advance(7999);
  assert.equal(env.ticks.length, count, "8 秒之前不打扰");
  env.advance(1);
  assert.equal(env.ticks.at(-1), 8, "提示要报「已缓冲 8 秒」");
  assert.equal(engine.currentStatus, "buffering", "只是提示，不是失败");

  env.advance(6999);
  assert.equal(engine.currentStatus, "buffering");
  env.advance(1);
  assert.equal(engine.currentStatus, "error");
  assert.equal(env.events.at(-1).kind, "buffer-timeout");
  assert.equal(env.timers.size, 0, "失败后不留计时器");
});

test("stalled 与 waiting 同样算卡住", (t) => {
  const env = setup(t);
  engine.load(station);
  env.advance(1000);
  env.audios[0].dispatchEvent(new Event("playing"));
  env.audios[0].dispatchEvent(new Event("stalled"));
  assert.equal(engine.currentStatus, "buffering");
});

test("暂停后恢复重新计时；换台后重新计时且忽略旧音频事件", (t) => {
  const env = setup(t);
  engine.load(station);
  env.advance(1000);
  engine.pause();
  assert.equal(env.timers.size, 0);
  env.advance(1000);

  // 暂停了 1 秒，恢复后仍要重新给满 4 秒，不能把暂停的时间算进「调谐中」
  engine.resume();
  const count = env.ticks.length;
  env.advance(1999);
  assert.equal(env.ticks.length, count, "恢复 2 秒还不该报弱信号");
  env.advance(1);
  assert.equal(env.ticks.length, count);
  env.advance(2000);
  assert.equal(env.ticks.at(-1), 4);

  engine.load({ ...station, id: "second" });
  env.audios[0].dispatchEvent(new Event("playing"));
  assert.equal(engine.currentStatus, "tuning", "旧音频的事件必须失效");
  assert.equal(env.ticks.at(-1), 0);
  env.advance(4000);
  assert.equal(env.ticks.at(-1), 4);
  engine.stop();
  assert.equal(env.timers.size, 0);
});

test("暂停超过 30 秒再继续，重新连接而不是播旧缓冲", (t) => {
  const env = setup(t);
  engine.load(station);
  env.advance(1000);
  env.audios[0].dispatchEvent(new Event("playing"));

  engine.pause();
  env.advance(30_000);
  engine.resume();

  assert.equal(env.audios.length, 2, "应该新建一个 Audio 重新连接");
  assert.equal(engine.currentStatus, "tuning");
});

test("暂停后迟到的 playing 事件不会把状态改回播放", (t) => {
  const env = setup(t);
  engine.load(station);
  env.advance(1000);
  engine.pause();

  env.audios[0].dispatchEvent(new Event("playing"));

  assert.equal(engine.currentStatus, "paused");
});

test("空闲时暂停不会把状态改成 paused", (t) => {
  setup(t);
  engine.stop();
  engine.pause();
  assert.equal(engine.currentStatus, "idle");
});

test("waiting 反复触发不会把连接超时往后推", (t) => {
  const env = setup(t);
  engine.load(station);
  env.advance(3000);
  env.audios[0].dispatchEvent(new Event("waiting"));
  env.advance(2000);
  env.audios[0].dispatchEvent(new Event("waiting"));
  env.advance(2999);
  assert.equal(engine.currentStatus, "tuning");
  env.advance(1);
  assert.equal(engine.currentStatus, "error");
  assert.equal(env.events.at(-1).kind, "connect-timeout", "8 秒从装载算起，不顺延");
});

test("有缓冲但一直不出声，8 秒照样判失败", (t) => {
  const env = setup(t);
  engine.load(station);
  // 后台标签页 / 音频焦点被抢：readyState 够了却永远等不到 playing
  env.audios[0].readyState = 3;
  env.advance(8000);
  assert.equal(engine.currentStatus, "error");
  assert.equal(env.events.at(-1).kind, "connect-timeout");
  assert.equal(env.timers.size, 0);
});

test("播放被浏览器拒绝也会清理阈值提醒和连接超时", async (t) => {
  const env = setup(t);
  globalThis.Audio.prototype.play = () => Promise.reject(new DOMException("blocked", "NotAllowedError"));
  engine.load(station);
  await Promise.resolve();
  assert.equal(engine.currentStatus, "error");
  assert.equal(env.events.at(-1).kind, "autoplay-blocked", "要能和真正的网络失败区分开");
  assert.equal(env.timers.size, 0);
});
