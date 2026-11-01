import assert from "node:assert/strict";
import { after, test } from "node:test";
import { registerHooks } from "node:module";

/*
 * hls.js 是动态 import 的，engine 在它下载完成之前没有 audio 元素。
 * 这组测试把 hls.js 换成替身，精确复现「下载中用户按了暂停」的那段窗口。
 */

const stubUrl = new URL("./hlsStub.mjs", import.meta.url).href;

const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "hls.js") return { url: stubUrl, shortCircuit: true };
    if (specifier.startsWith(".") && context.parentURL?.includes("/src/") && !/\.[a-z]+$/i.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { engine } = await import("../src/player/engine.ts");
const { default: HlsStub } = await import(stubUrl);

after(() => hook.deregister());

const hlsStation = { id: "hls", url: "https://example.com/live.m3u8", hls: true };

const flush = () => new Promise((resolve) => setImmediate(resolve));

function setup(t) {
  let now = 100000;
  let serial = 0;
  let playCalls = 0;
  const timers = new Map();
  const audios = [];
  const oldWindow = globalThis.window;
  const oldAudio = globalThis.Audio;

  globalThis.window = {
    setTimeout(fn, delay) {
      const id = ++serial;
      timers.set(id, { fn, at: now + delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  };
  globalThis.Audio = class extends EventTarget {
    readyState = 0;
    error = null;
    constructor() {
      super();
      audios.push(this);
    }
    play() {
      playCalls++;
      return Promise.resolve();
    }
    pause() {
      this.dispatchEvent(new Event("pause"));
    }
    removeAttribute() {}
    load() {}
  };

  t.mock.method(Date, "now", () => now);
  engine.hooks = { onTick: () => {}, onStatus: () => {} };

  t.after(() => {
    engine.stop();
    engine.hooks = null;
    HlsStub.instances.length = 0;
    timers.clear();
    if (oldWindow === undefined) delete globalThis.window;
    else globalThis.window = oldWindow;
    if (oldAudio === undefined) delete globalThis.Audio;
    else globalThis.Audio = oldAudio;
  });

  return {
    audios,
    get playCalls() {
      return playCalls;
    },
  };
}

test("解码器还在下载时点暂停，manifest 到达后也不出声", async (t) => {
  const env = setup(t);
  engine.load(hlsStation);
  assert.equal(engine.currentStatus, "tuning");

  engine.pause();
  assert.equal(engine.currentStatus, "paused", "audio 还没创建也要先切到暂停");

  await flush();
  await flush();

  const hls = HlsStub.instances.at(-1);
  assert.ok(hls, "解码器加载完成后应该创建 hls 实例");
  hls.emit(HlsStub.Events.MANIFEST_PARSED);

  assert.equal(engine.currentStatus, "paused");
  assert.equal(env.playCalls, 0, "用户按过暂停，不能自己开播");
});

test("下载期间暂停后又点播放，manifest 到达后正常出声", async (t) => {
  const env = setup(t);
  engine.load(hlsStation);
  engine.pause();
  engine.resume();

  await flush();
  await flush();

  const hls = HlsStub.instances.at(-1);
  assert.ok(hls);
  hls.emit(HlsStub.Events.MANIFEST_PARSED);

  assert.equal(env.playCalls, 1, "恢复播放后应该调用 play()");
});
