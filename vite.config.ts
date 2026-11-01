import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * 把 index.html 里的 %SITE_URL% 换成部署域名。
 *
 * 留空时替换成空串，链接退化为相对路径——本地和预览站都能正常打开，
 * 只是分享卡片里的图片地址不够绝对。域名一确定，在 .env 里写
 * VITE_SITE_URL=https://example.com 就够，不用再动 HTML。
 */
function siteUrlPlugin(siteUrl: string): Plugin {
  return {
    name: "fm-radio:site-url",
    transformIndexHtml(html) {
      return html.replaceAll("%SITE_URL%", siteUrl);
    },
  };
}

export default defineConfig(({ mode }) => {
  // "." 就是项目根：vite 启动时的工作目录，也是 .env 文件所在的地方
  const env = loadEnv(mode, ".", "");
  const siteUrl = (env["VITE_SITE_URL"] ?? "").replace(/\/+$/, "");

  return {
    plugins: [react(), tailwindcss(), siteUrlPlugin(siteUrl)],
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
