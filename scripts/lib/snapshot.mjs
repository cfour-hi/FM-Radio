/*
 * 快照校验：写盘之前把整份数据过一遍。
 *
 * 这些检查存在的理由只有一个——发布出去的东西必须完整。构建脚本会从
 * radio-browser 翻几十页拉全量，任何一页失败、任何一条脏数据，都不该
 * 变成用户手里的残缺目录。纯函数，构建脚本和测试共用。
 */

const HTTPS = "https://";

/**
 * 单份分片的逐条检查。
 * 返回 { ok, errors }，errors 是给人看的短句，不做格式化。
 */
export function validateStations(stations, label) {
  const errors = [];
  const ids = new Set();
  const urls = new Set();

  for (const [index, station] of stations.entries()) {
    const where = `${label}[${index}]`;

    if (typeof station.id !== "string" || station.id.length === 0) {
      errors.push(`${where} 缺少 id`);
    } else if (ids.has(station.id)) {
      errors.push(`${where} id 重复：${station.id}`);
    } else {
      ids.add(station.id);
    }

    if (typeof station.name !== "string" || station.name.length === 0) {
      errors.push(`${where} 缺少台名`);
    }

    const url = typeof station.url === "string" ? station.url : "";
    if (!url.startsWith(HTTPS)) {
      errors.push(`${where} 不是 https 流：${url || "(空)"}`);
    } else if (urls.has(url)) {
      errors.push(`${where} 流地址重复：${url}`);
    } else {
      urls.add(url);
    }

    const { lat, lon } = station;
    if (lat === null || lat === undefined || lon === null || lon === undefined) {
      if (lat !== null && lat !== undefined) errors.push(`${where} 只有纬度没有经度`);
      if (lon !== null && lon !== undefined) errors.push(`${where} 只有经度没有纬度`);
    } else if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) {
      errors.push(`${where} 坐标越界：${lat}, ${lon}`);
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * 三份分片合起来的检查：逐片检查之外，再确认同一个台没有跨片重复。
 * 跨片重复会让前端按 id 合并时随机丢掉一份，表现为「地图上有、搜索里没有」。
 */
export function validateSnapshot({ core, rest, catalog }) {
  const errors = [];
  const seen = new Map();

  for (const [label, list] of Object.entries({ core, rest, catalog })) {
    if (!Array.isArray(list)) {
      errors.push(`${label} 不是数组`);
      continue;
    }
    if (list.length === 0) errors.push(`${label} 为空`);
    errors.push(...validateStations(list, label).errors);
    for (const station of list) {
      const previous = seen.get(station.id);
      if (previous) errors.push(`id 跨分片重复：${station.id}（${previous} / ${label}）`);
      else seen.set(station.id, label);
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * 和上一版对比，防止「拉了一半就发布」。
 *
 * 正常周更只会小幅波动；掉超过 15% 基本意味着接口或网络出了问题，
 * 这时宁可让构建失败，也不要把残缺快照推上去。维护者确认没问题时
 * 用 `--force` 跳过这一项。
 */
export function checkShrink(previous, current, { minRatio = 0.85 } = {}) {
  const errors = [];
  for (const key of ["core", "rest", "catalog"]) {
    const before = previous?.[key];
    const after = current?.[key];
    if (!Number.isFinite(before) || before <= 0) continue;
    if (!Number.isFinite(after)) {
      errors.push(`${key} 数量无效：${after}`);
      continue;
    }
    if (after < before * minRatio) {
      errors.push(
        `${key} 从 ${before} 降到 ${after}（低于上一版的 ${Math.round(minRatio * 100)}%）`,
      );
    }
  }
  return { ok: errors.length === 0, errors };
}
