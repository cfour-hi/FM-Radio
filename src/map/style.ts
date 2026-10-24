import type { StyleSpecification } from "maplibre-gl";

/*
 * 地图样式：一张只有陆地的世界。
 *
 * 这里刻意不接任何在线底图瓦片。此前用的是天地图 vec + ibo + cva 三层叠加，
 * 靠把不透明度压到 0.1 换来「夜航」观感，但有个绕不过去的问题——vec 是渲染好的
 * 栅格瓦片，陆地、海岸、国界、省界、道路全烘焙在同一张 PNG 里，没有任何参数
 * 能把省界单独关掉。ibo（纯界线层）倒是能整层删，可剩下的那层依然带着界线。
 *
 * 于是换掉底图本身：陆地来自 Natural Earth 1:110m land，一份只有 featurecla=Land
 * 的多边形数据，属性里不含任何行政区划。用它画一层无描边的色块，地图上就只剩下
 * 「陆地」和「海洋」，一条界线都不会有——不是因为把线调透明了，而是因为数据里
 * 根本没有线。
 *
 * 代价是放大到城市级之后没有道路、没有地名、没有海岸细节。这是有意的取舍：
 * 这张图不当地图用，它是「世界上哪些地方有人在听」的一张分布图。放大之后的
 * 定位交给电台点自己和它们的名字，不再交给行政底图。
 */

/** 各层的海拔（颜色）集中在这里，改配色只动这一处 */
const INK = {
  /**
   * 海洋。
   *
   * 换成整屏之后这一层的含义变了：它不再只是「地图面板的底」，而是球体
   * 本身——MapLibre 的 background 在 globe 下只画在球面上，球外面那片
   * 太空是 sky，两者是分开的。所以这里的颜色要和太空拉开距离，球才是一颗球。
   *
   * 用了一点冷调：#0c0e13 时球面和 #06080d 的太空只差六个灰阶，
   * 整屏看过去就是「一团浮在黑色里的光点」；提到 #0a1019 之后，
   * 球的边缘自己就出来了，大气辉光只需要负责把轮廓收干净。
   */
  sea: "#0a1019",
  /**
   * 陆地：比海洋再亮一档，但偏暖。
   *
   * 这个差值不好拿捏——太亮了会变成「一块陆地色块」，抢掉粒子的主体地位；
   * 太暗了球体就失去体积。现在的差值刚好够在球面形成微弱的块面，
   * 又不至于让人第一眼看到的是色块而不是点位。
   */
  land: "#1a1710",
  /**
   * 放大后的陆地。
   *
   * 不放亮，改放「暖」。全球视角下陆地对海洋只是亮一点点，到了城市尺度
   * 陆地占满整屏，靠亮度差会变成一张米色底图；靠冷暖差则仍然是暗面——
   * 蓝通道压到 12 之后，海是冷黑、陆是暖褐，边界一眼能看出，画面不飘。
   */
  landDeep: "#16130c",
  /**
   * 大陆粒子：暖金。
   *
   * 比原先的 #c99a5e 再亮一档。粒子是球面发光的「源」，网格（经纬线）和
   * 蜂窝贴图都是它的底。这三层里只有粒子允许暖到接近电台点——因为它
   * 正是「地面上有人」的暗示，但峰值仍压在图内电台暖点之下。
   */
  dot: "#d6a363",
} as const;

export type StationFeature = {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: {
    sid: string;
    clicks: number;
    /** 标签文字；已按 20 字截断 */
    name: string;
    /** 省 / 州，可能为空串 */
    state: string;
    /** 0 = 真实坐标，1 = 从台名推断的坐标 */
    approx: number;
  };
};

export type StationGeoJson = {
  type: "FeatureCollection";
  features: StationFeature[];
};

/**
 * 空壳 source。
 *
 * 图层先在样式里占住位置，数据回来之后 setData 填进去。反过来做——等数据到了
 * 再 addLayer——就得指定 beforeId 插队，还得处理「地图已经销毁」的竞态；
 * 而且加载失败时图层干脆不存在，样式表里看不出来。
 */
export const EMPTY_DOTS = { type: "FeatureCollection" as const, features: [] };
export const EMPTY_LAND = { type: "FeatureCollection" as const, features: [] };

/**
 * 字形文件。
 *
 * 数字和拉丁字母（英文台名、拉丁字母地名）在 PBF 的 0–255 区间里，
 * 整个地图只依赖这一个文件；它放在 public/ 里自己托管，不把「地图上的文字」
 * 寄托在别人的演示服务器上。目录名必须和 text-font 里的字体名一致。
 *
 * 中文字符不在这里——它走 MapLibre 的 localIdeographFontFamily，用系统字体
 * 现画。中文子集化字动辄几十 MB，为几个台名付这个代价不值。
 */
