/*
 * 测试用的 hls.js 替身。
 *
 * 只实现 engine 实际用到的接口：构造、Events/ErrorTypes、on/emit、
 * loadSource/attachMedia/destroy。测试通过 instances 找到实例并手动
 * 触发 manifest，从而控制「解码器下载完成」这个时刻。
 */
export default class HlsStub {
  static Events = { MANIFEST_PARSED: "manifest-parsed", ERROR: "error" };
  static ErrorTypes = { NETWORK_ERROR: "network" };
  static instances = [];

  constructor() {
    this.handlers = new Map();
    this.destroyed = false;
    HlsStub.instances.push(this);
  }

  on(event, handler) {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
  }

  emit(event, data) {
    for (const handler of this.handlers.get(event) ?? []) handler(event, data);
  }

  loadSource() {}

  attachMedia(media) {
    this.media = media;
  }

  destroy() {
    this.destroyed = true;
  }
}
