import { useEffect } from "react";
import { usePlayer } from "../store/player";

/**
 * 全局快捷键。
 *
 * 一条底线：只要焦点在能输入的地方，就一个键都不许抢。
 * 空格是搜索框里最常用的字符，抢一次就够让人放弃这个站了。
 */
const SEARCH_SELECTOR = "[data-search-input]";

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export function useGlobalKeys(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // 修饰键组合是浏览器和系统的地盘，不碰
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      // 原生 dialog 打开时 Esc / Tab 归它自己管，这里让路
      if (document.querySelector("dialog[open]")) return;

      const typing = isTyping(event.target);

      if (event.key === "Escape") {
        // 输入中按 Esc 先退出输入，而不是继续往下传
        if (typing && event.target instanceof HTMLElement) {
          event.target.blur();
        }
        return;
      }

      if (typing) return;

      // 已经按住不放时不要连发，切台会像疯了一样
      if (event.repeat) return;

      const player = usePlayer.getState();

      switch (event.key.toLowerCase()) {
        case " ":
          if (!player.station) return;
          /*
           * 空格永远等于播放/暂停，即使焦点停在某个按钮上。
           * 让原生空格去「按」那个按钮才是坑：用户点过「随机点亮」之后
           * 焦点还留在按钮上，按空格会再随机一次，而不是暂停。
           * 按钮走 Enter，空格只归播放器。
           */
          event.preventDefault();
          player.toggle();
          return;
        case "n":
          player.next(1);
          return;
        case "p":
          player.next(-1);
          return;
        case "m":
          player.toggleMute();
          return;
        case "/": {
          const input = document.querySelector<HTMLInputElement>(SEARCH_SELECTOR);
          if (!input) return;
          event.preventDefault();
          input.focus();
          input.select();
          return;
        }
        default:
          return;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
