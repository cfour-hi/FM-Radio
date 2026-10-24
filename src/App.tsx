import { useEffect, useRef } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import Header from "./components/Header";
import PlayerBar from "./components/PlayerBar";
import RouteEffects from "./components/RouteEffects";
import MapPage from "./pages/MapPage";
import NotFound from "./pages/NotFound";
import { useGlobalKeys } from "./hooks/useGlobalKeys";
import { useLibrary } from "./store/library";
import { usePlayer, readLastStation } from "./store/player";

/*
 * 地图就是首页。
 *
 * 整颗球是唯一的内容，页面级的居中、留白、底部大空隙全都不要——
 * main 永远不加内边距，否则 fixed 的地图虽然铺满窗口，main 仍会撑出
 * 可滚动的高度。老路由 /map 与 /library 重定向到 /，不让旧链接 404。
 *
 * 顶栏和播放条现在都是 fixed 的悬浮元素（左上角胶囊、左下角卡片），
 * 不再参与文档流，所以这里也不需要 flex-col 的上下推挤——地图直接铺满
 * 视口，球也因此比「让开两条通栏」时大了一圈。
 */

export default function App() {
  const hydrate = useLibrary((s) => s.hydrate);
  const remember = useLibrary((s) => s.remember);
  const station = usePlayer((s) => s.station);
  const status = usePlayer((s) => s.status);

  useGlobalKeys();

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // 刷新后恢复上次收听的电台：一次性，靠 ref 防止 StrictMode 开发期双调用
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const last = readLastStation();
    if (last) usePlayer.getState().play(last);
  }, []);

  // 真正出声之后才记入「最近听过」，调谐失败的不算
  const live = status === "playing";
  useEffect(() => {
    if (station && live) void remember(station);
  }, [station, live, remember]);

  return (
    <div className="min-h-screen bg-base">
      <RouteEffects />
      <Header />
      <main>
        <Routes>
          <Route path="/" element={<MapPage />} />
          <Route path="/map" element={<Navigate to="/" replace />} />
          <Route path="/library" element={<Navigate to="/" replace />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <PlayerBar />
    </div>
  );
}
