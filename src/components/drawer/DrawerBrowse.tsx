import { useMemo, useState } from "react";
import StationRow from "../StationRow";
import { OTHER_REGION, type BrowseCountry } from "../../lib/browseGroups";
import type { Station } from "../../lib/types";

type Seed = { country: string; province: string | null };

type Props = {
  stations: Station[];
  countries: BrowseCountry[];
  /** 深链 ?c=&p= 的初始位置；只读一次 */
  seed?: Seed | null;
  onPickStation: (station: Station) => void;
};

const ROW =
  "flex min-h-11 w-full items-center justify-between gap-2 border-b border-line-soft px-4 text-left transition-colors hover:bg-surface";

/* 按国家 → 地区 → 电台浏览；中国在地区层再提供城市筛选。 */
export default function DrawerBrowse({ stations, countries, seed, onPickStation }: Props) {
  const [countryCode, setCountryCode] = useState<string | null>(seed?.country ?? null);
  const [regionKey, setRegionKey] = useState<string | null>(seed?.province ?? null);
  const [city, setCity] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(50);

  const country = countryCode ? countries.find((item) => item.code === countryCode) ?? null : null;
  const region = country && regionKey ? country.regions.find((item) => item.key === regionKey) ?? null : null;

  const list = useMemo(() => {
    if (!country) return [];
    return stations
      .filter((station) => {
        if (station.countryCode.toUpperCase() !== country.code) return false;
        if (region && (station.province || station.state || OTHER_REGION) !== region.key) return false;
        if (city && station.city !== city) return false;
        return true;
      })
      .sort((a, b) => b.clicks - a.clicks);
  }, [stations, country, region, city]);

  const reset = () => setVisibleCount(50);

  if (!countries.length) {
    return <p className="px-3 py-8 text-center text-[12px] text-muted">目录还在加载…</p>;
  }

  /* 国家列表 */
  if (!country) {
    return (
      <div data-drawer-scroll className="min-h-0 flex-1 overflow-y-auto">
        <p className="num px-4 py-2 text-[11px] uppercase tracking-[0.14em] text-dim">
          全部国家 · {countries.length} 个
        </p>
        <ul role="listbox" aria-label="国家列表">
          {countries.map((item) => (
            <li key={item.code}>
              <button
                type="button"
                data-browse-country={item.code}
                onClick={() => {
                  setCountryCode(item.code);
                  setRegionKey(null);
                  setCity(null);
                  reset();
                }}
                className={ROW}
              >
                <span className="truncate text-[13px] text-ink">{item.name}</span>
                <span className="num shrink-0 text-[11px] text-dim">{item.count}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  /* 地区列表 */
  if (!region) {
    return (
      <div data-drawer-scroll className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2">
          <button
            type="button"
            onClick={() => {
              setCountryCode(null);
              setRegionKey(null);
              setCity(null);
              reset();
            }}
            aria-label="返回国家列表"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-[6px] text-dim transition-colors hover:text-ink"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </button>
          <p className="num truncate text-[12px] text-dim">{country.name} · {country.count} 个台</p>
        </div>
        <ul role="listbox" aria-label="地区列表">
          {country.regions.map((item) => (
            <li key={item.key}>
              <button
                type="button"
                data-browse-region={item.key}
                onClick={() => {
                  setRegionKey(item.key);
                  setCity(null);
                  reset();
                }}
                className={ROW}
              >
                <span className="truncate text-[13px] text-ink">{item.name}</span>
                <span className="num shrink-0 text-[11px] text-dim">{item.count}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const shown = list.slice(0, visibleCount);

  return (
    <>
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <button
          type="button"
          onClick={() => {
            setRegionKey(null);
            setCity(null);
            reset();
          }}
          aria-label="返回地区列表"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-[6px] text-dim transition-colors hover:text-ink"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </button>
        <p className="num truncate text-[12px] text-dim">
          {country.name} · {region.name} · {list.length} 个台
        </p>
      </div>

      {region.cities.length > 1 && (
        <div className="flex flex-wrap gap-1.5 border-b border-line px-3 py-2">
          <button
            type="button"
            data-browse-city="__all__"
            aria-pressed={city === null}
            onClick={() => {
              setCity(null);
              reset();
            }}
            className={`min-h-9 rounded-[6px] border px-2 text-[12px] ${
              city === null ? "border-signal/40 text-ink" : "border-line text-muted"
            }`}
          >
            全部
          </button>
          {region.cities.map((item) => (
            <button
              key={item.key}
              type="button"
              data-browse-city={item.key}
              aria-pressed={city === item.key}
              onClick={() => {
                setCity(item.key);
                reset();
              }}
              className={`min-h-9 rounded-[6px] border px-2 text-[12px] ${
                city === item.key ? "border-signal/40 text-ink" : "border-line text-muted"
              }`}
            >
              {item.name}
              <span className="num ml-1 text-[10px] text-dim">{item.count}</span>
            </button>
          ))}
        </div>
      )}

      <div data-drawer-scroll className="min-h-0 flex-1 overflow-y-auto">
        {list.length === 0 ? (
          <p className="px-3 py-8 text-center text-[12px] text-muted">该地区暂无已加载电台</p>
        ) : (
          <>
            <ul role="listbox" aria-label="电台列表">
              {shown.map((station, index) => (
                <StationRow
                  key={station.id}
                  station={station}
                  index={index}
                  queue={list}
                  compact
                  onPick={onPickStation}
                  note={station.geo ? "" : "无法定位"}
                />
              ))}
            </ul>
            {shown.length < list.length && (
              <button
                type="button"
                onClick={() => setVisibleCount((count) => count + 50)}
                className="mx-4 my-3 min-h-11 rounded border border-line px-4 text-[13px] text-signal"
              >
                加载更多（还有 {list.length - shown.length} 个）
              </button>
            )}
          </>
        )}
      </div>
    </>
  );
}
