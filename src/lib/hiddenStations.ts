import type { EngineErrorKind } from "../player/errors";
import type { Station } from "./types";

/**
 * 本地隐藏的坏台。
 *
 * 硬失败（连接超时、解码失败、流结束、格式不支持）7 天内累计两次就自动
 * 隐藏；网络抖动和「未知错误」只记录在本次播放里，不写进来，避免把慢网
 * 误判成死台。隐藏只影响推荐、随机和自动换台，收藏与最近仍然照常显示。
 */

const KEY = "fm-radio.hidden.v1";
const LIMIT = 200;
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const AUTO_HIDE_AFTER = 2;

export type HiddenReason = EngineErrorKind | "manual";

export type HiddenEntry = {
  id: string;
  name: string;
  /** 最近一次失败 / 隐藏的时间 */
  at: number;
  /** 窗口内的硬失败次数 */
  count: number;
  reason: HiddenReason;
};

type Record_ = HiddenEntry & { hidden: boolean };

type Stored = { v: 1; records: Record_[] };

const HARD_FAILURES: ReadonlySet<EngineErrorKind> = new Set([
  "connect-timeout",
  "decode",
  "stream-ended",
  "src-not-supported",
]);

export function isHardFailure(kind: EngineErrorKind): boolean {
  return HARD_FAILURES.has(kind);
}

function isRecord(value: unknown): value is Record_ {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<Record_>;
  return (
    typeof row.id === "string" &&
    typeof row.name === "string" &&
    typeof row.at === "number" &&
    typeof row.count === "number" &&
    typeof row.reason === "string" &&
    typeof row.hidden === "boolean"
  );
}

function readRecords(): Record_[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const snapshot = JSON.parse(raw) as Partial<Stored>;
    if (!Array.isArray(snapshot.records)) return [];
    return snapshot.records.filter(isRecord);
  } catch {
    return [];
  }
}

function writeRecords(records: Record_[]): boolean {
  try {
    const trimmed = records
      .slice()
      .sort((a, b) => b.at - a.at)
      .slice(0, LIMIT);
    localStorage.setItem(KEY, JSON.stringify({ v: 1, records: trimmed }));
    return true;
  } catch {
    // 隐私模式或容量已满：本次会话仍按内存状态提示，刷新后失效
    return false;
  }
}

/** 当前所有被隐藏的台，按最近一次失败时间倒序。 */
export function readHidden(): HiddenEntry[] {
  return readRecords()
    .filter((record) => record.hidden)
    .map(({ hidden: _hidden, ...entry }) => entry);
}

export function hiddenIdSet(): Set<string> {
  return new Set(readHidden().map((entry) => entry.id));
}

export function isHidden(id: string): boolean {
  return readRecords().some((record) => record.id === id && record.hidden);
}

/** 手动隐藏；已经隐藏的台只更新原因和时间。 */
export function hide(station: Station, reason: HiddenReason = "manual", now = Date.now()): HiddenEntry[] {
  const records = readRecords();
  const existing = records.find((record) => record.id === station.id);
  if (existing) {
    existing.hidden = true;
    existing.at = now;
    existing.reason = reason;
    existing.name = station.name;
    existing.count = Math.max(1, existing.count);
  } else {
    records.push({ id: station.id, name: station.name, at: now, count: 1, reason, hidden: true });
  }
  writeRecords(records);
  return readHidden();
}

/**
 * 记录一次失败。只有硬失败会累计，并在窗口内达到两次时自动隐藏。
 * 返回「这次之后是否处于隐藏状态」。
 */
export function recordFailure(
  station: Station,
  kind: EngineErrorKind,
  now = Date.now(),
): boolean {
  if (!isHardFailure(kind)) return isHidden(station.id);

  const records = readRecords();
  let record = records.find((item) => item.id === station.id);

  if (record?.hidden) return true;

  if (!record) {
    record = { id: station.id, name: station.name, at: now, count: 0, reason: kind, hidden: false };
    records.push(record);
  }

  const withinWindow = now - record.at <= WINDOW_MS;
  record.count = withinWindow ? record.count + 1 : 1;
  record.at = now;
  record.reason = kind;
  record.name = station.name;

  if (record.count >= AUTO_HIDE_AFTER) record.hidden = true;

  writeRecords(records);
  return record.hidden;
}

/** 隐藏台连续播放成功、或用户手动恢复时移除记录。 */
export function unhide(id: string): HiddenEntry[] {
  writeRecords(readRecords().filter((record) => record.id !== id));
  return readHidden();
}

export function unhideAll(): HiddenEntry[] {
  writeRecords([]);
  return [];
}
