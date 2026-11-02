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
  // CI runner 上地图初始化、3.4MB catalog 下载都可能比本地慢，留足余量
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://127.0.0.1:5566",
    trace: "on-first-retry",
    locale: "zh-CN",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    /*
     * 必须显式绑定 127.0.0.1：Vite 默认的 localhost 在某些环境（包括
     * GitHub Actions 的 Node）只解析到 ::1，而这里探测的是 127.0.0.1，
     * 结果是浏览器永远等不到 dev server，CI 报 webServer 超时。
     */
    command: "pnpm exec vite --host 127.0.0.1 --port 5566 --strictPort",
    url: "http://127.0.0.1:5566",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
