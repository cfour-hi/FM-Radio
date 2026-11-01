import { checkSupport } from "../lib/capability";
import { pickAlternatives } from "../lib/stationAlternatives";
import type { Station } from "../lib/types";
import { engine, type EngineStatus } from "../player/engine";
import type { EngineErrorKind } from "../player/errors";
import { bindMediaSession, syncMediaSession } from "../player/mediaSession";
import { create } from "zustand";

type PlayerState = {
  station: Station | null;
  status: EngineStatus;
  error: string | null;
  /** 失败的机器可读分类：界面据此决定该「再试一次」还是「换个台」 */
  errorKind: EngineErrorKind | null;
  /** 从开始调谐算起的秒数快照，仅在状态变化和弱信号阈值更新；直播没有播放进度 */
  elapsed: number;
  volume: number;
  muted: boolean;
  /** 当前列表，决定「下一个台」是谁 */
  queue: Station[];

  history: { station: Station; queue: Station[] }[];
  previous: () => Station | null;
  sleepUntil: number | null;
  sleepExpired: boolean;
  setSleep: (minutes: number | null) => void;
  expireSleep: () => void;
  play: (station: Station, queue?: Station[], remember?: boolean) => void;
  toggle: () => void;
  pause: () => void;
  resume: () => void;
  /** 返回是否真的切到了另一个台 */
  next: (direction?: 1 | -1) => boolean;
  retry: () => void;
  /** 当前台播不了时，换一个同城/同国的台 */
  errorAlternative: () => void;
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

const SLEEP_KEY = "fm-radio.sleepUntil";
function readSleep(): number | null {
  try {
    const raw = sessionStorage.getItem(SLEEP_KEY);
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : null;
  } catch { return null; }
}
function writeSleep(value: number | null) {
  try {
    if (value === null) sessionStorage.removeItem(SLEEP_KEY);
    else sessionStorage.setItem(SLEEP_KEY, String(value));
  } catch { /* 本次会话仍可定时 */ }
}
const savedSleep = readSleep();
const initialVolume = Math.min(1, Math.max(0, readPref(VOLUME_KEY, 0.8)));
const initialMuted = readPref(MUTE_KEY, 0) === 1;

export const usePlayer = create<PlayerState>((set, get) => ({
  station: null,
  status: "idle",
  error: null,
  errorKind: null,
  elapsed: 0,
  volume: initialVolume,
  muted: initialMuted,
  queue: [],
  history: [],
  sleepUntil: savedSleep !== null && savedSleep > Date.now() ? savedSleep : null,
  sleepExpired: savedSleep !== null && savedSleep <= Date.now(),
  setSleep: (minutes) => {
    if (minutes !== null && ![15, 30, 60].includes(minutes)) return;
    const sleepUntil = minutes === null ? null : Date.now() + minutes * 60_000;
    writeSleep(sleepUntil);
    set({ sleepUntil, sleepExpired: false });
  },
  expireSleep: () => {
    writeSleep(0);
    set({ sleepUntil: null, sleepExpired: true });
    // 停止并释放连接，防止尚在加载的 HLS 异步回调在到期后开始播放。
    engine.stop();
    set({ status: "paused", error: null, errorKind: null, elapsed: 0 });
    syncMediaSession(get().station, "paused");
  },
  previous: () => {
    const history = get().history.slice();
    const entry = history.pop();
    if (!entry) return null;
    set({ history });
    get().play(entry.station, entry.queue, false);
    return entry.station;
  },

  play: (station, queue, remember = true) => {
    const state = get();
    if (state.sleepExpired) { writeSleep(null); set({ sleepExpired: false }); }
    if (remember && state.station && state.station.id !== station.id) {
      set({ history: [...state.history, { station: state.station, queue: state.queue }].slice(-50) });
    }

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
      set({
        station,
        queue: nextQueue,
        status: "error",
        error: support.reason,
        errorKind: "unsupported",
        elapsed: 0,
      });
      syncMediaSession(station, "error");
      return;
    }

    set({ station, queue: nextQueue, status: "tuning", error: null, errorKind: null, elapsed: 0 });
    syncMediaSession(station, "tuning");

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
    if (get().sleepExpired || engine.currentStatus === "idle") { get().retry(); return; }
    engine.resume();
  },

  next: (direction = 1) => {
    const { queue, station } = get();
    if (queue.length === 0) return false;

    const index = station ? queue.findIndex((s) => s.id === station.id) : -1;

    // 跳过当前浏览器播不了的台，避免「下一台」连着几次都不出声
    for (let step = 1; step <= queue.length; step++) {
      const raw = index + step * direction;
      const candidate = queue[((raw % queue.length) + queue.length) % queue.length];
      if (!candidate) continue;
      // 只有一台时绕一圈会回到自己，那不是「下一台」
      if (candidate.id === station?.id) continue;
      if (!checkSupport(candidate).ok) continue;
      get().play(candidate);
      return true;
    }
    return false;
  },

  retry: () => {
    const { station } = get();
    if (!station) return;
    if (get().sleepExpired) { writeSleep(null); set({ sleepExpired: false }); }
    const support = checkSupport(station);
    if (!support.ok) {
      set({ status: "error", error: support.reason, errorKind: "unsupported" });
      return;
    }
    set({ status: "tuning", error: null, errorKind: null, elapsed: 0 });
    syncMediaSession(station, "tuning");
    engine.load(station);
  },

  errorAlternative: () => {
    const { station, queue } = get();
    if (!station) return;
    const [pick] = pickAlternatives(station, queue, (s) => checkSupport(s).ok && !s.sslError, 1);
    // 没有替代时按钮根本不会显示，这里静默返回即可
    if (pick) get().play(pick);
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
    get().setSleep(null);
    engine.stop();
    set({ station: null, status: "idle", error: null, errorKind: null, elapsed: 0 });
    syncMediaSession(null, "idle");
  },
}));

// 引擎把状态推回 store，React 从 store 读——单向数据流，只有这一个方向
engine.hooks = {
  onStatus: (status, error, kind) => {
    usePlayer.setState({ status, error, errorKind: kind });
    const station = usePlayer.getState().station;
    if (!station) return;
    syncMediaSession(station, status);
    /*
     * 真正出声之后才记「上次收听」。
     *
     * 从前是在 play() 里写的，那时还不能确定这个台能不能播：分享链接指向一个
     * 已经停播的台，也会被写进去，下次刷新就默认恢复一个坏台。
     */
    if (status === "playing") writeLastStation(station);
  },
  onTick: (elapsed) => {
    usePlayer.setState({ elapsed });
  },
};

engine.setVolume(initialVolume, initialMuted);

/*
 * 开发期调试钩子。端到端测试要验证「连接超时」「缓冲超时」这类只在真机上
 * 才自然发生的路径，靠真实网络等 8 秒不稳；把引擎实例挂出来就能直接读
 * 内部 timer 与状态机。和 __map / __player 一样只在开发期存在。
 */
if (import.meta.env?.DEV) {
  (window as unknown as { __engine?: unknown }).__engine = engine;
}

bindMediaSession({
  play: () => usePlayer.getState().resume(),
  pause: () => usePlayer.getState().pause(),
  next: () => usePlayer.getState().next(1),
  previous: () => usePlayer.getState().previous(),
  stop: () => usePlayer.getState().stop(),
});
