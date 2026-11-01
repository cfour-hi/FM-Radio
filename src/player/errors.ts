/*
 * 播放失败的种类。
 *
 * 界面需要知道的不只是「失败了」，还有「值不值得再试一次」：证书异常、
 * 编解码不支持这类，重试一百次也不会好，应该直接换台；网络抖动则可以
 * 再点一次。字符串文案会随措辞改动，所以分类另外用一份机器可读的枚举。
 */

export type EngineErrorKind =
  | "unsupported"
  | "network"
  | "decode"
  | "src-not-supported"
  | "aborted"
  | "connect-timeout"
  | "buffer-timeout"
  | "autoplay-blocked"
  | "hls-decoder"
  | "stream-ended"
  | "unknown";

export type EngineError = { message: string; kind: EngineErrorKind; hint?: string };

/** MediaError.code → 文案 + 分类 + 操作提示 */
export function describeMediaError(code: number | undefined): EngineError {
  switch (code) {
    case 1:
      return { 
        message: "加载被中断了", 
        kind: "aborted",
        hint: "可以重试，或看看同城有没有别的台"
      };
    case 2:
      return { 
        message: "网络中断，这个台此刻可能不可达", 
        kind: "network",
        hint: "检查网络连接，或试试别的台"
      };
    case 3:
      return { 
        message: "音频解码失败，可能是编码不受支持", 
        kind: "decode",
        hint: "这个台的格式可能不兼容，换个台试试"
      };
    case 4:
      return { 
        message: "地址不可用或格式不受支持", 
        kind: "src-not-supported",
        hint: "这个台可能已停播，看看同城还有其他台吗"
      };
    default:
      return { 
        message: "这个台暂时听不到", 
        kind: "unknown",
        hint: "重试或换个台"
      };
  }
}

/** 根据错误分类返回更详细的操作提示 */
export function getErrorHint(kind: EngineErrorKind, message?: string): string | null {
  switch (kind) {
    case "autoplay-blocked":
      return "浏览器需要你先点一下播放，才能出声";
    case "connect-timeout":
      return "连接超时，这个台可能已停止广播";
    case "buffer-timeout":
      return "缓冲卡住了，这个台暂时响应慢";
    case "stream-ended":
      return "直播流中断了，电台可能已停播";
    case "hls-decoder":
      return "HLS 解码器加载失败，网络可能不稳定";
    case "unsupported":
      return message ?? "这个台的格式不支持";
    case "network":
      return "网络问题，可以重试或换个台";
    case "decode":
    case "src-not-supported":
      return "格式问题，换个台试试";
    case "aborted":
    case "unknown":
    default:
      return "重试或换个台";
  }
}
