import type Hls from "hls.js";
import { isHlsStream, needsHlsJs, resolveStreamUrl } from "../lib/stream";
import type { Station } from "../lib/types";
import { describeMediaError, type EngineErrorKind } from "./errors";

/*
 * 播放引擎是全局单例，不归任何 React 组件所有。
 * 组件会挂载又卸载，声音不能跟着断。
 */

export type EngineStatus = "idle" | "tuning" | "playing" | "paused" | "buffering" | "error";

export type EngineHooks = {
  onStatus: (status: EngineStatus, error: string | null, kind: EngineErrorKind | null) => void;
  onTick: (elapsed: number) => void;
};

/** 连不上就早点认输，别让用户盯着空白等 */
const CONNECT_TIMEOUT = 8000;
const WEAK_SIGNAL_DELAY = 4000;
/** 已经出过声又卡住：8 秒给个「可以换台」的提示，15 秒认输 */
const BUFFER_HINT_DELAY = 8000;
const BUFFER_TIMEOUT = 15000;
/** 暂停超过这么久再继续，重新连接回到直播边缘，而不是从旧缓冲接着播 */
const STALE_RESUME_MS = 30_000;

class PlayerEngine {
  private audio: HTMLAudioElement | null = null;
  private hls: Hls | null = null;
  private connectTimer: number | null = null;
  private bufferTimer: number | null = null;
  private ticker: number | null = null;
  private startedAt = 0;
  /** 本次 buffering 从什么时候开始，给「已缓冲 N 秒」提示做基准 */
  private bufferingSince: number | null = null;
  private pausedAt: number | null = null;
  /**
   * 用户在加载期间按了暂停。
   *
   * hls.js 是动态 import 的，audio 元素要等它下载完才创建；这段时间里
   * pause() 找不到元素。把意图记下来，manifest 到达时先看它，别自顾自开播。
   */
  private pauseRequested = false;
  private status: EngineStatus = "idle";
  private volume = 1;
  private muted = false;
  /** 每次换台 +1，用来识别「加载 hls.js 期间用户又换了台」 */
  private loadToken = 0;
  /** 当前音源，HLS 退回时需要用它重新加载 */
  private station: Station | null = null;
  private usedHlsJs = false;
  private fallbackUsed = false;
  /** hls.js 解析到 manifest 之前，play() 没有意义 */
  private manifestReady = false;

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
    this.pauseRequested = false;
    this.manifestReady = false;
    // setStatus 进 tuning 时会挂上连接超时，这里不再单独 arm
    this.setStatus("tuning", null);

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
    const paused = this.pauseRequested;
    this.load(station, true);
    this.fallbackUsed = true; // load 会重置，这里要重新标上
    this.pauseRequested = paused; // 回退不能把用户按过的暂停抹掉
    return true;
  }

  resume(): void {
    this.pauseRequested = false;
    const pausedFor = this.pausedAt === null ? 0 : Date.now() - this.pausedAt;

    /*
     * 直播流暂停久了，元素里留着的是几十秒前的缓冲。直接 play() 会从那里
     * 接着播，用户听到的是「过去」；重新连接一次才能回到直播边缘。
     * audio 还不存在（hls.js 仍在下载）时也走这条路：重新装载最省事。
     */
    const hlsStillLoading = this.hls !== null && !this.manifestReady;
    if (this.station && (!this.audio || hlsStillLoading || pausedFor >= STALE_RESUME_MS)) {
      this.load(this.station);
      return;
    }

    const el = this.audio;
    if (!el) return;
    /*
     * 必须重置时间基准。
     *
     * elapsed 在暂停期间是冻结的（用 pausedAt 算），但 startedAt 还是最初
     * 装载的时刻。不重置的话「暂停十几秒再继续」会立刻满足「调谐超过 4 秒」，
     * 界面一恢复就显示弱信号，而且剩余时间算出来是负的，提示再也不会消失。
     */
    this.startedAt = Date.now();
    this.pausedAt = null;
    this.clearConnectTimer();
    this.clearBufferTimer();
    this.setStatus("tuning", null);
    void this.safePlay(el);
  }

  pause(): void {
    // 空闲时媒体会话也可能发 pause，没有台就别把状态改成「暂停」
    if (!this.station) return;
    this.clearConnectTimer();
    this.clearBufferTimer();
    this.pauseRequested = true;
    this.pausedAt = Date.now();
    // audio 可能还没创建（hls.js 正在下载）；状态先切到暂停，别让界面继续转圈
    this.audio?.pause();
    this.setStatus("paused", null);
  }

  stop(): void {
    ++this.loadToken; // 也取消尚在等待 hls.js 下载的加载请求
    this.disposeSource();
    this.station = null;
    this.pauseRequested = false;
    this.manifestReady = false;
    this.stopTicker();
    this.setStatus("idle", null);
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
      // 迟到的 playing 事件不能盖过用户刚按下的暂停
      if (this.pauseRequested) {
        el.pause();
        this.setStatus("paused", null);
        return;
      }
      this.clearConnectTimer();
      this.clearBufferTimer();
      this.pausedAt = null;
      this.setStatus("playing", null);
    });

    /*
     * stalled 与 waiting 一起听。
     *
     * 直播流卡住时浏览器不一定发 waiting（有的只发 stalled），只听一个有
     * 一半的台会永远停在 buffering 上——那正是用户最需要「换个台」的时刻。
     */
    const onStall = () => {
      if (!mine()) return;
      // 已经出声过的台卡住是「缓冲」，没出过声就是还在连
      this.setStatus(this.status === "playing" ? "buffering" : "tuning", null);
    };
    el.addEventListener("waiting", onStall);
    el.addEventListener("stalled", onStall);

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
      const described = describeMediaError(el.error?.code);
      this.setStatus("error", described.message, described.kind);
    });

    el.addEventListener("ended", () => {
      if (!mine()) return;
      this.setStatus("error", "这个台的流中断了", "stream-ended");
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
        this.setStatus("error", "浏览器拦截了自动播放 · 点播放键开始收听", "autoplay-blocked");
        return;
      }
      if (this.status !== "error") {
        this.setStatus("error", "这个台暂时连不上", "unknown");
      }
    }
  }

  private async loadViaHls(url: string, token: number): Promise<void> {
    let HlsLib: typeof Hls;
    try {
      // hls.js 只在需要时下载，不进主包
      HlsLib = (await import("hls.js")).default;
    } catch {
      if (token !== this.loadToken) return;
      this.setStatus("error", "HLS 解码器加载失败", "hls-decoder");
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
      this.manifestReady = true;
      // 下载解码器期间用户可能已经按了暂停，这时只把状态收好，不要出声
      if (this.pauseRequested) {
        this.setStatus("paused", null);
        return;
      }
      void this.safePlay(el);
    });

    hls.on(HlsLib.Events.ERROR, (_event, data) => {
      if (!mine() || !data.fatal) return;
      this.clearConnectTimer();
      const isNetwork = data.type === HlsLib.ErrorTypes.NETWORK_ERROR;
      this.setStatus(
        "error",
        isNetwork ? "HLS 流连不上，这个台可能已停止广播" : "HLS 流解析失败",
        isNetwork ? "network" : "decode",
      );
    });

    hls.loadSource(url);
    hls.attachMedia(el);
  }

  /**
   * 连不上就认输。
   *
   * 判据只有一个：8 秒之内没有收到 playing（status 还停在 tuning）。
   * 从前这里还有两条早退——`!el` 和 `readyState >= 3`——各自留了一个永久
   * 转圈的坑：HLS 分支下 audio 要到 import 完成才创建，慢网时 8 秒到了
   * 元素还不存在；有缓冲但播不动（后台标签、音频焦点被抢）时 readyState
   * 够了却永远不出声。两者都不该被当成「还在连」。
   */
  private armConnectTimer(): void {
    // 幂等：waiting 会反复把状态推回 tuning，不设防的话超时会被无限顺延
    if (this.connectTimer !== null) return;
    this.connectTimer = window.setTimeout(() => {
      this.connectTimer = null;
      if (this.status !== "tuning") return;
      if (this.tryHlsFallback()) return;
      this.setStatus("error", "连接超时，这个台可能已经停止广播", "connect-timeout");
    }, CONNECT_TIMEOUT);
  }

  private clearConnectTimer(): void {
    if (this.connectTimer === null) return;
    window.clearTimeout(this.connectTimer);
    this.connectTimer = null;
  }

  /** 播放中卡死也有个尽头：15 秒还不出声就判失败，让用户去看别的台 */
  private armBufferTimer(): void {
    if (this.bufferTimer !== null) return;
    this.bufferTimer = window.setTimeout(() => {
      this.bufferTimer = null;
      if (this.status !== "buffering") return;
      this.setStatus("error", "缓冲超时，这个台暂时卡住了", "buffer-timeout");
    }, BUFFER_TIMEOUT);
  }

  private clearBufferTimer(): void {
    if (this.bufferTimer === null) return;
    window.clearTimeout(this.bufferTimer);
    this.bufferTimer = null;
  }

  /**
   * 只排两个里程碑，不做持续计时：直播没有进度可播报。
   *   tuning    → 4 秒（信号弱，界面显示 WEAK SIGNAL）
   *   buffering → 8 秒（已缓冲这么久，可以换个台）
   */
  private scheduleStatusTick(): void {
    this.stopTicker();
    const at =
      this.status === "tuning"
        ? WEAK_SIGNAL_DELAY
        : this.status === "buffering"
          ? BUFFER_HINT_DELAY
          : -1;
    if (at < 0) return;

    const base = this.status === "buffering" ? (this.bufferingSince ?? Date.now()) : this.startedAt;
    const remaining = at - (Date.now() - base);
    if (remaining <= 0) return;
    this.ticker = window.setTimeout(() => {
      this.ticker = null;
      this.hooks?.onTick(Math.max(0, (Date.now() - base) / 1000));
    }, remaining);
  }

  private stopTicker(): void {
    if (this.ticker === null) return;
    window.clearTimeout(this.ticker);
    this.ticker = null;
  }

  private setStatus(
    status: EngineStatus,
    error: string | null = null,
    kind: EngineErrorKind | null = null,
  ): void {
    this.status = status;

    if (status === "tuning") this.armConnectTimer();
    if (status === "buffering") {
      this.bufferingSince ??= Date.now();
      this.armBufferTimer();
    } else {
      this.bufferingSince = null;
      this.clearBufferTimer();
    }

    if (status === "playing" || status === "paused" || status === "error" || status === "idle") {
      this.clearConnectTimer();
    }

    this.scheduleStatusTick();
    this.hooks?.onStatus(status, error, kind);
    this.hooks?.onTick(Math.max(0, ((this.pausedAt ?? Date.now()) - this.startedAt) / 1000));
  }

  /**
   * 彻底断开当前源。
   * 直接换一个 Audio 实例而不是复用旧的：旧实例的事件再也碰不到新状态，
   * 省掉一整套「这个事件是不是上一个台留下的」判断。
   */
  private disposeSource(): void {
    this.clearConnectTimer();
    this.clearBufferTimer();
    this.bufferingSince = null;

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
