import type { HiddenEntry } from "../../lib/hiddenStations";

type Props = {
  entries: HiddenEntry[];
  onBack: () => void;
  onClose: () => void;
  onRestore: (id: string) => void;
  onRestoreAll: () => void;
};

/** 已隐藏的台：查看原因、单个恢复或全部恢复。 */
export default function DrawerHidden({ entries, onBack, onClose, onRestore, onRestoreAll }: Props) {
  return (
    <>
      <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
        <button
          type="button"
          onClick={onBack}
          aria-label="返回"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-[6px] text-dim transition-colors hover:text-ink"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </button>
        <p className="num flex-1 text-[13px] text-ink">已隐藏 {entries.length} 个</p>
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

      {entries.length === 0 ? (
        <div className="px-3 py-8 text-center text-[12px] text-muted">没有隐藏的电台</div>
      ) : (
        <>
          <div data-drawer-scroll className="min-h-0 flex-1 overflow-y-auto">
            <ul role="list" aria-label="已隐藏的电台">
              {entries.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-center gap-2 border-b border-line-soft px-4 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] text-ink">{entry.name}</p>
                    <p className="mt-0.5 text-[11px] text-dim">
                      {entry.reason === "manual" ? "手动隐藏" : `连接失败 ${entry.count} 次`}
                      {" · "}
                      {new Date(entry.at).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRestore(entry.id)}
                    aria-label={`恢复 ${entry.name}`}
                    className="shrink-0 rounded-[6px] border border-line px-3 py-1.5 text-[12px] text-signal transition-colors hover:text-ink"
                  >
                    恢复
                  </button>
                </li>
              ))}
            </ul>
          </div>
          {entries.length > 1 && (
            <button
              type="button"
              onClick={onRestoreAll}
              className="min-h-11 shrink-0 border-t border-line px-4 text-left text-[12px] text-muted transition-colors hover:text-ink"
            >
              全部恢复
            </button>
          )}
        </>
      )}
    </>
  );
}
