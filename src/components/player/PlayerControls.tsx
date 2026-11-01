import {
  CopyLinkButton,
  FavoriteButton,
  MuteButton,
  NextButton,
  PlayToggle,
  PreviousButton,
  VolumeSlider,
} from "./PlayerButtons";
import type { EngineStatus } from "../../player/engine";
import type { Station } from "../../lib/types";

type Shared = {
  station: Station;
  status: EngineStatus;
  playing: boolean;
  erroring: boolean;
  failedForAutoplay: boolean;
  onToggle: () => void;
  onNext: () => void;
};

type MobileProps = Shared & {
  hasPrevious: boolean;
  onPrevious: () => void;
};

/* 移动端：紧凑控制行 + 单手快捷操作栏。 */
export function MobileControls({
  station,
  status,
  playing,
  erroring,
  failedForAutoplay,
  hasPrevious,
  onToggle,
  onNext,
  onPrevious,
}: MobileProps) {
  return (
    <>
      <div className="mt-1 flex items-center justify-between gap-1 sm:hidden">
        <PreviousButton />
        <PlayToggle playing={playing} erroring={erroring && !failedForAutoplay} status={status} onToggle={onToggle} />
        <NextButton onClick={onNext} />
        <FavoriteButton station={station} />
        <MuteButton />
      </div>

      <div className="mt-2 flex items-center justify-center gap-3 border-t border-line/50 pt-2 pb-1 sm:hidden">
        <button
          type="button"
          onClick={onPrevious}
          disabled={!hasPrevious}
          aria-label="上一台"
          className="flex h-12 w-12 items-center justify-center rounded-full bg-surface text-muted transition-colors disabled:opacity-30 active:scale-95"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
            <path d="m10 5-7 7 7 7M3 12h12a5 5 0 0 1 0 10" />
          </svg>
        </button>
        <button
          type="button"
          onClick={onToggle}
          aria-label={playing ? "暂停" : "播放"}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-signal text-base transition-transform active:scale-95"
        >
          {status === "tuning" || status === "buffering" ? (
            <span className="tuning-ring" aria-hidden />
          ) : playing ? (
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
              <rect x="7" y="5" width="3.2" height="14" rx="1" />
              <rect x="13.8" y="5" width="3.2" height="14" rx="1" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="h-4 w-4 ml-0.5" fill="currentColor" aria-hidden>
              <path d="M8 5.5v13l11-6.5z" />
            </svg>
          )}
        </button>
        <button
          type="button"
          onClick={onNext}
          aria-label="下一台"
          className="flex h-12 w-12 items-center justify-center rounded-full bg-surface text-muted transition-colors active:scale-95"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
            <path d="M15 5.5h2v13h-2zM6 5.5v13l9-6.5z" />
          </svg>
        </button>
      </div>
    </>
  );
}

/* 桌面端：独立控制行，挂音量滑块。 */
export function DesktopControls({
  station,
  status,
  playing,
  erroring,
  failedForAutoplay,
  onToggle,
  onNext,
}: Shared) {
  return (
    <div className="hidden flex-wrap items-center justify-between gap-1 border-t border-line/70 px-3.5 py-2 sm:flex">
      <PreviousButton />
      <PlayToggle playing={playing} erroring={erroring && !failedForAutoplay} status={status} onToggle={onToggle} />
      <NextButton onClick={onNext} />
      <FavoriteButton station={station} />
      <CopyLinkButton station={station} />
      <MuteButton />
      <VolumeSlider />
    </div>
  );
}
