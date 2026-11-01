import { defineConfig, devices } from "@playwright/test";

/*
 * 冒烟测试只覆盖「应用能打开、关键路径能走通」。
 *
 * 不验证真实音频：流的可用性属于数据问题，由 data:check 负责；
 * 这里只确认点击之后播放器选中了正确的电台。
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  timeout: 45_000,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://127.0.0.1:5566",
    trace: "on-first-retry",
    locale: "zh-CN",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm dev --port 5566 --strictPort",
    url: "http://127.0.0.1:5566",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
