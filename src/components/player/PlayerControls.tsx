import {
  CopyLinkButton,
  FavoriteButton,
  MuteButton,
  NextButton,
  PlayToggle,
  PreviousButton,
  ShareButton,
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

/* 移动端：一行五个按钮，上一站/播放/下一站/收藏/静音都在 44px 以上。 */
export function MobileControls({
  station,
  status,
  playing,
  erroring,
  failedForAutoplay,
  onToggle,
  onNext,
}: Shared) {
  return (
    <div className="mt-1 flex items-center justify-between gap-1 sm:hidden">
      <PreviousButton />
      <PlayToggle playing={playing} erroring={erroring && !failedForAutoplay} status={status} onToggle={onToggle} />
      <NextButton onClick={onNext} />
      <FavoriteButton station={station} />
      <ShareButton station={station} />
      <MuteButton />
    </div>
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
