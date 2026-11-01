export type Tab = "nearby" | "favorites" | "recents" | "search";

const TABS: { key: Tab; label: string }[] = [
  { key: "search", label: "全部" },
  { key: "nearby", label: "附近" },
  { key: "favorites", label: "收藏" },
  { key: "recents", label: "最近" },
];

type Props = {
  tab: Tab;
  /** 有搜索词或筛选时，「全部」始终算选中 */
  searching: boolean;
  onSelect: (tab: Tab) => void;
};

export default function DrawerTabs({ tab, searching, onSelect }: Props) {
  return (
    <div className="flex items-center gap-1 border-b border-line px-3 py-2">
      {TABS.map((item) => {
        const active = item.key === "search" ? searching : !searching && tab === item.key;
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onSelect(item.key)}
            aria-pressed={active}
            className={`h-10 rounded-[6px] px-3 text-[13px] transition-colors ${
              active ? "bg-surface-2 text-ink" : "text-muted hover:bg-surface hover:text-ink"
            }`}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
