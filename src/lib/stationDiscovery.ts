import type { Station } from "./types";

const normalize = (value: string) => value.trim().toLowerCase();
const LANGUAGE_ALIASES: Record<string, string> = {
  zh: "chinese", zho: "chinese", chi: "chinese", mandarin: "chinese", "mandarin chinese": "chinese", 中文: "chinese", 汉语: "chinese", 普通话: "chinese",
  en: "english", eng: "english", 英语: "english", ja: "japanese", jpn: "japanese", 日语: "japanese",
  ko: "korean", kor: "korean", 韩语: "korean", fr: "french", fra: "french", fre: "french",
  de: "german", deu: "german", ger: "german", es: "spanish", spa: "spanish",
  国语: "chinese", 國語: "chinese", 汉语普通话: "chinese", hokkien: "chinese", hakka: "chinese", teochew: "chinese", shanghainese: "chinese",
  "american english": "english", "british english": "english", "english uk": "english", "caribbean english": "english",
  "brazilian portuguese": "portuguese", "português (brasil)": "portuguese", "português brasil": "portuguese", "portugues do brasil": "portuguese", "pt-br": "portuguese", por: "portuguese",
  "español": "spanish", "français": "french", "deutsch": "german", "русский": "russian", "português": "portuguese",
  cantonese: "chinese", "cantonese chinese": "chinese", 粤语: "chinese",
};
export const languageKey = (value: string) => LANGUAGE_ALIASES[normalize(value)] ?? normalize(value);
export const LANGUAGE_LABELS: Record<string, string> = {
  chinese: "中文（含方言）", english: "英语", japanese: "日语", korean: "韩语", french: "法语", german: "德语",
  dutch: "荷兰语", polish: "波兰语", turkish: "土耳其语", greek: "希腊语", swedish: "瑞典语", norwegian: "挪威语", finnish: "芬兰语", danish: "丹麦语",
  thai: "泰语", vietnamese: "越南语", indonesian: "印度尼西亚语", malay: "马来语", tamil: "泰米尔语", bengali: "孟加拉语", urdu: "乌尔都语",
  ukrainian: "乌克兰语", czech: "捷克语", romanian: "罗马尼亚语", hungarian: "匈牙利语", hebrew: "希伯来语", persian: "波斯语", swahili: "斯瓦希里语",
  spanish: "西班牙语", portuguese: "葡萄牙语", russian: "俄语", italian: "意大利语", arabic: "阿拉伯语", hindi: "印地语",
};
export const GENRES = [
  { key: "jazz", label: "爵士", tags: ["jazz", "smooth jazz", "爵士"] },
  { key: "classical", label: "古典", tags: ["classical", "classical music", "古典"] },
  { key: "pop", label: "流行", tags: ["pop", "pop music", "top 40", "流行"] },
  { key: "rock", label: "摇滚", tags: ["rock", "classic rock", "alternative rock", "摇滚"] },
  { key: "electronic", label: "电子", tags: ["electronic", "electro", "dance", "house", "techno", "电子"] },
  { key: "news", label: "新闻", tags: ["news", "news talk", "新闻"] },
  { key: "talk", label: "谈话", tags: ["talk", "talk radio", "news talk", "谈话"] },
  { key: "ambient", label: "轻音乐 / 氛围", tags: ["ambient", "chillout", "easy listening", "lounge", "轻音乐"] },
] as const;
export function matchesFilters(station: Station, language = "", genre = ""): boolean {
  if (language && !station.languages.some((value) => languageKey(value) === language)) return false;
  const category = GENRES.find((item) => item.key === genre);
  return !genre || Boolean(category && station.tags.some((tag) => category.tags.some((alias) => normalize(tag) === alias)));
}
export function languageOptions(stations: Station[]): string[] {
  return [...new Set(stations.flatMap((station) => station.languages.map(languageKey)).filter((key) => Object.hasOwn(LANGUAGE_LABELS, key)))]
    .sort((a, b) => (LANGUAGE_LABELS[a] ?? a).localeCompare(LANGUAGE_LABELS[b] ?? b, "zh-CN"));
}
export type RandomScope = "all" | "chinese" | "region" | "favorites";
export function randomPool(stations: Station[], favorites: Station[], scope: RandomScope, current: Station | null): Station[] {
  const source = scope === "favorites" ? favorites : stations;
  return source.filter((station) => {
    if (scope === "chinese") return matchesFilters(station, "chinese");
    if (scope !== "region") return true;
    if (!current?.countryCode || station.countryCode !== current.countryCode) return false;
    return !current.province || station.province === current.province;
  });
}
/** 避开当前台和最近访问的台；候选耗尽后才允许重复，永不随机回当前台。 */
export function pickRandom(stations: Station[], currentId: string | null, recentIds: string[], random = Math.random): Station | null {
  const candidates = [...new Map(stations.filter((s) => s.id !== currentId).map((s) => [s.id, s])).values()];
  const unseen = candidates.filter((s) => !recentIds.includes(s.id));
  const pool = unseen.length ? unseen : candidates;
  return pool[Math.floor(random() * pool.length)] ?? null;
}
