import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { usePlayer } from "./store/player";
import "./styles/index.css";

/*
 * 开发期调试钩子：让自动化测试和浏览器控制台读到的
 * 就是应用真正在用的那个 store 实例，而不是另一个副本。
 * 生产构建里这段会被整块去掉。
 */
if (import.meta.env.DEV) {
  (window as unknown as { __player?: unknown }).__player = usePlayer;
}

const root = document.getElementById("root");
if (!root) throw new Error("#root 未找到");

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
