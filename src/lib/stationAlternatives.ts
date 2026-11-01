import { distanceKm, validGeo } from "./nearbyStations";
import type { Station } from "./types";

/*
 * 「这个台播不了，附近还有哪个能听？」
 *
 * 失败态最需要的不是「重试」（同一个坏流再点一次大概率还是坏），而是一个
 * 能立刻出声的替代。选谁的原则只有一条：离得越近越像是用户在找的那一类
 * 声音——同城的话，连节目形态都常常是一路的。
 *
 * 中国台有省市字段，直接按省/市分档；境外台没有，退到国家代码 + 球面距离。
 */

/** 境外台的「近」：300 公里大约是同一个都市圈，1500 公里是同语区邻国 */
const NEAR_KM = 300;
const REGION_KM = 1500;

/** 无穷距离在排序里要当成「最远」，不能参与减法（Infinity - Infinity = NaN） */
const distanceKey = (value: number) => (Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER);

type Ranked = { station: Station; tier: number; distance: number };

function rank(current: Station, pool: Station[], accept: (station: Station) => boolean): Ranked[] {
  const out: Ranked[] = [];

  for (const station of pool) {
    if (station.id === current.id) continue;
    if (!accept(station)) continue;

    let distance = Infinity;
    if (current.geo && station.geo && validGeo(current.geo) && validGeo(station.geo)) {
      distance = distanceKm(current.geo, station.geo);
    }

    let tier: number;
    if (current.province) {
      // 中国台：同城 → 同省 → 同国
      const sameProvince = station.province === current.province;
      const sameCity = sameProvince && Boolean(current.city) && station.city === current.city;
      if (sameCity) tier = 0;
      else if (sameProvince) tier = 1;
      else if (station.countryCode && station.countryCode === current.countryCode) tier = 3;
      else continue;
    } else {
      // 境外台：国家代码是唯一可靠的归属，先筛掉其它国家
      if (!current.countryCode || station.countryCode !== current.countryCode) continue;
      tier = distance <= NEAR_KM ? 0 : distance <= REGION_KM ? 1 : 2;
    }

    out.push({ station, tier, distance });
  }

  out.sort(
    (a, b) =>
      a.tier - b.tier ||
      distanceKey(a.distance) - distanceKey(b.distance) ||
      b.station.clicks - a.station.clicks,
  );
  return out;
}

/**
 * 给一个失败的台找替代。
 * @param accept 调用方传「能播且证书没问题」的判断，避免推荐一个同样播不了的
 */
export function pickAlternatives(
  current: Station,
  pool: Station[],
  accept: (station: Station) => boolean = () => true,
  limit = 5,
): Station[] {
  return rank(current, pool, accept).slice(0, limit).map((item) => item.station);
}

/**
 * 有没有替代，找一个就返回。
 * 界面只是要决定「显示不显示这个按钮」，不必为此把队列整个排一遍。
 */
export function hasAlternative(
  current: Station,
  pool: Station[],
  accept: (station: Station) => boolean = () => true,
): boolean {
  for (const station of pool) {
    if (station.id === current.id) continue;
    if (!accept(station)) continue;
    if (current.province) {
      if (station.province === current.province) return true;
      if (station.countryCode && station.countryCode === current.countryCode) return true;
      continue;
    }
    if (current.countryCode && station.countryCode === current.countryCode) return true;
  }
  return false;
}
