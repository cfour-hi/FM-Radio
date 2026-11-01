import assert from "node:assert/strict";
import test from "node:test";
import { importTs } from "./tsLoader.mjs";

const { lockAxis, swipeVelocity, decideDismiss, decideCollapse, decideRestore, clampOffset, AXIS_LOCK_PX } =
  await importTs("../src/lib/swipeGesture.ts");

test("方向锁：阈值内不判，超过后只认一个轴", () => {
  assert.equal(lockAxis(3, 2), "none", "手指刚落下时的抖动不算意图");
  assert.equal(lockAxis(AXIS_LOCK_PX - 1, 0), "none");
  assert.equal(lockAxis(0, 10), "y");
  assert.equal(lockAxis(12, 3), "x");
  assert.equal(lockAxis(-40, 5), "x", "取绝对值，方向不影响判轴");
});

test("方向锁：平手判给纵向", () => {
  // 用户更可能是想滚列表，而不是想关面板
  assert.equal(lockAxis(9, 9), "y");
});

test("方向锁：脏数据不抛，一律不判", () => {
  assert.equal(lockAxis(NaN, 100), "none");
  assert.equal(lockAxis(100, Infinity), "none");
});

test("速度取尾段：慢慢拖一大段再猛一甩，算甩", () => {
  // 前 950ms 只挪了 20px，最后 50ms 甩了 60px
  const samples = [
    { x: 0, y: 0, t: 0 },
    { x: 20, y: 0, t: 950 },
    { x: 80, y: 0, t: 1000 },
  ];
  const { vx } = swipeVelocity(samples, 90);
  assert.equal(vx, 1.2, "若用全程平均会得到 0.08，用户会觉得甩不动");
});

test("速度：全部落在窗口外时，退回最后一个真实间隔", () => {
  // 手指停住再松手是常态；只拿 last 跟自己比会让速度恒为 0
  const samples = [
    { x: 0, y: 0, t: 0 },
    { x: 500, y: 0, t: 50 },
    { x: 510, y: 0, t: 200 },
  ];
  const { vx } = swipeVelocity(samples, 90);
  assert.equal(vx, (510 - 500) / 150);
});

test("速度：异常输入返回 0，绝不返回 NaN", () => {
  for (const samples of [
    [],
    [{ x: 0, y: 0, t: 0 }],
    [{ x: 0, y: 0, t: 100 }, { x: 10, y: 0, t: 100 }],
    [{ x: 0, y: 0, t: 100 }, { x: 10, y: 0, t: 50 }],
    [{ x: 0, y: 0, t: 0 }, { x: NaN, y: 0, t: 100 }],
  ]) {
    const { vx, vy } = swipeVelocity(samples);
    assert.ok(Number.isFinite(vx) && Number.isFinite(vy), `样本 ${JSON.stringify(samples)} 产出了 NaN`);
    assert.equal(vx, 0);
  }
});

test("关闭判定：拖过尺寸比例就该关", () => {
  // 390 宽的抽屉，阈值 = max(56, 93.6)
  assert.equal(decideDismiss({ distance: 94, velocity: 0, size: 390 }), true);
  assert.equal(decideDismiss({ distance: 93, velocity: 0, size: 390 }), false);
});

test("关闭判定：没拖到位但甩得够快，也算", () => {
  assert.equal(decideDismiss({ distance: 30, velocity: 0.6, size: 390 }), true);
  assert.equal(decideDismiss({ distance: 30, velocity: 0.3, size: 390 }), false, "速度不够");
  assert.equal(decideDismiss({ distance: 10, velocity: 2, size: 390 }), false, "再快也得甩过 24px");
});

test("关闭判定：反方向一律不算", () => {
  assert.equal(decideDismiss({ distance: -200, velocity: 2, size: 390 }), false);
});

test("关闭判定：尺寸为 0 时退到最小距离，不产生 NaN", () => {
  assert.equal(decideDismiss({ distance: 60, velocity: 0, size: 0 }), true);
  assert.equal(decideDismiss({ distance: 10, velocity: 0, size: 0 }), false);
});

test("播放条的阈值比抽屉小，同一行程才够用", () => {
  // 收起位移只有三十几像素：用抽屉的 56px 门槛永远达不到
  const travel = 24;
  assert.equal(decideDismiss({ distance: travel, velocity: 0, size: 33, minDistance: 56, ratio: 0.24 }), false);
  assert.equal(decideDismiss({ distance: travel, velocity: 0, size: 33, minDistance: 20, ratio: 0.3 }), true);
});

test("播放条收起用自己的档位，抽屉关闭不受影响", () => {
  // 33px 行程里拖 24px：按播放条算该收起，按抽屉（56px 门槛）不该
  assert.equal(decideCollapse({ distance: 24, velocity: 0, size: 33 }), true);
  assert.equal(decideDismiss({ distance: 24, velocity: 0, size: 33 }), false);
  // 反方向一律不算
  assert.equal(decideCollapse({ distance: -24, velocity: 0, size: 33 }), false);
});

test("展开判定与关闭判定对同一段行程符号相反", () => {
  // 播放条收起后可拖行程只有 30 多像素，这里按它的尺度算
  assert.equal(decideRestore({ distance: -22, velocity: 0, size: 33 }), true);
  assert.equal(decideRestore({ distance: 22, velocity: 0, size: 33 }), false, "往下拖不该展开");
  assert.equal(decideRestore({ distance: -30, velocity: -0.6, size: 33 }), true, "上滑快甩也算");
});

test("位移夹紧：永远落在 [0, 尺寸] 之间", () => {
  assert.equal(clampOffset(-5, 390), 0);
  assert.equal(clampOffset(500, 390), 390);
  assert.equal(clampOffset(120, 390), 120);
  assert.equal(clampOffset(NaN, 390), 0);
  assert.equal(clampOffset(50, 0), 0);
  assert.equal(clampOffset(50, NaN), 0);
});
