import { regionLabel } from "../../lib/cnEnrichment";
import { CN_REGIONS } from "../../lib/cnRegions";
import { accuracyLabel } from "../../lib/nearbyStations";
import type { Where } from "../../lib/whereami";

type Props = {
  where: Where | null;
  locating: boolean;
  locationError: string | null;
  supportsGeolocation: boolean;
  /** 按距离算出的台数，只用于标题 */
  nearestCount: number;
  /** 手选地区的中文展示名 */
  nearbyLabel: string | null;
  onRequestLocation: () => void;
  onSelectProvince: (province: string) => void;
};

/*
 * 「附近」的说明与定位入口。
 *
 * 浏览器坐标仅参与本地距离计算；手选地区是独立的省内目录模式。
 */
export default function DrawerNearby({
  where,
  locating,
  locationError,
  supportsGeolocation,
  nearestCount,
  nearbyLabel,
  onRequestLocation,
  onSelectProvince,
}: Props) {
  return (
    <div className="border-b border-line px-4 py-3 text-[12px] text-muted">
      {where?.source === "browser" ? (
        <div className="mb-2">
          <p className="text-ink">已加载电台中距离最近的 {nearestCount} 个台</p>
          <p className="mt-1 text-[12px] text-dim">
            按直线距离排序 · 定位精度{accuracyLabel(where.accuracy)}
          </p>
        </div>
      ) : nearbyLabel && (
        <p className="mb-2">已选地区 · <span className="text-ink">{nearbyLabel}</span></p>
      )}
      {supportsGeolocation ? (
        <button
          type="button"
          onClick={onRequestLocation}
          disabled={locating}
          className="mb-3 rounded-[6px] border border-line px-3 py-1.5 text-ink transition-colors hover:bg-surface disabled:opacity-50"
        >
          {locating ? "正在获取位置…" : where?.source === "browser" ? "更新我的位置" : "用我的位置"}
        </button>
      ) : <p className="mb-2 text-[12px] text-dim">当前浏览器不支持定位，请手动选择地区。</p>}
      <label className="flex items-center gap-2">
        <span className="shrink-0">手动选择</span>
        <select
          aria-label="选择附近电台地区"
          value={where?.source === "manual" ? where.province : ""}
          onChange={(event) => onSelectProvince(event.target.value)}
          className="h-8 min-w-0 flex-1 rounded-[6px] border border-line bg-base px-2 text-ink"
        >
          <option value="" disabled>请选择省份或地区</option>
          {CN_REGIONS.map((region) => (
            <option key={region.name} value={region.name}>{regionLabel(region.name)}</option>
          ))}
        </select>
      </label>
      <p role="status" className="mt-2 text-[12px] text-dim">
        {locating ? "正在获取位置，也可以直接选择地区。" : locationError}
      </p>
    </div>
  );
}
