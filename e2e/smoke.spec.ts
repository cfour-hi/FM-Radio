import { expect, test, type Page } from "@playwright/test";

/*
 * 冒烟测试。五条路径覆盖「打开就能用」的最小闭环：
 * 地球出得来、搜索能出结果、点台能选中、深链能恢复、抽屉能开关。
 *
 * 不依赖真实音频：点击后只断言 store 里的 station，不等待出声。
 */

const GUIDE_KEY = "fm-radio.onboarding.v1";

async function openApp(page: Page): Promise<void> {
  // 跳过首访引导，避免每次都要先点「开始探索」；同时清掉上次电台与睡眠定时
  await page.addInitScript((key) => {
    localStorage.setItem(key, "1");
    localStorage.removeItem("fm-radio.lastStation");
    sessionStorage.removeItem("fm-radio.sleepUntil");
  }, GUIDE_KEY);

  await page.goto("/");
  await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible({ timeout: 30_000 });
}

async function openDrawer(page: Page) {
  await page.getByRole("button", { name: "电台面板" }).click();
  const drawer = page.getByRole("dialog", { name: "电台面板" });
  await expect(drawer).toBeVisible();
  return drawer;
}

const currentStationId = (page: Page) =>
  page.evaluate(() => {
    const player = (window as unknown as { __player?: { getState: () => { station: { id: string } | null } } })
      .__player;
    return player?.getState().station?.id ?? null;
  });

test("首屏：地球画出来，HUD 显示台数，没有页面异常", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await openApp(page);

  await expect(page.getByText(/·\s*\d+\s*台/).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("搜索：一个字只搜地图电台，两个字才补全目录", async ({ page }) => {
  await openApp(page);
  const drawer = await openDrawer(page);
  const input = drawer.getByRole("searchbox", { name: "搜索电台" });

  await input.fill("北");
  await expect(drawer.getByText("输入至少 2 个字可搜索全球目录")).toBeVisible();
  await expect(drawer.locator("[data-row]").first()).toBeVisible();

  await input.fill("北京");
  await expect(drawer.getByText(/全部电台 · \d+ 个结果/)).toBeVisible();
  await expect(drawer.locator("[data-row]").first()).toContainText("北京");
});

test("点台：点击结果行后播放器选中该台", async ({ page }) => {
  await openApp(page);
  const drawer = await openDrawer(page);

  await drawer.getByRole("searchbox", { name: "搜索电台" }).fill("北京");
  const row = drawer.locator("[data-row]").first();
  await expect(row).toBeVisible();
  const id = await row.getAttribute("data-row");
  expect(id).toBeTruthy();

  await row.locator("button").first().click();
  await expect.poll(() => currentStationId(page)).toBe(id);
});

test("深链：?s= 刷新后直接选中分享的电台", async ({ page }) => {
  await openApp(page);
  const drawer = await openDrawer(page);

  await drawer.getByRole("searchbox", { name: "搜索电台" }).fill("北京");
  const row = drawer.locator("[data-row]").first();
  await expect(row).toBeVisible();
  const id = await row.getAttribute("data-row");
  expect(id).toBeTruthy();

  await page.goto(`/?s=${encodeURIComponent(id!)}`);
  await expect
    .poll(() => currentStationId(page), { timeout: 20_000 })
    .toBe(id);
});

test("抽屉：可以打开和关闭", async ({ page }) => {
  await openApp(page);

  const drawer = await openDrawer(page);
  await drawer.getByRole("button", { name: "收起面板" }).click();
  await expect(drawer).toBeHidden();
});

test("抽屉：键盘焦点留在面板内，关闭后归还触发按钮", async ({ page }) => {
  await openApp(page);
  const trigger = page.getByRole("button", { name: "电台面板" });
  await trigger.focus();
  await trigger.click();

  const drawer = page.getByRole("dialog", { name: "电台面板" });
  await expect(drawer).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");

  // 面板里只有十来个可聚焦元素，按两轮 Tab 一定会回绕
  for (let i = 0; i < 15; i++) await page.keyboard.press("Tab");
  expect(await drawer.evaluate((root) => root.contains(document.activeElement))).toBe(true);

  await drawer.getByRole("button", { name: "收起面板" }).click();
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
});
