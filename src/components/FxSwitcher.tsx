import { useEffect, useRef } from "react";
import { FX_LIST, type FxId } from "../fx/registry";
import { useFxStore } from "../store/fx";

/*
 * 右上角的特效切换器。
 *
 * 结构沿用 RandomExplorer 的 details 下拉：一个图标按钮点开菜单，
 * 点别处自动收起，Escape 收起并还焦点。菜单里两件事——特效单选、
 * 电台点开关（关掉就是纯氛围壁纸）。
 */
export default function FxSwitcher({ panelOpen }: { panelOpen?: boolean }) {
  const root = useRef<HTMLDetailsElement>(null);
  const fxId = useFxStore((s) => s.fxId);
  const setFx = useFxStore((s) => s.setFx);
  const showStations = useFxStore((s) => s.showStations);
  const toggleStationDots = useFxStore((s) => s.toggleStationDots);

  // 电台面板打开时收起，别压在抽屉上
  useEffect(() => {
    if (panelOpen && root.current) root.current.open = false;
  }, [panelOpen]);

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) {
        root.current?.removeAttribute("open");
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && root.current?.open) {
        root.current.open = false;
        root.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, []);

  const pick = (id: FxId) => {
    setFx(id);
    root.current?.removeAttribute("open");
    root.current?.querySelector("summary")?.focus();
  };

  const active = FX_LIST.find((fx) => fx.id === fxId);

  return (
    <details ref={root} className="relative pointer-events-auto" onKeyDown={(event) => {
      if (event.key === "Escape") {
        event.currentTarget.open = false;
        event.currentTarget.querySelector("summary")?.focus();
      }
    }}>
      <summary
        aria-label="切换特效"
        title="切换特效"
        className="grid h-11 w-11 sm:h-8 sm:w-8 cursor-pointer list-none place-items-center rounded-[6px] border border-line bg-base/55 text-muted backdrop-blur transition-colors hover:text-ink [&::-webkit-details-marker]:hidden"
      >
        {/* 特效图标：四芒星，与面板/眼睛/地球那排线性图标同一笔画粗细 */}
        <svg viewBox="0 0 24 24" className="h-[15px] w-[15px]" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 3.5c.9 4.6 2.4 6.6 8.5 8.5-6.1 1.9-7.6 3.9-8.5 8.5-.9-4.6-2.4-6.6-8.5-8.5 6.1-1.9 7.6-3.9 8.5-8.5z" />
        </svg>
      </summary>
      <div className="fixed right-2 top-16 z-30 w-52 sm:absolute sm:right-0 sm:top-10 rounded-lg border border-line bg-base p-3 shadow-xl">
        <p className="text-[11px] uppercase tracking-[0.14em] text-dim">特效</p>
        <div className="mt-2" role="radiogroup" aria-label="选择特效">
          {FX_LIST.map((fx) => {
            const selected = fx.id === fxId;
            return (
              <button
                key={fx.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => pick(fx.id)}
                className={`flex min-h-10 w-full items-center justify-between rounded px-2 text-left text-[12px] transition-colors ${
                  selected ? "bg-signal-soft text-signal" : "text-muted hover:bg-surface-2 hover:text-ink"
                }`}
              >
                <span>{fx.name}</span>
                {selected && (
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M4.5 12.5l5 5 10-11" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>

        {/* 电台点开关：只对粒子特效有意义，地球模式下藏起来 */}
        {fxId !== "globe" && (
          <label className="mt-3 flex min-h-10 cursor-pointer items-center justify-between gap-2 border-t border-line-soft pt-3 text-[12px] text-muted">
            <span>显示电台点</span>
            <input
              type="checkbox"
              checked={showStations}
              onChange={toggleStationDots}
              className="h-4 w-4 accent-[var(--color-signal)]"
            />
          </label>
        )}

        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          {active ? `${active.name} · ${active.hint}` : ""}
        </p>
      </div>
    </details>
  );
}
