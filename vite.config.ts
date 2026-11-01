import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * 把 index.html 里的 %SITE_URL% / %SHARE_QUERY% 换成部署地址与访问参数。
 *
 * 留空时替换成空串，链接退化为相对路径——本地和预览站都能正常打开，
 * 只是分享卡片里的图片地址不够绝对。域名一确定，在 .env 里写
 * VITE_SITE_URL=https://example.com 就够，不用再动 HTML。
 *
 * 有些静态托管（例如 WorkBuddy）整站要求 sharecode 才能访问，裸域名和
 * og.png 都会 403；这时用 VITE_SHARE_QUERY 把查询串带上，爬虫才抓得到。
 */
function siteUrlPlugin(siteUrl: string, shareQuery: string): Plugin {
  return {
    name: "fm-radio:site-url",
    transformIndexHtml(html) {
      return html
        .replaceAll("%SITE_URL%", siteUrl)
        .replaceAll("%SHARE_QUERY%", shareQuery);
    },
  };
}

export default defineConfig(({ mode }) => {
  // "." 就是项目根：vite 启动时的工作目录，也是 .env 文件所在的地方
  const env = loadEnv(mode, ".", "");
  const siteUrl = (env["VITE_SITE_URL"] ?? "").replace(/\/+$/, "");
  // 允许写 sharecode=xxx 或 ?sharecode=xxx，统一补一个问号
  const shareRaw = (env["VITE_SHARE_QUERY"] ?? "").trim().replace(/^[?&]+/, "");
  const shareQuery = shareRaw ? `?${shareRaw}` : "";

  return {
    plugins: [react(), tailwindcss(), siteUrlPlugin(siteUrl, shareQuery)],
    server: { port: 5555 },
    optimizeDeps: {
      /*
       * maplibre-gl 用 new URL("./maplibre-gl-worker.mjs", import.meta.url) 找自己的
       * worker。一旦被 Vite 预打包进 .vite/deps，这个相对路径就指向了不存在的文件，
       * 地图会停在「正在铺开地图」。排除它，让浏览器直接按原样加载。
       */
      exclude: ["maplibre-gl"],
    },
  };
});
