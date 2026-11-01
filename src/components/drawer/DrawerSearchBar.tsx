import type { RefObject } from "react";
import type { Station } from "../../lib/types";

type Props = {
  inputRef: RefObject<HTMLInputElement | null>;
  query: string;
  onQueryChange: (query: string) => void;
  onFocusSearch: () => void;
  onClose: () => void;
  /** 当前列表：方向键在它里面移动，回车播的就是高亮那一行 */
  items: Station[];
  active: number;
  onActiveChange: (index: number) => void;
  /** 回车选中：由抽屉决定是播放还是暂停 */
  onActivate: (station: Station, queue: Station[]) => void;
};

/* 搜索框与关闭按钮。键盘行为都留在这里，列表只负责渲染。 */
export default function DrawerSearchBar({
  inputRef,
  query,
  onQueryChange,
  onFocusSearch,
  onClose,
  items,
  active,
  onActiveChange,
  onActivate,
}: Props) {
  return (
    <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
      <div className="relative flex-1">
        <svg
          viewBox="0 0 24 24"
          className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-dim"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onFocus={onFocusSearch}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              onActiveChange(Math.min(active + 1, items.length - 1));
              return;
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              onActiveChange(Math.max(active - 1, -1));
              return;
            }
            if (event.key === "Enter") {
              const station = items[active === -1 ? 0 : active];
              if (!station) return;
              event.preventDefault();
              onActivate(station, items);
              return;
            }
            if (event.key === "Escape") {
              /*
               * 必须自己拦住：全局 Esc 只做 blur，会先把输入框踢掉焦点，
               * 用户想「先清词、再退出」的预期就完不成了。
               */
              event.stopPropagation();
              if (query) {
                onQueryChange("");
                onActiveChange(-1);
              } else {
                event.currentTarget.blur();
              }
            }
          }}
          data-search-input
          placeholder="搜台名、省份、城市或国家…"
          aria-label="搜索电台"
          aria-controls="drawer-results"
          className="h-9 w-full rounded-[6px] border border-line bg-base/60 pl-8 pr-3 text-[13px] text-ink placeholder:text-dim focus:border-signal/50 focus:outline-none"
        />
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="收起面板"
        className="grid h-11 w-11 shrink-0 place-items-center rounded-[6px] text-dim transition-colors hover:text-ink"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      </button>
    </div>
  );
}
