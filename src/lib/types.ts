export type Geo = {
  lat: number;
  lon: number;
};

/** 归一化之后的电台。所有字段保证存在，可空的地方用 null 而不是 undefined。 */
export type Station = {
  id: string;
  name: string;
  /** 已经过 https 校验的流地址 */
  url: string;
  homepage: string | null;
  favicon: string | null;
  countryCode: string;
  countryName: string;
  state: string | null;
  languages: string[];
  tags: string[];
  /** MP3 / AAC / AAC+ / OGG / UNKNOWN */
  codec: string;
  bitrate: number;
  votes: number;
  clicks: number;
  /** 没有经纬度的台约占四分之三 */
  geo: Geo | null;
  /**
   * 坐标是推断出来的，不是电台自己报的。
   *
   * 中国有一千多个台在众包库里没有坐标，但台名里带地名（「佛山电台」）。
   * 这类台的位置是按城市中心加抖动算出来的，只精确到「大概是哪座城市」。
   * 界面上要说明这一点，不能让用户以为那是发射塔的实地位置。
   */
  geoApprox: boolean;
  /** 推断出来的落点城市名，如「佛山」。真实坐标时为 null */
  place: string | null;
  lastCheckOk: boolean;
  /** 接口直接标明的 HLS 流，比字符串匹配可靠 */
  hls: boolean;
  /** 证书异常：流地址是 https 但握手很可能失败 */
  sslError: boolean;
  /**
   * 归属：省级行政区名（「湖南」「中国香港」的省名部分是「香港」）。
   *
   * 这一列是中国台独有的补充信息——radio-browser 的 state 字段只覆盖一部分，
   * 而且写法混乱（Guangdong / Kwangtung / gd / 广东 / hun 都有）。
   * 归它之前的前置问题在 scripts/cn-geo.mjs，前端只负责显示与筛选。
   * 非中国台为 null。
   */
  province: string | null;
  /** 归属城市（「长沙」）。只知道省时这里是省会，配合 geoPrecision 一起读。 */
  city: string | null;
  /**
   * 归属精确到哪一级。
   *
   * city     城市是算出来的（台名/state/品牌台呼给了城市级线索）
   * province 只知道省，城市那个值只是省会，不能当事实用
   * null     没有归属
   */
  geoPrecision: "city" | "province" | null;
};

export type SearchInput = {
  q?: string | undefined;
  countryCode?: string | undefined;
  tag?: string | undefined;
  language?: string | undefined;
  limit?: number | undefined;
};
