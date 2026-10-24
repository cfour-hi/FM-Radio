type Props = {
  /** 当前视角中心与缩放，来自 WorldMap 的 onViewChange */
  view: { lat: number; lon: number; zoom: number } | null;
  /** 已加载的台数 */
  total: number;
};

/*
 * 地图 HUD：四角 L 形角标 + 底部经纬度读数。
 *
 * 不追求花哨的装饰粒子，只做「让这张图看起来像在测量什么」的仪表元素：
 * 四角角标圈出取景框，底部一行等宽数字实时读经纬度和缩放。
 * 全部 pointer-events-none，不挡任何交互。
 */
export default function Hud({ view, total }: Props) {
  return (
    <>
      {/* 四角 L 形角标 */}
      <div aria-hidden className="pointer-events-none absolute left-3 top-3 z-20 h-4 w-4 border-l border-t border-cold/50" />
      <div aria-hidden className="pointer-events-none absolute right-3 top-3 z-20 h-4 w-4 border-r border-t border-cold/50" />
      <div aria-hidden className="pointer-events-none absolute bottom-3 left-3 z-20 h-4 w-4 border-b border-l border-cold/50" />
      <div aria-hidden className="pointer-events-none absolute bottom-3 right-3 z-20 h-4 w-4 border-b border-r border-cold/50" />

      {/*
       * 读数移到顶部中央。
       *
       * 左下角现在是播放器、右下角是版权信息、底部中央留给移动端的贴底
       * 播放条——底部已经没有一块干净的地方放这行数字了。挪到顶部中央
       * 正好和左上的 logo、右上的按钮组成一条完整的仪表横带。
       *
       * 窄屏放不下（logo 和按钮已经占满顶部），索性隐掉：移动端也不靠
       * 经纬度读数判断什么。
       */}
      <div className="pointer-events-none absolute left-1/2 top-5 z-20 hidden -translate-x-1/2 sm:block">
        <p className="num whitespace-nowrap text-[10px] uppercase tracking-[0.16em] text-dim">
          {view ? (
            <>
              Lat {view.lat.toFixed(2)} · Lon {view.lon.toFixed(2)} · Z {view.zoom.toFixed(2)}
            </>
          ) : (
            "定位中…"
          )}
          {total > 0 && <span className="text-muted"> · {total} 台</span>}
        </p>
      </div>
    </>
  );
}
