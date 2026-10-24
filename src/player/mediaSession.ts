import type { Station } from "../lib/types";
import type { EngineStatus } from "./engine";

/*
 * 锁屏 / 耳机线控 / 系统媒体面板。
 * 全部包在 try 里：不同浏览器支持的动作不一样，不支持不代表出错。
 */

export type MediaHandlers = {
  play: () => void;
  pause: () => void;
  next: () => void;
  previous: () => void;
  stop: () => void;
};

function available(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "mediaSession" in navigator &&
    typeof MediaMetadata !== "undefined"
  );
}

function artworkOf(station: Station): MediaImage[] {
  const src = station.favicon;
  if (!src || !/^https:\/\//i.test(src)) return [];
  return [{ src, sizes: "96x96" }];
}

function subtitleOf(station: Station): string {
  const parts = [station.countryName || station.countryCode, station.languages[0]].filter(Boolean);
  return parts.join(" · ") || "全球 FM";
}

export function syncMediaSession(station: Station | null, status: EngineStatus): void {
  if (!available()) return;

  try {
    if (!station) {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = "none";
      return;
    }

    navigator.mediaSession.metadata = new MediaMetadata({
      title: station.name,
      artist: subtitleOf(station),
      album: station.tags.slice(0, 2).join(" · ") || "FM Radio",
      artwork: artworkOf(station),
    });

    navigator.mediaSession.playbackState =
      status === "paused" ? "paused" : status === "idle" || status === "error" ? "none" : "playing";
  } catch {
    /* 元数据不合规时静默放弃，不影响播放 */
  }
}

export function bindMediaSession(handlers: MediaHandlers): void {
  if (!available()) return;

  const bind = (action: MediaSessionAction, fn: () => void) => {
    try {
      navigator.mediaSession.setActionHandler(action, fn);
    } catch {
      /* 该动作在当前浏览器不存在 */
    }
  };

  bind("play", handlers.play);
  bind("pause", handlers.pause);
  bind("nexttrack", handlers.next);
  bind("previoustrack", handlers.previous);
  bind("stop", handlers.stop);
}
