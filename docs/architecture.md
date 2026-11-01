# 架构说明

本文描述当前代码的结构与关键决策。早期按阶段写的实现总结已经合并到这里，不再单独维护。

## 1. 概览

纯前端单页应用，没有后端与账号体系。内容只有一颗可以拖动的地球和它上面的电台光点；所有数据要么来自构建期生成的快照，要么保存在本机。

技术栈：React 19、Vite、TypeScript（strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`）、Zustand、MapLibre GL（globe 投影）、hls.js、Tailwind CSS 4。

## 2. 运行时结构

```
main.tsx
  ErrorBoundary
    BrowserRouter
      App
        Header / RouteEffects / PlayerBar
        MapPage（唯一主页面）
```

- 路由只有 `/`；`/map` 与 `/library` 重定向到 `/`，其余走 NotFound。
- `App` 在挂载时恢复上次收听的电台；分享链接（`?s=<id>`）存在时跳过恢复，交给 `MapPage` 播放，避免「打开就静音」。
- 顶栏与播放条都是 fixed 悬浮元素，地图铺满整个视口。
- `ErrorBoundary` 兜住渲染异常；播放引擎是模块级单例，不挂在 React 树上，所以兜底出现时声音通常还在。

## 3. 状态与存储

四个 zustand store：

| store | 内容 |
| --- | --- |
| `player` | 当前台、播放状态、错误分类、音量、队列、历史、睡眠定时 |
| `map` | 镜头请求（聚焦 / 回到世界）、搜索聚焦 token |
| `fx` | 当前特效 id |
| `library` | 收藏、最近收听 |

存储分工：

- **localStorage**：收藏、最近收听（30 条）与各自的迁移标记、音量 / 静音、上次收听的电台快照、新手引导、特效选择。写失败（隐私模式）一律静默降级。
- **sessionStorage**：睡眠定时截止时间、手动选择的地区；新会话不继承。
- **旧 IndexedDB（库名 `fm-radio`）**：早期版本的收藏与最近收听。启动时用原生 API 一次性读出来合并进 localStorage（按 id 去重，写成功后才写迁移标记），之后不再读写；应用不再依赖 Dexie。

浏览器定位的坐标只存在 React 内存里，不反查省市、不上传、不持久化。

## 4. 播放引擎

`src/player/engine.ts` 是全局单例，状态机为 `idle → tuning → playing / buffering / paused / error`。

关键行为：

- **换台即换元素**：每次 `load()` 都销毁旧 Audio / hls.js 实例并新建，旧实例的事件靠引用比较自然失效；`loadToken` 负责丢弃仍在下载 hls.js 的旧请求。
- **超时**：8 秒未出声判定连接超时；调谐 4 秒提示弱信号；出声后卡住 8 秒提示可换台、15 秒判失败。
- **HLS 回退**：原生 HLS 声称支持却播不动时，换 hls.js 再试一次，只试一次。
- **暂停语义**：hls.js 是动态 import 的，audio 元素要等它下载完才存在。暂停意图用 `pauseRequested` 记录，manifest 到达时不再自动开播；迟到的 `playing` 事件也不会盖过暂停。
- **长暂停**：暂停超过 30 秒再继续时重新装载，回到直播边缘，而不是从旧缓冲接着播。
- **错误分类**：`src/player/errors.ts` 输出机器可读的 `EngineErrorKind`，界面据此决定「重试」还是「换个台」，并推荐同城 / 同省替代台。
- **系统集成**：Media Session 绑定播放、暂停、上一站、下一站；睡眠定时到期会停止连接但保留当前台。

## 5. 地图与特效

- MapLibre globe 投影，陆地轮廓与采样点由 `scripts/build-land-*.mjs` 生成，放在 `public/`；版权条标注 Natural Earth。
- 电台点是一层 GeoJSON source，不逐个创建 DOM Marker；只有当前高亮台用一个 Marker 跟随投影。
- 台名标签按点击量与避让算法筛选，可在右上角整体开关。
- 同一处叠了多个台时走命中测试，抽屉切到「这一带 N 个台」。
- 粒子特效（星际 / 银河 / 隧道）懒加载；切到特效时地图层淡出但**保持挂载**，切回秒出。`prefers-reduced-motion` 下过渡时长为 0。

## 6. 数据管线

`scripts/build-stations.mjs` 从 radio-browser 翻页拉全量（每页 1000），只保留 https 可播台，按有无坐标切三片：

| 分片 | 数量（当前） | 体积（gzip） | 加载时机 |
| --- | --- | --- | --- |
| core | 2,305 | 197KB | 首屏，地图渲染前 |
| rest | 7,886 | 763KB | 地图就绪后 `requestIdleCallback` |
| catalog | 22,665 | 1.46MB | 搜索词 ≥2 字或开始筛选 |

中国台由 `scripts/cn-geo.mjs` 按台名推断到城市 / 省，坐标带确定性抖动并标记 `geoApprox`；境外台做离群点清洗。

写盘前的闸门（`scripts/lib/snapshot.mjs`）：

- 翻页失败、返回非数组直接抛错，不再产出「拉了一半」的快照；
- 在线拉取少于 10,000 台拒绝生成；
- 逐条检查 id / 台名 / https / 坐标，跨分片查重复 id；
- 与上一版对比，任一比分片掉超过 15% 判失败（确认无误用 `--force`）。

快照不再写进 git 历史，而是发布成 GitHub Release；仓库只跟踪 `data/manifest.json`（tag、大小、sha256）。`scripts/fetch-data.mjs` 按清单拉取并逐个校验，`scripts/publish-data.mjs` 负责创建 release 与更新清单。CI 里先 `pnpm data:pull`，再跑 `data:validate`；`data:check` 抽查热门流，不放进 CI。

## 7. 搜索与发现

- `searchStations` 分三层匹配：台名前缀 → 台名包含 → 地区前缀（关键词至少两字）；索引按点击量排序，结果保持热度序。
- 地区词包含省、市、state、国家名、国家代码与港澳台展示名；国家名用 `Intl.DisplayNames`，不维护对照表。
- 抽屉：附近、收藏、最近、全部四个 tab；语言与类型筛选先合并再筛选，每次显示 50 条。
- 附近电台使用浏览器 Geolocation，本地计算球面距离，显示精度；也可手动选省。
- 随机探索的范围可选全部 / 中文 / 当前地区 / 收藏，排除证书异常与当前台。
- 分享链接 `?s=<stationId>` 优先播放；找不到时给一句四秒后消失的提示。

## 8. 性能

- 首屏 JS 约 560KB gzip（index 124 + WorldMap 293 + worker 144）；core 数据 197KB gzip。
- 地图、特效、hls.js、catalog 全部按需加载。
- 星空背景用 Canvas 静态绘制，替代 300 层 CSS radial-gradient；对比测量见 git 历史（原渐变平均帧间隔 45ms，Canvas 约 21ms，1280×720）。
- 抽屉首次打开前不挂载内容，首次打开也不请求定位。
- 已加载数据、搜索索引与地图分片都是模块级缓存，切换 tab 不重复计算。

## 9. 测试与 CI

- `pnpm test`：118 个 Node 测试，覆盖搜索、手势、睡眠定时、定位、播放状态机（含 HLS 替身）、收藏与最近收听迁移、国家名、快照校验等纯逻辑。
- `pnpm typecheck`：严格 TS。
- `pnpm e2e`：Playwright 冒烟，覆盖首屏、搜索、点台、深链、抽屉开关与焦点陷阱。
- `.github/workflows/ci.yml`：`data:pull` → `typecheck` → `data:validate` → `test` → `build`，之后单独跑 e2e。
- `.github/workflows/weekly-data.yml`：每周一自动拉取 radio-browser、校验、typecheck / test / build、发布 release 并提交 manifest；页面部署仍在 WorkBuddy 手动完成。

## 10. 已知限制

- 电台流由第三方提供，停播是周级别的事；`data:check` 只抽查热门流。
- 快照发布到 GitHub Release（见第 6 节）；构建依赖 GitHub 可用性，已发布的 tag 不要删除。
- 移动端真机（软键盘、锁屏、后台播放）未全面验收。
- `probe/` 下的浏览器检查页被 gitignore，文档不再引用它们；需要复现时请从本地保留的副本取用。
