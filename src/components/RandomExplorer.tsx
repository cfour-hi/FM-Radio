import { useEffect, useMemo, useRef, useState } from "react";
import type { Station } from "../lib/types";
import { checkSupport } from "../lib/capability";
import { pickRandom, randomPool, type RandomScope } from "../lib/stationDiscovery";
import { useLibrary } from "../store/library";
import { usePlayer } from "../store/player";

export default function RandomExplorer({ stations, onLocate, panelOpen }: { stations: Station[]; onLocate: (station: Station) => void; panelOpen: boolean }) {
  const root = useRef<HTMLDetailsElement>(null);
  useEffect(() => { if (panelOpen && root.current) root.current.open = false; }, [panelOpen]);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) root.current?.removeAttribute("open");
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && root.current?.open) {
        root.current.open = false;
        root.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", escape); };
  }, []);
  const [scope, setScope] = useState<RandomScope>("all");
  const [recent, setRecent] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const favorites = useLibrary((s) => s.favorites);
  const current = usePlayer((s) => s.station);
  const pool = useMemo(() => randomPool(stations, favorites, scope, current)
    .filter((s) => !s.sslError && checkSupport(s).ok), [stations, favorites, scope, current]);
  const choose = () => {
    const pick = pickRandom(pool, current?.id ?? null, recent);
    if (!pick) { setMessage("这个范围暂时没有其他可选电台"); return; }
    setMessage("");
    setRecent((ids) => [...ids, ...(current ? [current.id] : []), pick.id].slice(-20));
    onLocate(pick);
    usePlayer.getState().play(pick, pool);
  };
  return (
    <details ref={root} className="relative pointer-events-auto" onKeyDown={(event) => {
      if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); }
    }}>
      <summary aria-label="随机探索" title="随机探索" className="grid h-11 w-11 sm:h-8 sm:w-8 cursor-pointer list-none place-items-center rounded-[6px] border border-signal/30 bg-base/55 text-signal backdrop-blur [&::-webkit-details-marker]:hidden">
        <svg viewBox="0 0 24 24" className="h-[15px] w-[15px]" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
          <rect x="4" y="4" width="16" height="16" rx="3.5" />
          <path d="M8 8h.01M16 8h.01M12 12h.01M8 16h.01M16 16h.01" strokeWidth="3" strokeLinecap="round" />
        </svg>
      </summary>
      <div className="fixed right-2 top-16 w-56 sm:absolute sm:right-0 sm:top-10 rounded-lg border border-line bg-base p-3 shadow-xl">
        <label className="block text-[12px] text-muted">随机范围
          <select value={scope} onChange={(event) => { setScope(event.target.value as RandomScope); setMessage(""); }} className="mt-2 h-9 w-full rounded border border-line bg-base px-2 text-ink">
            <option value="all">全部地图电台</option>
            <option value="chinese">中文（含方言）</option>
            <option value="region" disabled={!current?.countryCode}>当前电台所在地区</option>
            <option value="favorites">我的收藏</option>
          </select>
        </label>
        {scope === "region" && <p className="mt-2 text-[11px] text-muted">{current?.province || current?.countryName || current?.countryCode}</p>}
        <button type="button" onClick={choose} className="mt-3 min-h-10 w-full rounded border border-signal/40 bg-signal-soft text-[12px] text-signal">随机点亮</button>
        <p role="status" className="mt-2 text-[11px] text-muted">{message || "避开刚听过的台，可在播放器返回上一站"}</p>
      </div>
    </details>
  );
}
