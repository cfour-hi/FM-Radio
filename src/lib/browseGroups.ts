import { countryNameOf } from "./countryNames";
import type { Station } from "./types";

/**
 * 按国家 / 地区分组的浏览索引。
 *
 * 中国按省（再收集城市），境外按 state；没有归属的归到「其他」。只做纯
 * 计算，隐藏台的过滤由调用方先做，排序按数量降序、再按名称。
 */

export type BrowseCity = { key: string; name: string; count: number };
export type BrowseRegion = { key: string; name: string; count: number; cities: BrowseCity[] };
export type BrowseCountry = { code: string; name: string; count: number; regions: BrowseRegion[] };

export const OTHER_REGION = "其他";

const byCountThenName = <T extends { count: number; name: string }>(a: T, b: T): number =>
  b.count - a.count || a.name.localeCompare(b.name, "zh-CN");

export function buildBrowseGroups(stations: Station[]): BrowseCountry[] {
  const countries = new Map<
    string,
    {
      code: string;
      name: string;
      count: number;
      regions: Map<string, { name: string; count: number; cities: Map<string, { name: string; count: number }> }>;
    }
  >();

  for (const station of stations) {
    const code = station.countryCode?.toUpperCase();
    if (!code) continue;

    const country = countries.get(code) ?? {
      code,
      // 中文界面优先用 Intl 的国名；数据里的英文全称只在语言包缺失时兜底
      name: countryNameOf(code) || station.countryName || code,
      count: 0,
      regions: new Map(),
    };
    country.count += 1;

    const regionName = station.province || station.state || OTHER_REGION;
    const region = country.regions.get(regionName) ?? { name: regionName, count: 0, cities: new Map() };
    region.count += 1;

    if (station.city) {
      const city = region.cities.get(station.city) ?? { name: station.city, count: 0 };
      city.count += 1;
      region.cities.set(station.city, city);
    }

    country.regions.set(regionName, region);
    countries.set(code, country);
  }

  return [...countries.values()]
    .sort(byCountThenName)
    .map((country) => ({
      code: country.code,
      name: country.name,
      count: country.count,
      regions: [...country.regions.values()]
        .sort((a, b) => (a.name === OTHER_REGION ? 1 : b.name === OTHER_REGION ? -1 : byCountThenName(a, b)))
        .map((region) => ({
          key: region.name,
          name: region.name,
          count: region.count,
          cities: [...region.cities.values()].sort(byCountThenName).map((city) => ({
            key: city.name,
            name: city.name,
            count: city.count,
          })),
        })),
    }));
}
