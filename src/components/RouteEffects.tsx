import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/**
 * 换页时该发生、但 CRA 不会替你做的两件事：
 * 把滚动位置收回顶部，把标签页标题换掉。
 * 没有第一条，从列表第 300 行点进地图会落在地图中间；
 * 没有第二条，浏览器历史里每一页都叫同一个名字。
 */
const TITLES: Record<string, string> = {
  "/": "FM Radio · 世界电台",
};

export default function RouteEffects() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    document.title = TITLES[pathname] ?? "这个频率上没有电台 · FM Radio";
  }, [pathname]);

  return null;
}
