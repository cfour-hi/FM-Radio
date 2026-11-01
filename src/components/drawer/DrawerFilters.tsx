import { GENRES, LANGUAGE_LABELS } from "../../lib/stationDiscovery";

type Props = {
  /** 全量目录里出现过的语言（含懒加载的无坐标台） */
  languages: string[];
  language: string;
  genre: string;
  filtering: boolean;
  onLanguage: (value: string) => void;
  onGenre: (value: string) => void;
  onClear: () => void;
};

/* 可折叠的语言与类型筛选，以及下方的已选条件 chips。 */
export default function DrawerFilters({
  languages,
  language,
  genre,
  filtering,
  onLanguage,
  onGenre,
  onClear,
}: Props) {
  return (
    <>
      <details className="border-b border-line px-4 py-1">
        <summary className="ml-4 min-h-9 cursor-pointer list-item py-2 text-[13px] text-muted">语言与类型</summary>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <select
            aria-label="筛选语言"
            value={language}
            onChange={(event) => onLanguage(event.target.value)}
            className="h-10 min-w-0 rounded border border-line bg-base px-2 text-[12px] text-ink"
          >
            <option value="">全部语言</option>
            {languages.map((key) => (
              <option key={key} value={key}>{LANGUAGE_LABELS[key] ?? key}</option>
            ))}
          </select>
          <select
            aria-label="筛选类型"
            value={genre}
            onChange={(event) => onGenre(event.target.value)}
            className="h-10 min-w-0 rounded border border-line bg-base px-2 text-[12px] text-ink"
          >
            <option value="">全部类型</option>
            {GENRES.map((item) => (
              <option key={item.key} value={item.key}>{item.label}</option>
            ))}
          </select>
        </div>
      </details>

      {filtering && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-1">
          {language && (
            <button
              type="button"
              aria-label="移除语言筛选"
              onClick={() => onLanguage("")}
              className="min-h-9 rounded border border-line px-2 text-[12px] text-signal"
            >
              {LANGUAGE_LABELS[language] ?? language} ×
            </button>
          )}
          {genre && (
            <button
              type="button"
              aria-label="移除类型筛选"
              onClick={() => onGenre("")}
              className="min-h-9 rounded border border-line px-2 text-[12px] text-signal"
            >
              {GENRES.find((item) => item.key === genre)?.label} ×
            </button>
          )}
          <button type="button" onClick={onClear} className="min-h-9 px-1 text-[12px] text-muted">清除筛选</button>
        </div>
      )}
    </>
  );
}
