import { useMemo } from "react";
import { checkSupport } from "../../lib/capability";
import { pickAlternatives } from "../../lib/stationAlternatives";
import { getErrorHint } from "../../player/errors";
import { usePlayer } from "../../store/player";
import type { Station } from "../../lib/types";

/**
 * 错误态下显示替代电台推荐。
 * 展示 1-3 个同城/同省的电台，点击直接切换。
 */
export default function AlternativeStations({ station, queue }: { station: Station | null; queue: Station[] }) {
  const play = usePlayer((s) => s.play);
  const errorKind = usePlayer((s) => s.errorKind);
  const error = usePlayer((s) => s.error);

  if (!station) return null;

  const alternatives = useMemo(
    () => pickAlternatives(station, queue, (s) => checkSupport(s).ok && !s.sslError, 3),
    [station, queue],
  );

  if (alternatives.length === 0) {
    const hint = errorKind ? getErrorHint(errorKind, error ?? undefined) : null;
    if (hint) {
      return <p className="truncate text-[11px] text-dim">{hint}</p>;
    }
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] text-dim">试试这些：</span>
      {alternatives.map((alt) => (
        <button
          key={alt.id}
          type="button"
          onClick={() => play(alt, queue)}
          className="truncate rounded-[3px] bg-surface px-1.5 py-0.5 text-[11px] text-muted transition-colors hover:text-ink"
          title={alt.name}
        >
          {alt.name}
        </button>
      ))}
    </div>
  );
}
