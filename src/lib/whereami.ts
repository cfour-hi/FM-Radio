import { useCallback, useEffect, useRef, useState } from "react";
import { CN_REGIONS } from "./cnRegions";
import { validGeo } from "./nearbyStations";
import type { Geo } from "./types";

export type BrowserLocation = {
  source: "browser";
  geo: Geo;
  /** 浏览器报告的位置精度，单位米。 */
  accuracy: number;
  timestamp: number;
};
export type ManualLocation = { source: "manual"; province: string };
export type Where = BrowserLocation | ManualLocation;
export type LocationResult = { ok: true; where: BrowserLocation } | { ok: false; error: string };

const MANUAL_KEY = "fm:manual-region:v2";
const TTL = 30 * 60 * 1000;
const validProvince = (province: unknown): province is string =>
  typeof province === "string" && CN_REGIONS.some((region) => region.name === province);

/** 只恢复用户手选的地区；旧版 IP/设备推算结果不会成为当前位置。 */
export function readManualLocation(): ManualLocation | null {
  try {
    const raw = sessionStorage.getItem(MANUAL_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as { at: number; province: string };
    const age = Date.now() - cached.at;
    if (!Number.isFinite(age) || age < 0 || age > TTL || !validProvince(cached.province)) return null;
    return { source: "manual", province: cached.province };
  } catch {
    return null;
  }
}

export function saveManualLocation(province: string): ManualLocation | null {
  if (!validProvince(province)) return null;
  try {
    sessionStorage.setItem(MANUAL_KEY, JSON.stringify({ at: Date.now(), province }));
  } catch {
    // 禁止存储时仍可在当前页面使用手选地区。
  }
  return { source: "manual", province };
}

/** 仅由用户点击触发；坐标只留在内存，不发起第三方定位请求或写入存储。 */
export async function locateViaBrowser(): Promise<LocationResult> {
  if (typeof window !== "undefined" && window.isSecureContext === false) {
    return { ok: false, error: "浏览器定位需要 HTTPS，请改用安全连接或手动选择地区。" };
  }
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return { ok: false, error: "当前浏览器不支持定位，请手动选择地区。" };
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: LocationResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      resolve(result);
    };
    const timeout = () => finish({ ok: false, error: "定位超时，请重试或手动选择地区。" });
    const deadline = setTimeout(timeout, 10500);
    try {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude: lat, longitude: lon, accuracy } = position.coords;
          const geo = { lat, lon };
          if (!validGeo(geo) || !Number.isFinite(accuracy) || accuracy < 0) {
            finish({ ok: false, error: "未获取到有效位置，请重试或手动选择地区。" });
            return;
          }
          finish({ ok: true, where: {
            source: "browser", geo, accuracy, timestamp: position.timestamp,
          } });
        },
        (error) => {
          if (error.code === 3) { timeout(); return; }
          finish({ ok: false, error: error.code === 1
            ? "定位权限未获允许，请在浏览器设置中开启，或手动选择地区。"
            : "暂时无法获取设备位置，请重试或手动选择地区。" });
        },
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
      );
    } catch {
      finish({ ok: false, error: "设备定位不可用，请重试或手动选择地区。" });
    }
  });
}

type LocationState = { where: Where | null; loading: boolean; error: string | null };

export function useWhereAmI() {
  const [state, setState] = useState<LocationState>(() => ({
    where: readManualLocation(), loading: false, error: null,
  }));
  const requestId = useRef(0);
  const mounted = useRef(false);
  const busy = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requestId.current += 1;
      busy.current = false;
    };
  }, []);

  const requestBrowserLocation = useCallback(() => {
    if (busy.current) return;
    busy.current = true;
    const id = ++requestId.current;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    void locateViaBrowser().then((result) => {
      if (!mounted.current || id !== requestId.current) return;
      busy.current = false;
      setState((prev) => ({
        where: result.ok ? result.where : prev.where,
        loading: false,
        error: result.ok ? null : result.error,
      }));
    });
  }, []);

  const selectProvince = useCallback((province: string) => {
    const where = saveManualLocation(province);
    if (!where) return;
    requestId.current += 1;
    busy.current = false;
    setState({ where, loading: false, error: null });
  }, []);

  return { ...state, selectProvince, requestBrowserLocation };
}
