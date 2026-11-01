import { useEffect, type RefObject } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * 把键盘焦点关在一个容器里。
 *
 * 打开时焦点交给容器本身（不替用户决定该落在哪个按钮上），Tab / Shift+Tab
 * 在容器内循环；关闭时把焦点还给打开它的那个元素。容器需要 tabIndex={-1}
 * 才能被聚焦，role="dialog" 负责把标题读给读屏软件。
 */
export function useFocusTrap(rootRef: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    if (!active) return;

    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // 等滑入这一帧过去再聚焦，避免焦点环在动画中途闪烁
    const frame = requestAnimationFrame(() => rootRef.current?.focus({ preventScroll: true }));

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const container = rootRef.current;
      if (!container) return;

      const items = [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        // offsetParent 为 null 的通常是视觉隐藏（sr-only）或收起的分支
        (el) => el.offsetParent !== null && el.tabIndex !== -1,
      );
      if (items.length === 0) {
        event.preventDefault();
        container.focus({ preventScroll: true });
        return;
      }

      const first = items[0]!;
      const last = items[items.length - 1]!;
      const current = document.activeElement;

      if (event.shiftKey) {
        if (current === first || current === container || !container.contains(current)) {
          event.preventDefault();
          last.focus();
        }
      } else if (current === last || !container.contains(current)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown, true);
      // 打开它的按钮可能在关闭前就被移除了，存在才还焦点
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [active, rootRef]);
}