const GLYPHS = `${import.meta.env.BASE_URL}fonts/{fontstack}/{range}.pbf`;
const FONT = "FMRadio";

/**
 * 当前投影。
 *
 * 两套点阵都已生成，改这一行就能在球体与平面之间切换：
 * globe 配 land-dots-globe.json（球面采样），mercator 配 land-dots.json（墨卡托网格）。
 * 陆地面这一层两种投影通用，不需要另做一份。
 */
export const PROJECTION: "globe" | "mercator" = "globe";

/** 大陆粒子点阵的 source（数据在加载完成后 setData 填进去） */
const SOURCE_DOTS = "land-dots";
/** 陆地多边形的 source */
const SOURCE_LAND = "land";
/** 陆地微观纹理（D 方案）的 pattern 名，WorldMap 用 addImage 注册它 */
export const LAND_PATTERN_NAME = "land-pattern";

/*
 * 陆地微观纹理（D 方案）：一张无缝菱形网格贴图，贴到陆地面内部。
 *
 * 这是小尺度的坐标格纹理，45° 斜线交叉成菱形、交点留一颗冷色小点，
 * 让陆地不再是整块纯色。球面已经不再有经纬线（那层大尺度的测量线
 * 已被移除），陆地的质感由这一张图案和冷暖粒子共同承担。
 *
 * 图案本身不在这里生成——SVG data URI 经 map.loadImage 加载会失败（SVG
 * 走 createImageBitmap 路径不可靠），改由 WorldMap 用 canvas 现画一张
 * 32×32 的位图再 addImage，像素可控、加载零请求。这里只约定名字。
 */

