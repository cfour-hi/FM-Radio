import type { Station } from "./types";

/*
 * 格式能力探测。
 *
 * 只拦「确定播不了」的，不拦「可能播不了」的：canPlayType 返回空串才是硬证据，
 * 返回 "maybe" 一律放行。宁可让用户试一次听到声音，也不要误拦一个能播的台。
 *
 * 特别说明 AAC+：Chrome 的 canPlayType('audio/aacp') 常年返回空串，但实际能播，
 * 所以这里刻意不对 AAC/AAC+ 做任何拦截。
 */

let oggSupport: boolean | null = null;

function canPlayOgg(): boolean {
  if (oggSupport !== null) return oggSupport;
  if (typeof document === "undefined") return true;
  try {
    const el = document.createElement("audio");
    oggSupport =
      el.canPlayType('audio/ogg; codecs="vorbis"') !== "" ||
      el.canPlayType("audio/ogg") !== "";
  } catch {
    oggSupport = true;
  }
  return oggSupport;
}

let nativeHls: boolean | null = null;

/** Safari/iOS 原生支持 m3u8，其它浏览器要靠 hls.js */
export function hasNativeHls(): boolean {
  if (nativeHls !== null) return nativeHls;
  if (typeof document === "undefined") return false;
  try {
    const el = document.createElement("audio");
    nativeHls =
      el.canPlayType("application/vnd.apple.mpegurl") !== "" ||
      el.canPlayType("application/x-mpegURL") !== "";
  } catch {
    nativeHls = false;
  }
  return nativeHls;
}

export type Support = { ok: true } | { ok: false; reason: string };

/** 判断这台在当前浏览器里值不值得尝试 */
export function checkSupport(station: Station): Support {
  const codec = station.codec.toUpperCase();
  if ((codec === "OGG" || codec === "OPUS" || codec === "VORBIS") && !canPlayOgg()) {
    return { ok: false, reason: "此浏览器不支持 OGG 音频" };
  }
  return { ok: true };
}

/**
 * 音量是否真的可调。
 *
 * iPhone / iPad 上 HTMLMediaElement.volume 是只读的装饰品：
 * 写得进去，读出来永远是 1，声音一点不变。与其摆一个拖不动的滑块，
 * 不如把整个控件藏掉——音量交给系统侧边键，那才是用户会去按的地方。
 */
let volumeWritable: boolean | null = null;

export function canSetVolume(): boolean {
  if (volumeWritable !== null) return volumeWritable;
  if (typeof document === "undefined") return false;
  try {
    const el = document.createElement("audio");
    el.volume = 0.5;
    volumeWritable = el.volume === 0.5;
  } catch {
    volumeWritable = false;
  }
  return volumeWritable;
}

/** 界面上的提示文案，用于「能播但可能有坑」的情况 */
export function cautionOf(station: Station): string | null {
  if (station.sslError) return "该台证书异常，可能连不上";
  return null;
}
