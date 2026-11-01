import { Suspense, lazy, useCallback } from "react";
import type { Station } from "../lib/types";
import { usePlayer } from "../store/player";
import { useFxStore } from "../store/fx";

/*
 * 粒子特效场景的挂载壳。
 *
 * MapPage 只认它一个：fxId 对应哪个特效、电台点开关怎么生效，都收在
 * 这里。点击命中由各特效自己处理——点表和屏幕坐标都在特效手里，
 * 拿到 sid 列表再交回来走统一的播放链路。
 *
 * 后续加新特效时：加一个组件文件、在下面的 dispatch 里添一行即可。
 */
const GalaxyScene = lazy(() => import("./GalaxyFx"));
const TunnelScene = lazy(() => import("./TunnelFx"));
const AuroraScene = lazy(() => import("./AuroraFx"));

type Props = {
  stations: Station[];
  /** 点击命中后交给 MapPage，与地图 onSelect 走同一条播放链路 */
  onSelect: (station: Station) => void;
  /** 同一处叠了多个台：交给抽屉列「这一带 N 个台」 */
  onMultiSelect: (stations: Station[]) => void;
};

export default function FxScene({ stations, onSelect, onMultiSelect }: Props) {
  const fxId = useFxStore((s) => s.fxId);
  const showStations = useFxStore((s) => s.showStations);
  // 正在播的台：各特效用它画脉冲标记，语义同地图的 highlightId
  const liveId = usePlayer((s) => s.station?.id ?? null);

  const handlePick = useCallback(
    (picked: Station[]) => {
      if (picked.length === 0) return;
      if (picked.length === 1) {
        onSelect(picked[0]!);
        return;
      }
      // 去重：同城推断台可能共用一个坐标，同一台不该被列两次
      const seen = new Set<string>();
      const unique = picked.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
      if (unique.length === 1) onSelect(unique[0]!);
      else onMultiSelect(unique);
    },
    [onSelect, onMultiSelect],
  );

  return (
    <div
      className="absolute inset-0"
      // 纯氛围模式下整层穿透：不响应点击，光标也不再暗示可点
      style={showStations ? undefined : { pointerEvents: "none" }}
    >
      {fxId === "galaxy" && (
        <Suspense fallback={null}>
          <GalaxyScene
            stations={stations}
            liveId={liveId}
            showStations={showStations}
            onPickStations={handlePick}
          />
        </Suspense>
      )}
      {fxId === "tunnel" && (
        <Suspense fallback={null}>
          <TunnelScene
            stations={stations}
            liveId={liveId}
            showStations={showStations}
            onPickStations={handlePick}
          />
        </Suspense>
      )}
      {fxId === "aurora" && (
        <Suspense fallback={null}>
          <AuroraScene
            stations={stations}
            liveId={liveId}
            showStations={showStations}
            onPickStations={handlePick}
          />
        </Suspense>
      )}
    </div>
  );
}