export function buildStyle(data: StationGeoJson): StyleSpecification {
  return {
    version: 8,
    name: "FM Radio World",
    glyphs: GLYPHS,
    projection: { type: PROJECTION },
    sources: {
      [SOURCE_LAND]: {
        type: "geojson",
        data: EMPTY_LAND,
      },
      [SOURCE_DOTS]: {
        type: "geojson",
        data: EMPTY_DOTS,
      },
      stations: {
        type: "geojson",
        data,
      },
    },
    layers: [
      {
        id: "bg",
        type: "background",
        paint: { "background-color": INK.sea },
      },
      /*
       * 陆地面：全球视角下整张地图唯一的「地理」。
       *
       * 不画 stroke。描边出来就是海岸线，而海岸线恰恰是用户要求去掉的那类
       * 「轮廓线」——色块与海洋的边界已经足够说明陆地到哪里为止，不需要再勾一道。
       *
       * 放大之后不归零。
       *
       * 这条是实测改的：原先它和粒子一起在 z4.4 退场，那时中国只有 7 个点，
       * 放大后黑屏也无所谓。现在中国有 260 个点铺在几十个城市里，z5–6 全是
       * 纯黑背景上飘着的橙点，完全看不出这是广东还是四川——点位越密，
       * 越需要一层能认出海岸线的暗面托底。
       *
      * 但只是「不归零」，不是「提亮」。
       *
       * 试过在 z6 把陆地提到不透明，整块华南立刻变成一片卡其色底图，
       * 粒子和点位全被压下去，和前面「只要暗面、不要色块」的约定正好相反。
       *
       * 现在的做法是放大后换一个更暖、更暗的色值：亮度几乎不变，
       * 但蓝通道压低，和冷色的海洋拉开色相差。海岸线靠冷暖差读出来，
       * 画面整体仍然是一块暗褐，不会变成米色地图。
       */
      {
        id: LAYER.land,
        type: "fill",
        source: SOURCE_LAND,
        paint: {
          "fill-color": ["interpolate", ["linear"], ["zoom"], 0, INK.land, 4.6, INK.land, 6.2, INK.landDeep],
          /*
           * 峰值只给 0.55，不是 1。
           *
           * 满不透明的陆地在 z3–4 会变成一大片沙色，而这个区间粒子刚好
           * 退到看不见，画面就只剩色块，质感全丢。压到半透明之后
           * 它退回「一层托底的暗面」，亮度差仍然够撑起球体，又不会盖过粒子。
           */
          "fill-opacity": ["interpolate", ["linear"], ["zoom"], 0, 0.55, 3.2, 0.55, 6.5, 0.92],
          /*
           * 陆地微观纹理（D 方案）：菱形网格平铺在陆地面内部。
           *
           * pattern 压在 fill-color 之上，斜线/交点的透明处透出下方的陆地色，
           * 所以它只是给纯色陆面加一层坐标格质感，不会盖掉暖色粒子。
           * 透明度跟着 fill-opacity 走——放大后陆面变亮，纹理也一起变清楚，
           * 不需要单独再退场。
           */
          "fill-pattern": LAND_PATTERN_NAME,
        },
      },
      /*
       * 粒子光晕（C 方案）。
       *
       * 粒子的实心内芯只有 1px 上下，全球视角下它是一层「薄雾」而不是
       * 「发光颗粒」。这一层垫在内芯下面：同一个 source、同一批点，只是
       * 半径放大、circle-blur 到 0.8，让每颗粒子周围漫出一圈暖色光晕。
       * 内芯是「点」，光晕是「它在发亮」——两层叠起来才是发光颗粒感。
       */
      {
        id: "land-dots-glow",
        type: "circle",
        source: SOURCE_DOTS,
        maxzoom: 5,
        paint: {
          "circle-color": INK.dot,
          "circle-blur": 0.8,
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 0, 2.4, 2, 2.8, 4, 3.4],
          "circle-opacity": ["interpolate", ["linear"], ["zoom"], 0, 0.16, 3, 0.13, 3.8, 0.05, 4.6, 0],
        },
      },
      {
        id: LAYER.landDots,
        type: "circle",
        source: SOURCE_DOTS,
        // 到城市尺度就没它的事了，直接让 MapLibre 别再把这些点送进管线
        maxzoom: 5,
        paint: {
          "circle-color": INK.dot,
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 0, 0.95, 2, 1.1, 4, 1.35],
          /*
           * 放大到城市级就退场。粒子在全球尺度是纹理，
           * 贴近地面时留下的只会是几个孤立的光点，反而干扰电台点位。
           *
           * 整屏之后这一层要更淡：球放大了近一倍，同样的粒子密度看起来
           * 从「一层薄雾」变成了「砂纸」。压到 0.45 之后它退回纹理，
           * 发光的电台点才是画面里唯一亮的东西。
           */
          "circle-opacity": ["interpolate", ["linear"], ["zoom"], 0, 0.45, 3, 0.36, 3.8, 0.12, 4.6, 0],
        },
      },

      /*
       * ---------- 电台：每个台都是一个光点 ----------
       *
       * 这里原来开着聚合：远处一片点收成一个带数字的圆，点开才散成单点。
       * 那颗数字把画面从「世界上哪里有台」变成了「这里有 48 个」，而且
       * 全球视角下密集区被收成了一两个圆圈，密度差反而看不出来了。
       *
       * 现在全部铺开。两千个 circle feature 对 GPU 是小数目——每个点不过
       * 两个三角形——换来的是密集处自己亮起来：欧洲、华北、巴西南岸的亮度
       * 差就是密度差，不需要一个数字替它说话。
       *
       * 一个光点由两层叠出来：外圈 circle-blur: 1，半径给大、透明度压低，
       * 只看得到光晕；内芯几乎不 blur、颜色偏白，中心才有那颗「源」。
       * 只画一层的话，要么是糊开的圆斑，要么是死板的圆点。
       *
       * 也不再按点击量分色——全图一种暖色，画面读起来是「光的分布」，
       * 而不是一张热度排序图。想找热门的台，列表里有的是排序方式。
       */
      /*
       * 光点分两类，用 filter 分开，不再混在同一层里：
       *   - 真实坐标（approx=0）：暖色亮点，是「发射台在那里」的实感
       *   - 推断坐标（approx=1，以中国台为主）：冷色亮点，是「大概在这一带」的估算
       *
       * 两类的形状、大小、亮度完全一致，仅色相不同。冷色提醒「这是台名推出来的
       * 大概位置」，但不再做成空心环——空心环会让这些台看起来像是「假的」，
       * 而它们同样是真实在播的台，只是坐标精度低一档而已。
       */
      {
        id: "station-glow",
        type: "circle",
        source: "stations",
        filter: ["==", ["get", "approx"], 0],
        paint: {
          "circle-color": "#f0a63c",
          "circle-blur": 1,
          /*
           * 全球视角下压得比城市尺度低一点。z0 时两千个光晕挤在几块大陆上，
           * 单点太亮会让整片陆地过曝成一块橙斑，密度差反而糊掉了。
           */
          "circle-opacity": ["interpolate", ["linear"], ["zoom"], 0, 0.34, 3, 0.5, 7, 0.55],
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 0, 4.6, 3, 7.5, 6, 11.5, 9, 16],
        },
      },
      {
        id: "station-dot",
        type: "circle",
        source: "stations",
        filter: ["==", ["get", "approx"], 0],
        paint: {
          "circle-color": "#fff2dd",
          /*
           * 内芯很小，但必须随缩放长大。
           *
           * 1.1px 在全球视角刚好是「一个亮点」；到了城市尺度，视野里只剩
           * 几个台，光晕的半径已经涨到 16px，内芯要是还停在 1px，看到的
           * 就只是一团雾。它得跟着长，光点才始终有个抓得住的核心。
           */
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 0, 1.1, 3, 1.5, 6, 2.2, 9, 3],
        },
      },
      /*
       * 推断点的两层：和真实点完全同构，只是把暖色换成冷色。
       *
       * 光晕和内芯的半径、透明度、blur 都和 station-glow / station-dot
       * 逐项一致，仅颜色不同——所以并排看时密度、亮度、大小没有区别，
       * 只靠色相分开「实测坐标」与「估算坐标」。
       */
      {
        id: "station-approx-glow",
        type: "circle",
        source: "stations",
        filter: ["==", ["get", "approx"], 1],
        paint: {
          "circle-color": "#5aa9c9",
          "circle-blur": 1,
          "circle-opacity": ["interpolate", ["linear"], ["zoom"], 0, 0.34, 3, 0.5, 7, 0.55],
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 0, 4.6, 3, 7.5, 6, 11.5, 9, 16],
        },
      },
      {
        id: "station-approx-dot",
        type: "circle",
        source: "stations",
        filter: ["==", ["get", "approx"], 1],
        paint: {
          "circle-color": "#cfe8ff",
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 0, 1.1, 3, 1.5, 6, 2.2, 9, 3],
        },
      },
      /*
       * 电台名。
       *
       * 默认就打开。光点回答的是「哪里在亮」，名字回答的是「那里是谁」——
       * 而后者才是大多数人打开这张图想知道的。让人先点开一个点才看到名字，
       * 等于把答案藏起来。
       *
       * 密度交给避让算法，不交给开关：两千个台不可能同时写出来，MapLibre
       * 会按 symbol-sort-key 从点击量高的开始抢位置，写不下的自己消失；
       * 放大之后视野收窄、能写的变少，剩下的名字补上来。全球视角下真正
       * 留在屏幕上的是一小批最有代表性的台，读起来是「几个熟悉的名字」，
       * 而不是一张挤满字的表格。
       *
       * 不设 minzoom：设了就会出现「打开了却什么都没出现」的情况。
       * 开关仍在右上角，觉得字多可以整层关掉。
       *
       * 中西文混排时，中文由 localIdeographFontFamily 用系统字体现画，
       * 拉丁字符走 FMRadio.pbf；两套字形在同一个 symbol 层里 MapLibre
       * 会自动分工，不需要拆成两层。
       */
      {
        id: LAYER.label,
        type: "symbol",
        source: "stations",
        layout: {
          "text-field": ["get", "name"],
          "text-font": [FONT],
          "text-size": 11,
          "text-max-width": 10,
          "text-anchor": "top",
          "text-offset": [0, 0.7],
          /*
           * 点击量大的台优先占位。
           *
           * 光靠避让会挑出「谁先被遍历到就显示谁」——结果是一堆小台挤掉
           * CCTV、各省新闻广播这些真正该露脸的。sort-key 取点击量负数，
           * 让避让算法从最有代表性的开始挑。
           */
          "symbol-sort-key": ["-", ["get", "clicks"]],
          /* 允许碰撞时只画得下几个，也不要把它们叠在一起 */
          "text-allow-overlap": false,
          "text-ignore-placement": false,
          "text-padding": 4,
          "text-optional": true,
        },
        paint: {
          "text-color": "#e6d3b4",
          "text-halo-color": INK.sea,
          "text-halo-width": 1.3,
        },
      },

      /* 一层几乎全透明的「命中区」，让手指不用点在 1px 的内芯上 */
      {
        id: "station-hit",
        type: "circle",
        source: "stations",
        paint: {
          "circle-color": "#000000",
          "circle-opacity": 0.002,
          "circle-radius": 14,
        },
      },
    ],
  };
}

export const LAYER = {
  land: "land",
  landDots: "land-dots",
  dot: "station-dot",
  label: "station-label",
  hit: "station-hit",
} as const;

export const SOURCE_ID = "stations";
export const LAND_DOTS_SOURCE = SOURCE_DOTS;
export const LAND_SOURCE = SOURCE_LAND;
