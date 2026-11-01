import assert from "node:assert/strict";
import test from "node:test";
import { importTs } from "./tsLoader.mjs";
const storage = new Map([["fm-radio.sleepUntil", "0"]]);
globalThis.sessionStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) };
const { usePlayer } = await importTs("../src/store/player.ts");
const { engine } = await importTs("../src/player/engine.ts");
const station = (id) => ({ id, url: `https://example.com/${id}`, name: id, codec: "MP3", languages: [], tags: [], countryCode: "CN" });
function setup(t) {
  usePlayer.setState(usePlayer.getInitialState(), true);
  const loaded = [];
  t.mock.method(engine, "load", (s) => loaded.push(s.id));
  t.mock.method(engine, "stop", () => {});
  t.mock.method(engine, "setVolume", () => {});
  return loaded;
}
test("已到期会话不自动恢复，用户点击播放重新连接", (t) => {
  const loaded = setup(t);
  assert.equal(usePlayer.getState().sleepExpired, true);
  usePlayer.setState({ station: station("a"), status: "paused" });
  usePlayer.getState().play(station("a"));
  assert.deepEqual(loaded, ["a"]);
  assert.equal(usePlayer.getState().sleepExpired, false);
});
test("上一站恢复真实访问顺序及原队列，不在两个台间反复跳", (t) => {
  const loaded = setup(t);
  const [a,b,c] = ["a","b","c"].map(station);
  const queue = [a,b];
  usePlayer.getState().play(a, queue);
  usePlayer.getState().play(b, queue);
  usePlayer.getState().play(c, [c]);
  assert.equal(usePlayer.getState().previous().id, "b");
  assert.deepEqual(usePlayer.getState().queue, queue);
  assert.equal(usePlayer.getState().previous().id, "a");
  assert.equal(usePlayer.getState().previous(), null);
  assert.deepEqual(loaded, ["a","b","c","b","a"]);
});
test("定时跨换台保留，到期释放连接；重设后也可恢复播放", (t) => {
  const loaded = setup(t);
  t.mock.method(Date, "now", () => 1000);
  usePlayer.getState().play(station("a"));
  usePlayer.getState().setSleep(15);
  assert.equal(usePlayer.getState().sleepUntil, 901000);
  assert.equal(storage.get("fm-radio.sleepUntil"), "901000");
  usePlayer.getState().play(station("b"));
  assert.equal(usePlayer.getState().sleepUntil, 901000);
  usePlayer.getState().expireSleep();
  assert.equal(engine.stop.mock.callCount(), 1);
  assert.equal(usePlayer.getState().status, "paused");
  assert.equal(storage.get("fm-radio.sleepUntil"), "0");
  usePlayer.getState().setSleep(30);
  usePlayer.getState().toggle();
  assert.equal(loaded.at(-1), "b");
  usePlayer.getState().setSleep(null);
  assert.equal(usePlayer.getState().sleepUntil, null);
  assert.equal(storage.has("fm-radio.sleepUntil"), false);
});
