import { checkSupport } from "../lib/capability";
import type { Station } from "../lib/types";
import { engine, type EngineStatus } from "../player/engine";
import { bindMediaSession, syncMediaSession } from "../player/mediaSession";
import { create } from "zustand";

type PlayerState = {
  station: Station | null;
  status: EngineStatus;
  error: string | null;
  /** 从开始调谐算起的秒数快照，仅在状态变化和弱信号阈值更新；直播没有播放进度 */
  elapsed: number;
  volume: number;
  muted: boolean;
  /** 当前列表，决定「下一个台」是谁 */
  queue: Station[];

  play: (station: Station, queue?: Station[]) => void;
  toggle: () => void;
  pause: () => void;
  resume: () => void;
  next: (direction?: 1 | -1) => void;
  retry: () => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  stop: () => void;
};

const VOLUME_KEY = "fm-radio.volume";
const MUTE_KEY = "fm-radio.muted";
const LAST_STATION_KEY = "fm-radio.lastStation";

function readPref(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* 隐私模式下写不进去，不影响播放 */
  }
}

/** 读取上次收听的电台快照；隐私模式或数据损坏时返回 null */
export function readLastStation(): Station | null {
  try {
    const raw = localStorage.getItem(LAST_STATION_KEY);
    if (!raw) return null;
    const station = JSON.parse(raw) as Station;
    if (station && typeof station.id === "string" && typeof station.url === "string") {
      return station;
    }
    return null;
  } catch {
    return null;
  }
}

/** 把当前电台快照写入 localStorage，刷新后可恢复 */
function writeLastStation(station: Station): void {
  try {
    localStorage.setItem(LAST_STATION_KEY, JSON.stringify(station));
  } catch {
    /* 隐私模式下写不进去，不影响播放 */
  }
}

const initialVolume = Math.min(1, Math.max(0, readPref(VOLUME_KEY, 0.8)));
const initialMuted = readPref(MUTE_KEY, 0) === 1;

export const usePlayer = create<PlayerState>((set, get) => ({
  station: null,
  status: "idle",
  error: null,
  elapsed: 0,
  volume: initialVolume,
  muted: initialMuted,
  queue: [],

  play: (station, queue) => {
    const state = get();

    // 点的是正在播的那台：当作暂停/继续，而不是从头重连
    if (state.station?.id === station.id) {
      if (state.status === "playing" || state.status === "tuning" || state.status === "buffering") {
        get().pause();
        return;
      }
      if (state.status === "paused") {
        get().resume();
        return;
      }
    }

    const support = checkSupport(station);
    /*
     * 传进来的队列可能是空的（比如从收藏直链、分享链接直接开一个台），
     * 这时不能把原有队列清掉：否则「下一台」会在一个没有内容的队列里原地打转。
     */
    const given = queue && queue.length > 0 ? queue : null;
    const nextQueue =
      given ??
      (state.queue.some((s) => s.id === station.id) ? state.queue : [station, ...state.queue]);

    if (!support.ok) {
      set({ station, queue: nextQueue, status: "error", error: support.reason, elapsed: 0 });
      syncMediaSession(station, "error");
      return;
    }

    set({ station, queue: nextQueue, status: "tuning", error: null, elapsed: 0 });
    syncMediaSession(station, "tuning");
    writeLastStation(station);

    engine.setVolume(get().volume, get().muted);
    engine.load(station);
  },

  toggle: () => {
    const { status } = get();
    if (status === "playing" || status === "tuning" || status === "buffering") {
      get().pause();
      return;
    }
    if (status === "paused") {
      get().resume();
      return;
    }
    get().retry();
  },

  pause: () => {
    engine.pause();
  },

  resume: () => {
    const { station } = get();
    if (!station) return;
    engine.resume();
  },

  next: (direction = 1) => {
    const { queue, station } = get();
    if (queue.length === 0) return;

    const index = station ? queue.findIndex((s) => s.id === station.id) : -1;

    // 跳过当前浏览器播不了的台，避免「下一台」连着几次都不出声
    for (let step = 1; step <= queue.length; step++) {
      const raw = index + step * direction;
      const candidate = queue[((raw % queue.length) + queue.length) % queue.length];
      if (!candidate) continue;
      if (!checkSupport(candidate).ok) continue;
      get().play(candidate);
      return;
    }
  },

  retry: () => {
    const { station } = get();
    if (!station) return;
    const support = checkSupport(station);
    if (!support.ok) {
      set({ status: "error", error: support.reason });
      return;
    }
    set({ status: "tuning", error: null, elapsed: 0 });
    syncMediaSession(station, "tuning");
    engine.load(station);
  },

  setVolume: (volume) => {
    const clamped = Math.min(1, Math.max(0, volume));
    const muted = clamped === 0;
    set({ volume: clamped, muted });
    engine.setVolume(clamped, muted);
    writePref(VOLUME_KEY, String(clamped));
    writePref(MUTE_KEY, muted ? "1" : "0");
  },

  toggleMute: () => {
    const muted = !get().muted;
    set({ muted });
    engine.setVolume(get().volume, muted);
    writePref(MUTE_KEY, muted ? "1" : "0");
  },

  stop: () => {
    engine.stop();
    set({ station: null, status: "idle", error: null, elapsed: 0 });
    syncMediaSession(null, "idle");
  },
}));

// 引擎把状态推回 store，React 从 store 读——单向数据流，只有这一个方向
engine.hooks = {
  onStatus: (status, error) => {
    usePlayer.setState({ status, error });
    const station = usePlayer.getState().station;
    if (station) syncMediaSession(station, status);
  },
  onTick: (elapsed) => {
    usePlayer.setState({ elapsed });
  },
};

engine.setVolume(initialVolume, initialMuted);

bindMediaSession({
  play: () => usePlayer.getState().resume(),
  pause: () => usePlayer.getState().pause(),
  next: () => usePlayer.getState().next(1),
  previous: () => usePlayer.getState().next(-1),
  stop: () => usePlayer.getState().stop(),
});
