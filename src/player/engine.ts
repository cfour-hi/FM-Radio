import type Hls from "hls.js";
import { isHlsStream, needsHlsJs, resolveStreamUrl } from "../lib/stream";
import type { Station } from "../lib/types";

/*
 * 播放引擎是全局单例，不归任何 React 组件所有。
 * 组件会挂载又卸载，声音不能跟着断。
 */

export type EngineStatus = "idle" | "tuning" | "playing" | "paused" | "buffering" | "error";

export type EngineHooks = {
  onStatus: (status: EngineStatus, error: string | null) => void;
  onTick: (elapsed: number) => void;
};

/** 连不上就早点认输，别让用户盯着空白等 */
const CONNECT_TIMEOUT = 8000;
const WEAK_SIGNAL_DELAY = 4000;

function describeMediaError(code: number | undefined): string {
  switch (code) {
    case 1:
      return "加载被中断了";
    case 2:
      return "网络中断，这个台此刻可能不可达";
    case 3:
      return "音频解码失败，可能是编码不受支持";
    case 4:
      return "地址不可用或格式不受支持";
    default:
      return "这个台暂时听不到";
  }
}

class PlayerEngine {
  private audio: HTMLAudioElement | null = null;
  private hls: Hls | null = null;
  private connectTimer: number | null = null;
  private ticker: number | null = null;
  private startedAt = 0;
  private pausedAt: number | null = null;
  private status: EngineStatus = "idle";
  private volume = 1;
  private muted = false;
  /** 每次换台 +1，用来识别「加载 hls.js 期间用户又换了台」 */
  private loadToken = 0;
  /** 当前音源，HLS 退回时需要用它重新加载 */
  private station: Station | null = null;
  private usedHlsJs = false;
  private fallbackUsed = false;

  hooks: EngineHooks | null = null;

  get currentStatus(): EngineStatus {
    return this.status;
  }

  /* ---------------- 对外 ---------------- */

  load(station: Station, forceHls = false): void {
    this.disposeSource();

    this.station = station;
    this.usedHlsJs = false;
    this.fallbackUsed = false;

    const token = ++this.loadToken;
    this.startedAt = Date.now();
    this.pausedAt = null;
    this.setStatus("tuning", null);
    this.armConnectTimer();

    const url = resolveStreamUrl(station.url);

    if (forceHls || needsHlsJs(station)) {
      void this.loadViaHls(url, token);
      return;
    }

    const el = this.createAudio();
    el.src = url;
    // 要在用户点击的同一条调用链里同步发起，否则 iOS 会拦
    void this.safePlay(el);
  }

  /**
   * 原生 HLS 有时会「声称支持但播不动」：Safari 对个别 fMP4 变体就是这样。
   * 这时不直接报错，先换成 hls.js 再试一次，只试一次，避免死循环。
   */
  private tryHlsFallback(): boolean {
    const station = this.station;
    if (!station || this.usedHlsJs || this.fallbackUsed) return false;
    if (!isHlsStream(station)) return false;

    this.fallbackUsed = true;
    this.load(station, true);
    this.fallbackUsed = true; // load 会重置，这里要重新标上
    return true;
  }

  resume(): void {
    const el = this.audio;
    if (!el) return;
    this.pausedAt = null;
    this.setStatus("tuning", null);
    this.armConnectTimer();
    void this.safePlay(el);
  }

  pause(): void {
    this.clearConnectTimer();
    if (!this.audio) return;
    this.audio.pause();
    this.pausedAt = Date.now();
    this.setStatus("paused", null);
  }

  stop(): void {
    this.disposeSource();
    this.station = null;
    this.stopTicker();
    this.status = "idle";
    this.hooks?.onStatus("idle", null);
  }

  setVolume(volume: number, muted: boolean): void {
    this.volume = volume;
    this.muted = muted;
    const el = this.audio;
    if (!el) return;
    el.volume = volume;
    el.muted = muted;
  }

  /* ---------------- 内部 ---------------- */

  private createAudio(): HTMLAudioElement {
    const el = new Audio();
    el.preload = "none";
    el.volume = this.volume;
    el.muted = this.muted;

    const mine = () => el === this.audio;

    el.addEventListener("playing", () => {
      if (!mine()) return;
      this.clearConnectTimer();
      this.pausedAt = null;
      this.setStatus("playing", null);
    });

    el.addEventListener("waiting", () => {
      if (!mine()) return;
      // 已经出声过的台卡住是「缓冲」，没出过声就是还在连
      this.setStatus(this.status === "playing" ? "buffering" : "tuning", null);
    });

    el.addEventListener("pause", () => {
      if (!mine()) return;
      if (this.status === "error") return;
      this.pausedAt ??= Date.now();
      this.setStatus("paused", null);
    });

    el.addEventListener("error", () => {
      if (!mine()) return;
      this.clearConnectTimer();
      if (this.tryHlsFallback()) return;
      this.setStatus("error", describeMediaError(el.error?.code));
    });

    el.addEventListener("ended", () => {
      if (!mine()) return;
      this.setStatus("error", "这个台的流中断了");
    });

    this.audio = el;
    return el;
  }

