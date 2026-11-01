/*
 * 品牌文案的唯一来源。
 *
 * 从前应用名散在 Header、index.html、路由标题、系统媒体面板四处，改一次名
 * 要记住四个地方。这里收成常量，代码侧全部引它；index.html 是静态模板，
 * 无法 import，那一处只能手工同步（文件里有注释标着）。
 */

export const APP_NAME = "地球之声";
export const SLOGAN = "一座会发声的地球";
/** 标签页 / 分享卡片的标题 */
export const SITE_TITLE = `${APP_NAME} · 全球电台`;