  private async safePlay(el: HTMLAudioElement): Promise<void> {
    try {
      await el.play();
    } catch (err) {
      if (el !== this.audio) return;
      const name = err instanceof Error ? err.name : "";
      if (name === "AbortError") return; // 换台导致的主动中断，不算错误
      if (name === "NotAllowedError") {
        this.setStatus("error", "浏览器拦截了自动播放，请再点一次播放键");
        return;
      }
      if (this.status !== "error") {
        this.setStatus("error", "这个台暂时连不上");
      }
    }
  }

  private async loadViaHls(url: string, token: number): Promise<void> {
    let HlsLib: typeof Hls;
    try {
      // hls.js 只在需要时下载，不进主包
      HlsLib = (await import("hls.js")).default;
    } catch {
      this.setStatus("error", "HLS 解码器加载失败");
      return;
    }

    // 等待期间用户可能已经换了台，此时这份结果作废
    if (token !== this.loadToken) return;
    this.usedHlsJs = true;

    const el = this.createAudio();
    const hls = new HlsLib({ enableWorker: true, lowLatencyMode: false });
    this.hls = hls;

    const mine = () => this.hls === hls;

    hls.on(HlsLib.Events.MANIFEST_PARSED, () => {
      if (!mine()) return;
      void this.safePlay(el);
    });

    hls.on(HlsLib.Events.ERROR, (_event, data) => {
      if (!mine() || !data.fatal) return;
      this.clearConnectTimer();
      const reason =
        data.type === HlsLib.ErrorTypes.NETWORK_ERROR
          ? "HLS 流连不上，这个台可能已停止广播"
          : "HLS 流解析失败";
      this.setStatus("error", reason);
    });

    hls.loadSource(url);
    hls.attachMedia(el);
  }

  private armConnectTimer(): void {
    this.clearConnectTimer();
    this.connectTimer = window.setTimeout(() => {
      const el = this.audio;
      if (!el) return;
      if (el.readyState >= 3) return;
      if (this.tryHlsFallback()) return;
      this.setStatus("error", "连接超时，这个台可能已经停止广播");
    }, CONNECT_TIMEOUT);
  }

  private clearConnectTimer(): void {
    if (this.connectTimer === null) return;
    window.clearTimeout(this.connectTimer);
    this.connectTimer = null;
  }

  private scheduleStatusTick(): void {
    this.stopTicker();
    // 界面只关心调谐满 4 秒这一刻，不需要持续广播播放时长。
    if (this.status !== "tuning") return;
    const remaining = WEAK_SIGNAL_DELAY - (Date.now() - this.startedAt);
    if (remaining <= 0) return;
    this.ticker = window.setTimeout(() => {
      this.ticker = null;
      this.hooks?.onTick(Math.max(0, (Date.now() - this.startedAt) / 1000));
    }, remaining);
  }

  private stopTicker(): void {
    if (this.ticker === null) return;
    window.clearTimeout(this.ticker);
    this.ticker = null;
  }

  private setStatus(status: EngineStatus, error: string | null): void {
    this.status = status;
    this.scheduleStatusTick();
    if (status === "playing" || status === "paused" || status === "error") this.clearConnectTimer();
    this.hooks?.onStatus(status, error);
    this.hooks?.onTick(Math.max(0, ((this.pausedAt ?? Date.now()) - this.startedAt) / 1000));
  }

  /**
   * 彻底断开当前源。
   * 直接换一个 Audio 实例而不是复用旧的：旧实例的事件再也碰不到新状态，
   * 省掉一整套「这个事件是不是上一个台留下的」判断。
   */
  private disposeSource(): void {
    this.clearConnectTimer();

    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }

    const el = this.audio;
    if (el) {
      this.audio = null; // 先摘掉引用，旧元素的事件处理器会自行失效
      el.pause();
      el.removeAttribute("src");
      try {
        el.load();
      } catch {
        /* 某些浏览器在空 src 上会抛，忽略即可 */
      }
    }
  }
}

export const engine = new PlayerEngine();

export type { PlayerEngine };
